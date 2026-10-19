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
    'Planned work with a deadline or an owner is a task too ("v2 ships on Thursday" → "Ship v2" on that date; "Anna owns QA" → "QA (Anna)").',
    `Today is ${WEEKDAYS[now.getDay()]}, ${localDateString(now)}. Resolve relative dates ("tomorrow", "on Thursday", "next week") to YYYY-MM-DD; a weekday means its next occurrence.`,
    'Return JSON only: {"tasks":[{"title":"...","date":"YYYY-MM-DD" or null,"time":"HH:MM" or null}]}.',
    'Titles: short imperative phrases in the language of the note, without the date. One task per action.',
    'Skip items already marked done ([x]), and facts or ideas that nobody has to act on. No tasks → {"tasks":[]}.',
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
export const parseExtractedTasks = (raw: string, source?: string, now: Date = new Date()): ExtractedTask[] => {
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
        const proposedDate = validDate((item as { date?: unknown })?.date);
        const date = proposedDate && (source === undefined || dateOccursInSource(proposedDate, source, now)) ? proposedDate : null;
        const proposedTime = validTime((item as { time?: unknown })?.time);
        tasks.push({
            id: `task-${tasks.length}`,
            title: clean,
            date,
            time: date && proposedTime && (source === undefined || timeOccursInSource(proposedTime, source)) ? proposedTime : null,
        });
        if (tasks.length >= MAX_TASKS) break;
    }
    return tasks;
};

// A model can invent a perfectly valid date from the prompt's "today" even for
// "Buy milk.". Accept only dates supported by recognizable source expressions.
// This guards scheduling metadata; task ownership/meaning still needs review.
const normalizedSource = (source: string): string => source.normalize('NFKC').toLowerCase();
const dateOccursInSource = (date: string, source: string, now: Date): boolean => {
    const text = normalizedSource(source);
    if (text.includes(date)) return true;
    for (const match of text.matchAll(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/g)) {
        if (`${match[3]}-${pad(Number(match[2]))}-${pad(Number(match[1]))}` === date) return true;
    }
    const addDays = (days: number): string => {
        const result = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        result.setDate(result.getDate() + days);
        return localDateString(result);
    };
    const relative: Array<[number, RegExp]> = [
        [2, /\bday after tomorrow\b|послезавтра|übermorgen|pasado mañana|après-demain|depois de amanhã|بعد غد|明後日|后天/],
        [1, /\btomorrow\b|(?:^|[^а-я])завтра(?![а-я])|\bmorgen\b|\bmañana\b|\bdemain\b|\bamanhã\b|غدًا|غدا|明日|明天/],
        [0, /\btoday\b|сегодня|\bheute\b|\bhoy\b|\baujourd'hui\b|\bhoje\b|اليوم|今日|今天/],
    ];
    // Remove the longer phrase before looking for its shorter "tomorrow" part.
    let remainder = text;
    for (const [days, pattern] of relative) {
        if (pattern.test(remainder)) {
            if (addDays(days) === date) return true;
            remainder = remainder.replace(new RegExp(pattern.source, 'g'), ' ');
        }
    }
    const weekdays = [
        /\bsunday\b|воскресень[еяю]|\bsonntag\b|\bdomingo\b|\bdimanche\b|الأحد|रविवार|日曜日|(?:周|星期)日|(?:周|星期)天/,
        /\bmonday\b|понедельник|\bmontag\b|\blunes\b|\blundi\b|\bsegunda-feira\b|الاثنين|सोमवार|月曜日|(?:周|星期)一/,
        /\btuesday\b|вторник|\bdienstag\b|\bmartes\b|\bmardi\b|\bterça-feira\b|الثلاثاء|मंगलवार|火曜日|(?:周|星期)二/,
        /\bwednesday\b|сред[ауеы]|\bmittwoch\b|\bmiércoles\b|\bmercredi\b|\bquarta-feira\b|الأربعاء|बुधवार|水曜日|(?:周|星期)三/,
        /\bthursday\b|четверг|\bdonnerstag\b|\bjueves\b|\bjeudi\b|\bquinta-feira\b|الخميس|गुरुवार|木曜日|(?:周|星期)四/,
        /\bfriday\b|пятниц[ауеы]|\bfreitag\b|\bviernes\b|\bvendredi\b|\bsexta-feira\b|الجمعة|शुक्रवार|金曜日|(?:周|星期)五/,
        /\bsaturday\b|суббот[ауеы]|\bsamstag\b|\bsábado\b|\bsamedi\b|السبت|शनिवार|土曜日|(?:周|星期)六/,
    ];
    return weekdays.some((pattern, day) => pattern.test(text) && addDays((day - now.getDay() + 7) % 7 || 7) === date);
};

const timeOccursInSource = (time: string, source: string): boolean => {
    const [hour, minute] = time.split(':').map(Number);
    return Array.from(normalizedSource(source).matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g))
        .some((match) => Number(match[1]) === hour && Number(match[2]) === minute);
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
