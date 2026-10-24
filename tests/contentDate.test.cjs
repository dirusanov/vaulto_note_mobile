const test = require('node:test');
const assert = require('node:assert');
const {
    contentDateOf,
    compareByContentDateDesc,
    hasContentChanged,
    nextContentUpdatedAt,
    incomingContentUpdatedAt,
} = require('../.test-build/contentDate/contentDate.js');

const T0 = '2026-10-01T12:00:00.000Z';
const T1 = '2026-10-02T12:00:00.000Z';
const NOW = '2026-10-24T09:00:00.000Z';

const note = (overrides = {}) => ({
    title: 'Groceries',
    content: '<p>milk</p>',
    transcription: undefined,
    has_audio: false,
    audio_file_path: undefined,
    updated_at: T1,
    content_updated_at: T0,
    ...overrides,
});

test('the card date is the content date, falling back to updated_at and created_at', () => {
    assert.strictEqual(contentDateOf(note()), T0);
    assert.strictEqual(contentDateOf(note({ content_updated_at: null })), T1);
    assert.strictEqual(contentDateOf({ created_at: T0 }), T0);
    assert.strictEqual(contentDateOf({}), '');
});

test('the list sorts by content date, so a freshly pinned old note stays below a newer edit', () => {
    const pinnedLater = note({ updated_at: NOW, content_updated_at: T0 });
    const editedYesterday = note({ updated_at: T1, content_updated_at: T1 });
    const sorted = [pinnedLater, editedYesterday].sort(compareByContentDateDesc);
    assert.deepStrictEqual(sorted, [editedYesterday, pinnedLater]);
});

test('rows without any date sort last instead of breaking the order', () => {
    const undated = { title: 'x' };
    const broken = { content_updated_at: 'not a date' };
    const dated = note();
    const sorted = [undated, dated, broken].sort(compareByContentDateDesc);
    assert.strictEqual(sorted[0], dated);
});

test('pin, unpin, privacy or scope saves keep the content date', () => {
    const existing = note();
    // updateNote re-sends the same title/text: nothing the user sees changed.
    assert.strictEqual(nextContentUpdatedAt(existing, { ...existing, is_pinned: true }, NOW), T0);
    assert.strictEqual(nextContentUpdatedAt(existing, { ...existing, storage_scope: 'local_only' }, NOW), T0);
});

test('a note from before the field keeps its old updated_at as content date', () => {
    const legacy = note({ content_updated_at: undefined });
    assert.strictEqual(nextContentUpdatedAt(legacy, legacy, NOW), T1);
});

for (const [what, change] of [
    ['text', { content: '<p>milk, eggs</p>' }],
    ['title', { title: 'Shopping' }],
    ['checklist toggle', { content: '<ul data-type="taskList"><li data-checked="true">milk</li></ul>' }],
    ['drawing', { content: '<p>milk</p><div data-drawing="1"></div>' }],
    ['transcript', { transcription: 'buy milk' }],
    ['added audio', { has_audio: true, audio_file_path: 'file:///a.m4a' }],
    ['replaced audio', { audio_file_path: 'file:///b.m4a' }],
]) {
    test(`a ${what} edit moves the content date to now`, () => {
        const existing = note({ audio_file_path: what === 'replaced audio' ? 'file:///a.m4a' : undefined });
        assert.strictEqual(hasContentChanged(existing, { ...existing, ...change }), true);
        assert.strictEqual(nextContentUpdatedAt(existing, { ...existing, ...change }, NOW), NOW);
    });
}

test('empty and missing values compare equal (no spurious edits)', () => {
    assert.strictEqual(
        hasContentChanged({ title: '', content: '', transcription: null }, { title: undefined, content: null }),
        false,
    );
});

test('a pulled note takes the server content date when the server sends it', () => {
    assert.strictEqual(
        incomingContentUpdatedAt({
            serverContentUpdatedAt: T0,
            serverUpdatedAt: NOW,
            existing: note({ content: 'local' }),
            incoming: { title: 'x', content: 'remote' },
        }),
        T0,
    );
});

test('an older server: a remote pin keeps the local content date', () => {
    const existing = note();
    assert.strictEqual(
        incomingContentUpdatedAt({ serverUpdatedAt: NOW, existing, incoming: { ...existing } }),
        T0,
    );
});

test('an older server: remote text edits take the server timestamp', () => {
    const existing = note();
    assert.strictEqual(
        incomingContentUpdatedAt({ serverUpdatedAt: NOW, existing, incoming: { ...existing, content: '<p>tea</p>' } }),
        NOW,
    );
});

test('a note new to this device without a server content date uses updated_at', () => {
    assert.strictEqual(incomingContentUpdatedAt({ serverUpdatedAt: NOW, incoming: { content: 'x' } }), NOW);
});

test('a garbage server content date is ignored', () => {
    const existing = note();
    assert.strictEqual(
        incomingContentUpdatedAt({ serverContentUpdatedAt: '1970-01-01T00:00:00Z', serverUpdatedAt: NOW, existing, incoming: existing }),
        T0,
    );
    assert.strictEqual(
        incomingContentUpdatedAt({ serverContentUpdatedAt: 'nope', serverUpdatedAt: NOW, existing, incoming: existing }),
        T0,
    );
});
