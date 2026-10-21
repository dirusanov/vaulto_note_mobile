const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, imports = {}, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: (name) => { if (!(name in imports)) throw Error(`Unexpected dependency ${name}`); return imports[name]; }, console, setTimeout, clearTimeout, AbortController, ...globals }, { filename: file });
  return exports;
}
const policy = load('src/services/offlineModelPolicy.ts');
const caps = (ram, low = false) => ({ totalMemoryBytes: ram, cpuCount: 4, isLowRamDevice: low });
test('automatic offline downloads keep weak/unknown devices to speech, without blocking explicit capable-device AI', () => {
  assert.equal(policy.recommendSpeechModel(caps(0)), 'base');
  assert.equal(policy.recommendOfflineAI(caps(0)), false);
  assert.equal(policy.recommendSpeechModel(caps(1.5e9)), 'tiny');
  assert.equal(policy.hasLocalAIMemoryBudget(caps(1.5e9)), false);
  assert.equal(policy.recommendSpeechModel(caps(2.5e9)), 'base');
  assert.equal(policy.recommendOfflineAI(caps(2.5e9)), false);
  assert.equal(policy.hasLocalAIMemoryBudget(caps(2.5e9)), true);
  assert.equal(policy.hasLocalAIMemoryBudget(caps(2.5e9), 1280835840), false);
  assert.equal(policy.hasLocalAIMemoryBudget(caps(4e9), 1280835840), true);
  assert.equal(policy.hasLocalAIMemoryBudget(caps(4e9), 2740937888), false);
  assert.equal(policy.recommendOfflineAI(caps(8e9, true)), false);
  assert.equal(policy.recommendSpeechModel(caps(8e9, true)), 'tiny');
  assert.equal(policy.recommendOfflineAI(caps(4e9)), true);
});
function queueStore() {
  const values = new Map();
  let failWrite = false;
  const storage = {
    getItem: async (key) => { await new Promise(r => setTimeout(r, 2)); return values.get(key) ?? null; },
    setItem: async (key, value) => { if (failWrite) throw Error('storage full'); values.set(key, value); },
    removeItem: async (key) => { values.delete(key); }, getAllKeys: async () => [...values.keys()],
  };
  return { values, fail: () => { failWrite = true; }, restart: () => load('src/services/pendingTranscriptions.ts', { '@react-native-async-storage/async-storage': storage }) };
}
const plain = (value) => JSON.parse(JSON.stringify(value));
test('pending recordings survive cold module restart and keep their original target version', async () => {
  const store = queueStore(); const queue = store.restart();
  await queue.enqueuePendingTranscription('a', { noteId: 'note', recordingId: 'r', variantId: 'summary' });
  const reloaded = store.restart();
  assert.deepEqual(plain(await reloaded.getPendingTranscriptions('a', 'note')), [{ noteId: 'note', recordingId: 'r', variantId: 'summary' }]);
});
test('concurrent recording/reconnect writes do not lose jobs; acknowledgements are scoped and idempotent', async () => {
  const store = queueStore(); const queue = store.restart();
  await Promise.all(Array.from({ length: 12 }, (_, i) => queue.enqueuePendingTranscription('a', { noteId: 'n', recordingId: `r${i}`, variantId: 'original' })));
  await queue.enqueuePendingTranscription('a', { noteId: 'other', recordingId: 'r0', variantId: 'original' });
  await queue.enqueuePendingTranscription('b', { noteId: 'n', recordingId: 'r0', variantId: 'original' });
  assert.equal((await queue.getPendingTranscriptions('a', 'n')).length, 12);
  await Promise.all([queue.removePendingTranscription('a', 'n', 'r0'), queue.removePendingTranscription('a', 'n', 'r0')]);
  assert.equal((await queue.getPendingTranscriptions('a', 'n')).length, 11);
  assert.equal((await queue.getPendingTranscriptions('a', 'other')).length, 1);
  await queue.clearPendingTranscriptions('a');
  assert.equal((await queue.getPendingTranscriptions('a', 'n')).length, 0);
  assert.equal((await queue.getPendingTranscriptions('b', 'n')).length, 1);
});
test('failed persistence rejects instead of promising a durable retry', async () => {
  const store = queueStore(); store.fail();
  await assert.rejects(store.restart().enqueuePendingTranscription('a', { noteId: 'n', recordingId: 'r', variantId: 'original' }), /storage full/);
  assert.equal((await store.restart().getPendingTranscriptions('a', 'n')).length, 0);
});
function transcription(options = {}) {
  const state = { downloaded: false, offline: false, privateMode: false, limited: false, networkFailure: false, status: 200, provider: 'vaulto_ai', ...options };
  const calls = { cloud: 0, local: 0, limit: 0, keys: [] };
  const imports = {
    axios: { isAxiosError: () => false },
    'expo-file-system/legacy': { getInfoAsync: async () => ({ exists: true, size: 100 }), deleteAsync: async () => {} },
    'expo-file-system': { File: class File {} },
    'react-native': { Platform: { OS: 'android' } },
    '../utils/env': { API_URL: 'https://qa.invalid' },
    '../utils/storage': { storage: { getToken: async () => 'synthetic-token' }, getAIProvider: async () => state.provider, getOnDeviceTranscription: async () => state.privateMode, getTranscriptionLanguage: async () => 'auto', getOpenAIApiKey: async () => 'synthetic-key', getOpenAIBaseUrl: async () => 'https://qa.invalid' },
    '../utils/featureFlags': { LOCAL_WHISPER_ENABLED: true },
    '../utils/openaiCompat': { buildOpenAICompatibleUrl: (base, route) => base + route }, '../utils/richContent': {},
    '../utils/uuid': { generateUUID: async () => 'qa-request' },
    '../utils/authEvents': {}, '../api/tokenRefresh': {}, '../utils/deviceIdentity': {},
    '../utils/connectivity': { isDeviceOffline: async () => state.offline },
    '../utils/limitEvents': { onLimitReached: { emit: () => { calls.limit++; } } },
    './LocalWhisperService': {
      getLocalWhisperModelStatus: async () => {
        if (state.modelStatusError) throw Error('Model storage is unavailable');
        return { isDownloaded: state.downloaded };
      },
      prepareAudioForLocalWhisper: async (uri) => uri,
      transcribeWithLocalWhisper: async () => { calls.local++; return 'Local transcript'; },
    },
  };
  const service = load('src/services/TranscriptionService.ts', imports, {
    Error, TypeError,
    FormData: class { append() {} },
    fetch: async (_url, init) => {
      calls.cloud++; calls.keys.push(init.headers['Idempotency-Key']);
      if (state.networkFailure === 'timeout') { const error = new Error('Aborted'); error.name = 'AbortError'; throw error; }
      if (state.networkFailure) throw new TypeError('Network request failed');
      const status = state.limited ? 403 : state.status;
      return { status, ok: status === 200, headers: { get: () => 'application/json' }, json: async () => ({ text: 'Cloud transcript', detail: 'Rejected request' }) };
    },
  });
  return { service, calls, state };
}
test('protected audio never falls back to the cloud, including when no model is available', async () => {
  for (const downloaded of [false, true]) {
    const { service, calls } = transcription({ downloaded });
    const result = await service.transcribeAudio('file://fictional.m4a', undefined, { onDeviceOnly: true });
    assert.equal(calls.cloud, 0);
    assert.equal(result.success, downloaded);
    assert.equal(calls.local, downloaded ? 1 : 0);
    if (!downloaded) assert.equal(result.error, service.ON_DEVICE_MODEL_REQUIRED);
  }
});
test('phone-only preference never uploads audio when the downloaded model becomes unavailable', async () => {
  for (const provider of ['vaulto_ai', 'openai', 'local']) {
    for (const unavailable of [{ downloaded: false }, { downloaded: true, modelStatusError: true }]) {
      const { service, calls } = transcription({ privateMode: true, provider, ...unavailable });
      const modes = [];
      const result = await service.transcribeAudio('file://fictional.m4a', undefined, { onMode: mode => modes.push(mode) });
      assert.equal(calls.cloud, 0, `Privacy preference must survive a missing model (${provider})`);
      assert.equal(calls.local, 0);
      assert.equal(result.success, false);
      assert.equal(result.error, service.ON_DEVICE_MODEL_REQUIRED);
      assert.deepEqual(modes, ['device']);
    }
  }
});
test('phone-only voice never selects the cloud command agent, even with only speech installed', async () => {
  const state = { privateMode: false, offline: false, ready: true, model: 'qwen3.5-2b' };
  const { resolveVoiceAgentRoute } = load('src/services/voiceAgent.ts', {
    '../utils/storage': { getAIProvider: async () => 'vaulto_ai', getOnDeviceTranscription: async () => state.privateMode },
    '../utils/connectivity': { isDeviceOffline: async () => state.offline },
    './effectiveProvider': { isLocalLLMReady: async () => state.ready },
    './LocalLLMService': { getSelectedLocalLLMModel: async () => ({ key: state.model }) },
  });
  assert.equal(await resolveVoiceAgentRoute({ signedIn: true }), 'cloud');
  state.privateMode = true;
  assert.equal(await resolveVoiceAgentRoute({ signedIn: true }), 'device');
  state.model = 'qwen3.5-0.8b';
  assert.equal(await resolveVoiceAgentRoute({ signedIn: true }), null);
  state.ready = false;
  assert.equal(await resolveVoiceAgentRoute({ signedIn: true }), null);
  state.privateMode = false;
  assert.equal(await resolveVoiceAgentRoute({ signedIn: true, protectedNote: true }), null);
});
test('a downloaded model stays a backup online, activates offline or by choice, and handles exhausted cloud minutes', async () => {
  for (const options of [ {}, { offline: true }, { privateMode: true }, { limited: true } ]) {
    const { service, calls } = transcription({ downloaded: true, ...options });
    const modes = [];
    const result = await service.transcribeAudio('file://fictional.m4a', undefined, { idempotencyKey: 'recording-42', onMode: (mode) => modes.push(mode) });
    assert.equal(result.success, true);
    const directLocal = options.offline || options.privateMode;
    assert.equal(calls.cloud, directLocal ? 0 : 1);
    assert.equal(calls.local, directLocal || options.limited ? 1 : 0);
    assert.equal(calls.limit, 0);
    assert.deepEqual(calls.keys, directLocal ? [] : ['recording-42']);
    assert.deepEqual(modes, directLocal ? ['device'] : options.limited ? ['cloud', 'device'] : ['cloud']);
  }
});

