// Host integration tests, NOT Android/UI tests. Run the production TypeScript
// against real SQLite and crypto, replacing only native/runtime boundaries.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { randomBytes } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function app() {
    const cache = new Map();
    const secrets = new Map();
    const values = new Map();
    let deviceKeyWrites = 0;
    const database = new DatabaseSync(':memory:');
    const sqlite = {
        runAsync: async (sql, params = []) => database.prepare(sql).run(...params),
        getAllAsync: async (sql, params = []) => database.prepare(sql).all(...params),
    };
    const storage = {
        getDeviceKey: async () => secrets.get('device') ?? null,
        setDeviceKey: async (key) => { deviceKeyWrites++; secrets.set('device', key); },
        getStoredMasterKey: async (user) => secrets.get(`master:${user}`) ?? null,
        removeStoredMasterKey: async (user) => { secrets.delete(`master:${user}`); },
        getUserId: async () => values.get('userId') ?? null,
        setUserId: async (user) => { values.set('userId', user); },
        removeUserId: async () => { values.delete('userId'); },
        setKeepLocalNotes: async (keep) => { values.set('keep', keep); },
        getKeepLocalNotes: async () => values.get('keep') ?? false,
        getSyncEnabled: async () => false,
        getCryptoMode: async () => 'e2ee',
        setToken: async () => {}, removeToken: async () => {}, removeRefreshToken: async () => {},
        setUserProfile: async () => {}, removeUserProfile: async () => {},
    };
    const sync = {
        setCurrentUser: async () => {},
        setAuthenticated: () => {},
        clearLocalSyncCursor: async (user) => { values.delete(`seq:${user}`); },
        setSyncEnabled: (enabled) => { values.set('syncEnabled', enabled); },
        setEncryptionTransitionToken: () => {},
        registerEncryptionConflictHandler: () => {},
    };
    const hooks = {
        createContext: () => ({ Provider: 'Provider' }),
        useState: () => { throw new Error('Seed the auth session before rendering'); },
        useEffect: () => {}, useCallback: (fn) => fn, useRef: (current) => ({ current }), useMemo: (fn) => fn(),
        createElement: (type, props) => ({ type, props }),
    };
    const overrides = {
        'react-native': { Platform: { OS: 'android' }, NativeModules: {}, InteractionManager: { runAfterInteractions: (fn) => fn() } },
        '@react-native-community/netinfo': {},
        'react': hooks,
        'expo-crypto': { getRandomBytesAsync: async (n) => new Uint8Array(randomBytes(n)) },
        'expo-sqlite': { openDatabaseAsync: async () => sqlite },
        'expo-secure-store': {
            getItemAsync: async (key) => secrets.get(key) ?? null,
            setItemAsync: async (key, value) => { secrets.set(key, value); },
        },
        '@react-native-async-storage/async-storage': {
            getItem: async (key) => values.get(key) ?? null,
            setItem: async (key, value) => { values.set(key, value); },
            removeItem: async (key) => { values.delete(key); },
            getAllKeys: async () => [...values.keys()],
        },
        [path.join(root, 'src/utils/storage.ts')]: { storage, clearSyncLockBannerDismissed: async () => {} },
        [path.join(root, 'src/services/AudioService.ts')]: { AudioService: { deleteAudioFile: async () => {} } },
        [path.join(root, 'src/services/SyncService.ts')]: { syncService: sync },
        [path.join(root, 'src/utils/deviceIdentity.ts')]: { getDeviceId: async () => 'test-device', getPlatformName: () => 'android' },
        [path.join(root, 'src/utils/authEvents.ts')]: { onUnauthorized: { subscribe: () => () => {} } },
        [path.join(root, 'src/api/auth.ts')]: { authApi: { anonymousAuth: async () => ({ user_id: 'guest', access_token: 'test' }) } },
        [path.join(root, 'src/api/e2ee.ts')]: { e2eeApi: {} },
        [path.join(root, 'src/api/notes.ts')]: { notesApi: {} },
    };
    function load(file) {
        const resolved = path.resolve(root, file);
        if (overrides[resolved]) return overrides[resolved];
        if (cache.has(resolved)) return cache.get(resolved).exports;
        const module = { exports: {} };
        cache.set(resolved, module);
        const localRequire = createRequire(resolved);
        const requireApp = (request) => {
            if (overrides[request]) return overrides[request];
            if (request.startsWith('.')) {
                const base = path.resolve(path.dirname(resolved), request);
                for (const suffix of ['.ts', '.tsx']) {
                    if (fs.existsSync(base + suffix)) return load(base + suffix);
                }
            }
            return localRequire(request);
        };
        const source = ts.transpileModule(fs.readFileSync(resolved, 'utf8'), {
            fileName: resolved,
            compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
        }).outputText;
        vm.runInThisContext(`(function(require, module, exports) { ${source}\n})`, { filename: resolved })(requireApp, module, module.exports);
        return module.exports;
    }
    function auth(user = 'alice') {
        const session = ['token', 'refresh', user, { id: user, provider: 'google' }, false, false];
        let i = 0;
        hooks.useState = () => [session[i++], () => {}];
        return load('src/context/AuthContext.tsx').AuthProvider({ children: null }).props.value;
    }
    async function mountRetainedGuestEncryption(userId) {
        const effects = [];
        hooks.useState = (initial) => [initial, () => {}];
        hooks.useEffect = (callback) => effects.push(callback);
        overrides[path.join(root, 'src/hooks/useAuth.ts')] = { useAuth: () => ({ userId, isGuest: true, isAuthenticated: false }) };
        load('src/context/EncryptionContext.tsx').EncryptionProvider({ children: null });
        for (const effect of effects) effect();
        await new Promise(setImmediate);
    }
    return { load, auth, mountRetainedGuestEncryption, database, secrets, values, storage, overrides, get deviceKeyWrites() { return deviceKeyWrites; }, restartCrypto() { cache.delete(path.join(root, 'src/crypto/encryption.ts')); return load('src/crypto/encryption.ts'); } };
}

