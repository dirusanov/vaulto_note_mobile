/**
 * Note versions: step labels (no note content, localized on display) and the
 * word diff behind "Compare with Original".
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildLineageLabel,
    buildVariantDisplayLabels,
    englishStepName,
    isStepLabel,
    storedStepLabelOf,
    sanitizeStepLabel,
    markUserVariantName,
    userVariantName,
    plainVariantTitle,
    chipTextForLabel,
    agentOptionIdForMode,
    variantIconFor,
} = require('../.test-build/versions/i18n/variantLabels');
const { diffWords, hasDifferences } = require('../.test-build/versions/utils/textDiff');

const ru = {
    'edit.presets.summarize.label': 'Кратко',
    'edit.presets.professional.label': 'Деловой стиль',
    'edit.versions.kind.checklist': 'Чеклист',
};
const t = (key, fallback) => ru[key] || fallback;

test('step names are stored in English and never carry note text', () => {
    assert.equal(englishStepName({ id: 'summarize' }), 'Summarize');
    assert.equal(englishStepName({ id: 'agent_todo' }), 'Checklist');
    assert.equal(englishStepName({ id: 'custom_instruction' }), 'Custom Instruction');
    // User prompt names stay on the device: the synced label only says "Custom prompt".
    assert.equal(englishStepName({ id: 'custom-1', label: 'Rewrite for Dr. Cohen', isCustom: true }), 'Custom prompt');
});

test('lineage joins the source step and the new step', () => {
    assert.equal(buildLineageLabel('', 'Summarize'), 'Summarize');
    assert.equal(buildLineageLabel('Make Professional', 'Summarize'), 'Make Professional → Summarize');
    assert.equal(isStepLabel('Make Professional → Summarize'), true);
    assert.equal(isStepLabel('The meeting was productive'), false);
});

test('legacy variants whose label was a content title recover the step from option_id', () => {
    const legacy = { id: 'a', label: 'The meeting was productive', title: 'The meeting was productive', option_id: 'professional' };
    assert.equal(storedStepLabelOf(legacy), 'Make Professional');
    assert.equal(storedStepLabelOf({ id: 'b', label: 'Some title', option_id: null }), '');
});

test('chip texts are localized, show lineage and number duplicates', () => {
    const labels = buildVariantDisplayLabels([
        { id: '1', label: 'Summarize', option_id: 'summarize' },
        { id: '2', label: 'Make Professional → Summarize', option_id: 'summarize' },
        { id: '3', label: 'Old content title', title: 'Old content title', option_id: 'summarize' },
        { id: '4', label: 'Checklist', option_id: 'agent_todo' },
        { id: '5', label: 'Free text title', title: 'Free text title', option_id: null },
    ], t);
    assert.deepEqual(labels, {
        1: 'Кратко',
        2: 'Деловой стиль → Кратко',
        3: 'Кратко 2',
        4: 'Чеклист',
        // No step and no option: shown by position, never by its (content) label.
        5: '5',
    });
});

test('a legacy content title with an arrow is not treated as a lineage', () => {
    assert.equal(storedStepLabelOf({ id: 'x', label: 'Moscow → Paris trip', option_id: 'summarize' }), 'Summarize');
    assert.equal(storedStepLabelOf({ id: 'y', label: 'Moscow → Paris trip', option_id: null }), '');
});

test('custom prompts display their local name, generic when unknown', () => {
    const labels = buildVariantDisplayLabels([
        { id: 'a', label: 'Custom prompt', option_id: 'custom-1' },
        { id: 'b', label: 'Summarize → Custom prompt', option_id: 'custom-9' },
    ], t, { 'custom-1': { id: 'custom-1', label: 'Tweet it', isCustom: true } });
    assert.deepEqual(labels, { a: 'Tweet it', b: 'Кратко → Custom prompt' });
});

test('stored labels are sanitized exactly like the server does', () => {
    assert.equal(sanitizeStepLabel('Make Professional → Summarize', 'summarize'), 'Make Professional → Summarize');
    assert.equal(sanitizeStepLabel('The meeting was productive', 'professional'), 'Make Professional');
    assert.equal(sanitizeStepLabel('Moscow → Paris trip', 'summarize'), 'Summarize');
    assert.equal(sanitizeStepLabel('Rewrite for Dr. Cohen', 'custom-17'), 'Custom prompt');
    assert.equal(sanitizeStepLabel('I have two cats', null), undefined);
    assert.equal(sanitizeStepLabel(null, 'grammar'), 'Fix Grammar');
});

test('user-given names live in the encrypted title and win on display', () => {
    const stored = markUserVariantName('  For the team ');
    assert.equal(userVariantName(stored), 'For the team');
    assert.equal(userVariantName('The meeting went well'), null);
    assert.equal(plainVariantTitle(stored), 'For the team');
    const labels = buildVariantDisplayLabels([
        { id: 'a', label: 'Summarize', option_id: 'summarize', title: stored },
        { id: 'b', label: 'Summarize', option_id: 'summarize', title: 'Short' },
    ], t);
    assert.deepEqual(labels, { a: 'For the team', b: 'Кратко' });
});

test('derived versions show only their own step on the chip', () => {
    assert.equal(chipTextForLabel('Кратко'), 'Кратко');
    assert.equal(chipTextForLabel('Деловой стиль → Кратко'), 'Кратко');
});

test('agent modes map to their own kinds and icons', () => {
    assert.equal(agentOptionIdForMode('todo'), 'agent_todo');
    assert.equal(agentOptionIdForMode('edit_content'), 'agent');
    assert.equal(variantIconFor({ id: 'x', option_id: 'agent_todo' }, {}), 'checklist');
    assert.equal(variantIconFor({ id: 'x', option_id: 'grammar' }, { grammar: 'spellcheck' }), 'spellcheck');
});

test('word diff marks removed and added words and reassembles both texts', () => {
    const before = 'we will sync again on friday at ten';
    const after = 'We will reconvene on Friday at 10:00 AM';
    const segments = diffWords(before, after);
    assert.equal(segments.filter((s) => s.type !== 'added').map((s) => s.text).join(''), before);
    assert.equal(segments.filter((s) => s.type !== 'removed').map((s) => s.text).join(''), after);
    assert.ok(segments.some((s) => s.type === 'removed' && s.text.includes('sync')));
    assert.ok(segments.some((s) => s.type === 'added' && s.text.includes('reconvene')));
    assert.equal(hasDifferences(segments), true);
    assert.equal(hasDifferences(diffWords('same text', 'same text')), false);
});
