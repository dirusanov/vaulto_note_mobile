/**
 * Note editor logic: Undo/Redo steps (the editor's echo of loaded content is
 * replaced only once, right after a load), the Title -> text handoff, and the
 * content/title rules behind blank notes and checklist titles.
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

const {
    HISTORY_ECHO_WINDOW_MS,
    isHistoryEchoExpected,
    pushHistoryStep,
    recordHistoryChange,
} = require('../.test-build/editor/utils/editHistory');
const { splitTitleHandoffText } = require('../.test-build/editor/utils/titleHandoff');
const {
    isEditorEchoOf,
    hasMeaningfulRichContent,
    deriveAutoTitleFromPlainText,
    stripLeadingListMarker,
} = require('../.test-build/editor/utils/richContent');
const { stripStoredTitleMarkdown } = require('../.test-build/editor/utils/markdownUtils');

const seeded = (content, title = 'T') => ({ history: [{ title, content }], index: 0 });
const record = (history, content, echoExpected, title = 'T') => recordHistoryChange(
    history,
    { title, content },
    { echoExpected, isEcho: isEditorEchoOf }
);

const ACCEPTED_MARKDOWN = '- [ ] Milk\n- [ ] Bread';
const EDITOR_RENDERING = '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Milk</p></div></li><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Bread</p></div></li></ul>';
const UNDERLINED = EDITOR_RENDERING.replace('<p>Milk</p>', '<p><u>Milk</u></p>');

test('the echo right after a load replaces the step (Undo stays off)', () => {
    const result = record(seeded(ACCEPTED_MARKDOWN), EDITOR_RENDERING, true);
    assert.equal(result.kind, 'echo');
    assert.equal(result.history.index, 0);
    assert.equal(result.history.history.length, 1);
    assert.equal(result.history.history[0].content, EDITOR_RENDERING);
});

test('a formatting-only edit is a step when no echo is expected', () => {
    // Even when the comparison would call it an echo, only a load expects one.
    const result = recordHistoryChange(
        seeded(ACCEPTED_MARKDOWN),
        { title: 'T', content: UNDERLINED },
        { echoExpected: false, isEcho: () => true }
    );
    assert.equal(result.kind, 'step');
    assert.equal(result.history.index, 1);
    assert.equal(result.history.history[0].content, ACCEPTED_MARKDOWN);
});

test('many formatting edits then a ticked box: one Undo goes back one edit', () => {
    let history = seeded(ACCEPTED_MARKDOWN);
    // The load's echo, then underline, highlight, indent and a tick.
    history = record(history, EDITOR_RENDERING, true).history;
    const edits = [
        UNDERLINED,
        UNDERLINED.replace('<p>Bread</p>', '<p><mark data-color="#FFFFBA">Bread</mark></p>'),
        UNDERLINED.replace('<p>Bread</p>', '<p><mark data-color="#FFFFBA">Bread</mark></p>').replace('data-checked="false"', 'data-checked="true"'),
    ];
    edits.forEach((content) => {
        history = record(history, content, false).history;
    });
    assert.equal(history.history.length, 4);
    assert.equal(history.index, 3);
    // Undo once: the step before the tick, with all formatting kept.
    assert.equal(history.history[history.index - 1].content, edits[1]);
});

test('identical title and text is not a step; a title change is', () => {
    const base = seeded('<p>a</p>');
    assert.equal(record(base, '<p>a</p>', false).kind, 'unchanged');
    const titled = record(base, '<p>a</p>', true, 'New title');
    assert.equal(titled.kind, 'step');
    assert.equal(titled.history.history[1].title, 'New title');
});

test('a step after Undo drops the Redo tail', () => {
    let history = seeded('<p>a</p>');
    history = record(history, '<p>ab</p>', false).history;
    history = record(history, '<p>abc</p>', false).history;
    history = { ...history, index: 1 };
    const result = record(history, '<p>abX</p>', false);
    assert.deepEqual(result.history.history.map((entry) => entry.content), ['<p>a</p>', '<p>ab</p>', '<p>abX</p>']);
    assert.equal(result.history.index, 2);
});

test('history keeps at most the limit of steps', () => {
    let history = seeded('0');
    for (let i = 1; i <= 60; i += 1) {
        history = pushHistoryStep(history, { title: '', content: String(i) }, 50);
    }
    assert.equal(history.history.length, 50);
    assert.equal(history.index, 49);
    assert.equal(history.history[49].content, '60');
});

test('the echo expectation lapses', () => {
    assert.equal(isHistoryEchoExpected(undefined, 1000), false);
    assert.equal(isHistoryEchoExpected(1000, 1000 + HISTORY_ECHO_WINDOW_MS), true);
    assert.equal(isHistoryEchoExpected(1000, 1001 + HISTORY_ECHO_WINDOW_MS), false);
});

test('characters typed into the title after Enter move to the text', () => {
    assert.deepEqual(splitTitleHandoffText('Shopping', '', 'Shoppingm'), { moved: 'm' });
    // The input still shows the moved "m": only the new key moves.
    assert.deepEqual(splitTitleHandoffText('Shopping', 'm', 'Shoppingmi'), { moved: 'i' });
    // The input was reset to the title in between.
    assert.deepEqual(splitTitleHandoffText('Shopping', 'm', 'Shoppingi'), { moved: 'i' });
    // The reset itself, or nothing new.
    assert.deepEqual(splitTitleHandoffText('Shopping', 'm', 'Shopping'), { moved: '' });
    assert.deepEqual(splitTitleHandoffText('Shopping', 'm', 'Shoppingm'), { moved: '' });
    // Real title edits end the handoff.
    assert.equal(splitTitleHandoffText('Shopping', '', 'Shoppin'), null);
    assert.equal(splitTitleHandoffText('Shopping', '', 'XShopping'), null);
    assert.deepEqual(splitTitleHandoffText('', '', 'q'), { moved: 'q' });
});

test('an empty checklist item is not content (no blank notes in the list)', () => {
    const emptyTask = '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p></p></div></li></ul>';
    assert.equal(hasMeaningfulRichContent(emptyTask), false);
    assert.equal(hasMeaningfulRichContent(emptyTask.replace('<p></p>', '<p>Milk</p>')), true);
    assert.equal(hasMeaningfulRichContent('<p></p>'), false);
});

test('titles derived from a checklist carry no checkbox or list marker', () => {
    assert.equal(deriveAutoTitleFromPlainText('☐ Milk bread xyz\n☑ Eggs'), 'Milk bread xyz');
    assert.equal(deriveAutoTitleFromPlainText('☐Milk'), 'Milk');
    assert.equal(deriveAutoTitleFromPlainText('- [x] Milk'), 'Milk');
    assert.equal(deriveAutoTitleFromPlainText('1. Call Anna'), 'Call Anna');
    assert.equal(stripLeadingListMarker('  • ☐ Bread'), 'Bread');
    assert.equal(stripLeadingListMarker('2026 plan'), '2026 plan');
    assert.equal(stripStoredTitleMarkdown('☐ Milk bread xyz'), 'Milk bread xyz');
});

test('a guest voice note is titled from its first sentence or clause, on the device', () => {
    const { deriveTitleFromTranscript } = require('../.test-build/editor/utils/richContent');
    assert.equal(deriveTitleFromTranscript('Call Anna about the launch. She wants Thursday.'), 'Call Anna about the launch');
    assert.equal(deriveTitleFromTranscript('купить молоко и хлеб'), 'Купить молоко и хлеб');
    assert.equal(
        deriveTitleFromTranscript('Ideas for the weekend trip, we could go hiking near the lake and then have dinner in town'),
        'Ideas for the weekend trip',
    );
    assert.equal(
        deriveTitleFromTranscript('So yesterday I was thinking that maybe we should finally move the whole team offsite somewhere'),
        'So yesterday I was thinking that…',
    );
    assert.equal(deriveTitleFromTranscript('明天下午三点和产品团队开会讨论新版本的发布计划以及市场推广的安排，还要准备演示'), '明天下午三点和产品团队开会讨论新版本的发…');
    assert.equal(deriveTitleFromTranscript('明天开会，讨论发布'), '明天开会，讨论发布');
    assert.equal(deriveTitleFromTranscript('#work Ship the beta?'), 'Ship the beta');
    assert.equal(deriveTitleFromTranscript('   '), '');
});
