/**
 * Original + derived versions: which version a version was made from (shown
 * as "Based on" and used by Improve and Compare), stepping through the
 * changes of a comparison, and the editor header's fixed action places.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
    resolveVersionSource,
    parentStepsOfLabel,
    compareBasesFor,
    defaultImproveSource,
    groupDiffChanges,
    changeIndexOfSegment,
    splitDiffIntoParagraphs,
    stepChange,
    VERSIONS_HEADER_MIN_COUNT,
} = require('../.test-build/versionFlow/utils/versionLineage');
const { diffWords } = require('../.test-build/versionFlow/utils/textDiff');
const { editorHeaderLayout, estimateLabelWidth } = require('../.test-build/versionFlow/utils/toolbarLayout');

const imp = (id, label, option_id) => ({ id, label, option_id });

// --- source of a version -----------------------------------------------------

test('a single preset step comes from the original', () => {
    const list = [imp('a', 'Summarize', 'summarize')];
    assert.equal(resolveVersionSource('a', list), 'original');
    assert.equal(resolveVersionSource('original', list), null);
    assert.equal(resolveVersionSource('missing', list), null);
});

test('a chain comes from the closest earlier version with the parent label', () => {
    const list = [
        imp('s1', 'Summarize', 'summarize'),
        imp('p', 'Make Professional', 'professional'),
        imp('s2', 'Summarize', 'summarize'),
        imp('e', 'Summarize → Structure', 'structure'),
        imp('x', 'Make Professional → Summarize', 'summarize'),
    ];
    assert.equal(resolveVersionSource('e', list), 's2', 'the later of two identical names, made before it');
    assert.equal(resolveVersionSource('x', list), 'p');
});

test('a deleted source is unknown, but its name still comes from the chain', () => {
    const list = [imp('e', 'Summarize → Structure', 'structure')];
    assert.equal(resolveVersionSource('e', list), null);
    assert.equal(parentStepsOfLabel('Кратко → Письмо 2'), 'Кратко');
    assert.equal(parentStepsOfLabel('A → B → C'), 'A → B');
    assert.equal(parentStepsOfLabel('Кратко'), '');
});

test('a recorded source wins while it exists; voice results without a record stay unknown', () => {
    const list = [
        imp('s1', 'Summarize', 'summarize'),
        imp('s2', 'Summarize', 'summarize'),
        imp('e', 'Summarize → Structure', 'structure'),
        imp('l', 'List', 'agent_list'),
        imp('prev', 'Previous original', 'previous_original'),
    ];
    assert.equal(resolveVersionSource('e', list, { knownSources: { e: 's1' } }), 's1');
    assert.equal(resolveVersionSource('e', list, { knownSources: { e: 'gone' } }), 's2', 'falls back to the chain');
    assert.equal(resolveVersionSource('l', list), null, 'agent result: not a guess at Original');
    assert.equal(resolveVersionSource('l', list, { knownSources: { l: 's2' } }), 's2');
    assert.equal(resolveVersionSource('l', list, { knownSources: { l: 'original' } }), 'original');
    assert.equal(resolveVersionSource('prev', list), null, 'a demoted original has no source');
});

test('Improve starts from the version being read', () => {
    assert.equal(defaultImproveSource('e', ['s', 'e']), 'e');
    assert.equal(defaultImproveSource('original', ['s', 'e']), 'original');
    assert.equal(defaultImproveSource('deleted', ['s', 'e']), 'original');
});

test('compare bases: the source first, then the original', () => {
    assert.deepEqual(compareBasesFor('e', 's'), ['s', 'original']);
    assert.deepEqual(compareBasesFor('s', 'original'), ['original']);
    assert.deepEqual(compareBasesFor('l', null), ['original']);
    assert.deepEqual(compareBasesFor('original', null), []);
});

test('the versions bar gets a header from five versions', () => {
    assert.equal(VERSIONS_HEADER_MIN_COUNT, 5);
});

// --- stepping through changes -------------------------------------------------

test('a replaced phrase is one change; separate edits are separate changes', () => {
    const segments = diffWords('Call Anna on Friday about the budget', 'Call Ira on Monday about the budget');
    const changes = groupDiffChanges(segments);
    assert.equal(changes.length, 2, JSON.stringify(segments));
    const words = (change) => segments.slice(change.start, change.end + 1).map((s) => s.text).join('');
    assert.match(words(changes[0]), /Anna/);
    assert.match(words(changes[0]), /Ira/);
    assert.match(words(changes[1]), /Friday/);
});

test('whitespace-only edits are not changes; a line break ends a change', () => {
    assert.equal(groupDiffChanges(diffWords('a b', 'a  b')).length, 0);
    const segments = [
        { type: 'removed', text: 'x' },
        { type: 'same', text: '\n' },
        { type: 'added', text: 'y' },
    ];
    assert.equal(groupDiffChanges(segments).length, 2);
    assert.equal(groupDiffChanges([]).length, 0);
});

test('every segment of a change maps back to it', () => {
    const segments = diffWords('one two three four', 'one 2 three 4');
    const changes = groupDiffChanges(segments);
    assert.equal(changes.length, 2);
    changes.forEach((change, index) => {
        for (let i = change.start; i <= change.end; i += 1) {
            if (segments[i].type !== 'same') assert.equal(changeIndexOfSegment(changes, i), index);
        }
    });
    assert.equal(changeIndexOfSegment(changes, 0), -1, 'the unchanged first word');
});

test('paragraphs keep the text and the segment each piece came from', () => {
    const segments = diffWords('Title\n\nOld line\nKeep', 'Title\n\nNew line\nKeep');
    const paragraphs = splitDiffIntoParagraphs(segments);
    const rebuilt = paragraphs.map((pieces) => pieces.map((p) => p.text).join('')).join('\n');
    const both = segments.map((s) => s.text).join('');
    assert.equal(rebuilt, both, 'nothing lost or duplicated');
    assert.deepEqual(paragraphs[1], [], 'an empty line stays');
    const changed = paragraphs[2].filter((p) => p.type !== 'same');
    assert.ok(changed.length >= 2);
    changed.forEach((p) => assert.equal(segments[p.segmentIndex].type, p.type));
});

test('line breaks follow the newer text: a removed break does not start a paragraph', () => {
    const segments = diffWords('First line.\nSecond line.', 'First line. Second line.');
    const paragraphs = splitDiffIntoParagraphs(segments);
    assert.equal(paragraphs.length, 1, JSON.stringify(segments));
    const added = splitDiffIntoParagraphs(diffWords('One. Two.', 'One.\nTwo.'));
    assert.equal(added.length, 2, 'an added break does');
});

test('Previous / Next stop at the ends', () => {
    assert.equal(stepChange(-1, 1, 3), 0);
    assert.equal(stepChange(-1, -1, 3), 2);
    assert.equal(stepChange(0, -1, 3), 0);
    assert.equal(stepChange(2, 1, 3), 2);
    assert.equal(stepChange(1, 1, 3), 2);
    assert.equal(stepChange(0, 1, 0), -1);
});

test('a long text keeps its changes in order', () => {
    const before = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
    const after = before.replace('word10 ', 'WORD10 ').replace('word200 ', '').replace('word399', 'end');
    const changes = groupDiffChanges(diffWords(before, after));
    assert.equal(changes.length, 3);
    assert.ok(changes[0].start < changes[1].start && changes[1].start < changes[2].start);
});

// --- editor header ------------------------------------------------------------

test('Improve is labelled on common phones and tablets, at 100% and 200% text', () => {
    // Pixel-class phone (411dp), English and Russian.
    assert.equal(editorHeaderLayout(411, 1, 'Improve').labelImprove, true);
    assert.equal(editorHeaderLayout(411, 1, 'Улучшить').labelImprove, true);
    assert.equal(editorHeaderLayout(411, 2, 'Улучшить').labelImprove, true, 'the label caps at 130% text');
    assert.equal(editorHeaderLayout(411, 2, 'Verbessern').labelImprove, true);
    // Tablet: every action fits in the header.
    const tablet = editorHeaderLayout(800, 2, 'Verbessern');
    assert.deepEqual(tablet, { secondaryInMenu: false, labelImprove: true });
});

test('narrow phones keep the header in one row: secondary actions in the menu, icon-only if needed', () => {
    const narrow = editorHeaderLayout(320, 1, 'Improve');
    assert.equal(narrow.secondaryInMenu, true);
    assert.equal(narrow.labelImprove, false);
    assert.equal(editorHeaderLayout(360, 2, 'Improve').labelImprove, false);
    assert.equal(editorHeaderLayout(360, 1, 'Improve').labelImprove, true);
    assert.equal(editorHeaderLayout(411, 1, '').labelImprove, false);
});

test('the header layout depends only on width, text size and wording (no state)', () => {
    assert.equal(editorHeaderLayout.length, 3);
    assert.deepEqual(editorHeaderLayout(411, 1, 'Improve'), editorHeaderLayout(411, 1, 'Improve'));
});

test('label width estimate: CJK glyphs are wider than Latin', () => {
    assert.ok(estimateLabelWidth('改进', 14) > estimateLabelWidth('ab', 14));
    assert.equal(estimateLabelWidth('', 14), 0);
});
