// The microphone tells the truth: the route shown at the mic and in Settings is
// checked against the real routing code (TranscriptionService.transcribeAudio,
// the editor's offline skip, voiceAgent.resolveVoiceAgentRoute), and the
// on-device agent is kept away from plain dictation and negated requests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
function load(file, imports = {}, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    require: (name) => { if (!(name in imports)) throw Error(`Unexpected dependency ${name}`); return imports[name]; },
    console: { ...console, log: () => {}, error: () => {}, warn: () => {} }, setTimeout, clearTimeout, AbortController, ...globals,
  }, { filename: file });
  return exports;
}

const micRoute = load('src/utils/micRoute.ts');
const voiceCommand = load('src/utils/voiceCommand.ts');

// ─── Transcription route parity ─────────────────────────────────────────────

function transcriptionService(state) {
  const calls = { cloud: 0, local: 0 };
  const imports = {
    axios: { isAxiosError: () => false },
    'expo-file-system/legacy': { getInfoAsync: async () => ({ exists: true, size: 100 }), deleteAsync: async () => {} },
    'expo-file-system': { File: class File { constructor(uri) { this.name = uri.split('/').pop(); } } },
    'react-native': { Platform: { OS: 'android' } },
    '../utils/env': { API_URL: 'https://qa.invalid' },
    '../utils/storage': {
      storage: { getToken: async () => 'synthetic-token' },
      getAIProvider: async () => state.provider,
      getOnDeviceTranscription: async () => state.privateMode,
      getLocalModelsEnabled: async () => state.localModelsEnabled,
      getTranscriptionLanguage: async () => 'auto',
      getOpenAIApiKey: async () => 'synthetic-key',
      getOpenAIBaseUrl: async () => 'https://qa.invalid',
    },
    '../utils/featureFlags': { LOCAL_WHISPER_ENABLED: true },
    '../utils/openaiCompat': { buildOpenAICompatibleUrl: (base, route) => base + route }, '../utils/richContent': {},
    '../utils/uuid': { generateUUID: async () => 'qa-request' },
    '../utils/authEvents': {}, '../api/tokenRefresh': {}, '../utils/deviceIdentity': {},
    '../utils/connectivity': { isDeviceOffline: async () => state.offline },
    '../utils/limitEvents': { onLimitReached: { emit: () => {} } },
    '../utils/aiLimitState': { clearAiLimit: () => {}, isLlmLimitReason: () => false, markAiLimitReached: () => {} },
    './localSpeechSpeed': { recordLocalTranscription: async () => {} },
    './LocalWhisperService': {
      getLocalWhisperModelStatus: async () => ({ isDownloaded: state.speechDownloaded }),
      prepareAudioForLocalWhisper: async (uri) => uri,
      transcribeWithLocalWhisper: async () => { calls.local++; return 'Local transcript'; },
      transcribeWithLocalWhisperTimed: async () => { calls.local++; return { text: 'Local transcript', segments: [] }; },
    },
  };
  const service = load('src/services/TranscriptionService.ts', imports, {
    Error, TypeError,
    FormData: class { append() {} },
    fetch: async () => {
      calls.cloud++;
      if (state.networkFailure) throw new TypeError('Network request failed');
      return { status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => ({ text: 'Cloud transcript' }) };
    },
  });
  return { service, calls };
}

/**
 * What the editor really does with a finished recording (handleRecordingFinish):
 * skip offline when not on-device, otherwise transcribeAudio. Returns the route.
 */
async function observeEditorRoute(state) {
  const { service, calls } = transcriptionService(state);
  const onDevice = state.privateMode || await service.isOnDeviceTranscriptionActive();
  if (!state.transcribe) return 'audio_only';
  if (!onDevice && !state.protectedNote && state.offline) return 'later';
  const modes = [];
  const result = await service.transcribeAudio('file://synthetic.m4a', undefined, {
    onDeviceOnly: state.protectedNote, onMode: (mode) => modes.push(mode),
  });
  if (result.error === service.ON_DEVICE_MODEL_REQUIRED) return 'device_model_missing';
  if (modes[0] === 'device') {
    assert.equal(calls.cloud, 0, 'a device route never uploads');
    return 'device';
  }
  assert.equal(modes[0], 'cloud');
  return state.provider === 'vaulto_ai' ? 'cloud' : 'custom';
}

