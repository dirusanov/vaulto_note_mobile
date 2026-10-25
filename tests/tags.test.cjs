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

const { withTagLine, appendAboveTagLine } = require('../.test-build/tags/tags.js');
const appendLine = (text) => (body) => `${body}<p>${text}</p>`;

test('suggested tags are written as a tag line at the end of a rich note', () => {
    assert.strictEqual(withTagLine('<p>Call the bank</p><p></p>', ['Work', 'money']), '<p>Call the bank</p><p>#work #money</p>');
});

test('tags already in the note are not added twice; new ones join the last tag line with its marks', () => {
    assert.strictEqual(withTagLine('<p>Plan for #work</p>', ['work', 'trip']), '<p>Plan for #work</p><p>#trip</p>');
    assert.strictEqual(withTagLine('<p>Plan</p><p>#work</p>', ['work']), '<p>Plan</p><p>#work</p>');
    assert.strictEqual(withTagLine('<p>Plan</p><p><strong>#work</strong></p>', ['trip']), '<p>Plan</p><p><strong>#work</strong> #trip</p>');
});

test('tags kept elsewhere stay where they are', () => {
    // A tag line at the top is the user's: new tags go to a new line at the end.
    assert.strictEqual(withTagLine('<p>#work</p><p>Plan</p>', ['trip']), '<p>#work</p><p>Plan</p><p>#trip</p>');
    assert.strictEqual(appendAboveTagLine('<p>#work</p><p>Plan</p>', appendLine('More')), '<p>#work</p><p>Plan</p><p>More</p>');
});

test('text appended after the tags were written goes above the tag line', () => {
    assert.strictEqual(appendAboveTagLine('<p>First</p><p>#work #trip</p>', appendLine('Second')), '<p>First</p><p>Second</p><p>#work #trip</p>');
    assert.strictEqual(appendAboveTagLine('<p>First</p>', appendLine('Second')), '<p>First</p><p>Second</p>');
});

test('a paragraph inside a list, quote or table is never the tag line', () => {
    const list = '<ul><li><p>#later</p></li></ul>';
    assert.strictEqual(appendAboveTagLine(list, appendLine('Note')), `${list}<p>Note</p>`);
    assert.strictEqual(withTagLine(list, ['home']), `${list}<p>#home</p>`);
    const quote = '<p>Hi</p><blockquote><p>#quoted</p></blockquote>';
    assert.strictEqual(appendAboveTagLine(quote, appendLine('Note')), `${quote}<p>Note</p>`);
});

test('plain-text notes get a tag line after a blank line', () => {
    assert.strictEqual(withTagLine('Buy milk\n', ['дом']), 'Buy milk\n\n#дом');
    assert.strictEqual(withTagLine('Buy milk\n\n#дом', ['еда']), 'Buy milk\n\n#дом #еда');
    assert.strictEqual(appendAboveTagLine('Buy milk\n\n#дом', (body) => `${body}\nand eggs`), 'Buy milk\nand eggs\n\n#дом');
    assert.strictEqual(withTagLine('', ['дом']), '#дом');
});

test('nothing to write leaves the note as it is', () => {
    assert.strictEqual(withTagLine('<p>Hello</p>', []), '<p>Hello</p>');
    assert.strictEqual(withTagLine('<p>Hello</p>', ['#', '']), '<p>Hello</p>');
});
