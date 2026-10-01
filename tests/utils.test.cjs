/**
 * Guards for the small pure helpers that shape the editor and the AI plumbing.
 *
 * Build first:
 *   npx tsc --ignoreConfig src/utils/checklistScale.ts src/utils/openaiCompat.ts \
 *     src/utils/errorMessage.ts --target ES2020 --module commonjs \
 *     --outDir .test-build/utils --skipLibCheck --esModuleInterop
 */
const assert = require('node:assert/strict');
const test = require('node:test');

const {
    countChecklistItems,
    resolveChecklistScaleFactor,
    resolveChecklistScaleForContent,
} = require('../.test-build/utils/checklistScale.js');

const {
    DEFAULT_OPENAI_BASE_URL,
    buildOpenAICompatibleUrl,
    modelSupportsTemperature,
    normalizeOpenAIBaseUrl,
} = require('../.test-build/utils/openaiCompat.js');

const { getErrorMessage } = require('../.test-build/utils/errorMessage.js');

// --- checklist scaling ------------------------------------------------------

test('checklist items are counted in the visual editor HTML', () => {
    const html = '<ul><li data-type="taskItem">a</li><li data-type="taskItem">b</li></ul>';
    assert.equal(countChecklistItems(html), 2);
});

test('checklist items are counted in raw markdown, checked or not', () => {
    assert.equal(countChecklistItems('- [ ] a\n- [x] b\n- [X] c'), 3);
    assert.equal(countChecklistItems('* [ ] a\n* [x] b'), 2);
});

test('an empty checkbox with no trailing space still counts', () => {
    assert.equal(countChecklistItems('- [ ]'), 1);
});

test('plain bullets and prose are not mistaken for a checklist', () => {
    assert.equal(countChecklistItems('- just a bullet\n- another'), 0);
    assert.equal(countChecklistItems('a [x] in a sentence'), 0);
    assert.equal(countChecklistItems(''), 0);
});

test('HTML task items win over any markdown lookalike in the same content', () => {
    const mixed = '<li data-type="taskItem">a</li>\n- [ ] b\n- [ ] c';
    assert.equal(countChecklistItems(mixed), 1);
});

test('short checklists are scaled up, long ones are left alone', () => {
    assert.equal(resolveChecklistScaleFactor(1, true), 1.25);
    assert.equal(resolveChecklistScaleFactor(8, true), 1.25);
    assert.equal(resolveChecklistScaleFactor(9, true), 1.15);
    assert.equal(resolveChecklistScaleFactor(15, true), 1.15);
    assert.equal(resolveChecklistScaleFactor(16, true), 1);
});

test('scaling is a no-op when disabled or when there is nothing to scale', () => {
    assert.equal(resolveChecklistScaleFactor(5, false), 1);
    assert.equal(resolveChecklistScaleFactor(0, true), 1);
});

test('content without a checklist reports no scale at all, not a scale of 1', () => {
    assert.equal(resolveChecklistScaleForContent('plain note', true), null);
    assert.equal(resolveChecklistScaleForContent('- [ ] a', true), 1.25);
    assert.equal(resolveChecklistScaleForContent('- [ ] a', false), 1);
});

// --- OpenAI-compatible endpoints -------------------------------------------

test('an empty or blank base URL falls back to the OpenAI default', () => {
    assert.equal(normalizeOpenAIBaseUrl(''), DEFAULT_OPENAI_BASE_URL);
    assert.equal(normalizeOpenAIBaseUrl('   '), DEFAULT_OPENAI_BASE_URL);
    assert.equal(normalizeOpenAIBaseUrl(null), DEFAULT_OPENAI_BASE_URL);
    assert.equal(normalizeOpenAIBaseUrl(undefined), DEFAULT_OPENAI_BASE_URL);
});

test('a custom base URL keeps its path but loses trailing slashes', () => {
    assert.equal(normalizeOpenAIBaseUrl('  https://llm.local/v1///  '), 'https://llm.local/v1');
});

