const test = require('node:test');
const assert = require('node:assert/strict');
const {
    splitSentences,
    buildRecordingTimings,
    joinPartSegments,
    serializeTimings,
    parseTimings,
    linkTextToRecordings,
    findQuoteLink,
    activePhraseKey,
    phrasesOfRecording,
    playbackStartFor,
    formatPhraseTime,
    phraseMatchScore,
} = require('../.test-build/phraseTiming/phraseTiming');

const RU = 'Я отправлю Ире смету к пятнице. А звонок пока не назначай. Купить молоко.';
// whisper.cpp style: one segment per sentence, times in seconds.
const RU_SEGMENTS = [
    { start: 0, end: 2.6, text: ' Я отправлю Ире смету к пятнице.' },
    { start: 2.6, end: 4.9, text: ' А звонок пока не назначай.' },
    { start: 5.2, end: 6.4, text: ' Купить молоко.' },
];

test('sentences split on punctuation and line breaks, with offsets', () => {
    const text = 'Hello there. How are you?\n- [ ] Buy milk\n\nOk…';
    const parts = splitSentences(text);
    assert.deepEqual(parts.map((p) => p.text), ['Hello there.', 'How are you?', '- [ ] Buy milk', 'Ok…']);
    for (const part of parts) assert.equal(text.slice(part.from, part.to), part.text);
    assert.deepEqual(splitSentences('  ...  \n\n'), []);
});

test('device segments become one timed phrase per sentence', () => {
    const timings = buildRecordingTimings(RU, RU_SEGMENTS, 'device');
    assert.equal(timings.source, 'device');
    assert.deepEqual(timings.phrases.map((p) => [p.text, p.start]), [
        ['Я отправлю Ире смету к пятнице.', 0],
        ['А звонок пока не назначай.', 2.6],
        ['Купить молоко.', 5.2],
    ]);
    assert.ok(timings.phrases.every((p) => p.end > p.start));
});

test('a segment holding two sentences is split by word position', () => {
    const timings = buildRecordingTimings('One two three. Four five six.', [{ start: 10, end: 16, text: 'One two three four five six' }], 'cloud');
    assert.equal(timings.phrases.length, 2);
    assert.equal(timings.phrases[0].start, 10);
    assert.ok(timings.phrases[1].start > 12.5 && timings.phrases[1].start < 13.5, String(timings.phrases[1].start));
});

test('timing from a second pass with other wording is carried over by words', () => {
    // Authoritative text (gpt-transcribe) vs timing pass (whisper-1) wording.
    const text = 'Send Anna the estimate by Friday. Then book a table for 8 people.';
    const timingPass = [
        { start: 0.4, end: 3.1, text: 'Send Ana the estimate by Friday.' },
        { start: 3.5, end: 6.0, text: 'Then book a table for eight people.' },
    ];
    const timings = buildRecordingTimings(text, timingPass, 'aligned');
    assert.equal(timings.phrases.length, 2);
    assert.equal(timings.phrases[0].start, 0.4);
    assert.equal(timings.phrases[1].start, 3.5);
});

test('a sentence the timing pass did not hear gets no timing instead of a guess', () => {
    const timings = buildRecordingTimings('Completely different words here. Buy milk today please.', [
        { start: 1, end: 3, text: 'buy milk today please' },
    ], 'aligned');
    assert.deepEqual(timings.phrases.map((p) => p.text), ['Buy milk today please.']);
    assert.equal(buildRecordingTimings('', RU_SEGMENTS, 'device'), null);
    assert.equal(buildRecordingTimings(RU, [], 'device'), null);
    assert.equal(buildRecordingTimings(RU, [{ start: NaN, end: 1, text: 'x' }], 'device'), null);
});

