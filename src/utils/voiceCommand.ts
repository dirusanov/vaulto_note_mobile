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
