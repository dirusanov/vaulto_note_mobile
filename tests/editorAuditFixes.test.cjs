/**
 * Editor defects from the UX audit of 2026-11-19 (docs/qa/2026-11-19-ux-audit):
 * an empty Original with a non-empty version is not cleaned away on Back, a
 * failed save keeps the editor open, checklist state survives the text used for
 * Compare and for AI instructions, and Undo history survives a version switch.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const originalLoad = Module._load;
Module._load = function (request) {
    if (request === 'react-native') {
        return { Text: () => null, StyleSheet: { flatten: (style) => style, create: (styles) => styles } };
    }
    if (request === 'react') {
        return { createElement: (...args) => ({ args }) };
    }
    return originalLoad.apply(this, arguments);
};

const { shouldAutoCleanEmptyNote } = require('../.test-build/editor/utils/emptyNote');
const { saveThenProceed } = require('../.test-build/editor/utils/saveThenProceed');
const {
    pushHistoryStep,
    resumeHistoryOnSwitch,
    retitleHistory,
} = require('../.test-build/editor/utils/editHistory');
const {
    isEditorEchoOf,
    isEditorRenderingOf,
    richContentToPlainText,
    richContentToTaskAwarePlainText,
    richContentToReadableText,
} = require('../.test-build/editor/utils/richContent');
const { diffWords, hasDifferences } = require('../.test-build/editor/utils/textDiff');

// ---- Empty-note autoclean ---------------------------------------------------

test('Back keeps a note whose Original is empty but a version has text', () => {
    assert.equal(shouldAutoCleanEmptyNote({
        title: '',
        originalContent: '<p></p>',
        hasAudio: false,
        variantContents: ['<p>Summary of the meeting</p>'],
    }), false);
    assert.equal(shouldAutoCleanEmptyNote({
        title: '',
        originalContent: '',
        hasAudio: false,
        variantContents: ['', '- [ ] milk'],
    }), false);
});

test('a truly empty draft is still cleaned away', () => {
    assert.equal(shouldAutoCleanEmptyNote({ title: '', originalContent: '<p></p>', hasAudio: false, variantContents: [] }), true);
    assert.equal(shouldAutoCleanEmptyNote({ title: '  ', originalContent: '', hasAudio: false, variantContents: ['<p></p>', undefined] }), true);
    assert.equal(shouldAutoCleanEmptyNote({ title: 'Title', originalContent: '', hasAudio: false, variantContents: [] }), false);
    assert.equal(shouldAutoCleanEmptyNote({ title: '', originalContent: '', hasAudio: true, variantContents: [] }), false);
});

// ---- Save failure on leaving / switching ---------------------------------------

test('a failed save does not leave the editor and reports the failure', async () => {
    let left = false;
    let reported = null;
    const ran = await saveThenProceed(
        async () => { throw new Error('disk full'); },
        () => { left = true; },
        (error) => { reported = error; },
    );
    assert.equal(ran, false);
    assert.equal(left, false, 'the editor stays open');
    assert.equal(reported && reported.message, 'disk full');
});

test('a successful save goes on with the action', async () => {
    const order = [];
    const ran = await saveThenProceed(
        async () => { order.push('save'); },
        () => { order.push('leave'); },
        () => { order.push('failed'); },
    );
    assert.equal(ran, true);
    assert.deepEqual(order, ['save', 'leave']);
});

// ---- Checklist state in Compare and AI text ------------------------------------

const richChecklist = (checked) =>
    '<ul data-type="taskList">'
    + `<li data-type="taskItem" data-checked="${checked}"><label><input type="checkbox"${checked ? ' checked' : ''}><span></span></label><div><p>Buy milk</p></div></li>`
    + '<li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Call Ira</p></div></li>'
    + '</ul>';

test('plain text still drops checkboxes (search, previews, tags)', () => {
    assert.equal(richContentToPlainText(richChecklist(false)), richContentToPlainText(richChecklist(true)));
});

test('task-aware text tells a ticked item from an unticked one (visual editor HTML)', () => {
    assert.equal(richContentToTaskAwarePlainText(richChecklist(false)), '- [ ] Buy milk\n- [ ] Call Ira');
    assert.equal(richContentToTaskAwarePlainText(richChecklist(true)), '- [x] Buy milk\n- [ ] Call Ira');
});

test('task-aware text keeps the state of Markdown checklists and strips other syntax', () => {
    const markdown = '# Shopping\n- [ ] **Buy** milk\n- [X] Bread\n- plain bullet\nSome _text_';
    assert.equal(richContentToTaskAwarePlainText(markdown), 'Shopping\n- [ ] Buy milk\n- [x] Bread\nplain bullet\nSome text');
});

test('Compare shows a status change of a checklist item', () => {
    const segments = diffWords(
        richContentToTaskAwarePlainText(richChecklist(false)),
        richContentToTaskAwarePlainText(richChecklist(true)),
    );
    assert.equal(hasDifferences(segments), true);
    const removed = segments.filter((s) => s.type === 'removed').map((s) => s.text).join('');
    const added = segments.filter((s) => s.type === 'added').map((s) => s.text).join('');
    assert.equal(removed, '[ ]');
    assert.equal(added, '[x]');
});

test('Compare reads tasks as ☐/☑ and shows no Markdown syntax (review 2026-11-20, P2-8)', () => {
    assert.equal(richContentToReadableText(richChecklist(true)), '☑ Buy milk\n☐ Call Ira');
    const markdown = '# Shopping\n- [ ] **Buy** milk\n- [X] Bread\n- plain bullet\n1. first\nSome _text_';
    const readable = richContentToReadableText(markdown);
    assert.equal(readable, 'Shopping\n☐ Buy milk\n☑ Bread\n• plain bullet\n1. first\nSome text');
    assert.doesNotMatch(readable, /\[[ xX]\]|\*\*|^#/m);
    const segments = diffWords(
        richContentToReadableText(richChecklist(false)),
        richContentToReadableText(richChecklist(true)),
    );
    const removed = segments.filter((s) => s.type === 'removed').map((s) => s.text).join('');
    const added = segments.filter((s) => s.type === 'added').map((s) => s.text).join('');
    assert.equal(removed, '☐');
    assert.equal(added, '☑');
});

// ---- Undo across a version switch ----------------------------------------------

const sameDocument = (a, b) => isEditorEchoOf(a, b) || isEditorEchoOf(b, a) || isEditorRenderingOf(a, b);

test('coming back to a version keeps its Undo steps', () => {
    let history = pushHistoryStep(undefined, { title: 'v', content: 'First draft' });
    history = pushHistoryStep(history, { title: 'v', content: 'First draft, edited' });

    const resumed = resumeHistoryOnSwitch(history, { title: 'v', content: 'First draft, edited' }, sameDocument);
    assert.equal(resumed.index, 1);
    assert.deepEqual(resumed.history.map((e) => e.content), ['First draft', 'First draft, edited']);
});

test('the editor rendering of the same text still keeps the steps', () => {
    let history = pushHistoryStep(undefined, { title: 'v', content: '- [ ] milk' });
    history = pushHistoryStep(history, { title: 'v', content: '- [ ] milk\n- [ ] bread' });
    const html = '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>milk</p></li><li data-type="taskItem" data-checked="false"><p>bread</p></li></ul>';
    const resumed = resumeHistoryOnSwitch(history, { title: 'v', content: html }, sameDocument);
    assert.equal(resumed.index, 1);
    assert.equal(resumed.history.length, 2);
    assert.equal(resumed.history[1].content, html, 'the current step is what is shown');
});

test('a version changed elsewhere meanwhile starts its Undo over', () => {
    let history = pushHistoryStep(undefined, { title: 'v', content: 'Old text' });
    history = pushHistoryStep(history, { title: 'v', content: 'Old text 2' });
    const resumed = resumeHistoryOnSwitch(history, { title: 'v', content: 'Rewritten by the agent' }, sameDocument);
    assert.deepEqual(resumed, { history: [{ title: 'v', content: 'Rewritten by the agent' }], index: 0 });
    assert.deepEqual(
        resumeHistoryOnSwitch(undefined, { title: 'v', content: 'x' }, sameDocument),
        { history: [{ title: 'v', content: 'x' }], index: 0 },
    );
});

test('renaming a version renames every Undo step', () => {
    let history = pushHistoryStep(undefined, { title: 'Summary', content: 'a' });
    history = pushHistoryStep(history, { title: 'Summary', content: 'b' });
    const renamed = retitleHistory(history, '⁣For Anna');
    assert.deepEqual(renamed.history.map((e) => e.title), ['⁣For Anna', '⁣For Anna']);
    assert.equal(renamed.index, 1);
    assert.equal(retitleHistory(undefined, 'x'), undefined);
});