test('meeting parts add up their offsets and stop at a part of unknown length', () => {
    const joined = joinPartSegments([
        { segments: [{ start: 1, end: 2, text: 'first' }], durationSeconds: 270 },
        { segments: [{ start: 0.5, end: 3, text: 'second' }], durationSeconds: 270 },
        { segments: [{ start: 2, end: 4, text: 'third' }], durationSeconds: null },
        { segments: [{ start: 1, end: 2, text: 'fourth' }], durationSeconds: 100 },
    ]);
    assert.deepEqual(joined.map((s) => [s.text, s.start]), [['first', 1], ['second', 270.5], ['third', 542]]);
    // A part with no speech still moves the clock.
    const withSilence = joinPartSegments([
        { segments: [], durationSeconds: 270 },
        { segments: [{ start: 3, end: 4, text: 'later' }], durationSeconds: 30 },
    ]);
    assert.equal(withSilence[0].start, 273);
});

test('a meeting transcript gets timings across its parts; no segments means no timings', () => {
    const { timingsFromTranscription } = require('../.test-build/phraseTiming/phraseTiming');
    const text = 'Opening words of the meeting.\n\nClosing words after the break.';
    const raw = timingsFromTranscription(text, { success: true, text, parts: [
        { segments: [{ start: 2, end: 4, text: 'Opening words of the meeting.' }], segmentsSource: 'cloud', durationSeconds: 270 },
        { segments: [{ start: 10, end: 13, text: 'Closing words after the break.' }], segmentsSource: 'aligned', durationSeconds: 120 },
    ] });
    const timings = parseTimings(raw);
    assert.equal(timings.source, 'aligned');
    assert.deepEqual(timings.phrases.map((p) => p.start), [2, 280]);
    assert.equal(timingsFromTranscription(text, { success: true, text }), undefined);
    const single = parseTimings(timingsFromTranscription('Hello world.', { segments: [{ start: 1, end: 2, text: 'Hello world.' }], segmentsSource: 'device' }));
    assert.equal(single.source, 'device');
});

test('timings round-trip, and old or damaged data reads as no timings', () => {
    const timings = buildRecordingTimings(RU, RU_SEGMENTS, 'device');
    assert.deepEqual(parseTimings(serializeTimings(timings)), timings);
    assert.equal(serializeTimings(null), undefined);
    for (const raw of [undefined, null, '', 'not json', '{"v":2,"phrases":[]}', '{"v":1}', '{"v":1,"phrases":[{"text":"x","start":-1,"end":2}]}']) {
        assert.equal(parseTimings(raw), null, String(raw));
    }
    const partly = parseTimings('{"v":1,"source":"weird","phrases":[{"text":"ok","start":1,"end":2},{"text":"","start":1,"end":2},{"start":1}]}');
    assert.equal(partly.source, 'device');
    assert.equal(partly.phrases.length, 1);
});

const source = (id, text, segments, kind = 'device') => ({ recordingId: id, timings: buildRecordingTimings(text, segments, kind) });

test('unchanged and lightly edited sentences keep their link; rewritten ones lose it', () => {
    const rec = source('r1', RU, RU_SEGMENTS);
    const edited = 'Я отправлю Ирине смету к пятнице.\nЗвонок назначим потом, когда будет ясно.\nКупить молоко.\nЭто я дописал руками.';
    const linked = linkTextToRecordings(edited, [rec]);
    assert.deepEqual(linked.map((p) => [p.text, p.link && p.link.start]), [
        ['Я отправлю Ирине смету к пятнице.', 0],
        ['Звонок назначим потом, когда будет ясно.', null],
        ['Купить молоко.', 5.2],
        ['Это я дописал руками.', null],
    ]);
    for (const phrase of linked) assert.equal(edited.slice(phrase.from, phrase.to), phrase.text);
});

test('short sentences link only when identical, and repeats follow reading order', () => {
    const text = 'Okay. We start now with the plan. Okay. And then we finish the plan.';
    const rec = source('r1', text, [
        { start: 0, end: 1, text: 'Okay.' },
        { start: 1, end: 4, text: 'We start now with the plan.' },
        { start: 4, end: 5, text: 'Okay.' },
        { start: 5, end: 8, text: 'And then we finish the plan.' },
    ]);
    const linked = linkTextToRecordings(text, [rec]);
    assert.deepEqual(linked.map((p) => p.link.start), [0, 1, 4, 5]);
    assert.equal(linkTextToRecordings('Okey.', [rec])[0].link, null);
    assert.equal(phraseMatchScore('Ok.', 'Okay.'), 0);
});