const category = (route) => (route.startsWith('device_') && route !== 'device_model_missing' ? 'device' : route);

const allStates = function* () {
  for (const provider of ['vaulto_ai', 'local', 'local_whisper', 'openai'])
    for (const privateMode of [false, true])
      for (const protectedNote of [false, true])
        for (const offline of [false, true])
          for (const speechDownloaded of [false, true])
            for (const localModelsEnabled of [false, true])
              for (const transcribe of [true, false])
                yield { provider, privateMode, protectedNote, offline, speechDownloaded, localModelsEnabled, transcribe, speechSupported: true };
};

test('the route shown at the mic is the route the recording takes (every combination)', async () => {
  let checked = 0;
  for (const state of allStates()) {
    // An on-device provider without its model is a broken setup the recorder
    // already warns about ("Model not downloaded"); the local call then fails.
    if (['local', 'local_whisper'].includes(state.provider) && !state.speechDownloaded && !state.offline
      && !state.privateMode && !state.protectedNote && state.transcribe) continue;
    const shown = micRoute.pickTranscriptionRoute(state);
    const real = await observeEditorRoute(state);
    assert.equal(category(shown), real, `route mismatch for ${JSON.stringify(state)}: shown ${shown}, real ${real}`);
    checked++;
  }
  assert.ok(checked > 200);
});

test('a privacy choice or protected note is never shown or routed as cloud', () => {
  for (const state of allStates()) {
    if (!(state.privateMode || state.protectedNote) || !state.transcribe) continue;
    const route = micRoute.pickTranscriptionRoute(state);
    assert.ok(['device_private', 'device_model_missing'].includes(route), JSON.stringify(state));
    assert.equal(micRoute.routeSendsAudio(route), false);
  }
});

test('"this phone when offline" is promised only when the phone really takes over', async () => {
  for (const speechDownloaded of [false, true]) {
    for (const localModelsEnabled of [false, true]) {
      const state = { provider: 'vaulto_ai', privateMode: false, protectedNote: false, offline: false, speechDownloaded, localModelsEnabled, transcribe: true, speechSupported: true, networkFailure: true };
      const { service, calls } = transcriptionService(state);
      const result = await service.transcribeAudio('file://synthetic.m4a');
      assert.equal(micRoute.cloudFallsBackToDevice(state), result.success && calls.local === 1, JSON.stringify(state));
    }
  }
});

test('specific device routes name the reason', () => {
  const base = { provider: 'vaulto_ai', privateMode: false, protectedNote: false, offline: false, speechDownloaded: true, localModelsEnabled: true, transcribe: true, speechSupported: true };
  assert.equal(micRoute.pickTranscriptionRoute(base), 'cloud');
  assert.equal(micRoute.pickTranscriptionRoute({ ...base, offline: true }), 'device_offline');
  assert.equal(micRoute.pickTranscriptionRoute({ ...base, privateMode: true }), 'device_private');
  assert.equal(micRoute.pickTranscriptionRoute({ ...base, protectedNote: true, speechDownloaded: false }), 'device_model_missing');
  assert.equal(micRoute.pickTranscriptionRoute({ ...base, offline: true, speechDownloaded: false }), 'later');
  assert.equal(micRoute.pickTranscriptionRoute({ ...base, provider: 'local' }), 'device');
  assert.equal(micRoute.pickTranscriptionRoute({ ...base, transcribe: false }), 'audio_only');
  assert.equal(micRoute.routeSendsAudio('cloud'), true);
  assert.equal(micRoute.routeSendsAudio('later'), false);
});

// ─── Voice agent route parity ───────────────────────────────────────────────

