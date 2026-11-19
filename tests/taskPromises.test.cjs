// Promise → verifiable task (UX audit 2026-11-19, feedback F-01): no invented
// tasks or list items, negations are not tasks, a deadline only when said.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildTaskExtractionPrompt,
    parseExtractedTasks,
    trimInventedTitleParts,
    isNegatedInSource,
} = require('../.test-build/tasks/taskExtraction');

test('prompt asks for a verbatim quote and forbids negated tasks and added details', () => {
    const prompt = buildTaskExtractionPrompt(new Date(2026, 10, 19));
    assert.ok(prompt.includes('"quote"'));
    assert.ok(prompt.includes('negated'));
    assert.ok(prompt.includes('do not add synonyms'));
});

test('"отправлю смету к пятнице, а звонок пока не назначай" gives one task with the said deadline', () => {
    const now = new Date(2026, 10, 19, 10, 0); // Thursday
    const source = 'Я отправлю Ире смету к пятнице, а звонок пока не назначай.';
    const raw = JSON.stringify({ tasks: [
        { title: 'Отправить Ире смету', date: '2026-11-20', time: null, quote: 'отправлю Ире смету к пятнице' },
        { title: 'Назначить звонок', date: '2026-11-20', time: null, quote: 'звонок пока не назначай' },
    ] });
    const tasks = parseExtractedTasks(raw, source, now);
    assert.deepEqual(tasks.map((t) => [t.title, t.date, t.quote]), [
        ['Отправить Ире смету', '2026-11-20', 'отправлю Ире смету к пятнице'],
    ]);
});

test('a deadline said for one task is not copied to another', () => {
    const now = new Date(2026, 10, 19, 10, 0);
    const source = 'Send Anna the estimate by Friday. Also buy milk.';
    const raw = JSON.stringify({ tasks: [
        { title: 'Send Anna the estimate', date: '2026-11-20', time: null, quote: 'Send Anna the estimate by Friday' },
        { title: 'Buy milk', date: '2026-11-20', time: '09:00', quote: 'buy milk' },
    ] });
    const tasks = parseExtractedTasks(raw, source, now);
    assert.deepEqual(tasks.map((t) => [t.title, t.date, t.time]), [
        ['Send Anna the estimate', '2026-11-20', null],
        ['Buy milk', null, null],
    ]);
    // Answers without quotes (older prompts, small local models) fall back to the whole note.
    const legacy = parseExtractedTasks('{"tasks":[{"title":"Buy milk","date":"2026-11-20","time":null}]}', source, now);
    assert.equal(legacy[0].date, '2026-11-20');
    assert.equal(legacy[0].quote, null);
});

test('F-01: "buy milk" does not become "buy milk, milk, dairy"', () => {
    assert.equal(trimInventedTitleParts('Buy milk, milk, dairy', 'Buy milk.'), 'Buy milk');
    assert.equal(trimInventedTitleParts('Buy milk, eggs, bread', 'Buy milk, eggs and bread.'), 'Buy milk, eggs, bread');
    assert.equal(trimInventedTitleParts('Купить молоко, молочку', 'Купить молоко.'), 'Купить молоко');
    const tasks = parseExtractedTasks('{"tasks":[{"title":"Buy milk, milk, dairy","date":null,"time":null,"quote":"Buy milk"}]}', 'Buy milk.');
    assert.deepEqual(tasks.map((t) => t.title), ['Buy milk']);
});

test('tasks the note never mentions are dropped; quotes not in the note are ignored', () => {
    const source = 'Купить молоко и хлеб.';
    const raw = JSON.stringify({ tasks: [
        { title: 'Купить молоко', date: null, time: null, quote: 'Купить молоко' },
        { title: 'Записаться к стоматологу', date: null, time: null, quote: 'записаться к стоматологу' },
        { title: 'Купить хлеб', date: null, time: null, quote: 'совсем другие слова здесь' },
    ] });
    const tasks = parseExtractedTasks(raw, source);
    assert.deepEqual(tasks.map((t) => [t.title, t.quote]), [['Купить молоко', 'Купить молоко'], ['Купить хлеб', null]]);
});

test('negations in Russian and English do not become tasks', () => {
    assert.ok(isNegatedInSource('Назначить звонок', 'Звонок пока не назначай.'));
    assert.ok(isNegatedInSource('Звонить Пете', 'Пете не надо звонить.'));
    assert.ok(isNegatedInSource('Schedule the call', "Don't schedule the call yet."));
    assert.ok(isNegatedInSource('Schedule the call', 'Don’t schedule the call yet.'));
    assert.ok(isNegatedInSource('Call Bob', 'No need to call Bob.'));
});

test('other tasks of the same note and "don\'t forget" reminders survive', () => {
    assert.ok(!isNegatedInSource('Call Anna', 'Call Anna tomorrow, but no need to call Bob.'));
    assert.ok(!isNegatedInSource('Отправить смету', 'Я отправлю смету, а звонок пока не назначай.'));
    assert.ok(!isNegatedInSource('Buy milk', "Don't forget to buy milk."));
    assert.ok(!isNegatedInSource('Купить молоко', 'Не забудь купить молоко.'));
    assert.ok(!isNegatedInSource('Позвонить Пете', 'Я не уверен, но позвоню Пете.'));
    const tasks = parseExtractedTasks(JSON.stringify({ tasks: [
        { title: 'Buy milk', date: null, time: null, quote: "Don't forget to buy milk" },
        { title: 'Schedule the call', date: null, time: null, quote: "don't schedule the call yet" },
    ] }), "Don't forget to buy milk. Don't schedule the call yet.");
    assert.deepEqual(tasks.map((t) => t.title), ['Buy milk']);
});

test('without a source (no note text) parsing behaves as before', () => {
    const tasks = parseExtractedTasks('{"tasks":[{"title":"Buy milk, milk, dairy","date":"2026-11-20","time":null,"quote":"x"}]}');
    assert.equal(tasks[0].title, 'Buy milk, milk, dairy');
    assert.equal(tasks[0].quote, null);
});