test('online → offline → online switches each new recording automatically without sticking to local processing', async () => {
  const { service, calls, state } = transcription({ downloaded: true });
  const modes = [];
  for (const offline of [false, true, false]) {
    state.offline = offline;
    const result = await service.transcribeAudio('file://fictional.m4a', undefined, { onMode: mode => modes.push(mode) });
    assert.equal(result.success, true);
  }
  assert.deepEqual(modes, ['cloud', 'device', 'cloud']);
  assert.equal(calls.cloud, 2); assert.equal(calls.local, 1);
  state.privateMode = true;
  await service.transcribeAudio('file://fictional.m4a');
  assert.equal(calls.cloud, 2); assert.equal(calls.local, 2);
});

test('a transport failure after the online check uses the downloaded model; reconnection restores cloud', async () => {
  const { service, calls, state } = transcription({ downloaded: true, networkFailure: true });
  const modes = [];
  let result = await service.transcribeAudio('file://fictional.m4a', undefined, { onMode: mode => modes.push(mode) });
  assert.equal(result.success, true); assert.equal(result.text, 'Local transcript');
  assert.deepEqual(modes, ['cloud', 'device']);
  state.networkFailure = false;
  result = await service.transcribeAudio('file://fictional.m4a');
  assert.equal(result.text, 'Cloud transcript');
  assert.equal(calls.local, 1); assert.equal(calls.cloud, 2);
});