test('the agent shown at the mic is the agent that decides (every combination)', async () => {
  for (const provider of ['vaulto_ai', 'local', 'local_llm', 'local_whisper', 'openai'])
    for (const privateMode of [false, true])
      for (const protectedNote of [false, true])
        for (const signedIn of [false, true])
          for (const offline of [false, true])
            for (const [ready, model] of [[false, 'qwen3.5-2b'], [true, 'qwen3.5-2b'], [true, 'qwen3.5-0.8b']]) {
              const { resolveVoiceAgentRoute, modelUnderstandsRequests } = load('src/services/voiceAgent.ts', {
                '../utils/storage': { getAIProvider: async () => provider, getOnDeviceTranscription: async () => privateMode },
                '../utils/connectivity': { isDeviceOffline: async () => offline },
                './effectiveProvider': { isLocalLLMReady: async () => ready },
                './LocalLLMService': { getSelectedLocalLLMModel: async () => ({ key: model }) },
                '../utils/voiceCommand': voiceCommand,
              });
              const real = await resolveVoiceAgentRoute({ signedIn, protectedNote });
              const shown = micRoute.pickVoiceAgentRoute({
                provider, privateMode, protectedNote, signedIn, offline,
                deviceAgentReady: ready && modelUnderstandsRequests(model),
              });
              assert.equal(shown, real, JSON.stringify({ provider, privateMode, protectedNote, signedIn, offline, ready, model }));
            }
});

// ─── Microphone mode ────────────────────────────────────────────────────────

test('mode: remembered value is parsed safely; meeting, hold and no agent always dictate', () => {
  assert.equal(micRoute.parseVoiceInputMode('dictate'), 'dictate');
  assert.equal(micRoute.parseVoiceInputMode('edit'), 'edit');
  assert.equal(micRoute.parseVoiceInputMode(null), micRoute.DEFAULT_VOICE_INPUT_MODE);
  assert.equal(micRoute.parseVoiceInputMode('agent'), micRoute.DEFAULT_VOICE_INPUT_MODE);
  assert.equal(micRoute.effectiveVoiceInputMode('edit', 'cloud'), 'edit');
  assert.equal(micRoute.effectiveVoiceInputMode('dictate', 'cloud'), 'dictate');
  assert.equal(micRoute.effectiveVoiceInputMode('edit', null), 'dictate');
  assert.equal(micRoute.effectiveVoiceInputMode('edit', 'device', { meeting: true }), 'dictate');
  assert.equal(micRoute.effectiveVoiceInputMode('edit', 'device', { holdToDictate: true }), 'dictate');
});

// ─── Settings summary ───────────────────────────────────────────────────────

test('settings summary answers "does my recording leave the phone?" from the configuration', () => {
  const base = {
    provider: 'vaulto_ai', privateMode: false, speechSupported: true, speechDownloaded: false, localModelsEnabled: true,
    aiDownloaded: false, deviceAgentCapable: false, signedIn: true, syncEnabled: false, e2ee: false,
  };
  const s = (over) => micRoute.summarizeProcessing({ ...base, ...over });
  assert.deepEqual({ ...s({}) }, { storage: 'device', speech: 'cloud', ai: 'cloud', audioLeaves: 'for_text' });
  assert.equal(s({ speechDownloaded: true }).speech, 'cloud_device_offline');
  // Switched off, a downloaded model is not used offline (isLocalSpeechReady).
  assert.equal(s({ speechDownloaded: true, localModelsEnabled: false }).speech, 'cloud');
  const privateSpeech = s({ privateMode: true, speechDownloaded: true });
  assert.equal(privateSpeech.speech, 'device_always');
  assert.equal(privateSpeech.audioLeaves, 'no');
  // Voice-only privacy: AI actions still go to the cloud, as text.
  assert.equal(privateSpeech.ai, 'cloud');
  assert.equal(s({ privateMode: true, speechDownloaded: true, aiDownloaded: true }).ai, 'device');
  assert.equal(s({ privateMode: true, speechDownloaded: false }).speech, 'device_model_missing');
  assert.equal(s({ privateMode: true, speechDownloaded: true, syncEnabled: true, e2ee: true }).audioLeaves, 'sync_only');
  assert.equal(s({ privateMode: true, speechDownloaded: true, syncEnabled: true, e2ee: true }).storage, 'sync_e2ee');
  assert.equal(s({ syncEnabled: true }).storage, 'sync');
  // Guests have no sync and no cloud LLM.
  const guest = s({ signedIn: false, syncEnabled: true });
  assert.equal(guest.storage, 'device');
  assert.equal(guest.ai, 'sign_in');
  // A guest's downloaded model answers AI actions without a further switch.
  assert.equal(s({ signedIn: false, aiDownloaded: true }).ai, 'device');
  assert.equal(s({ signedIn: false, aiDownloaded: true }).speech, 'cloud', 'speech routing is unchanged');
  assert.equal(s({ provider: 'local', aiDownloaded: true, speechDownloaded: true }).ai, 'device');
  assert.equal(s({ provider: 'local', aiDownloaded: false }).ai, 'device_needs_model');
  assert.equal(s({ provider: 'local_whisper', speechDownloaded: true }).ai, 'none');
});

