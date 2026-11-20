/**
 * "Every failure ends in a clear sentence and a next step" (UX review, 20 Nov 2026):
 * server text never reaches the user, an expired access token is renewed and the
 * request sent once more, a known AI limit is answered without a request, an
 * unlock always reports what it achieved, dates follow the app language.
 *
 * Build first: see "test:errors" in package.json.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const build = '../.test-build/errorPaths';
const { getErrorMessage, describeServerStatus } = require(`${build}/errorMessage.js`);
const { createSessionFetch } = require(`${build}/sessionRetry.js`);
const { SessionExpiredError, isSessionExpiredError, isServerUnreachableError } = require(`${build}/sessionErrors.js`);
const limit = require(`${build}/aiLimitState.js`);
const { formatAppDate } = require(`${build}/dateFormat.js`);
const { isUnreadableNote, summarizeUnlock } = require(`${build}/unreadableNote.js`);
const { estimateSecondsLeft, roundTimeLeft } = require(`${build}/progressEstimate.js`);

// --- plain words instead of server text ------------------------------------------

test('the AI endpoint\'s "Invalid credentials" never reaches the user', () => {
    const raw = 'LLM API error: 401 - {"detail":"Invalid credentials"}';
    assert.match(getErrorMessage(raw), /session has expired/i);
    assert.doesNotMatch(getErrorMessage(raw), /Invalid credentials/);
    assert.match(getErrorMessage(new Error('LLM API error: 401')), /Sign in again/);
});

test('statuses of our own services map to calm copy, never the body', () => {
    assert.match(getErrorMessage(new Error('LLM API error: 500 - {"detail":"Traceback ..."}')), /temporarily unavailable/);
    assert.match(getErrorMessage(new Error('LLM API error: 429')), /Too many requests/);
    assert.match(getErrorMessage(new Error('Agent request failed (413)')), /too long/);
    assert.match(getErrorMessage(new Error('Transcription request failed (422)')), /Something went wrong/);
    assert.match(getErrorMessage('Session expired. Please sign in again.'), /Sign in again to continue/);
    assert.match(getErrorMessage(new Error('LLM returned empty response')), /sent back nothing/);
    assert.match(describeServerStatus(503), /temporarily unavailable/);
});

test('an expired session on any API call reads as such, but a wrong password at sign-in does not', () => {
    const apiCall = { message: 'Request failed with status code 401', response: { status: 401, data: { detail: 'Invalid credentials' } }, config: { url: '/sync/notes' } };
    assert.match(getErrorMessage(apiCall), /session has expired/i);
    const login = { message: 'Request failed with status code 401', response: { status: 401, data: { detail: 'Invalid credentials' } }, config: { url: '/auth/login' } };
    assert.doesNotMatch(getErrorMessage(login), /session has expired/i);
});

test('the session errors are recognised by name and by message', () => {
    assert.ok(isSessionExpiredError(new SessionExpiredError()));
    assert.ok(isSessionExpiredError({ message: 'session_expired' }));
    assert.ok(!isSessionExpiredError(new Error('Usage limit reached')));
    assert.ok(isServerUnreachableError({ name: 'ServerUnreachableError' }));
    assert.match(getErrorMessage(new SessionExpiredError()), /Sign in again/);
    assert.match(getErrorMessage({ name: 'ServerUnreachableError', message: 'server_unreachable' }), /Could not reach the server/);
    // The limit errors keep their message: screens recognise it.
    assert.equal(getErrorMessage(new limit.UsageLimitError('llm_tokens_exhausted')), 'Usage limit reached');
});

// --- 401: renew silently, retry once ------------------------------------------------

const sessionHarness = (statuses, refresh) => {
    const sent = [];
    let expired = 0;
    const fetchWithSession = createSessionFetch({
        getToken: async () => 'old-token',
        refresh: async () => refresh,
        send: async (url, init) => {
            sent.push(init.headers.Authorization);
            return { status: statuses.shift() };
        },
        onExpired: () => { expired += 1; },
    });
    const call = () => fetchWithSession('https://api.invalid/ai/improve', (token) => ({ headers: { Authorization: `Bearer ${token}` } }));
    return { call, sent, get expired() { return expired; } };
};

test('a stale access token is renewed and the request sent once more', async () => {
    const h = sessionHarness([401, 200], { kind: 'success', accessToken: 'new-token' });
    const response = await h.call();
    assert.equal(response.status, 200);
    assert.deepEqual(h.sent, ['Bearer old-token', 'Bearer new-token']);
    assert.equal(h.expired, 0);
});

test('a session that cannot be renewed asks for a sign-in, once', async () => {
    const h = sessionHarness([401], { kind: 'invalid_refresh' });
    await assert.rejects(h.call(), (error) => isSessionExpiredError(error));
    assert.equal(h.sent.length, 1, 'no retry with the dead token');
    assert.equal(h.expired, 1);
});

test('a renewed token refused again is not retried forever', async () => {
    const h = sessionHarness([401, 401], { kind: 'success', accessToken: 'new-token' });
    await assert.rejects(h.call(), (error) => isSessionExpiredError(error));
    assert.equal(h.sent.length, 2);
});

test('offline during the renewal is not a sign-out', async () => {
    const h = sessionHarness([401], { kind: 'transient_failure' });
    await assert.rejects(h.call(), (error) => isServerUnreachableError(error));
    assert.equal(h.expired, 0);
});

test('other answers pass through untouched', async () => {
    for (const status of [200, 403, 500]) {
        const h = sessionHarness([status], { kind: 'invalid_refresh' });
        assert.equal((await h.call()).status, status);
        assert.equal(h.sent.length, 1);
    }
});

// --- the AI limit known up front --------------------------------------------------------

test('usage figures of the profile make the limit known, with its reset date', () => {
    limit.resetAiLimitStateForTests();
    const now = Date.parse('2026-11-20T10:00:00Z');
    limit.noteAiTokensRemaining(0, '2026-12-01T00:00:00Z', now);
    assert.equal(limit.isAiLimitKnown(now), true);
    assert.equal(limit.aiLimitResetAt(now), Date.parse('2026-12-01T00:00:00Z'));
    // A later refusal without a date keeps the date already known.
    limit.markAiLimitReached(null, now + 1000);
    assert.equal(limit.aiLimitResetAt(now + 1000), Date.parse('2026-12-01T00:00:00Z'));
    // Tokens back (a new period, an upgrade): no longer limited.
    limit.noteAiTokensRemaining(5000, '2026-12-01T00:00:00Z', now);
    assert.equal(limit.isAiLimitKnown(now), false);
    assert.equal(limit.aiLimitResetAt(now), null);
});

// --- dates in the app language ------------------------------------------------------------

test('dates follow the app language, not the device locale', () => {
    const now = new Date(2026, 10, 20);
    assert.equal(formatAppDate(new Date(2026, 11, 1, 12), 'ru', now), '1 декабря');
    assert.equal(formatAppDate(new Date(2026, 11, 1, 12), 'en', now), 'December 1');
    assert.match(formatAppDate(new Date(2027, 0, 5, 12), 'de', now), /5\. Januar 2027/);
    assert.equal(formatAppDate(null, 'ru', now), '');
    assert.equal(formatAppDate('not a date', 'ru', now), '');
});

// --- unlock result ---------------------------------------------------------------------------

test('an unlock counts readable notes and the ones still sealed', () => {
    const notes = [
        { title: 'Shopping', content: 'milk' },
        { title: '[Encrypted]', content: '[Encrypted]' },
        { title: '', content: 'Call Anna' },
        { title: 'Gone', content: 'x', deleted: true },
        { title: '', content: '', locked: true },
    ];
    assert.deepEqual(summarizeUnlock(notes), { readable: 2, unreadable: 2 });
    assert.equal(isUnreadableNote({ title: '[Encrypted]', content: '[Encrypted]' }), true);
    assert.equal(isUnreadableNote({ title: 'Encrypted notes', content: 'about [Encrypted] text' }), false);
});

test('time left comes from how fast the bar really moved', () => {
    assert.equal(estimateSecondsLeft({ at: 0, progress: 8 }, { at: 1000, progress: 9 }), null, 'too early');
    // 10 points in 30 s, 80 points to go: about 4 minutes.
    assert.equal(estimateSecondsLeft({ at: 0, progress: 10 }, { at: 30000, progress: 20 }), 240);
    assert.deepEqual(roundTimeLeft(240), { unit: 'minutes', value: 4 });
    assert.deepEqual(roundTimeLeft(42), { unit: 'seconds', value: 50 });
    assert.deepEqual(roundTimeLeft(3), { unit: 'almost' });
});