test('cloud timeouts and custom-service transport failures also fall back to downloaded speech', async () => {
  for (const options of [{ networkFailure: 'timeout' }, { provider: 'openai', networkFailure: true }]) {
    const { service, calls } = transcription({ downloaded: true, ...options });
    const result = await service.transcribeAudio('file://fictional.m4a');
    assert.equal(result.success, true); assert.equal(result.text, 'Local transcript');
    assert.equal(calls.cloud, 1); assert.equal(calls.local, 1);
  }
});

test('missing offline models and rejected HTTP requests are not disguised as successful local transcription', async () => {
  const missing = transcription({ networkFailure: true });
  const failed = await missing.service.transcribeAudio('file://fictional.m4a');
  assert.equal(failed.success, false); assert.equal(failed.errorKind, 'network'); assert.equal(missing.calls.local, 0);
  for (const status of [400, 422, 500]) {
    const { service, calls } = transcription({ downloaded: true, status });
    assert.equal((await service.transcribeAudio('file://fictional.m4a')).success, false);
    assert.equal(calls.local, 0);
  }
});

test('text improvements return to the chosen cloud after reconnecting and respect an explicit local choice', async () => {
  const state = { provider: 'vaulto_ai', offline: false, downloaded: true, privateMode: false };
  const { getEffectiveAIProvider } = load('src/services/effectiveProvider.ts', {
    '../utils/storage': { getAIProvider: async () => state.provider, getOnDeviceTranscription: async () => state.privateMode },
    '../utils/connectivity': { isDeviceOffline: async () => state.offline },
    '../utils/featureFlags': { LOCAL_MODELS_ENABLED: true },
    './LocalLLMService': { isLocalLLMRuntimeAvailable: () => true, getLocalLLMModelStatus: async () => ({ isDownloaded: state.downloaded }) },
  });
  for (const offline of [false, true, false]) {
    state.offline = offline;
    assert.equal(await getEffectiveAIProvider(), offline ? 'local' : 'vaulto_ai');
  }
  state.provider = 'local';
  assert.equal(await getEffectiveAIProvider(), 'local');
  state.provider = 'vaulto_ai'; state.privateMode = true;
  assert.equal(await getEffectiveAIProvider(), 'local');
  state.privateMode = false;
  state.provider = 'vaulto_ai'; state.offline = true; state.downloaded = false;
  assert.equal(await getEffectiveAIProvider(), 'vaulto_ai');
});