// ─── On-device request gate: RU + EN regression set ─────────────────────────

const LIST_NOTE = '- [ ] молоко\n- [ ] хлеб\n- [ ] milk';
const PLAIN_NOTE = 'Recipe notes for Sunday.';

/** Requests the phone's agent should see (with the note they were said in). */
const COMMANDS = [
  ['Make a checklist: milk, bread, eggs', PLAIN_NOTE],
  ['Please make a shopping list with apples and coffee', PLAIN_NOTE],
  ['Can you turn this into a checklist', LIST_NOTE],
  ['Okay now make a list of ideas: podcast, newsletter', PLAIN_NOTE],
  ['Create a to-do list for tomorrow: call the bank, pay rent', PLAIN_NOTE],
  ['Rename the note to Budget', PLAIN_NOTE],
  ['Rename it Trip to Rome', PLAIN_NOTE],
  ['Name the note Weekly plan', PLAIN_NOTE],
  ['Add cheese and coffee', LIST_NOTE],
  ['Add cheese and coffee to the list', PLAIN_NOTE],
  ['Сделай чек-лист: молоко, хлеб, яйца', PLAIN_NOTE],
  ['Сделай список покупок: молоко, хлеб', PLAIN_NOTE],
  ['Пожалуйста, составь список задач на завтра', PLAIN_NOTE],
  ['Можешь сделать из этого чек-лист', LIST_NOTE],
  ['А теперь преврати это в список дел', PLAIN_NOTE],
  ['Переименуй заметку в Отпуск', PLAIN_NOTE],
  ['Назови заметку Бюджет на ноябрь', PLAIN_NOTE],
  ['Озаглавь заметку Встреча с Андреем', PLAIN_NOTE],
  ['Добавь сыр и кофе', LIST_NOTE],
  ['Добавь в список сыр и кофе', PLAIN_NOTE],
  ['Можно добавить в список сыр и кофе', PLAIN_NOTE],
];

const LONG_DICTATION = Array.from({ length: 45 }, (_, i) => (i === 0 ? 'Сделай' : 'список')).join(' ');

/** Dictation, negations and look-alikes the phone's agent must never act on. */
const DICTATION = [
  // Plain dictation
  ['Buy milk and bread tomorrow morning', 'no_request'],
  ['The list for Saturday: chips, juice, cake', 'no_request'],
  ['I need to make a list of things for the trip', 'no_request'],
  ['Remember to make a checklist for the trip', 'no_request'],
  ['Mark called and said the list is ready', 'no_request'],
  ['Make sure the list of guests is final', 'no_request'],
  ['Turn left after the bakery on the list of stops', 'no_request'],
  ['Call it a day and rename nothing', 'no_request'],
  ['Name three reasons why the project slipped', 'no_target'],
  ['Check the oil before the trip', 'no_request'],
  ['Add salt to the soup and simmer for ten minutes', 'no_target', PLAIN_NOTE],
  ['Купить молоко и хлеб завтра утром', 'no_request'],
  ['Мне нужно составить список вещей в поездку', 'no_request'],
  ['Мама сказала составь список покупок', 'no_request'],
  ['Позвони маме насчёт выходных', 'no_request'],
  ['Сегодня я сделал чек-лист для поездки', 'no_request'],
  ['Составить список вещей на дачу', 'no_request'],
  ['Переименовать файлы до пятницы', 'no_request'],
  ['Сделай так, чтобы список гостей был готов к пятнице', 'no_request'],
  ['Назови три причины, почему проект задержался', 'no_target'],
  ['Добавь соль в суп и вари десять минут', 'no_target', PLAIN_NOTE],
  ['Отметь, что Миша уже купил билеты', 'no_request'],
  // Negations
  ["Don't make a checklist, just write it down", 'negated'],
  ['Do not rename this note', 'negated'],
  ['Please never add sugar to the list', 'negated'],
  ['No, make it a list later', 'negated'],
  ['Не делай список, просто запиши мысль', 'negated'],
  ['Не надо переименовывать заметку', 'negated'],
  ['Никогда не добавляй сахар в список', 'negated'],
  ['Пожалуйста, не создавай чек-лист', 'negated'],
  // Length bounds
  ['Список', 'length'],
  [LONG_DICTATION, 'length'],
];

