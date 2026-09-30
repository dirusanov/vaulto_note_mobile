/**
 * "Find tasks": the model returns action items as JSON; everything around that
 * (prompt with today's date, tolerant parsing, dedupe against the note's own
 * checklist, checklist Markdown, calendar event times) lives here so it can be
 * tested without React Native.
 */

export interface ExtractedTask {
    id: string;
    title: string;
    /** Local calendar date, YYYY-MM-DD. */
    date: string | null;
    /** Local time, HH:MM (24h). Only meaningful with a date. */
    time: string | null;
}

export interface TaskCalendarEvent {
    title: string;
    startDate: Date;
    endDate: Date;
    allDay: boolean;
}

const MAX_TASKS = 15;
const DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_REGEX = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Same script ranges as noteSearch (no \p{…}: Hermes support is not assumed).
const WORD_REGEX = /[0-9A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]+/g;

const pad = (value: number): string => String(value).padStart(2, '0');

/** The device's local date (not UTC), so "today" matches what the user sees. */
export const localDateString = (date: Date): string =>
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export const buildTaskExtractionPrompt = (now: Date): string => [
    'Extract the actionable tasks (to-dos, commitments, things to buy, call, send, book or prepare) from the note.',
    `Today is ${WEEKDAYS[now.getDay()]}, ${localDateString(now)}. Resolve relative dates ("tomorrow", "on Thursday", "next week") to YYYY-MM-DD; a weekday means its next occurrence.`,
    'Return JSON only: {"tasks":[{"title":"...","date":"YYYY-MM-DD" or null,"time":"HH:MM" or null}]}.',
    'Titles: short imperative phrases in the language of the note, without the date. One task per action.',
    'Skip items already marked done ([x]), plain facts and ideas without an action. No tasks → {"tasks":[]}.',
    `At most ${MAX_TASKS} tasks. Never invent tasks, dates or times that are not in the note.`,
].join(' ');

const validDate = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const match = value.trim().match(DATE_REGEX);
    if (!match) return null;
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const probe = new Date(year, month - 1, day);
    return probe.getFullYear() === year && probe.getMonth() === month - 1 && probe.getDate() === day
        ? value.trim()
        : null;
};

const validTime = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const match = value.trim().match(TIME_REGEX);
    return match ? `${pad(Number(match[1]))}:${match[2]}` : null;
};

const normalizeTitle = (title: string): string =>
    (title.toLowerCase().replace(/ё/g, 'е').match(WORD_REGEX) || []).join(' ');

/** Tolerates code fences, prose around the JSON and a bare array. */
export const parseExtractedTasks = (raw: string): ExtractedTask[] => {
    const text = (raw || '').replace(/```(?:json)?/gi, '').trim();
    let parsed: unknown = null;
    const candidates = [text, text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1), text.slice(text.indexOf('['), text.lastIndexOf(']') + 1)];
    for (const candidate of candidates) {
        if (!candidate) continue;
        try {
            parsed = JSON.parse(candidate);
            break;
        } catch {
            // try the next shape
        }
    }
    const list = Array.isArray(parsed) ? parsed : (parsed as { tasks?: unknown } | null)?.tasks;
    if (!Array.isArray(list)) return [];

    const seen = new Set<string>();
    const tasks: ExtractedTask[] = [];
    for (const item of list) {
        const title = typeof item === 'string' ? item : (item as { title?: unknown })?.title;
        if (typeof title !== 'string') continue;
        const clean = title.replace(/^\s*(?:[-*•]\s*)?(?:\[[ xX]?\]\s*)?/, '').trim();
        const key = normalizeTitle(clean);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const date = validDate((item as { date?: unknown })?.date);
        tasks.push({
            id: `task-${tasks.length}`,
            title: clean,
            date,
            time: date ? validTime((item as { time?: unknown })?.time) : null,
        });
        if (tasks.length >= MAX_TASKS) break;
    }
    return tasks;
};

/** Checklist items already in the note (checked or not), normalized for comparison. */
export const checklistTitlesFromMarkdown = (markdown: string): Set<string> => {
    const titles = new Set<string>();
    for (const line of (markdown || '').split('\n')) {
        const match = line.match(/^\s*[-*+]\s+\[[ xX]\]\s+(.+)$/);
        // Items added by "Find tasks" carry " — <due>"; the title is what is compared.
        if (match) titles.add(normalizeTitle(match[1].split(' — ')[0]));
    }
    return titles;
};

export const isTaskInNote = (task: Pick<ExtractedTask, 'title'>, existing: Set<string>): boolean =>
    existing.has(normalizeTitle(task.title));

export const tasksToChecklistMarkdown = (
    tasks: ExtractedTask[],
    formatDue: (task: ExtractedTask) => string = (task) => [task.date, task.time].filter(Boolean).join(' '),
): string => tasks
    .map((task) => {
        const due = task.date ? formatDue(task) : '';
        const title = task.title.replace(/\s+/g, ' ');
        return `- [ ] ${due ? `${title} — ${due}` : title}`;
    })
    .join('\n');

/**
 * Event times for the system calendar editor, which lets the user adjust them:
 * a time gives a one-hour event, a date alone an all-day event, and no date
 * proposes tomorrow at 9:00.
 */
export const taskToCalendarEvent = (task: ExtractedTask, now: Date = new Date()): TaskCalendarEvent => {
    const dateMatch = task.date ? task.date.match(DATE_REGEX) : null;
    if (dateMatch) {
        const [year, month, day] = [Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3])];
        const timeMatch = task.time ? task.time.match(TIME_REGEX) : null;
        if (timeMatch) {
            const startDate = new Date(year, month, day, Number(timeMatch[1]), Number(timeMatch[2]));
            return { title: task.title, startDate, endDate: new Date(startDate.getTime() + 60 * 60 * 1000), allDay: false };
        }
        return { title: task.title, startDate: new Date(year, month, day), endDate: new Date(year, month, day + 1), allDay: true };
    }
    const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0);
    return { title: task.title, startDate, endDate: new Date(startDate.getTime() + 60 * 60 * 1000), allDay: false };
};

const compactDate = (date: Date): string => `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
const compactDateTime = (date: Date): string => `${compactDate(date)}T${pad(date.getHours())}${pad(date.getMinutes())}00`;

/** Web fallback when the native calendar editor is unavailable (floating local times). */
export const googleCalendarUrl = (event: TaskCalendarEvent, details = ''): string => {
    const dates = event.allDay
        ? `${compactDate(event.startDate)}/${compactDate(event.endDate)}`
        : `${compactDateTime(event.startDate)}/${compactDateTime(event.endDate)}`;
    const params = [`action=TEMPLATE`, `text=${encodeURIComponent(event.title)}`, `dates=${dates}`];
    if (details) params.push(`details=${encodeURIComponent(details)}`);
    return `https://calendar.google.com/calendar/render?${params.join('&')}`;
};
