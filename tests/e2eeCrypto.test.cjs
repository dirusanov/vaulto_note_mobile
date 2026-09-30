/**
 * Guards for the end-to-end encryption primitives: key bundles must round-trip,
 * a wrong secret must never unwrap, and the secret validators must agree with
 * the rules the UI advertises.
 *
 * Build first:
 *   npx tsc --ignoreConfig src/crypto/e2ee.ts --target ES2020 --module commonjs \
 *     --outDir .test-build/crypto --skipLibCheck --esModuleInterop
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const nodeCrypto = require('node:crypto');

// expo-crypto is a native module; back it with the platform CSPRNG.
const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request) {
    if (request === 'expo-crypto') {
        return {
            getRandomBytesAsync: async (length) => new Uint8Array(nodeCrypto.randomBytes(length)),
        };
    }
    return originalLoad.apply(this, arguments);
};

const {
    CIPHER_VERSION,
    DEFAULT_KDF_ITERATIONS,
    KEY_BUNDLE_VERSION,
    PASSPHRASE_MIN_LENGTH,
    PASSPHRASE_MIN_WORDS,
    clearMasterKey,
    generateRecoveryCode,
    getMasterKey,
    getSecretValidationError,
    hasMasterKey,
    isKeyBundle,
    isValidPassphrase,
    keyIdFromMasterKey,
    masterKeyFromRecoveryCode,
    normalizeSecretInput,
    recoveryCodeFromMasterKey,
    setMasterKey,
    unwrapMasterKey,
    unwrapMasterKeyAsync,
    wrapMasterKey,
} = require('../.test-build/crypto/e2ee.js');

const PASSPHRASE = 'correct horse battery staple';
const sameBytes = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

// A single 32-byte key reused across the KDF-heavy cases keeps the suite quick.
const masterKey = new Uint8Array(nodeCrypto.randomBytes(32));

// --- recovery codes ---------------------------------------------------------

test('a generated recovery code is a 24-word BIP39 mnemonic', async () => {
    const code = await generateRecoveryCode();
    assert.equal(code.split(' ').length, 24);
});

test('the recovery code is the master key, so it round-trips both ways', async () => {
    const code = await generateRecoveryCode();
    const derived = masterKeyFromRecoveryCode(code);
    assert.equal(derived.length, 32);
    assert.equal(recoveryCodeFromMasterKey(derived), code);
});

test('a recovery code survives the casing and spacing a user pastes', async () => {
    const code = await generateRecoveryCode();
    const messy = `  ${code.toUpperCase().replace(/ /g, '   ')}  `;
    assert.ok(sameBytes(masterKeyFromRecoveryCode(messy), masterKeyFromRecoveryCode(code)));
});

test('a mnemonic with a broken checksum is rejected, not silently accepted', () => {
    assert.throws(
        () => masterKeyFromRecoveryCode('abandon abandon abandon abandon'),
        /Invalid recovery code format/,
    );
});

// --- key bundle wrap / unwrap ----------------------------------------------

test('a wrapped master key unwraps back to the same bytes', async () => {
    const bundle = await wrapMasterKey(masterKey, PASSPHRASE, 'passphrase');
    assert.ok(sameBytes(await unwrapMasterKeyAsync(bundle, PASSPHRASE), masterKey));
});

test('the bundle advertises the parameters the app promises', async () => {
    const bundle = await wrapMasterKey(masterKey, PASSPHRASE, 'passphrase');
    assert.equal(bundle.version, KEY_BUNDLE_VERSION);
    assert.equal(bundle.kdf.name, 'PBKDF2-HMAC-SHA256');
    assert.equal(bundle.kdf.iterations, DEFAULT_KDF_ITERATIONS);
    assert.equal(bundle.wrap.name, 'AES-256-GCM');
    assert.equal(bundle.secret_mode, 'passphrase');
    assert.equal(bundle.kdf.salt.length, 32); // 16 bytes, hex
    assert.equal(bundle.wrap.nonce.length, 24); // 12 bytes, hex
});

test('two wraps of one key differ but commit to the same key_id', async () => {
    const first = await wrapMasterKey(masterKey, PASSPHRASE, 'passphrase');
    const second = await wrapMasterKey(masterKey, PASSPHRASE, 'passphrase');
    assert.notEqual(first.wrapped_key, second.wrapped_key, 'salt/nonce must not repeat');
    assert.equal(first.key_id, second.key_id);
    assert.equal(first.key_id, keyIdFromMasterKey(masterKey));
});

test('a wrong passphrase fails closed instead of returning garbage', async () => {
    const bundle = await wrapMasterKey(masterKey, PASSPHRASE, 'passphrase');
    await assert.rejects(
        () => unwrapMasterKeyAsync(bundle, 'correct horse battery stapleX'),
        /Invalid access key/,
    );
});

test('unwrapping tolerates the whitespace a keyboard adds around a passphrase', async () => {
    const bundle = await wrapMasterKey(masterKey, PASSPHRASE, 'passphrase');
    assert.ok(sameBytes(await unwrapMasterKeyAsync(bundle, `  ${PASSPHRASE}  `), masterKey));
});

test('the sync and async unwrap paths agree', async () => {
    const bundle = await wrapMasterKey(masterKey, PASSPHRASE, 'passphrase');
    assert.ok(sameBytes(unwrapMasterKey(bundle, PASSPHRASE), masterKey));
});

test('KDF progress is reported monotonically and ends at 1', async () => {
    const seen = [];
    await wrapMasterKey(masterKey, PASSPHRASE, 'passphrase', (p) => seen.push(p));
    assert.ok(seen.length > 1, 'expected progress callbacks');
    assert.equal(seen[seen.length - 1], 1);
    for (let i = 1; i < seen.length; i++) {
        assert.ok(seen[i] >= seen[i - 1], `progress went backwards at ${i}`);
    }
});

// --- secret validation ------------------------------------------------------

test('a passphrase passes on length or on word count, not on neither', () => {
    assert.equal(isValidPassphrase('a'.repeat(PASSPHRASE_MIN_LENGTH)), true);
    assert.equal(isValidPassphrase('alpha beta gamma'), true, `${PASSPHRASE_MIN_WORDS} words is enough`);
    assert.equal(isValidPassphrase('short'), false);
    assert.equal(isValidPassphrase('   '), false);
});

test('one-letter tokens do not count towards the word minimum', () => {
    assert.equal(isValidPassphrase('a b c d'), false);
});

test('the validator names the right problem for each secret mode', async () => {
    assert.match(getSecretValidationError('', 'passphrase'), /Passphrase is required/);
    assert.match(getSecretValidationError('', 'recovery_code'), /Recovery code is required/);
    assert.match(getSecretValidationError('nope', 'recovery_code'), /Invalid recovery code/);
    assert.equal(getSecretValidationError(await generateRecoveryCode(), 'recovery_code'), null);
    assert.equal(getSecretValidationError(PASSPHRASE, 'passphrase'), null);
});

test('normalization strips zero-width characters that break a paste', () => {
    assert.equal(normalizeSecretInput('pass​phrase  here', 'passphrase'), 'passphrase here');
    assert.equal(normalizeSecretInput('  ALPHA   Beta ', 'recovery_code'), 'alpha beta');
});

// --- bundle shape validation ------------------------------------------------

const validBundle = {
    version: KEY_BUNDLE_VERSION,
    kdf: { name: 'PBKDF2-HMAC-SHA256', iterations: DEFAULT_KDF_ITERATIONS, salt: 'ab'.repeat(16) },
    wrap: { name: 'AES-256-GCM', nonce: 'cd'.repeat(12) },
    wrapped_key: 'ef'.repeat(48),
    created_at: new Date().toISOString(),
};

test('a well-formed bundle is recognized', () => {
    assert.equal(isKeyBundle(validBundle), true);
    assert.equal(isKeyBundle({ ...validBundle, key_id: 'a'.repeat(64) }), true);
    assert.equal(isKeyBundle({ ...validBundle, secret_mode: 'pin' }), true, 'legacy pin bundles still parse');
});

// NOTE: the `&&` chain in isKeyBundle short-circuits on a missing field, so it
// can return undefined rather than false. Every call site consumes it as a
// boolean, so these assert rejection rather than the literal `false`.
test('a malformed bundle is rejected rather than half-trusted', () => {
    assert.ok(!isKeyBundle(null));
    assert.ok(!isKeyBundle('v3'));
    assert.ok(!isKeyBundle({ ...validBundle, kdf: undefined }));
    assert.ok(!isKeyBundle({ ...validBundle, wrap: undefined }));
    assert.ok(!isKeyBundle({ ...validBundle, version: '3' }));
    assert.ok(!isKeyBundle({ ...validBundle, key_id: 'not-hex' }));
    assert.ok(!isKeyBundle({ ...validBundle, key_id: 'a'.repeat(63) }));
    assert.ok(!isKeyBundle({ ...validBundle, secret_mode: 'sms' }));
});

// --- in-memory master key ---------------------------------------------------

test('the master key is held only in memory and can be cleared', () => {
    clearMasterKey();
    assert.equal(hasMasterKey(), false);
    assert.equal(getMasterKey(), null);

    setMasterKey(masterKey);
    assert.equal(hasMasterKey(), true);
    assert.ok(sameBytes(getMasterKey(), masterKey));

    clearMasterKey();
    assert.equal(hasMasterKey(), false);
});

test('the cipher version the notes are tagged with is v3', () => {
    assert.equal(CIPHER_VERSION, 'v3');
});
