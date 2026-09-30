const test = require('node:test');
const assert = require('node:assert/strict');
const {
    queryTerms,
    rankNotesForQuestion,
    excerptForQuestion,
    buildNoteSources,
    formatSourcesForModel,
} = require('../.test-build/search/noteSearch');

const notes = [
    { id: 'a', title: 'Groceries', text: 'milk, bread, eggs and coffee', updatedAt: '2026-09-01' },
    { id: 'b', title: 'Встреча с командой', text: 'Запуск переносим на четверг. Маркетингу нужна неделя.', updatedAt: '2026-09-20' },
    { id: 'c', title: 'Trip', text: 'Book the hotel in Lisbon and the flight on Friday', updatedAt: '2026-09-25' },
];

test('stopwords are dropped and words are stemmed', () => {
    assert.deepEqual(queryTerms('What did I plan for the Lisbon trip?'), ['plan', 'lisbon', 'trip']);
    assert.deepEqual(queryTerms('Когда запуск продукта?'), ['запуск', 'проду']);
});

test('ranking finds inflected Russian and English matches', () => {
    assert.equal(rankNotesForQuestion(notes, 'на какой день перенесли запуска?')[0].id, 'b');
    assert.equal(rankNotesForQuestion(notes, 'hotel booking in lisbon')[0].id, 'c');
    assert.equal(rankNotesForQuestion(notes, 'do I need to buy coffee')[0].id, 'a');
});

test('broad questions fall back to the most recent notes', () => {
    assert.deepEqual(rankNotesForQuestion(notes, 'what did I do?').map((r) => r.id), ['c', 'b', 'a']);
    assert.deepEqual(rankNotesForQuestion(notes, 'zebra quantum', 2).map((r) => r.id), ['c', 'b']);
});

test('long notes contribute the passage around the match', () => {
    const long = `${'filler '.repeat(400)}the passport is in the blue drawer ${'filler '.repeat(400)}`;
    const excerpt = excerptForQuestion(long, 'where is my passport', 300);
    assert.ok(excerpt.includes('passport'));
    assert.ok(excerpt.startsWith('…'));
    assert.ok(excerpt.length <= 310);
});

test('sources are numbered, budgeted and formatted for the model', () => {
    const sources = buildNoteSources(notes, 'lisbon hotel', { limit: 2 });
    assert.equal(sources[0].id, 'c');
    assert.equal(sources[0].index, 1);
    assert.ok(formatSourcesForModel(sources).startsWith('[1] Trip\nBook the hotel'));
});

test('list search matches every word, in any order and inflection, not markup', () => {
    const { listSearchTerms, matchesListQuery } = require('../.test-build/search/noteSearch');
    const text = 'Встреча с командой\nЗапуск переносим на четверг. Tom & Jerry ёлка';
    assert.ok(matchesListQuery(text, listSearchTerms('четверг запуска')));
    assert.ok(matchesListQuery(text, listSearchTerms('Tom Jerry')));
    assert.ok(matchesListQuery(text, listSearchTerms('елка')));
    assert.ok(!matchesListQuery(text, listSearchTerms('четверг пятница')));
    assert.ok(!matchesListQuery(text, listSearchTerms('strong')));
    assert.ok(matchesListQuery(text, listSearchTerms('   ')));
    assert.deepEqual(listSearchTerms('Meetings meetings'), ['meetin']);
});
