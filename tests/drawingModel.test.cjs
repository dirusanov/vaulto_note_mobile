const test = require('node:test');
const assert = require('node:assert/strict');
const { drawingReducer, initialDrawingState } = require('../.test-build/drawing/drawing/drawingModel');

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

test('one eraser drag that removes several strokes and a label is one undo step', () => {
    let s = run([
        { type: 'addStroke', stroke: stroke(10) },
        { type: 'addStroke', stroke: stroke(40) },
        { type: 'addText', text: label('note', 70) },
    ]);
    const boxes = [{ width: 60, height: 25 }];
    s = run([
        { type: 'eraseAt', x: 30, y: 10, radius: 5, boxes },
        { type: 'eraseAt', x: 30, y: 40, radius: 5, boxes },
        { type: 'eraseAt', x: 30, y: 80, radius: 5, boxes },
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