test('guest migration moves pending identifiers to the same owner as the recordings', async () => {
  const store = queueStore(); const queue = store.restart();
  await queue.enqueuePendingTranscription('guest', { noteId: 'n', recordingId: 'r', variantId: 'original', segments: ['file://cached-part'] });
  await queue.enqueuePendingTranscription('other', { noteId: 'other-n', recordingId: 'other-r', variantId: 'original' });
  await queue.movePendingTranscriptions('guest', 'account');
  assert.equal((await queue.getPendingTranscriptions('guest', 'n')).length, 0);
  assert.deepEqual(plain(await store.restart().getPendingTranscriptions('account', 'n'))[0].segments, ['file://cached-part']);
  assert.equal((await queue.getPendingTranscriptions('other', 'other-n')).length, 1);
});

test('plain dictation and encrypted meeting retry metadata survive cold restart', async () => {
  const store = queueStore(); const q = store.restart();
  await q.enqueuePendingTranscription('a', { noteId: 'n', recordingId: 'r', variantId: 'original', micMode: 'force_text', segments: ['file://encrypted-part'], segmentsEncrypted: true });
  const [job] = await store.restart().getPendingTranscriptions('a', 'n');
  assert.equal(job.micMode, 'force_text'); assert.equal(job.segmentsEncrypted, true);
  const paths = await q.clearPendingTranscriptions('a');
  assert.deepEqual(plain(paths), ['file://encrypted-part']);
});

test('a failed meeting part is never acknowledged as complete and decrypted temporary files are removed', async () => {
  const { transcribeMeetingParts } = load('src/services/meetingTranscription.ts');
  const calls = [], removed = [];
  const deps = {
    exists: async () => true,
    decrypt: async (uri) => 'plain:' + uri,
    remove: async (uri) => { removed.push(uri); },
    onPart() {},
    transcribe: async (uri, key) => { calls.push([uri, key]); return key.endsWith(':0') ? { success: true, text: 'First part' } : { success: false, text: '', error: 'network failed' }; },
  };
  const result = await transcribeMeetingParts(['encrypted:a', 'encrypted:b'], 'recording', true, deps);
  assert.equal(result.success, false); assert.equal(result.text, '');
  assert.equal(result.error, 'network failed');
  assert.deepEqual(calls, [['plain:encrypted:a', 'recording:part:0'], ['plain:encrypted:b', 'recording:part:1']]);
  assert.deepEqual(removed, ['plain:encrypted:a', 'plain:encrypted:b']);
  deps.transcribe = async (_uri, key) => ({ success: true, text: key.endsWith(':0') ? 'First part' : 'Second part' });
  const retried = await transcribeMeetingParts(['encrypted:a', 'encrypted:b'], 'recording', true, deps);
  assert.equal(retried.success, true); assert.equal(retried.text, 'First part\n\nSecond part');
});

test('an incomplete encrypted meeting save preserves raw input and cleans only its attempted copies', async () => {
  const { persistMeetingParts, transcribeMeetingParts } = load('src/services/meetingTranscription.ts');
  const removed = [];
  await assert.rejects(persistMeetingParts(['raw:a', 'raw:b'], async (uri) => {
    if (uri === 'raw:b') throw Error('disk full'); return 'encrypted:a';
  }, async (uri) => { removed.push(uri); }), /disk full/);
  assert.deepEqual(removed, ['encrypted:a']);
  let requests = 0;
  const missing = await transcribeMeetingParts(['missing:a'], 'r', true, {
    exists: async () => false, onPart() {}, transcribe: async () => { requests++; },
  });
  assert.equal(missing.success, false); assert.equal(requests, 0);
});
