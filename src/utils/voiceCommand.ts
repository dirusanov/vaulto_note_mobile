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
