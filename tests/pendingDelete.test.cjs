const test = require('node:test');
const assert = require('node:assert');
const { createPendingDeleteStore } = require('../.test-build/pendingDelete/pendingDelete.js');

const WINDOW = 8000;
const GRACE = 600;

const setup = (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const commits = [];
    const commit = (ids) => { commits.push(ids); return Promise.resolve(); };
    const store = createPendingDeleteStore({ windowMs: WINDOW, graceMs: GRACE });
    return { store, commits, commit };
};

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

test('notes are hidden at once, the Undo bar shows them, nothing is committed during the window', (t) => {
    const { store, commits, commit } = setup(t);
    assert.strictEqual(store.schedule(['a', 'b'], commit), true);
    assert.deepStrictEqual(store.getSnapshot(), { undoableIds: ['a', 'b'], hiddenIds: ['a', 'b'] });
    t.mock.timers.tick(WINDOW - 1);
    assert.deepStrictEqual(commits, []);
});

test('Undo anywhere in the window restores and nothing is ever committed', (t) => {
    const { store, commits, commit } = setup(t);
    store.schedule(['a'], commit);
    t.mock.timers.tick(WINDOW - 10);
    assert.strictEqual(store.undo(), true);
    assert.deepStrictEqual(store.getSnapshot(), { undoableIds: null, hiddenIds: [] });
    t.mock.timers.tick(WINDOW * 3);
    assert.deepStrictEqual(commits, []);
});

test('a tap that lands as the bar disappears still restores (grace period)', (t) => {
    const { store, commits, commit } = setup(t);
    store.schedule(['a'], commit);
    t.mock.timers.tick(WINDOW);
    assert.strictEqual(store.getSnapshot().undoableIds, null, 'bar hidden');
    assert.deepStrictEqual(store.getSnapshot().hiddenIds, ['a'], 'still out of the list');
    assert.strictEqual(store.undo(), true);
    t.mock.timers.tick(GRACE * 2);
    assert.deepStrictEqual(commits, []);
});

test('after the window and grace the batch is committed once and stays hidden until done', async (t) => {
    const { store, commits } = setup(t);
    let finish;
    store.schedule(['a'], (ids) => { commits.push(ids); return new Promise((r) => { finish = r; }); });
    t.mock.timers.tick(WINDOW + GRACE);
    assert.deepStrictEqual(commits, [['a']]);
    assert.deepStrictEqual(store.getSnapshot(), { undoableIds: null, hiddenIds: ['a'] });
    assert.strictEqual(store.undo(), false, 'nothing left to undo');
    finish();
    await flushPromises();
    assert.deepStrictEqual(store.getSnapshot().hiddenIds, []);
    t.mock.timers.tick(WINDOW * 2);
    assert.deepStrictEqual(commits, [['a']]);
});

test('a repeated Delete tap with the same notes does not commit the first batch', (t) => {
    const { store, commits, commit } = setup(t);
    store.schedule(['a'], commit);
    assert.strictEqual(store.schedule(['a'], commit), false);
    assert.deepStrictEqual(commits, []);
    assert.strictEqual(store.undo(), true);
    t.mock.timers.tick(WINDOW * 2);
    assert.deepStrictEqual(commits, []);
});

test('a second delete joins the batch and one Undo restores both', (t) => {
    const { store, commits, commit } = setup(t);
    store.schedule(['a'], commit);
    t.mock.timers.tick(5000);
    store.schedule(['b', 'a'], commit);
    assert.deepStrictEqual(store.getSnapshot().undoableIds, ['a', 'b']);
    t.mock.timers.tick(WINDOW - 1);
    assert.deepStrictEqual(commits, [], 'window restarted for the merged batch');
    assert.strictEqual(store.undo(), true);
    t.mock.timers.tick(WINDOW * 2);
    assert.deepStrictEqual(commits, []);
});

test('flush commits now (app sent to background); later Undo does nothing', (t) => {
    const { store, commits, commit } = setup(t);
    store.schedule(['a'], commit);
    store.flush();
    assert.deepStrictEqual(commits, [['a']]);
    assert.strictEqual(store.undo(), false);
    store.flush();
    t.mock.timers.tick(WINDOW * 2);
    assert.deepStrictEqual(commits, [['a']]);
});

test('subscribers hear every change; snapshots are stable between changes', (t) => {
    const { store, commit } = setup(t);
    let calls = 0;
    const unsubscribe = store.subscribe(() => { calls += 1; });
    const before = store.getSnapshot();
    assert.strictEqual(store.getSnapshot(), before);
    store.schedule(['a'], commit);
    assert.notStrictEqual(store.getSnapshot(), before);
    store.undo();
    assert.strictEqual(calls, 2);
    unsubscribe();
    store.schedule(['b'], commit);
    assert.strictEqual(calls, 2);
});

test('a failed commit brings the notes back to the list and reports the error', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const errors = [];
    const store = createPendingDeleteStore({ windowMs: WINDOW, graceMs: GRACE, onError: (e) => errors.push(e) });
    store.schedule(['a'], () => { throw new Error('disk full'); });
    t.mock.timers.tick(WINDOW + GRACE);
    await flushPromises();
    assert.strictEqual(errors.length, 1);
    assert.deepStrictEqual(store.getSnapshot().hiddenIds, []);
});
