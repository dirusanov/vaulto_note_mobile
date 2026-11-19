/**
 * Voice fallback that ticks a checklist item when the agent chose dictation:
 * only a phrase that says the item is done may tick it. A negation, a question
 * or a plain mention keeps the list as it is (UX audit 2026-11-19, P1).
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
    resolveDirectChecklistCheckFallback,
} = require('../.test-build/checklistCommand/utils/checklistVoiceCommand');

const MARKDOWN_RU = '- [ ] молоко\n- [ ] хлеб';
const MARKDOWN_EN = '- [ ] milk\n- [ ] bread';
const RICH_RU = '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>молоко</p></div></li>'
    + '<li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>хлеб</p></div></li></ul>';

test('negations do not tick the item (RU)', () => {
    for (const phrase of [
        'Я ещё не купил молоко',
        'Не отмечай молоко',
        'Пока не купил молоко',
        'Молоко нет, не купил',
    ]) {
        assert.equal(resolveDirectChecklistCheckFallback(MARKDOWN_RU, phrase), null, phrase);
        assert.equal(resolveDirectChecklistCheckFallback(RICH_RU, phrase), null, `${phrase} (rich)`);
    }
});

test('negations do not tick the item (EN)', () => {
    for (const phrase of [
        "I haven't bought milk yet",
        "Don't mark milk",
        "I didn’t buy milk",
        'Not milk, I did not get it',
        'No milk today, mark nothing',
        'Uncheck milk',
    ]) {
        assert.equal(resolveDirectChecklistCheckFallback(MARKDOWN_EN, phrase), null, phrase);
    }
});

test('questions and plain mentions do not tick the item', () => {
    for (const phrase of [
        'Купил ли я молоко?',
        'Молоко куплено?',
        'Молоко',
        'Молоко надо купить',
        'Молоко и сыр',
    ]) {
        assert.equal(resolveDirectChecklistCheckFallback(MARKDOWN_RU, phrase), null, phrase);
    }
    for (const phrase of ['Did I buy milk?', 'Did I buy milk', 'milk', 'milk and cheese', 'Remember the milk']) {
        assert.equal(resolveDirectChecklistCheckFallback(MARKDOWN_EN, phrase), null, phrase);
    }
});

test('positive commands still tick the named item', () => {
    assert.equal(resolveDirectChecklistCheckFallback(MARKDOWN_RU, 'Отметь молоко'), '- [x] молоко\n- [ ] хлеб');
    assert.equal(resolveDirectChecklistCheckFallback(MARKDOWN_RU, 'Купил молоко'), '- [x] молоко\n- [ ] хлеб');
    assert.equal(resolveDirectChecklistCheckFallback(MARKDOWN_RU, 'Молоко готово'), '- [x] молоко\n- [ ] хлеб');
    assert.equal(resolveDirectChecklistCheckFallback(MARKDOWN_EN, 'Mark milk done'), '- [x] milk\n- [ ] bread');
    assert.equal(resolveDirectChecklistCheckFallback(MARKDOWN_EN, 'Bought milk'), '- [x] milk\n- [ ] bread');
    assert.equal(resolveDirectChecklistCheckFallback(MARKDOWN_EN, 'I’ve bought milk and bread.'), '- [x] milk\n- [x] bread');

    const rich = resolveDirectChecklistCheckFallback(RICH_RU, 'Купил молоко');
    assert.ok(rich, 'rich checklist item is ticked');
    assert.match(rich, /data-checked="true"[^]*молоко/);
    assert.equal((rich.match(/data-checked="true"/g) || []).length, 1, 'only the named item is ticked');
    assert.match(rich, /<input type="checkbox" checked>/);
});
