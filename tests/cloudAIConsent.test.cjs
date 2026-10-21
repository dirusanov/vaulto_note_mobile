const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function fixture() {
  const values = new Map(), dialogs = [];
  let uploads = 0, failWrite = false;
  const appState = { currentState: 'active' };
  const storage = {
    getItem: async k => values.get(k) ?? null,
    setItem: async (k, v) => { if (failWrite) throw Error('storage full'); values.set(k, v); },
    removeItem: async k => { values.delete(k); },
    getAllKeys: async () => [...values.keys()],
    multiGet: async keys => keys.map(k => [k, values.get(k) ?? null]),
    multiRemove: async keys => { for (const k of keys) values.delete(k); },
  };
  const imports = {
    '@react-native-async-storage/async-storage': storage,
    'react-native': { Platform: { OS: 'ios' }, AppState: appState, Alert: { alert: (...args) => dialogs.push(args) }, Linking: { openURL: async () => {} } },
    '../i18n': { t: (_key, opts) => opts.defaultValue.replace('{{host}}', opts.host ?? '') },
    '../utils/env': { API_URL: 'https://api.vaultonote.com' },
  };
  const code = ts.transpileModule(fs.readFileSync('src/services/cloudAIConsent.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: n => { if (!(n in imports)) throw Error(n); return imports[n]; }, URL, Map, Error, fetch: async () => { uploads++; return { ok: true }; } });
  const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  return { api: exports, values, dialogs, appState, settle, uploads: () => uploads, fail: () => { failWrite = true; } };
}
test('no data is uploaded before explicit approval; cancellation leaves no permission', async () => {
  const f = fixture();
  const job = f.api.cloudAIFetch('https://api.vaultonote.com/ai/improve', { body: 'private text' });
  const rejected = assert.rejects(job, { code: 'CLOUD_AI_CONSENT_REQUIRED' });
  await f.settle(); assert.equal(f.uploads(), 0); assert.equal(f.dialogs.length, 1);
  assert.match(f.dialogs[0][1], /Vaulto and OpenAI/);
  f.dialogs[0][2][0].onPress(); await rejected;
  assert.equal(f.uploads(), 0); assert.equal(await f.api.hasCloudAIConsent(), false);
});
test('approval persists per destination and concurrent uploads share one prompt', async () => {
  const f = fixture(); const jobs = [f.api.cloudAIFetch('https://api.vaultonote.com/ai/improve'), f.api.cloudAIFetch('https://api.vaultonote.com/ai/transcribe')];
  await f.settle(); assert.equal(f.dialogs.length, 1); assert.equal(f.uploads(), 0);
  f.dialogs[0][2][2].onPress(); await Promise.all(jobs);
  await f.api.cloudAIFetch('https://api.vaultonote.com/ai/agent');
  assert.equal(f.uploads(), 3); assert.equal(f.dialogs.length, 1);
  assert.equal(await f.api.hasCloudAIConsent(), true);
});
test('a different custom service needs its own approval and discloses its origin', async () => {
  const f = fixture(); const first = f.api.cloudAIFetch('https://api.vaultonote.com/ai/improve');
  await f.settle(); f.dialogs[0][2][2].onPress(); await first;
  const second = f.api.cloudAIFetch('https://chosen.example/v1/chat/completions');
  const rejected = assert.rejects(second, { code: 'CLOUD_AI_CONSENT_REQUIRED' });
  await f.settle(); assert.match(f.dialogs[1][1], /https:\/\/chosen.example/);
  assert.equal(f.uploads(), 1); f.dialogs[1][2][0].onPress(); await rejected;
  assert.equal(f.uploads(), 1);
});
test('revocation removes approval and prevents a pending prompt from granting it again', async () => {
  const f = fixture(); const first = f.api.cloudAIFetch('https://api.vaultonote.com/ai/improve');
  await f.settle(); f.dialogs[0][2][2].onPress(); await first;
  await f.api.revokeCloudAIConsent(); assert.equal(await f.api.hasCloudAIConsent(), false);
  const second = f.api.cloudAIFetch('https://api.vaultonote.com/ai/improve');
  const rejected = assert.rejects(second, { code: 'CLOUD_AI_CONSENT_REQUIRED' });
  await f.settle(); await f.api.revokeCloudAIConsent(); f.dialogs[1][2][2].onPress(); await rejected;
  assert.equal(f.uploads(), 1); assert.equal(await f.api.hasCloudAIConsent(), false);
});
test('a background retry cannot show a prompt or upload without existing permission', async () => {
  const f = fixture(); f.appState.currentState = 'background';
  await assert.rejects(f.api.cloudAIFetch('https://api.vaultonote.com/ai/agent'), { code: 'CLOUD_AI_CONSENT_REQUIRED' });
  assert.equal(f.uploads(), 0); assert.equal(f.dialogs.length, 0);
});
test('permission persistence failure fails closed before the network call', async () => {
  const f = fixture(); f.fail(); const job = f.api.cloudAIFetch('https://api.vaultonote.com/ai/improve');
  const rejected = assert.rejects(job, /storage full/);
  await f.settle(); f.dialogs[0][2][2].onPress(); await rejected; assert.equal(f.uploads(), 0);
});

test('permission cancellation remains identifiable after the speech retry boundary serializes it', () => {
  const f = fixture(); const error = new f.api.CloudAIConsentRequiredError();
  assert.equal(f.api.isCloudAIConsentError(error), true);
  assert.equal(f.api.isCloudAIConsentError(error.message), true);
  assert.equal(f.api.isCloudAIConsentError('Network request failed'), false);
});
