const test = require('node:test');
const assert = require('node:assert');
const { extractTags, countTags, hasTag, splitTags } = require('../.test-build/tags/tags.js');

test('hashtags in any script are found, lower-cased and unique', () => {
    assert.deepStrictEqual(extractTags('Plan #Work and #идеи, again #work'), ['work', 'идеи']);
    assert.deepStrictEqual(extractTags('#家庭 #trip-2026 #to_do'), ['家庭', 'trip-2026', 'to_do']);
});

test('URL fragments, headings and numbers are not tags', () => {
    assert.deepStrictEqual(extractTags('see https://example.com/#top'), []);
    assert.deepStrictEqual(extractTags('# Heading\n## Sub'), []);
    assert.deepStrictEqual(extractTags('task #1 and #2024'), []);
    assert.deepStrictEqual(extractTags('mail me@site#x'), []);
});

test('a tag at the start of a line or in brackets counts; trailing dashes are trimmed', () => {
    assert.deepStrictEqual(extractTags('#start\n(#inside) #end-'), ['start', 'inside', 'end']);
});

test('countTags orders by use then name; hasTag ignores case', () => {
    assert.deepStrictEqual(countTags(['#b #a', '#a', '#c']), [
        { tag: 'a', count: 2 }, { tag: 'b', count: 1 }, { tag: 'c', count: 1 },
    ]);
    assert.strictEqual(hasTag('Buy milk #Home', 'home'), true);
    assert.strictEqual(hasTag('Buy milk #Home', 'work'), false);
});

test('splitTags keeps the text intact and marks tags', () => {
    const parts = splitTags('Buy milk #home and #1 more');
    assert.strictEqual(parts.map((p) => p.text).join(''), 'Buy milk #home and #1 more');
    assert.deepStrictEqual(parts.filter((p) => p.tag).map((p) => p.text), ['#home']);
});