test('joining a base and a path never doubles or drops the slash', () => {
    assert.equal(
        buildOpenAICompatibleUrl('https://llm.local/v1/', '/chat/completions'),
        'https://llm.local/v1/chat/completions',
    );
    assert.equal(
        buildOpenAICompatibleUrl('https://llm.local/v1', 'chat/completions'),
        'https://llm.local/v1/chat/completions',
    );
});

test('reasoning models are not sent a temperature they would reject', () => {
    assert.equal(modelSupportsTemperature('gpt-5.4-mini'), false);
    assert.equal(modelSupportsTemperature('o1-preview'), false);
    assert.equal(modelSupportsTemperature('o3-mini'), false);
    assert.equal(modelSupportsTemperature('o4'), false);
    assert.equal(modelSupportsTemperature('  GPT-5  '), false, 'matching must ignore case and padding');
});

test('ordinary chat models still get a temperature', () => {
    assert.equal(modelSupportsTemperature('gpt-4o-mini'), true);
    assert.equal(modelSupportsTemperature('llama-3.1-8b'), true);
    assert.equal(modelSupportsTemperature(''), true);
    assert.equal(modelSupportsTemperature(null), true);
});

// --- user-facing error messages --------------------------------------------

test("the backend's detail field is preferred over the transport message", () => {
    const axiosLike = { message: 'Request failed with status code 402', response: { data: { detail: 'Out of minutes.' } } };
    assert.equal(getErrorMessage(axiosLike), 'Out of minutes.');
});

test('a raw OpenAI error envelope is unwrapped to its message', () => {
    const raw = 'API Error: 400 - {"error":{"message":"Unsupported parameter: temperature","type":"invalid_request_error"}}';
    assert.equal(getErrorMessage(raw), 'Unsupported parameter: temperature');
});

test('billing and key failures become advice instead of provider jargon', () => {
    const quota = 'API Error: 429 - {"error":{"message":"You exceeded your current quota","code":"insufficient_quota"}}';
    assert.match(getErrorMessage(quota), /run out of credits/);

    const badKey = 'API Error: 401 - {"error":{"message":"Incorrect API key provided","code":"invalid_api_key"}}';
    assert.match(getErrorMessage(badKey), /API Key is invalid/);
});

test('an unparseable API error is relabelled rather than shown as-is', () => {
    assert.equal(getErrorMessage('API Error: 500 - Internal Server Error'), 'Server Error 500 - Internal Server Error');
});

test('a tunnel outage tells the user their note is safe', () => {
    assert.match(getErrorMessage('API Error: 503 - upstream down'), /note is safe/);
    assert.match(getErrorMessage('ngrok tunnel limit_exceeded'), /connection limit exceeded/i);
});

test('transport failures are translated into something actionable', () => {
    assert.match(getErrorMessage('Network Error'), /Check internet connection/);
    assert.match(getErrorMessage('timeout of 30000ms exceeded'), /timed out/);
});

test('an unusable error falls back to the caller-supplied message', () => {
    assert.equal(getErrorMessage(null, 'Could not save'), 'Could not save');
    assert.equal(getErrorMessage({}, 'Could not save'), 'Could not save');
    assert.equal(getErrorMessage({ message: '   ' }, 'Could not save'), 'Could not save');
    assert.equal(getErrorMessage(undefined), 'Something went wrong');
});

test('whisper silence hallucinations are dropped, real speech kept', () => {
    const { stripWhisperHallucinations } = require('../.test-build/utils/whisperText');
    assert.equal(stripWhisperHallucinations('Купить молоко. Продолжение следует...'), 'Купить молоко.');
    assert.equal(stripWhisperHallucinations('Субтитры сделал DimaTorzok'), '');
    assert.equal(stripWhisperHallucinations('Call Anna tomorrow. Thanks for watching!'), 'Call Anna tomorrow.');
    assert.equal(stripWhisperHallucinations('[Music]'), '');
    assert.equal(stripWhisperHallucinations('Позвонить стоматологу завтра в десять'), 'Позвонить стоматологу завтра в десять');
});
