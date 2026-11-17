// Host integration of the production upload method. Native FS, API and crypto
// are boundaries; this does not exercise a real S3 server or encryption algorithm.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const ts = require('typescript');
// Compatibility contract for existing deployed servers. A standalone mobile
// checkout need not contain the backend; when present, validate it as well.
const allowed = new Set(['audio/m4a', 'audio/mp4', 'audio/aac', 'audio/mpeg', 'audio/wav', 'application/octet-stream']);
const backendPath = path.resolve(root, '../backend/claude_gateway_service/app/presentation/api/routes/audio.py');
if (fs.existsSync(backendPath)) {
 const backend = fs.readFileSync(backendPath, 'utf8');
 const actual = new Set([...backend.match(/ALLOWED_MIME_TYPES = \{([\s\S]*?)\n\}/)[1].matchAll(/"([^"]+)"/g)].map(m => m[1]));
 assert.deepEqual(actual, allowed, 'Update the compatibility contract deliberately when backend MIME changes');
}
const formatExports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(root+'/src/utils/audioFormat.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:formatExports});
const source = fs.readFileSync(root+'/src/services/SyncService.ts','utf8');
const method = source.slice(source.indexOf('    private async uploadNoteAudio('),source.indexOf('    private async downloadNoteAudio('));
const methodCode = ts.transpileModule('class Harness {\n'+method+'\n}\nexports.Harness=Harness;', {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
function harness(payload, mode, status=200) {
 const calls={writes:[],deletes:[],commits:[],targets:[],states:[],uploads:[]};
 const exports={};
 vm.runInNewContext(methodCode,{
  exports, ...formatExports, console:{log:()=>{},warn:()=>{}},
  getCryptoMode:()=>mode,
  AudioService:{readAudioBase64:async()=>payload},
  Crypto:{CryptoDigestAlgorithm:{SHA256:'SHA256'},digestStringAsync:async(_a,bytes)=>{assert.equal(bytes,payload);return 'f'.repeat(64);}},
  encryptAudioBase64ForSync:async bytes=>Buffer.from('encrypted:'+bytes).toString('base64'),
  audioApi:{getUploadUrl:async(...args)=>{calls.targets.push(args);assert.ok(allowed.has(args[1]),'backend rejects '+args[1]);return {url:'https://qa.invalid',headers:{'Content-Type':args[1]},required_enc_scheme:mode==='e2ee'?'e2ee':'none',key_epoch:7,vault_generation:3,upload_id:'upload'};},commit:async(...args)=>{calls.commits.push(args);}},
  FileSystem:{cacheDirectory:'cache/',writeAsStringAsync:async(...args)=>calls.writes.push(args),uploadAsync:async(...args)=>{calls.uploads.push(args);return {status};},deleteAsync:async(...args)=>calls.deletes.push(args)},
  setNoteAudioSyncState:async(...args)=>calls.states.push(args),
 });
 const service=new exports.Harness();
 Object.assign(service,{currentKeyEpoch:7,currentVaultGeneration:3,currentTransitionToken:null,reconcileEncryptionState:async()=>false});
 return {service,calls};
}
const fixtures={wav:Buffer.from('RIFFxxxxWAVEfmt '),m4a:Buffer.from('\0\0\0\x18ftypM4A '),mp3:Buffer.from('ID3'),aac:Buffer.from([255,241,80,128]),ogg:Buffer.from('OggS\0OpusHead'),flac:Buffer.from('fLaC\0'),webm:Buffer.from([26,69,223,163]),amr:Buffer.from('#!AMR\n')};
for(const [container,bytes] of Object.entries(fixtures)) for(const mode of ['off','e2ee']) test('actual uploadNoteAudio '+container+' '+mode+' agrees with backend and preserves payload',async()=>{
 const payload=bytes.toString('base64');const {service,calls}=harness(payload,mode);
 await service.uploadNoteAudio('own-qa',{id:'n',audio_file_path:'private/stored',audio_duration:12});
 assert.equal(calls.targets.length,1);assert.equal(calls.commits.length,1);
 const commit=calls.commits[0][1];
 assert.equal(commit.mime_type,calls.targets[0][1]);assert.equal(commit.enc_scheme,mode==='off'?'none':'e2ee');
 assert.equal(commit.enc_epoch,mode==='off'?0:7);assert.equal(commit.vault_generation,3);
 assert.equal(calls.writes[0][1],mode==='off'?payload:Buffer.from('encrypted:'+payload).toString('base64'));
 assert.equal(calls.uploads[0][2].headers['Content-Type'],commit.mime_type);
 assert.equal(calls.deletes[0][0],calls.writes[0][0]);assert.equal(calls.states[0][2].audio_synced,1);
});
test('failed PUT deletes decoded temporary audio and does not commit or mark synced',async()=>{
 const {service,calls}=harness(fixtures.wav.toString('base64'),'off',503);
 await assert.rejects(service.uploadNoteAudio('own-qa',{id:'n',audio_file_path:'private/stored'}),/HTTP 503/);
 assert.equal(calls.deletes.length,1);assert.equal(calls.commits.length,0);assert.equal(calls.states.length,0);
});
