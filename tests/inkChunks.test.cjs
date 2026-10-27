const test = require('node:test');
const assert = require('node:assert/strict');
const { updateInkChunks, INK_CHUNK_SIZE } = require('../.test-build/drawing/drawing/inkChunks');
const strokes = (count) => Array.from({ length: count }, (_, id) => ({ id }));
const render = (items) => ({ ids: items.map((item) => item.id) });
const flatten = (chunks) => chunks.flatMap((chunk) => chunk.strokes);

test('a cut on a full page only records a local group, preserving ink order', () => {
    const page = strokes(3200);
    const before = updateInkChunks([], page, render);
    let recorded = 0;
    const cut = [...page.slice(0, 17), { id: 'left' }, { id: 'right' }, ...page.slice(18)];
    const after = updateInkChunks(before, cut, (items) => {
        recorded += items.length;
        return render(items);
    });
    assert.deepEqual(flatten(after), cut);
    assert.ok(recorded <= INK_CHUNK_SIZE + 1, `${recorded} paths recorded for one cut`);
    assert.equal(after.filter((chunk) => before.includes(chunk)).length, before.length - 1);
});

test('deletion, selection, undo, reorder and duplicate references preserve rendering order', () => {
    const page = strokes(130);
    let chunks = updateInkChunks([], page, render);
    for (const edit of [
        page.filter((_, i) => i % 5 !== 0),
        page,
        [...page.slice(64), ...page.slice(0, 64)],
        [...page, ...page],
        [],
        page,
    ]) {
        chunks = updateInkChunks(chunks, edit, render);
        assert.deepEqual(flatten(chunks), edit);
        assert.deepEqual(chunks.flatMap((chunk) => chunk.picture.ids), edit.map((item) => item.id));
    }
});

test('handwriting fills the tail instead of making a picture for every stroke', () => {
    const page = strokes(1000);
    let chunks = [];
    for (let length = 1; length <= page.length; length++) {
        chunks = updateInkChunks(chunks, page.slice(0, length), render);
    }
    assert.equal(chunks.length, Math.ceil(page.length / INK_CHUNK_SIZE));
    assert.deepEqual(flatten(chunks), page);
    assert.ok(chunks.every((chunk) => chunk.strokes.length <= INK_CHUNK_SIZE));
    let recorded = 0;
    const same = updateInkChunks(chunks, page, () => { recorded++; });
    assert.equal(recorded, 0);
    assert.ok(same.every((chunk, i) => chunk === chunks[i]));
});