test('parallel first saves all decrypt after a cold app restart', async () => {
    const a = app();
    try {
        const crypto = a.load('src/crypto/encryption.ts');
        const texts = ['Заголовок 🔒', 'Секретная заметка\n- [x] молоко', 'AI version', ''];
        const ciphertexts = await Promise.all(texts.map(crypto.encrypt));
        const restarted = a.restartCrypto();
        assert.deepEqual(await Promise.all(ciphertexts.map(restarted.decrypt)), texts);
        assert.equal(a.deviceKeyWrites, 1);
        assert.ok(ciphertexts[0].startsWith('v3d.'));
        assert.ok(!ciphertexts[1].includes('молоко'));
    } finally { a.database.close(); }
});

test('a failed device key write is retried instead of caching an unusable key', async () => {
    const a = app();
    try {
        const persist = a.storage.setDeviceKey;
        a.storage.setDeviceKey = async () => { throw new Error('Keystore unavailable'); };
        const crypto = a.load('src/crypto/encryption.ts');
        await assert.rejects(crypto.encrypt('first save'), /Keystore unavailable/);
        a.storage.setDeviceKey = persist;
        const ciphertext = await crypto.encrypt('retry');
        assert.equal(await a.restartCrypto().decrypt(ciphertext), 'retry');
    } finally { a.database.close(); }
});

