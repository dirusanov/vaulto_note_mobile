const test = require('node:test');
const assert = require('node:assert');
const f = require('../.test-build/transfer/noteTransferFormat.js');

test('file names are safe and unique', () => {
    const used = new Set();
    assert.strictEqual(f.safeFileName('Plan: Q4 / budget?', used), 'Plan Q4 budget.md');
    assert.strictEqual(f.safeFileName('Plan: Q4 / budget?', used), 'Plan Q4 budget (2).md');
    assert.strictEqual(f.safeFileName('', used), 'note.md');
});

test('markdown export round-trips through import', () => {
    const file = f.noteToMarkdownFile('Покупки', '- [ ] молоко\n- [x] хлеб #дом', '2026-10-02T10:00:00Z');
    assert.deepStrictEqual(f.parseTextNote(file, 'Покупки.md'), { title: 'Покупки', content: '- [ ] молоко\n- [x] хлеб #дом' });
});

test('plain text has no title; a named markdown file keeps its name', () => {
    assert.deepStrictEqual(f.parseTextNote('Just a line\nsecond', 'a.txt'), { title: '', content: 'Just a line\nsecond' });
    assert.deepStrictEqual(f.parseTextNote('Body text', 'Ideas.md'), { title: 'Ideas', content: 'Body text' });
    assert.strictEqual(f.parseTextNote('   \n', 'x.md'), null);
});

test('Google Keep notes: text, checklists, labels; trashed and foreign JSON skipped', () => {
    assert.deepStrictEqual(
        f.parseKeepNote(JSON.stringify({ title: 'Trip', textContent: 'Pack bags', labels: [{ name: 'Travel plans' }] })),
        { title: 'Trip', content: 'Pack bags\n\n#Travel_plans' },
    );
    assert.deepStrictEqual(
        f.parseKeepNote(JSON.stringify({ title: '', listContent: [{ text: 'milk', isChecked: false }, { text: 'eggs', isChecked: true }] })),
        { title: '', content: '- [ ] milk\n- [x] eggs' },
    );
    assert.strictEqual(f.parseKeepNote(JSON.stringify({ title: 'x', textContent: 'y', isTrashed: true })), null);
    assert.strictEqual(f.parseKeepNote(JSON.stringify({ foo: 1 })), null);
    assert.strictEqual(f.parseKeepNote('not json'), null);
});
