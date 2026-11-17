// Host routing tests: the native converter is a boundary. Its actual resampling
// and output WAV layout require Android/iOS integration coverage.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function app(platform, nativeModule) {
 const exports = {};
 const imports = {
  'react-native': { Platform: { OS: platform }, NativeModules: { AudioTranscode: nativeModule }, AppState: { addEventListener: () => {} } },
  '../utils/whisperText': {},
  'expo-file-system/legacy': { documentDirectory: 'private/' },
  '../utils/storage': {}, './DeviceCapabilities': {}, './LocalLLMService': {},
  './modelDownload': { createMutex: () => async fn => fn() },
 };
 const source = ts.transpileModule(fs.readFileSync(path.join(root, 'src/services/LocalWhisperService.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
 }).outputText;
 vm.runInNewContext(source, { exports, require: name => { assert.ok(name in imports, `Unexpected import ${name}`); return imports[name]; }, console, setTimeout, clearTimeout });
 return exports;
}
for (const platform of ['android','ios']) for (const name of ['stereo-44100.wav','float-48000.WAV','recording.m4a','speech.mp3']) {
 test(`local preparation normalizes ${name} on ${platform}`, async () => {
  const calls=[];
  const service=app(platform,{convertToWav:async uri=>{calls.push(uri);return 'cache/canonical.wav';}});
  assert.equal(await service.prepareAudioForLocalWhisper(`file:///shared/${name}`),'cache/canonical.wav');
  assert.deepEqual(calls,[`file:///shared/${name}`]);
 });
}
test('web rejects WAV and other containers without invoking a native converter',async()=>{
 let calls=0;const service=app('web',{convertToWav:async()=>{calls++;return 'unexpected.wav';}});
 for (const name of ['speech.wav','speech.m4a']) await assert.rejects(service.prepareAudioForLocalWhisper(name),/not supported in the browser/);
 assert.equal(calls,0);
});
test('missing native converter rejects WAV instead of passing unnormalized samples to Whisper',async()=>{
 for (const nativeModule of [undefined,{}]) await assert.rejects(app('android',nativeModule).prepareAudioForLocalWhisper('speech.wav'),/conversion module is not installed/);
});
test('native conversion failures propagate without returning the original WAV',async()=>{
 const service=app('android',{convertToWav:async()=>{throw Error('Unsupported codec');}});
 await assert.rejects(service.prepareAudioForLocalWhisper('speech.wav'),/Unsupported codec/);
});
