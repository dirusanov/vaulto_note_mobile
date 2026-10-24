/**
 * The guest Play Integrity helpers must agree with the gateway byte for byte
 * (app/application/services/guest_integrity.py `request_hash`).
 *
 * Build first:
 *   npx tsc --ignoreConfig src/utils/guestIntegrity.ts --target ES2020 --module commonjs \
 *     --outDir .test-build/guestIntegrity --skipLibCheck --esModuleInterop
 */
const assert = require('node:assert/strict');
const test = require('node:test');

const {
    guestRequestHash,
    installIdFromAndroidId,
    integrityChallengeOf,
    integrityErrorCode,
    withTimeout,
} = require('../.test-build/guestIntegrity/guestIntegrity.js');

test('request hash matches the gateway', () => {
    // Values printed by the gateway's request_hash() for the same inputs.
    assert.equal(
        guestRequestHash(
            '1761300000.0123456789abcdef01234567.0123456789abcdef0123456789abcdef',
            '3f1c2d4e-1111-4222-8333-944455556666',
            'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        ),
        'd7ea5148b728a4bd2816919ca1be27432928209574a6747d84d12da59208fe17',
    );
    assert.equal(guestRequestHash('c', 'd', undefined), '19965733278ae304be5b4529afc9015d7d0de39d83a64d26b8698f33ee556231');
    assert.equal(guestRequestHash('c', 'd', null), guestRequestHash('c', 'd', ''));
});

test('install id hides the Android ID and is stable', () => {
    const id = installIdFromAndroidId('9774d56d682e549c');
    assert.match(id, /^[0-9a-f]{64}$/);
    assert.equal(id, installIdFromAndroidId(' 9774d56d682e549c '));
    assert.ok(!id.includes('9774d56d682e549c'));
    assert.equal(installIdFromAndroidId(''), undefined);
    assert.equal(installIdFromAndroidId(null), undefined);
});

test('only a 428 integrity_required error carries a challenge', () => {
    const error = {
        response: {
            status: 428,
            data: { detail: 'x', code: 'integrity_required', meta: { challenge: '1.a.b', cloud_project_number: '123' } },
        },
    };
    assert.deepEqual(integrityChallengeOf(error), { challenge: '1.a.b', cloudProjectNumber: '123' });
    assert.equal(
        integrityChallengeOf({ response: { status: 428, data: { code: 'integrity_required', meta: { challenge: 'c', cloud_project_number: null } } } }).cloudProjectNumber,
        null,
    );
    assert.equal(integrityChallengeOf({ response: { status: 429, data: { code: 'guest_signups_limited' } } }), null);
    assert.equal(integrityChallengeOf({ response: { status: 428, data: { code: 'other' } } }), null);
    assert.equal(integrityChallengeOf(new Error('Network Error')), null);
    assert.equal(integrityChallengeOf(null), null);
});

test('native error codes are shortened for the server', () => {
    assert.equal(integrityErrorCode({ code: 'ERR_APP_INTEGRITY_PLAY_SERVICES_NOT_FOUND' }), 'PLAY_SERVICES_NOT_FOUND');
    assert.equal(integrityErrorCode(new Error('boom')), 'UNKNOWN');
    assert.equal(integrityErrorCode({ code: 'ERR weird/code' }), 'ERR_weird_code');
});

test('withTimeout rejects a hanging call', async () => {
    await assert.rejects(withTimeout(new Promise(() => {}), 10, 'prepare'), (error) => {
        assert.equal(integrityErrorCode(error), 'TIMEOUT');
        return true;
    });
    assert.equal(await withTimeout(Promise.resolve(5), 1000, 'x'), 5);
});