test('keep-on-device sign-out retains the scoped key, notes, versions and trash', async () => {
    const a = app();
    try {
        const key = new Uint8Array(randomBytes(32));
        a.secrets.set('master:alice', Buffer.from(key).toString('hex'));
        a.secrets.set('master:bob', 'other account key');
        a.values.set('userId', 'alice');
        const e2ee = a.load('src/crypto/e2ee.ts');
        e2ee.setMasterKey(key);
        const crypto = a.load('src/crypto/encryption.ts');
        crypto.setCryptoMode('e2ee');
        const db = a.load('src/services/DatabaseService.ts');
        await db.saveNoteLocal('alice', { id: 'n1', title: 'Секрет', content: 'После выхода', synced: 1 });
        await db.saveImprovementLocal('alice', { id: 'v1', note_id: 'n1', encrypted_title: await crypto.encrypt('Версия'), encrypted_content: await crypto.encrypt('Чеклист'), synced: 1 });
        const trash = { id: 't1', title: 'Корзина', content: 'Можно восстановить', recordings: [], deleted_at: new Date().toISOString() };
        await db.saveTrashEntry('alice', trash);
        await a.auth().signOut({ keepLocalNotes: true, wipeLocal: false });
        assert.equal(a.values.get('userId'), 'alice');
        assert.equal(a.values.get('keep'), true);
        assert.equal(a.secrets.get('master:bob'), 'other account key');
        // Simulate process death: only the retained account's SecureStore key is available.
        e2ee.clearMasterKey();
        const retained = await a.storage.getStoredMasterKey('alice');
        assert.ok(retained, 'keeping ciphertext must keep its decryption key');
        await a.mountRetainedGuestEncryption('alice');
        assert.equal(a.values.get('syncEnabled'), false, 'retaining local access must not resume account sync');
        assert.equal((await db.getNotesLocal('alice'))[0].content, 'После выхода');
        assert.equal((await db.getAllImprovementsLocal('alice'))[0].content, 'Чеклист');
        assert.deepEqual(await db.getTrashEntries('alice'), [trash]);
    } finally { a.database.close(); }
});

test('delete-on-device sign-out removes the local key and data', async () => {
    const a = app();
    try {
        a.values.set('userId', 'alice');
        a.secrets.set('master:alice', 'key');
        a.values.set('seq:alice', 152);
        a.values.set('seq:bob', 93);
        const db = a.load('src/services/DatabaseService.ts');
        await db.saveNoteLocal('alice', { id: 'n1', title: 'Delete me', content: 'test', synced: 1 });
        await db.saveNoteLocal('bob', { id: 'b1', content: 'Keep another account', synced: 1 });
        await a.auth().signOut({ keepLocalNotes: false, wipeLocal: true });
        assert.equal(await a.storage.getStoredMasterKey('alice'), null);
        assert.deepEqual(await db.getNotesLocal('alice'), []);
        assert.equal(a.values.has('seq:alice'), false, 'the next sign-in must pull the full server history');
        assert.equal(a.values.get('seq:bob'), 93);
        assert.equal((await db.getNotesLocal('bob'))[0].content, 'Keep another account');
    } finally { a.database.close(); }
});

test('SecureStore errors never masquerade as a missing or successfully saved device key', async () => {
    const a = app();
    try {
        delete a.overrides[path.join(root, 'src/utils/storage.ts')];
        const native = a.overrides['expo-secure-store'];
        native.getItemAsync = async () => { throw new Error('Keychain temporarily unavailable'); };
        native.setItemAsync = async () => { throw new Error('Keychain write failed'); };
        const { storage } = a.load('src/utils/storage.ts');
        await assert.rejects(storage.getDeviceKey(), /Keychain temporarily unavailable/);
        await assert.rejects(storage.setDeviceKey('ab'.repeat(32)), /Keychain write failed/);
    } finally { a.database.close(); }
});

test('deleting one account leaves the other account notes, versions and trash intact', async () => {
    const a = app();
    try {
        const db = a.load('src/services/DatabaseService.ts');
        const crypto = a.load('src/crypto/encryption.ts');
        for (const user of ['alice', 'bob']) {
            await db.saveNoteLocal(user, { id: `${user}-note`, content: `Note for ${user}` });
            await db.saveImprovementLocal(user, { id: `${user}-version`, note_id: `${user}-note`, encrypted_content: await crypto.encrypt(`Version for ${user}`) });
            await db.saveTrashEntry(user, { id: `${user}-trash`, title: user, content: 'trash', recordings: [], deleted_at: new Date().toISOString() });
        }
        const pending = a.load('src/services/pendingTranscriptions.ts');
        for (const user of ['alice', 'bob']) await pending.enqueuePendingTranscription(user, { noteId: `${user}-note`, recordingId: 'r', variantId: 'original' });
        await db.wipeLocalDatabase('alice');
        assert.equal((await pending.getPendingTranscriptions('alice', 'alice-note')).length, 0);
        assert.equal((await pending.getPendingTranscriptions('bob', 'bob-note')).length, 1);
        assert.deepEqual(await db.getNotesLocal('alice'), []);
        assert.deepEqual(await db.getAllImprovementsLocal('alice'), []);
        assert.deepEqual(await db.getTrashEntries('alice'), []);
        assert.equal((await db.getNotesLocal('bob'))[0].content, 'Note for bob');
        assert.equal((await db.getAllImprovementsLocal('bob'))[0].content, 'Version for bob');
        assert.equal((await db.getTrashEntries('bob'))[0].title, 'bob');
    } finally { a.database.close(); }
});

