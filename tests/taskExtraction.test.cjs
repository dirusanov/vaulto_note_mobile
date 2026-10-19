const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildTaskExtractionPrompt,
    parseExtractedTasks,
    checklistTitlesFromMarkdown,
    isTaskInNote,
    tasksToChecklistMarkdown,
    taskToCalendarEvent,
    localDateString,
} = require('../.test-build/tasks/taskExtraction');

test('prompt carries the local date and weekday', () => {
    const prompt = buildTaskExtractionPrompt(new Date(2026, 8, 30, 23, 30));
    assert.ok(prompt.includes('Wednesday, 2026-09-30'));
});

test('parses fenced JSON, bare arrays and drops junk', () => {
    const raw = '```json\n{"tasks":[{"title":"- [ ] Book hotel","date":"2026-10-02","time":"9:05"},{"title":"book hotel"},{"title":""},{"title":"Call Anna","date":"2026-02-30","time":"10:00"},{"nope":1}]}\n```';
    const tasks = parseExtractedTasks(raw);
    assert.deepEqual(tasks.map((t) => [t.title, t.date, t.time]), [
        ['Book hotel', '2026-10-02', '09:05'],
        ['Call Anna', null, null],
    ]);
    assert.deepEqual(parseExtractedTasks('Sure! ["Buy milk", "Buy milk"]').map((t) => t.title), ['Buy milk']);
    assert.deepEqual(parseExtractedTasks('no json here'), []);
});

test('tasks already in the note checklist are recognised', () => {
    const existing = checklistTitlesFromMarkdown('# Plan\n- [ ] Купить молоко\n- [x] Book hotel — Oct 2\ntext');
    assert.ok(isTaskInNote({ title: 'купить молоко!' }, existing));
    assert.ok(isTaskInNote({ title: 'Book hotel' }, existing));
    assert.ok(!isTaskInNote({ title: 'Call Anna' }, existing));
    // A shorter or longer task is a different task.
    assert.ok(!isTaskInNote({ title: 'Book' }, existing));
    assert.ok(!isTaskInNote({ title: 'Купить молоко и хлеб' }, existing));
});

test('undated notes cannot acquire an invented model deadline or reminder time', () => {
    const now = new Date(2026, 9, 19, 2, 0);
    const raw = '{"tasks":[{"title":"Buy milk","date":"2026-10-19","time":"08:00"}]}';
    const [task] = parseExtractedTasks(raw, 'Buy milk.', now);
    assert.equal(task.date, null);
    assert.equal(task.time, null);
    assert.equal(tasksToChecklistMarkdown([task]), '- [ ] Buy milk');
    assert.equal(parseExtractedTasks(raw, 'Buy 19 bottles of milk for 8 dollars.', now)[0].date, null);
});

test('source deadlines retain supported dates and explicit times, but reject wrong resolutions', () => {
    const now = new Date(2026, 9, 19, 2, 0); // Monday
    const raw = (date, time = '15:00') => JSON.stringify({ tasks: [{ title: 'Call Anna', date, time }] });
    assert.equal(parseExtractedTasks(raw('2026-10-20'), 'Позвонить Анне завтра в 15:00.', now)[0].time, '15:00');
    assert.equal(parseExtractedTasks(raw('2026-10-20'), 'Позвонить Анне завтра.', now)[0].time, null);
    assert.equal(parseExtractedTasks(raw('2026-10-19'), 'Позвонить Анне завтра.', now)[0].date, null);
    assert.equal(parseExtractedTasks(raw('2026-10-23'), 'Call Anna on Friday at 15:00.', now)[0].date, '2026-10-23');
    assert.equal(parseExtractedTasks(raw('2026-10-20'), 'Call Anna the day after tomorrow.', now)[0].date, null);
    assert.equal(parseExtractedTasks(raw('2026-10-21'), 'Call Anna the day after tomorrow.', now)[0].date, '2026-10-21');
    assert.equal(parseExtractedTasks(raw('2026-10-23'), 'Позвонить 23.10.2026 в 15:00.', now)[0].date, '2026-10-23');
    assert.equal(parseExtractedTasks(raw('2026-10-23'), 'Call on 2026-10-23 at 15:00.', now)[0].date, '2026-10-23');
});

test('checklist markdown and calendar events', () => {
    const tasks = parseExtractedTasks('{"tasks":[{"title":"Ship v2","date":"2026-10-01","time":"14:00"},{"title":"Pack","date":"2026-10-03"},{"title":"Think"}]}');
    assert.equal(tasksToChecklistMarkdown(tasks), '- [ ] Ship v2 — 2026-10-01 14:00\n- [ ] Pack — 2026-10-03\n- [ ] Think');

    const timed = taskToCalendarEvent(tasks[0]);
    assert.equal(timed.allDay, false);
    assert.equal(timed.startDate.getHours(), 14);
    assert.equal(timed.endDate.getTime() - timed.startDate.getTime(), 3600000);

    const allDay = taskToCalendarEvent(tasks[1]);
    assert.equal(allDay.allDay, true);
    assert.equal(localDateString(allDay.startDate), '2026-10-03');

    const undated = taskToCalendarEvent(tasks[2], new Date(2026, 8, 30, 20, 0));
    assert.equal(localDateString(undated.startDate), '2026-10-01');
    assert.equal(undated.startDate.getHours(), 9);
});

test('google calendar fallback url', () => {
    const { googleCalendarUrl } = require('../.test-build/tasks/taskExtraction');
    const [timed, allDay] = parseExtractedTasks('{"tasks":[{"title":"Ship v2 & QA","date":"2026-10-01","time":"14:00"},{"title":"Pack","date":"2026-10-03"}]}');
    assert.equal(googleCalendarUrl(taskToCalendarEvent(timed)), 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=Ship%20v2%20%26%20QA&dates=20261001T140000/20261001T150000');
    assert.ok(googleCalendarUrl(taskToCalendarEvent(allDay), 'From note').endsWith('dates=20261003/20261004&details=From%20note'));
});
