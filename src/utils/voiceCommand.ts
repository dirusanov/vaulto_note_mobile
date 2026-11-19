/**
 * Whether a transcript reads like a request to the app ("Добавь пункт: купить
 * кофе", "make a checklist") rather than note content. The voice agent decides
 * this properly; this guess is only used when the agent could not answer (AI limit,
 * server error), so a request that was not carried out is not pasted into the note
 * as text. It errs towards dictation: only short phrases that open with an
 * instruction verb count. Kept free of app imports so tests can load it.
 */

/** Requests are short; anything longer is dictation. */
const MAX_COMMAND_WORDS = 20;

/** Filler a request may start with ("please add…", "а теперь сделай…"). */
const LEADING_FILLER = new Set([
    'please', 'ok', 'okay', 'now', 'and', 'then', 'also', 'hey', 'vaulto',
    'пожалуйста', 'а', 'и', 'ну', 'теперь', 'так', 'ещё', 'еще', 'давай', 'слушай', 'окей',
    'bitte', 'jetzt', 'und', 'por', 'favor', 'ahora', 'y', 's\'il', 'te', 'plaît', 'maintenant', 'et', 'agora', 'e',
]);

/** Instruction verbs, as said to the app (imperative). Lowercase. */
const COMMAND_VERBS = new Set([
    // English
    'add', 'append', 'insert', 'put', 'make', 'create', 'turn', 'convert', 'format', 'reformat',
    'delete', 'remove', 'erase', 'clear', 'cross', 'check', 'tick', 'uncheck', 'mark',
    'rename', 'title', 'name', 'call', 'rewrite', 'fix', 'correct', 'shorten', 'summarize', 'summarise',
    'translate', 'replace', 'change', 'sort', 'organize', 'organise', 'structure', 'split', 'merge',
    // Russian
    'добавь', 'добавьте', 'допиши', 'впиши', 'вставь', 'запиши', 'сделай', 'сделайте', 'создай', 'составь',
    'преврати', 'оформи', 'отформатируй', 'удали', 'удалите', 'убери', 'сотри', 'очисти', 'вычеркни',
    'отметь', 'отметьте', 'зачеркни', 'сними', 'переименуй', 'назови', 'озаглавь', 'перепиши', 'исправь',
    'сократи', 'перескажи', 'переведи', 'замени', 'поменяй', 'измени', 'отсортируй', 'упорядочи',
    'структурируй', 'раздели', 'объедини', 'поставь',
    // German, Spanish, French, Portuguese (common forms)
    'füge', 'mach', 'mache', 'erstelle', 'lösche', 'entferne', 'markiere', 'benenne', 'übersetze', 'ersetze',
    'añade', 'agrega', 'haz', 'crea', 'borra', 'elimina', 'quita', 'marca', 'renombra', 'traduce', 'reemplaza',
    'ajoute', 'fais', 'crée', 'supprime', 'enlève', 'coche', 'renomme', 'traduis', 'remplace',
    'adiciona', 'acrescenta', 'faz', 'faça', 'cria', 'crie', 'apaga', 'remove', 'marque', 'renomeia', 'traduz', 'substitui',
]);

const words = (text: string): string[] =>
    text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];

export const looksLikeVoiceCommand = (transcript: string): boolean => {
    const all = words(transcript || '');
    if (all.length < 2 || all.length > MAX_COMMAND_WORDS) return false;
    let index = 0;
    while (index < all.length && index < 3 && LEADING_FILLER.has(all[index])) index += 1;
    return COMMAND_VERBS.has(all[index] ?? '');
};

// ─── On-device request gate ──────────────────────────────────────────────────
// The phone's small model only handles short requests (checklist, list, rename).
// It must never fire on plain dictation or on a negated request, so a phrase
// reaches it only when it plainly asks for one of those. Precision over recall:
// a request missed here is inserted as text and can be repeated; a dictation
// mistaken for a request would change the note.

/** The on-device agent looks at 2-40 words; longer is always dictation. */
export const DEVICE_COMMAND_MIN_WORDS = 2;
export const DEVICE_COMMAND_MAX_WORDS = 40;

/** Polite openings before the verb ("can you make…", "можешь сделать…"). */
const POLITE_OPENING = new Set([
    'can', 'could', 'would', 'will', 'you', 'pls', 'kindly',
    'можешь', 'можете', 'можно', 'мне', 'нам', 'быстро',
    'kannst', 'du', 'puedes', 'peux', 'tu', 'podes', 'pode', 'você',
]);

