const assert = require('node:assert/strict');
const test = require('node:test');

const {
    isRetryableSyncConflict,
    isSameKeyGeneration,
    rebasedClientTimestamp,
    shouldPauseForEncryptionState,
} = require('../.test-build/encryptionState.js');

test('pauses a plaintext device when another device enables E2EE', () => {
    assert.equal(shouldPauseForEncryptionState('local', 'e2ee'), true);
});

test('pauses an E2EE device when another device disables E2EE', () => {
    assert.equal(shouldPauseForEncryptionState('e2ee', 'off'), true);
});

test('continues when local and server encryption modes match', () => {
    assert.equal(shouldPauseForEncryptionState('local', 'off'), false);
    assert.equal(shouldPauseForEncryptionState('e2ee', 'e2ee'), false);
});

test('keeps legacy servers without enc_mode compatible', () => {
    assert.equal(shouldPauseForEncryptionState('local', null), false);
    assert.equal(shouldPauseForEncryptionState('e2ee', undefined), false);
});

test('pauses when E2EE key generation changed while the device was offline', () => {
    assert.equal(shouldPauseForEncryptionState('e2ee', 'e2ee', 2, 4), true);
    assert.equal(shouldPauseForEncryptionState('e2ee', 'e2ee', 4, 2), true);
});

test('pauses before apply when a destructive vault reset changed generation', () => {
    assert.equal(shouldPauseForEncryptionState('local', 'off', 8, 8, 2, 3), true);
    assert.equal(shouldPauseForEncryptionState('e2ee', 'off', 8, 9, 2, 3), true);
});

test('continues when the destructive vault generation is current', () => {
    assert.equal(shouldPauseForEncryptionState('local', 'off', 8, 8, 3, 3), false);
});

test('pauses when the server loses a previously known vault generation', () => {
    assert.equal(shouldPauseForEncryptionState('local', 'off', 8, 8, 3, 0), true);
});

test('does not treat an unknown bootstrap epoch as a key rotation', () => {
    assert.equal(shouldPauseForEncryptionState('e2ee', 'e2ee', 0, 4), false);
});

test('preserves semantic local edits for version and timestamp conflicts', () => {
    assert.equal(isRetryableSyncConflict('version_conflict'), true);
    assert.equal(isRetryableSyncConflict('stale_timestamp'), true);
    assert.equal(isRetryableSyncConflict('encryption_required'), false);
    assert.equal(isRetryableSyncConflict('vault_generation_mismatch'), false);
    assert.equal(isRetryableSyncConflict('note_id_in_use_by_another_user'), false);
});

test('rebased retry timestamp is strictly newer than a future server clock', () => {
    const server = '2030-01-01T00:00:00.000Z';
    assert.equal(
        rebasedClientTimestamp(Date.parse('2029-01-01T00:00:00.000Z'), server),
        '2030-01-01T00:00:00.001Z',
    );
});

test('rebased retry timestamp uses current time for invalid server timestamp', () => {
    assert.equal(
        rebasedClientTimestamp(Date.parse('2028-02-03T04:05:06.000Z'), 'invalid'),
        '2028-02-03T04:05:06.000Z',
    );
});

test('recognizes crash-resume bundles by key commitment, not wrapper bytes', () => {
    assert.equal(isSameKeyGeneration('a'.repeat(64), 'a'.repeat(64), false), true);
    assert.equal(isSameKeyGeneration('a'.repeat(64), 'b'.repeat(64), false), false);
    assert.equal(isSameKeyGeneration(undefined, undefined, true), true);
});
