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

const { withTagLine, keepTagLineLast } = require('../.test-build/tags/tags.js');

test('suggested tags are written as a tag line at the end of a rich note', () => {
    assert.strictEqual(withTagLine('<p>Call the bank</p><p></p>', ['Work', 'money']), '<p>Call the bank</p><p>#work #money</p>');
});

test('tags already in the note are not added twice', () => {
    assert.strictEqual(withTagLine('<p>Plan for #work</p>', ['work', 'trip']), '<p>Plan for #work</p><p>#trip</p>');
    assert.strictEqual(withTagLine('<p>Plan</p><p>#work</p>', ['work']), '<p>Plan</p><p>#work</p>');
});

test('text dictated after the tag line goes above it', () => {
    assert.strictEqual(keepTagLineLast('<p>First</p><p>#work #trip</p><p>Second</p>'), '<p>First</p><p>Second</p><p>#work #trip</p>');
    assert.strictEqual(keepTagLineLast('<p>First</p><p>#work</p>'), '<p>First</p><p>#work</p>');
});

test('a list item made of hashtags is not a tag line', () => {
    const html = '<ul><li><p>#later</p></li></ul><p>Note</p>';
    assert.strictEqual(keepTagLineLast(html), html);
    assert.strictEqual(withTagLine(html, ['home']), '<ul><li><p>#later</p></li></ul><p>Note</p><p>#home</p>');
});

test('plain-text notes get a tag line after a blank line', () => {
    assert.strictEqual(withTagLine('Buy milk\n', ['дом']), 'Buy milk\n\n#дом');
    assert.strictEqual(keepTagLineLast('Buy milk\n\n#дом\nand eggs'), 'Buy milk\n\nand eggs\n\n#дом');
    assert.strictEqual(withTagLine('', ['дом']), '#дом');
});

test('nothing to write leaves the note as it is', () => {
    assert.strictEqual(withTagLine('<p>Hello</p>', []), '<p>Hello</p>');
    assert.strictEqual(withTagLine('<p>Hello</p>', ['#', '']), '<p>Hello</p>');
});