test('phrases from two recordings of one note play their own recording', () => {
    const a = source('a', 'First recording says hello to everyone.', [{ start: 0, end: 3, text: 'First recording says hello to everyone.' }]);
    const b = source('b', 'Second recording talks about the budget.', [{ start: 7, end: 9, text: 'Second recording talks about the budget.' }]);
    const linked = linkTextToRecordings('Second recording talks about the budget. First recording says hello to everyone.', [a, b]);
    assert.deepEqual(linked.map((p) => [p.link.recordingId, p.link.start]), [['b', 7], ['a', 0]]);
});

test('notes without timings link nothing and do not throw', () => {
    assert.deepEqual(linkTextToRecordings('Just typed text.', []).map((p) => p.link), [null]);
    assert.deepEqual(linkTextToRecordings('', []), []);
});

test('a task quote finds its sentence, and an edited sentence gives no Listen', () => {
    const rec = source('r1', RU, RU_SEGMENTS);
    const linked = linkTextToRecordings(RU, [rec]);
    const hit = findQuoteLink('отправлю Ире смету к пятнице', linked);
    assert.equal(hit.link.start, 0);
    assert.equal(findQuoteLink('позвонить маме', linked), null);
    assert.equal(findQuoteLink('', linked), null);
    assert.equal(findQuoteLink(null, linked), null);
    const editedText = 'Смету Ирине пришлю в понедельник утром обязательно.';
    assert.equal(findQuoteLink('Смету Ирине пришлю в понедельник', linkTextToRecordings(editedText, [rec])), null);
});

test('the phrase being heard is highlighted, nothing in long pauses or other recordings', () => {
    const rec = source('r1', RU, RU_SEGMENTS);
    const linked = linkTextToRecordings(RU, [rec]);
    assert.equal(activePhraseKey(linked, 'r1', 0.1), 'p0');
    assert.equal(activePhraseKey(linked, 'r1', 3.0), 'p1');
    assert.equal(activePhraseKey(linked, 'r1', 5.1), 'p2'); // pre-roll
    assert.equal(activePhraseKey(linked, 'r1', 30), null);
    assert.equal(activePhraseKey(linked, 'other', 3), null);
    assert.equal(activePhraseKey(linked, null, 3), null);
});

test('whole-recording fallback, playback start and clock labels', () => {
    const rec = source('r1', RU, RU_SEGMENTS);
    const own = phrasesOfRecording(rec);
    assert.equal(own.length, 3);
    assert.equal(own[2].link.recordingId, 'r1');
    assert.equal(playbackStartFor({ start: 0.1 }), 0);
    assert.equal(playbackStartFor({ start: 5.2 }), 4.95);
    assert.equal(formatPhraseTime(65.9), '1:05');
    assert.equal(formatPhraseTime(3725), '1:02:05');
    assert.equal(formatPhraseTime(NaN), '0:00');
});

test('linking an hour-long meeting stays fast', () => {
    const sentences = Array.from({ length: 900 }, (_, i) => `Sentence number ${i} talks about topic ${i % 37} and item ${i * 7}.`);
    const text = sentences.join(' ');
    const segments = sentences.map((s, i) => ({ start: i * 4, end: i * 4 + 3.5, text: s }));
    const started = Date.now();
    const rec = source('m', text, segments, 'cloud');
    const linked = linkTextToRecordings(text, [rec]);
    assert.equal(linked.filter((p) => p.link).length, 900);
    assert.equal(linked[450].link.start, 1800);
    assert.ok(Date.now() - started < 4000, `took ${Date.now() - started} ms`);
});