test('sign-out warns about locked, local-only, changed-version and unsent audio notes', async () => {
    const a = app();
    try {
        const e2ee = a.load('src/crypto/e2ee.ts');
        e2ee.setMasterKey(new Uint8Array(randomBytes(32)));
        const crypto = a.load('src/crypto/encryption.ts');
        crypto.setCryptoMode('e2ee');
        const db = a.load('src/services/DatabaseService.ts');
        const notes = [
            { id: 'safe', synced: 1 },
            { id: 'edit', synced: 1, dirty: true },
            { id: 'local', synced: 1, storage_scope: 'local_only' },
            { id: 'version', synced: 1 },
            { id: 'audio', synced: 1, has_audio: true, audio_file_path: '/test.m4a', audio_synced: 0 },
            { id: 'new', synced: 0 },
            { id: 'deleted', synced: 0, deleted: true },
        ];
        for (const note of notes) await db.saveNoteLocal('alice', { title: note.id, content: 'encrypted', ...note });
        await db.saveImprovementLocal('alice', { id: 'v1', note_id: 'version', encrypted_content: await crypto.encrypt('unsent version'), dirty: true, synced: 0 });
        await db.saveImprovementLocal('alice', { id: 'v2', note_id: 'version', encrypted_content: await crypto.encrypt('another version'), dirty: true, synced: 0 });
        await db.saveNoteLocal('bob', { id: 'other', content: 'another account', dirty: true });
        e2ee.clearMasterKey();
        assert.equal(await db.getSignOutDataAtRiskCount('alice'), 5, 'count notes once, including unreadable ciphertext');
        assert.equal(await db.getSignOutDataAtRiskCount('bob'), 1);
    } finally { a.database.close(); }
});

test('a recovery key restores server ciphertext and audio on a clean installation', async () => {
    const a = app();
    try {
        const e2ee = a.load('src/crypto/e2ee.ts');
        const crypto = a.load('src/crypto/encryption.ts');
        const code = await e2ee.generateRecoveryCode();
        const master = e2ee.masterKeyFromRecoveryCode(code);
        const bundle = await e2ee.wrapMasterKey(master, code, 'recovery_code');
        e2ee.setMasterKey(master);
        crypto.setCryptoMode('e2ee');
        const content = 'Восстановление после переустановки 🔐\n- [x] Готово';
        const ciphertext = await crypto.encryptForSync(content);
        const audio = Buffer.from(randomBytes(128)).toString('base64');
        const audioCiphertext = await crypto.encryptAudioBase64ForSync(audio);
        e2ee.clearMasterKey();
        a.secrets.clear();
        const fresh = a.restartCrypto();
        fresh.setCryptoMode('e2ee');
        await assert.rejects(fresh.decrypt(ciphertext), /E2EE locked/);
        await assert.rejects(fresh.encryptForSync('local edit'), /E2EE locked/);
        e2ee.setMasterKey(await e2ee.unwrapMasterKeyAsync(bundle, code.toUpperCase().replace(/ /g, '\n')));
        assert.equal(await fresh.decryptFromSync(ciphertext), content);
        assert.equal(fresh.decryptAudioBase64FromSync(audioCiphertext), audio);
        e2ee.setMasterKey(new Uint8Array(randomBytes(32)));
        await assert.rejects(fresh.decryptFromSync(ciphertext));
        assert.throws(() => fresh.decryptAudioBase64FromSync(audioCiphertext));
    } finally { a.database.close(); }
});


