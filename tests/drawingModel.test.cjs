const test = require('node:test');
const assert = require('node:assert/strict');
const { drawingReducer, initialDrawingState, selectInLasso } = require('../.test-build/drawing/drawing/drawingModel');

const stroke = (y) => ({ tool: 'ballpoint', color: '#000', size: 2, points: [10, y, 0.5, 50, y, 0.5] });
const label = (text, y = 100) => ({ x: 20, y, text, size: 20, color: '#000' });
const run = (actions, state = initialDrawingState()) => actions.reduce(drawingReducer, state);

test('every stroke is one undo step and redo restores it', () => {
    let s = run([{ type: 'addStroke', stroke: stroke(10) }, { type: 'addStroke', stroke: stroke(20) }]);
    assert.equal(s.content.strokes.length, 2);
    s = drawingReducer(s, { type: 'undo' });
    assert.equal(s.content.strokes.length, 1);
    s = drawingReducer(s, { type: 'redo' });
    assert.equal(s.content.strokes.length, 2);
    s = run([{ type: 'undo' }, { type: 'addStroke', stroke: stroke(30) }], s);
    assert.equal(s.redo.length, 0, 'a new edit drops the redo branch');
});

test('one eraser drag in whole-stroke mode that removes several strokes and a label is one undo step', () => {
    let s = run([
        { type: 'addStroke', stroke: stroke(10) },
        { type: 'addStroke', stroke: stroke(40) },
        { type: 'addText', text: label('note', 70) },
    ]);
    const boxes = [{ width: 60, height: 25 }];
    s = run([
        { type: 'eraseAt', x: 30, y: 10, radius: 5, boxes, mode: 'stroke' },
        { type: 'eraseAt', x: 30, y: 40, radius: 5, boxes, mode: 'stroke' },
        { type: 'eraseAt', x: 30, y: 80, radius: 5, boxes, mode: 'stroke' },
        { type: 'eraseEnd' },
    ], s);
    assert.equal(s.content.strokes.length, 0);
    assert.equal(s.content.texts.length, 0);
    s = drawingReducer(s, { type: 'undo' });
    assert.equal(s.content.strokes.length, 2);
    assert.equal(s.content.texts.length, 1);
});

test('erasing empty space changes nothing and adds no undo step', () => {
    const s = run([{ type: 'addStroke', stroke: stroke(10) }]);
    const after = run([{ type: 'eraseAt', x: 500, y: 500, radius: 5, boxes: [] }, { type: 'eraseEnd' }], s);
    assert.equal(after.undo.length, s.undo.length);
    assert.equal(after.content, s.content);
});

test('labels: empty ones are not kept, edits and moves are undoable', () => {
    let s = run([{ type: 'addText', text: label('   ') }]);
    assert.equal(s.content.texts.length, 0);
    s = run([
        { type: 'addText', text: label('first') },
        { type: 'updateText', index: 0, patch: { x: 200, y: 300 } },
        { type: 'updateText', index: 0, patch: { text: 'second' } },
    ], s);
    assert.deepEqual(s.content.texts[0], { ...label('second'), x: 200, y: 300 });
    s = drawingReducer(s, { type: 'undo' });
    assert.equal(s.content.texts[0].text, 'first');
    s = drawingReducer(s, { type: 'updateText', index: 0, patch: { text: '' } });
    assert.equal(s.content.texts.length, 0, 'clearing a label removes it');
});

test('an update that changes nothing is not an undo step', () => {
    const s = run([{ type: 'addText', text: label('same') }]);
    assert.equal(drawingReducer(s, { type: 'updateText', index: 0, patch: { text: 'same' } }), s);
});

test('paper is part of the content and its change can be undone', () => {
    let s = run([{ type: 'setPaper', paper: { pattern: 'grid', color: '#FFF8E7', layout: 'pages' } }]);
    assert.deepEqual(s.content.paper, { pattern: 'grid', color: '#FFF8E7', layout: 'pages' });
    s = drawingReducer(s, { type: 'setPaper', paper: { pattern: 'grid', color: '#FFF8E7', layout: 'canvas' } });
    assert.equal(s.content.paper.layout, 'canvas');
    s = drawingReducer(s, { type: 'undo' });
    s = drawingReducer(s, { type: 'undo' });
    assert.deepEqual(s.content.paper, { pattern: 'blank', color: null, layout: 'pages' });
});

test('the eraser rubs out only the ink under it and splits the stroke there', () => {
    const long = { tool: 'fountain', color: '#000', size: 2, points: [0, 10, 0.5, 100, 10, 0.5] };
    const kept = drawingReducer(run([{ type: 'addStroke', stroke: long }]), { type: 'eraseAt', x: 50, y: 10, radius: 5, boxes: [] });
    const [left, right] = kept.content.strokes;
    assert.equal(kept.content.strokes.length, 2);
    // Cut where the circle (grown by half the line width) meets the line, not at a sample.
    const round = (points) => points.map((value) => Math.round(value * 1000) / 1000);
    assert.deepEqual(round(left.points), [0, 10, 0.5, 44, 10, 0.5]);
    assert.deepEqual(round(right.points), [56, 10, 0.5, 100, 10, 0.5]);
    assert.equal(left.cut, undefined, 'the first piece keeps the pen-down start');
    assert.equal(right.cut, true, 'the cut end is not tapered like a pen-down');
});

