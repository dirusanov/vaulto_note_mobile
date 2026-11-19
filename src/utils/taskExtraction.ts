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
    /**
     * The words of the note the task came from, as the model quoted them and
     * only when they are really in the note. Used to play the source phrase.
     */
    quote?: string | null;
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
    'Return JSON only: {"tasks":[{"title":"...","date":"YYYY-MM-DD" or null,"time":"HH:MM" or null,"quote":"..."}]}.',
    'Titles: short imperative phrases in the language of the note, without the date. One task per action. Use only words and details from the note: do not add synonyms, categories or extra items.',
    'quote: the exact words of the note that state this task, copied verbatim, including its deadline words if any.',
    'Skip items already marked done ([x]), and facts or ideas that nobody has to act on. No tasks → {"tasks":[]}.',
    'A negated, cancelled or postponed action is not a task ("don\'t schedule the call yet", "звонок пока не назначай", "no need to call").',
    'A date or time belongs to a task only if it was said for that task; otherwise null.',
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

const wordsOf = (text: string): string[] => text.toLowerCase().replace(/ё/g, 'е').match(WORD_REGEX) || [];
// Same crude stem as phraseTiming: "смету"/"смета", "sends"/"send".
const stem = (word: string): string => (word.length <= 4 ? word : word.slice(0, word.length === 5 ? 4 : 5));
const sourceStems = (source: string): Set<string> => new Set(wordsOf(source).map(stem));

/** Share of the quote's words that occur in the note (models paraphrase slightly). */
const quoteCoverage = (quote: string, stems: Set<string>): number => {
    const words = wordsOf(quote);
    if (!words.length) return 0;
    return words.filter((word) => stems.has(stem(word))).length / words.length;
};

/**
 * Drops list fragments the note never mentioned or that repeat the task
 * ("Buy milk, milk, dairy" from "buy milk" → "Buy milk", F-01). The first
 * fragment is the task itself and always stays.
 */
export const trimInventedTitleParts = (title: string, source: string): string => {
    const parts = title.split(/\s*,\s*/);
    if (parts.length < 2) return title;
    const stems = sourceStems(source);
    const seen = new Set(wordsOf(parts[0]).map(stem));
    const kept = [parts[0]];
    for (const part of parts.slice(1)) {
        const words = wordsOf(part).map(stem);
        if (!words.length) continue;
        const repeats = words.every((word) => seen.has(word));
        const invented = words.some((word) => !stems.has(word));
        if (repeats || invented) continue;
        words.forEach((word) => seen.add(word));
        kept.push(part);
    }
    return kept.join(', ');
};

// "не назначай", "пока не звони", "не надо звонить", "don't schedule", "no need to call".
// "Не забудь…" / "don't forget…" is a reminder to act, not a negation.
const NEGATION_PATTERNS: RegExp[] = [
    /(?:^|[^а-яё])не\s+(?:надо|нужно|стоит|будем|буду|станем|хочу|хотим|могу|можем)\s+([а-яё]+)/g,
    /(?:^|[^а-яё])не\s+(?!забу|забы|надо|нужно|стоит|будем|буду|станем|хочу|хотим|могу|можем|только|все|всё|очень|так|то\b)([а-яё]+)/g,
    /\b(?:don'?t|do not|doesn'?t|won'?t|will not|shouldn'?t|should not|never|no need to|not going to)\s+(?:need to\s+|have to\s+|yet\s+)?(?!forget\b)([a-z]+)/g,
];

/** Clauses with a negated verb, as [verb stem, clause words]. */
const negatedClauses = (source: string): Array<{ verb: string; words: Set<string> }> => {
    const result: Array<{ verb: string; words: Set<string> }> = [];
    const text = source.toLowerCase().replace(/ё/g, 'е').replace(/[’]/g, "'");
    for (const clause of text.split(/[.!?;,\n]+|\s(?:а|но|and|but)\s/)) {
        for (const pattern of NEGATION_PATTERNS) {
            pattern.lastIndex = 0;
            for (const match of clause.matchAll(pattern)) {
                result.push({ verb: stem(match[1]), words: new Set(wordsOf(clause).map(stem)) });
            }
        }
    }
    return result;
};

/**
 * A task built from a negated action ("звонок пока не назначай" → "Назначить
 * звонок"): its verb is negated in the note and the rest of the title (if any)
 * belongs to that same clause.
 */
export const isNegatedInSource = (title: string, source: string): boolean => {
    const titleStems = wordsOf(title).map(stem);
    if (!titleStems.length) return false;
    return negatedClauses(source).some(({ verb, words }) => {
        if (!titleStems.includes(verb)) return false;
        const rest = titleStems.filter((word) => word !== verb && word.length > 2);
        return rest.length === 0 || rest.some((word) => words.has(word));
    });
};

/** A task none of whose words occur in the note was made up. */
const groundedInSource = (title: string, stems: Set<string>): boolean => {
    const words = wordsOf(title).filter((word) => word.length > 2);
    if (words.length === 0 || words.some((word) => stems.has(stem(word)))) return true;
    // A title in another script than the note (a translated task) cannot be
    // compared word by word; only same-script titles are checked.
    const latin = /[a-z]/;
    const sourceHasLatin = Array.from(stems).some((word) => latin.test(word));
    return words.every((word) => latin.test(word)) !== sourceHasLatin;
};

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
    const stems = source === undefined ? null : sourceStems(source);
    for (const item of list) {
        const title = typeof item === 'string' ? item : (item as { title?: unknown })?.title;
        if (typeof title !== 'string') continue;
        let clean = title.replace(/^\s*(?:[-*•]\s*)?(?:\[[ xX]?\]\s*)?/, '').trim();
        if (source !== undefined && stems) {
            clean = trimInventedTitleParts(clean, source);
            if (!groundedInSource(clean, stems) || isNegatedInSource(clean, source)) continue;
        }
        const key = normalizeTitle(clean);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const rawQuote = (item as { quote?: unknown })?.quote;
        const quote = typeof rawQuote === 'string' && rawQuote.trim() && stems && quoteCoverage(rawQuote, stems) >= 0.6
            ? rawQuote.trim().slice(0, 400)
            : null;
        // With a quote, a date must be said in it: "…к пятнице, а звонок не
        // назначай" gives Friday to the estimate, not to the call.
        const dateEvidence = quote ?? source;
        const proposedDate = validDate((item as { date?: unknown })?.date);
        const date = proposedDate && (dateEvidence === undefined || dateOccursInSource(proposedDate, dateEvidence, now)) ? proposedDate : null;
        const proposedTime = validTime((item as { time?: unknown })?.time);
        tasks.push({
            id: `task-${tasks.length}`,
            title: clean,
            date,
            time: date && proposedTime && (dateEvidence === undefined || timeOccursInSource(proposedTime, dateEvidence)) ? proposedTime : null,
            quote,
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