test('gate: every request in the RU+EN set reaches the on-device agent', () => {
  for (const [phrase, note] of COMMANDS) {
    assert.equal(voiceCommand.deviceCommandGate(phrase, note), 'ok', phrase);
    // The editor asks before it has the note: the request still qualifies.
    assert.equal(voiceCommand.isDeviceCommandCandidate(phrase), true, phrase);
  }
});

test('gate: plain dictation, look-alikes and negations never reach it (with the reason)', () => {
  for (const [phrase, reason, note] of DICTATION) {
    assert.equal(voiceCommand.deviceCommandGate(phrase, note ?? PLAIN_NOTE), reason, phrase);
  }
});

// The whole on-device agent with a model that answers "checklist" to anything
// (the failure the audit worries about): dictation must still come out as text.
function deviceAgent(model) {
  const calls = { model: 0 };
  const agent = load('src/services/voiceAgent.ts', {
    '../utils/storage': { getAIProvider: async () => 'local', getOnDeviceTranscription: async () => true },
    '../utils/connectivity': { isDeviceOffline: async () => true },
    './effectiveProvider': { isLocalLLMReady: async () => true },
    './LocalLLMService': {
      getSelectedLocalLLMModel: async () => ({ key: 'qwen3.5-2b' }),
      generateWithLocalLLM: async (prompt) => { calls.model++; return JSON.stringify(model(prompt)); },
    },
    '../utils/voiceCommand': voiceCommand,
  }, { JSON, Array, Set, Date });
  return { agent, calls };
}

const transcriptOf = (prompt) => prompt.split('<transcript>\n')[1].split('\n</transcript>')[0];
const misfiringModel = (prompt) => {
  const words = transcriptOf(prompt).split(/[\s,:]+/).filter((w) => w.length > 2);
  return { intent: 'checklist', items: words.slice(0, 3), title: '', note_title: 'Список' };
};
const cooperativeModel = (prompt) => {
  const text = transcriptOf(prompt);
  const rename = text.match(/(?:rename (?:the note to|it)|name the note|переименуй заметку в|назови заметку|озаглавь заметку)\s+(.+)$/i);
  if (rename) return { intent: 'rename', items: [], title: rename[1], note_title: rename[1] };
  const items = (text.split(':')[1] || text.replace(/^.*?(?:add|добавь)( в список)?/i, '')).split(/,| and | и /).map((s) => s.replace(/to the list/i, '').trim()).filter(Boolean);
  return { intent: 'checklist', items: items.length ? items : ['молоко'], title: '', note_title: 'Покупки' };
};

test('on-device agent: a misfiring model cannot turn dictation or negations into edits', async () => {
  const { agent, calls } = deviceAgent(misfiringModel);
  for (const [phrase, , note] of DICTATION) {
    const result = await agent.processVoiceNoteOnDevice(phrase, note ?? PLAIN_NOTE);
    assert.equal(result.hasInstruction, false, phrase);
    assert.notEqual(result.titleAction, 'set', phrase);
    assert.equal(result.originalText, phrase.trim());
  }
  assert.equal(calls.model, 0, 'the model is not even asked');
});

test('on-device agent: requests in the set are carried out with a capable model', async () => {
  const { agent } = deviceAgent(cooperativeModel);
  for (const [phrase, note] of COMMANDS) {
    const result = await agent.processVoiceNoteOnDevice(phrase, note);
    const acted = result.hasInstruction || result.titleAction === 'set';
    assert.ok(acted, `${phrase} → ${JSON.stringify(result)}`);
  }
});

test('editor pre-check matches the agent: isDeviceAgentCandidate uses the same gate', () => {
  const { agent } = deviceAgent(cooperativeModel);
  for (const [phrase] of COMMANDS) assert.equal(agent.isDeviceAgentCandidate(phrase), true, phrase);
  for (const [phrase, , note] of DICTATION) {
    assert.equal(agent.isDeviceAgentCandidate(phrase, note ?? PLAIN_NOTE), false, phrase);
  }
  assert.equal(agent.DEVICE_AGENT_MAX_WORDS, 40);
});