/** A negation before the request turns it into content ("не делай список", "don't rename it"). */
const NEGATIONS = new Set([
    'не', 'ни', 'нет', 'нельзя', 'никогда', 'незачем',
    'not', "don't", 'dont', "doesn't", "shouldn't", "won't", "can't", 'never', 'no', 'nothing',
    'nicht', 'kein', 'keine', 'nie', 'nunca', 'jamais', 'pas', 'ne', "n'", 'não', 'nao',
]);

/** Verbs that only ever rename ("переименуй в Отпуск", "rename to Budget"). */
const RENAME_VERBS = new Set([
    'rename', 'переименуй', 'переименовать', 'озаглавь', 'озаглавить', 'benenne', 'renombra', 'renomme', 'renomeia',
]);

/**
 * Verbs that rename only when the note is named as the object: "назови заметку
 * Отпуск", "name it Budget"; "назови три причины" is dictation.
 */
const NAMING_VERBS = new Set(['name', 'title', 'назови', 'назвать']);
const NOTE_OBJECTS = new Set(['note', 'it', 'this', 'заметку', 'запись', 'её', 'ее', 'это']);

/**
 * Verbs for what the phone's agent can do: make a list or checklist, add to
 * one, name the note. Ticking items off is handled by the editor itself, so
 * "check"/"mark" never reach the model ("Mark called…" is dictation).
 */
const DEVICE_VERBS = new Set([
    'make', 'create', 'turn', 'convert', 'format', 'reformat', 'organize', 'organise', 'structure', 'sort',
    'add', 'append', 'insert', 'put', 'rename', 'name', 'title',
    'сделай', 'сделайте', 'создай', 'составь', 'преврати', 'оформи', 'отформатируй', 'структурируй',
    'упорядочи', 'отсортируй', 'добавь', 'добавьте', 'допиши', 'впиши', 'вставь', 'переименуй', 'назови', 'озаглавь',
    'mach', 'mache', 'erstelle', 'füge', 'benenne', 'haz', 'crea', 'añade', 'agrega', 'renombra',
    'fais', 'crée', 'ajoute', 'renomme', 'faz', 'faça', 'cria', 'crie', 'adiciona', 'acrescenta', 'renomeia',
]);

/**
 * Russian asks politely with an infinitive ("можешь сделать список"); on its
 * own an infinitive is a to-do line ("Составить список вещей"), so it counts
 * only right after "можешь/можете/можно".
 */
const POLITE_INFINITIVES = new Set([
    'сделать', 'создать', 'составить', 'превратить', 'оформить', 'добавить', 'дописать', 'вписать',
    'вставить', 'переименовать', 'назвать', 'озаглавить', 'структурировать', 'упорядочить', 'отсортировать',
]);
const POLITE_MODALS = new Set(['можешь', 'можете', 'можно']);

/** Set phrases that open with a request verb but are not requests ("make sure", "сделай так, чтобы"). */
const NOT_A_REQUEST_AFTER: Record<string, ReadonlySet<string>> = {
    make: new Set(['sure', 'certain', 'time', 'up', 'sense', 'money', 'friends']),
    turn: new Set(['left', 'right', 'off', 'on', 'around', 'back', 'down', 'up']),
    put: new Set(['on', 'off', 'away', 'up', 'down']),
    сделай: new Set(['так', 'вид']),
    сделайте: new Set(['так', 'вид']),
};

/** Verbs that add to an existing list ("добавь молоко" in a shopping list). */
const ADD_VERBS = new Set([
    'add', 'append', 'insert', 'put', 'добавь', 'добавьте', 'допиши', 'впиши', 'вставь',
    'добавить', 'дописать', 'вписать', 'вставить',
    'füge', 'añade', 'agrega', 'ajoute', 'adiciona', 'acrescenta',
]);

/** Words after the verb that make it about a list or the note's name. */
const TARGET_STEMS = [
    'checklist', 'check-list', 'list', 'todo', 'to-do', 'task', 'item', 'bullet',
    'чек-лист', 'чеклист', 'список', 'списк', 'пункт', 'задач', 'перечень',
    'liste', 'aufgabe', 'punkt', 'lista', 'tarea', 'tâche', 'tarefa',
    'title', 'heading', 'заголов', 'назван',
    'titel', 'título', 'titulo', 'titre',
];

const NOTE_HAS_LIST = /(^|\n)\s*(?:[-*•]|\d+[.)])\s+\S|\[[ xX]\]|data-type="taskItem"|<li[\s>]/;

export type DeviceCommandGate =
    | 'ok'
    | 'length'
    | 'no_request'
    | 'negated'
    | 'no_target';

