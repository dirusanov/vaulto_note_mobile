const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, imports = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => {
    assert.ok(name in imports, `Unexpected dependency ${name}`);
    return imports[name];
  }, console, setTimeout, clearTimeout, setInterval, clearInterval }, { filename: file });
  return exports;
}
const format = load('src/utils/audioFormat.ts');
const wav = Buffer.alloc(52);
wav.write('RIFF'); wav.writeUInt32LE(44, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(8, 40);
wav.writeInt16LE(2000, 44); wav.writeInt16LE(-2000, 46);
const m4a = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypM4A '), Buffer.alloc(16)]);
const samples = [
  ['wav', wav], ['m4a', m4a], ['mp3', Buffer.from('ID3\x04\x00\x00', 'binary')],
  ['mp3', Buffer.from([0xff, 0xfb, 0x90, 0x64])], ['aac', Buffer.from([0xff, 0xf1, 0x50, 0x80])],
  ['ogg', Buffer.from('OggS\x00\x02OpusHead')], ['flac', Buffer.from('fLaC\x00\x00')],
  ['webm', Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f])], ['amr', Buffer.from('#!AMR\n')],
];
test('audio bytes take precedence over stale or misleading filename extensions', () => {
  for (const [extension, bytes] of samples) {
    assert.equal(format.audioExtension(bytes.toString('base64'), 'file:///legacy.m4a'), extension);
  }
  assert.equal(format.audioExtension(Buffer.from('RIFFxxxxAVI ').toString('base64')), 'm4a');
  assert.equal(format.audioExtension('', 'file:///speech.WAV?download=1'), 'wav');
});
function audioStore() {
  const files = new Map();
  const writes = [];
  const service = load('src/services/AudioService.ts', {
    'expo-audio': {},
    'react-native': { Platform: { OS: 'android' }, NativeModules: {} },
    '../utils/audioFormat': format,
    '../utils/recordingClock': load('src/utils/recordingClock.ts'),
    '../crypto/encryption': {
      encrypt: async value => `sealed:${value}`,
      decrypt: async value => { assert.ok(value.startsWith('sealed:')); return value.slice(7); },
    },
    'expo-file-system/legacy': {
      documentDirectory: 'file:///private/', cacheDirectory: 'file:///cache/',
      getInfoAsync: async () => ({ exists: true }),
      readDirectoryAsync: async dir => [...files.keys()].filter(uri => uri.startsWith(dir)).map(uri => uri.slice(dir.length)),
      readAsStringAsync: async (uri, { encoding }) => {
        assert.ok(files.has(uri), `Missing ${uri}`);
        return files.get(uri).toString(encoding === 'base64' ? 'base64' : 'utf8');
      },
      writeAsStringAsync: async (uri, value, { encoding }) => {
        writes.push(uri); files.set(uri, Buffer.from(value, encoding === 'base64' ? 'base64' : 'utf8'));
      },
      deleteAsync: async uri => files.delete(uri),
    },
  }).AudioService;
  return { files, writes, service };
}
test('offline save and decrypted retry preserve WAV bytes and a correct upload extension', async () => {
  const { files, service } = audioStore();
  files.set('file:///shared.wav', wav);
  const saved = await service.saveAudioFile('file:///shared.wav');
  assert.match(saved, /\.wav$/);
  assert.ok(files.get(saved).toString().startsWith('sealed:'));
  assert.equal(files.has('file:///shared.wav'), false);
  const retry = await service.readAudioFile(saved, 'retry');
  assert.match(retry, /\.wav$/);
  assert.deepEqual(files.get(retry), wav);
});
test('already installed legacy WAVs named m4a are repaired on read without changing stored ciphertext', async () => {
  const { files, service } = audioStore();
  const ciphertext = Buffer.from(`sealed:${wav.toString('base64')}`);
  files.set('file:///old/audio.m4a', ciphertext);
  const retry = await service.readAudioFile('file:///old/audio.m4a');
  assert.match(retry, /\.wav$/);
  assert.deepEqual(files.get(retry), wav);
  assert.deepEqual(files.get('file:///old/audio.m4a'), ciphertext);
});
test('native AAC recordings keep the M4A container and remain byte-identical after decrypt', async () => {
  const { files, service } = audioStore();
  files.set('file:///recording.m4a', m4a);
  const saved = await service.saveAudioFile('file:///recording.m4a', false);
  const retry = await service.readAudioFile(saved);
  assert.match(saved, /\.m4a$/); assert.match(retry, /\.m4a$/);
  assert.deepEqual(files.get(retry), m4a);
  assert.deepEqual(files.get('file:///recording.m4a'), m4a);
});
test('audio downloaded from sync keeps its actual container for later playback and recognition', async () => {
  const { files, service } = audioStore();
  const saved = await service.writeAudioBase64(wav.toString('base64'));
  assert.match(saved, /\.wav$/);
  const retry = await service.readAudioFile(saved);
  assert.deepEqual(files.get(retry), wav);
  assert.equal(format.audioMimeType(wav.toString('base64')), 'audio/wav');
  assert.equal(format.audioMimeType(m4a.toString('base64')), 'audio/mp4');
});
test('temporary decoded WAVs are cleaned up without deleting saved audio or unrelated cache files', async () => {
  const { files, service } = audioStore();
  files.set('file:///cache/temp_speech.wav', wav);
  files.set('file:///cache/temp_speech.m4a', m4a);
  files.set('file:///cache/unrelated.wav', wav);
  files.set('file:///private/audio_saved.wav', Buffer.from('sealed:audio'));
  await service.cleanupTempFiles();
  assert.equal(files.has('file:///cache/temp_speech.wav'), false);
  assert.equal(files.has('file:///cache/temp_speech.m4a'), false);
  assert.equal(files.has('file:///cache/unrelated.wav'), true);
  assert.equal(files.has('file:///private/audio_saved.wav'), true);
});