test('voice recording transcripts are encrypted in SQLite and hidden while their parent vault is locked', async () => {
    const a = app();
    try {
        const db = a.load('src/services/DatabaseService.ts');
        const crypto = a.load('src/crypto/encryption.ts');
        const e2ee = a.load('src/crypto/e2ee.ts');
        const key = new Uint8Array(randomBytes(32));
        e2ee.setMasterKey(key); crypto.setCryptoMode('e2ee');
        await db.saveNoteLocal('alice', { id: 'voice-note', title: 'Private dictation', content: '' });
        await db.saveVoiceRecordingLocal('alice', { id: 'recording', note_id: 'voice-note', file_path: '/encrypted.m4a', duration: 12, created_at: new Date().toISOString(), transcription: 'Call Alice on Friday' });
        const raw = a.database.prepare('SELECT transcription FROM voice_recordings WHERE id = ?').get('recording').transcription;
        assert.match(raw, /^v3d\./);
        assert.equal((await db.getVoiceRecordingsLocal('alice', 'voice-note'))[0].transcription, 'Call Alice on Friday');
        assert.equal((await db.getNotesLocal('alice'))[0].voice_files[0].transcription, 'Call Alice on Friday');
        e2ee.clearMasterKey();
        assert.equal((await db.getVoiceRecordingsLocal('alice', 'voice-note'))[0].transcription, undefined);
        e2ee.setMasterKey(key); crypto.setCryptoMode('local');
        await db.decryptAndRescueAllNotes('alice'); e2ee.clearMasterKey();
        assert.equal((await db.getVoiceRecordingsLocal('alice', 'voice-note'))[0].transcription, 'Call Alice on Friday');
    } finally { a.database.close(); }
});

test('reading a legacy plaintext voice transcript migrates it without rewriting other accounts', async () => {
    const a = app();
    try {
        const db = a.load('src/services/DatabaseService.ts');
        for (const user of ['alice', 'bob']) {
            await db.saveNoteLocal(user, { id: user+'-n', content: 'note' });
            await db.saveVoiceRecordingLocal(user, { id: user+'-r', note_id: user+'-n', file_path: '/encrypted.m4a', duration: 2, created_at: new Date().toISOString() });
            a.database.prepare('UPDATE voice_recordings SET transcription = ? WHERE id = ?').run('Legacy '+user, user+'-r');
        }
        assert.equal((await db.getVoiceRecordingsLocal('alice', 'alice-n'))[0].transcription, 'Legacy alice');
        assert.match(a.database.prepare('SELECT transcription FROM voice_recordings WHERE id = ?').get('alice-r').transcription, /^v3d\./);
        assert.equal(a.database.prepare('SELECT transcription FROM voice_recordings WHERE id = ?').get('bob-r').transcription, 'Legacy bob');
    } finally { a.database.close(); }
});

test('a failed note write is reported to sync, so its cursor does not skip the change', async () => {
    const a = app();
    try {
        const db = a.load('src/services/DatabaseService.ts');
        await db.saveNoteLocal('alice', { id: 'n1', title: 'First', content: 'stored', synced: 1 });
        const prepare = a.database.prepare.bind(a.database);
        a.database.prepare = (sql) => {
            if (/insert|update/i.test(sql) && /notes/i.test(sql)) {
                throw new Error('database is locked');
            }
            return prepare(sql);
        };
        // UI saves keep their old behaviour (logged, not thrown)...
        await db.saveNoteLocal('alice', { id: 'n2', content: 'ui save', synced: 0 });
        // ...but the sync engine learns the server change was not stored.
        await assert.rejects(
            db.saveNoteLocal('alice', { id: 'n3', content: 'from server', synced: 1 }, { throwOnError: true }),
            /database is locked/,
        );
    } finally { a.database.close(); }
});