test('partial erasing leaves untouched strokes as they were and removes covered ones', () => {
    const near = stroke(10);
    const far = stroke(200);
    const s = run([{ type: 'addStroke', stroke: near }, { type: 'addStroke', stroke: far }]);
    const dot = { tool: 'ballpoint', color: '#000', size: 2, points: [30, 10, 0.5] };
    const after = run([
        { type: 'addStroke', stroke: dot },
        { type: 'eraseAt', x: 30, y: 10, radius: 30, boxes: [] },
        { type: 'eraseEnd' },
    ], s);
    assert.deepEqual(after.content.strokes, [far]);
    assert.equal(after.content.strokes[0], far, 'same object, so its cached path is reused');
    assert.equal(drawingReducer(after, { type: 'undo' }).content.strokes.length, 3);
});

test('a fast eraser move erases along its whole path, not only where samples landed', () => {
    const across = { tool: 'ballpoint', color: '#000', size: 2, points: [0, 50, 0.5, 100, 50, 0.5] };
    const s = run([{ type: 'addStroke', stroke: across }]);
    const missed = drawingReducer(s, { type: 'eraseAt', x: 50, y: 0, radius: 5, boxes: [] });
    assert.equal(missed.content, s.content, 'one centre far from the line erases nothing');
    const swept = drawingReducer(s, { type: 'eraseAt', x: 50, y: 0, path: [50, 25, 50, 50, 50, 75, 50, 100], radius: 5, boxes: [] });
    assert.equal(swept.content.strokes.length, 2);
});

test('the lasso picks what it encloses; moving, copying, recolouring and deleting it are undoable', () => {
    let s = run([
        { type: 'addStroke', stroke: stroke(10) },
        { type: 'addStroke', stroke: stroke(200) },
        { type: 'addText', text: label('hi', 40) },
    ]);
    const boxes = [{ width: 30, height: 20 }];
    // A loop around the top: the first stroke and the label, not the stroke at y = 200.
    const loop = [0, 0, 100, 0, 100, 100, 0, 100];
    const picked = selectInLasso(s.content, boxes, loop);
    assert.deepEqual(picked, { strokes: [0], texts: [0] });
    // A loop that only crosses part of a stroke leaves it out.
    assert.deepEqual(selectInLasso(s.content, boxes, [0, 0, 20, 0, 20, 300, 0, 300]).strokes, []);

    s = drawingReducer(s, { type: 'moveSelection', selection: picked, dx: 5, dy: 7 });
    assert.deepEqual(s.content.strokes[0].points, [15, 17, 0.5, 55, 17, 0.5]);
    assert.equal(s.content.texts[0].y, 47);
    assert.equal(s.content.strokes[1], drawingReducer(s, { type: 'undo' }).content.strokes[1], 'others untouched');

    s = drawingReducer(s, { type: 'duplicateSelection', selection: picked, dx: 20, dy: 20 });
    assert.equal(s.content.strokes.length, 3);
    assert.deepEqual(s.content.strokes[2].points, [35, 37, 0.5, 75, 37, 0.5]);
    assert.equal(s.content.texts.length, 2);

    s = drawingReducer(s, { type: 'recolorSelection', selection: picked, color: '#E53935' });
    assert.equal(s.content.strokes[0].color, '#E53935');
    assert.equal(s.content.strokes[1].color, '#000');

    s = drawingReducer(s, { type: 'deleteSelection', selection: picked });
    assert.equal(s.content.strokes.length, 2);
    assert.equal(s.content.texts.length, 1);
    s = drawingReducer(s, { type: 'undo' });
    assert.equal(s.content.strokes.length, 3);
});

test('restore brings back the content and its undo history', () => {
    const before = run([{ type: 'addStroke', stroke: stroke(10) }, { type: 'addStroke', stroke: stroke(20) }, { type: 'undo' }]);
    let s = drawingReducer(initialDrawingState(), { type: 'restore', state: before });
    assert.equal(s.content.strokes.length, 1);
    assert.equal(s.undo.length, 1);
    assert.equal(s.redo.length, 1);
    s = drawingReducer(s, { type: 'redo' });
    assert.equal(s.content.strokes.length, 2);
});

test('a batched eraser path matches individual passes for both modes and undoes as one drag', () => {
    let seed = 12345;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    const strokes = Array.from({ length: 50 }, () => ({
        tool: 'fountain', color: '#000', size: 2,
        points: Array.from({ length: 20 }, () => [random() * 200, random() * 200, random()]).flat(),
    }));
    const original = initialDrawingState({
        strokes, texts: [label('one', 70), label('two', 150)],
        paper: { pattern: 'blank', color: null, layout: 'pages' },
    });
    const boxes = [{ width: 60, height: 25 }, { width: 60, height: 25 }];
    const path = [20, 70, 40, 80, 60, 90, 80, 100, 100, 110];
    for (const mode of ['partial', 'stroke']) {
        const action = { type: 'eraseAt', x: 10, y: 60, radius: 12, boxes, mode };
        const batched = drawingReducer(original, { ...action, path });
        let sequential = drawingReducer(original, action);
        for (let i = 0; i < path.length; i += 2) {
            sequential = drawingReducer(sequential, { ...action, x: path[i], y: path[i + 1] });
        }
        assert.deepEqual(batched.content, sequential.content);
        const ended = drawingReducer(batched, { type: 'eraseEnd' });
        assert.equal(ended.undo.length, 1);
        assert.equal(drawingReducer(ended, { type: 'undo' }).content, original.content);
        const undone = drawingReducer(ended, { type: 'undo' });
        assert.equal(drawingReducer(undone, { type: 'redo' }).content, batched.content);
    }
});