/**
 * Whether a transcript may go to the on-device agent at all. Without the note
 * (only the words are known yet) an add-request counts as a candidate; with the
 * note it needs a list there to add to.
 */
export const deviceCommandGate = (transcript: string, currentContent?: string): DeviceCommandGate => {
    const all = (transcript || '').toLowerCase().match(/[\p{L}\p{N}'’-]+/gu)?.map((w) => w.replace(/’/g, "'")) ?? [];
    if (all.length < DEVICE_COMMAND_MIN_WORDS || all.length > DEVICE_COMMAND_MAX_WORDS) return 'length';
    let index = 0;
    // The request opens the phrase: a few filler or polite words at most.
    while (index < all.length && index < 4 && (LEADING_FILLER.has(all[index]) || POLITE_OPENING.has(all[index]))) {
        index += 1;
    }
    const verb = all[index] ?? '';
    if (NEGATIONS.has(verb) || NEGATIONS.has(all[index + 1] ?? '')) return 'negated';
    if (all.slice(0, index).some((w) => NEGATIONS.has(w))) return 'negated';
    const politeInfinitive = POLITE_INFINITIVES.has(verb) && POLITE_MODALS.has(all[index - 1] ?? '');
    if (!DEVICE_VERBS.has(verb) && !politeInfinitive) return 'no_request';
    const rest = all.slice(index + 1);
    if (NOT_A_REQUEST_AFTER[verb]?.has(rest[0] ?? '')) return 'no_request';
    if (RENAME_VERBS.has(verb)) return 'ok';
    if (NAMING_VERBS.has(verb)) {
        const object = rest[0] === 'the' || (rest[0] === 'this' && rest[1] === 'note') ? rest[1] : rest[0];
        return NOTE_OBJECTS.has(object ?? '') && rest.length >= 2 ? 'ok' : 'no_target';
    }
    if (hasStem(rest, TARGET_STEMS)) return 'ok';
    if (ADD_VERBS.has(verb) && (currentContent === undefined || NOTE_HAS_LIST.test(currentContent))) return 'ok';
    return 'no_target';
};

export const isDeviceCommandCandidate = (transcript: string, currentContent?: string): boolean =>
    deviceCommandGate(transcript, currentContent) === 'ok';

/**
 * Whether to tell someone without voice AI (a guest with no on-device model
 * ready) that what they just dictated reads like a request the AI could carry
 * out. Their words still go into the note as text; this only decides the one
 * calm hint per session.
 */
export const shouldHintAiForRequest = (options: {
    transcript: string;
    signedIn: boolean;
    /** A voice agent (cloud or on-device) handled this recording. */
    agentAvailable: boolean;
    alreadyHinted: boolean;
}): boolean =>
    !options.signedIn
    && !options.agentAvailable
    && !options.alreadyHinted
    && looksLikeVoiceCommand(options.transcript);

export type VoiceRequestKind = 'checklist' | 'title' | 'edit';

/** Words that make a request about the note's title (stems, lowercase). */
const TITLE_STEMS = [
    'title', 'rename', 'name', 'heading',
    'заголов', 'назов', 'назв', 'назови', 'переименуй', 'озаглавь',
    'titel', 'überschrift', 'benenne', 'título', 'titulo', 'renombra', 'titre', 'renomme', 'nome', 'renomeia',
];

/** Words that make a request about a list or its items (stems, lowercase). */
const CHECKLIST_STEMS = [
    'checklist', 'list', 'todo', 'to-do', 'item', 'task', 'tick', 'check', 'cross', 'mark',
    'чек-лист', 'чеклист', 'список', 'пункт', 'задач', 'отметь', 'вычеркни', 'зачеркни', 'галочк',
    'liste', 'punkt', 'aufgabe', 'lista', 'tarea', 'elemento', 'tâche', 'élément', 'coche', 'tarefa', 'marque',
];

const hasStem = (all: string[], stems: string[]): boolean =>
    all.some((word) => stems.some((stem) => word.startsWith(stem)));

/**
 * What a request is about, so the sign-in hint can name what the AI would do
 * with it: a title, a checklist, or another change to the note.
 */
export const voiceRequestKind = (transcript: string): VoiceRequestKind => {
    const all = (transcript || '').toLowerCase().match(/[\p{L}\p{N}'-]+/gu) ?? [];
    if (hasStem(all, TITLE_STEMS)) return 'title';
    if (hasStem(all, CHECKLIST_STEMS)) return 'checklist';
    return 'edit';
};
