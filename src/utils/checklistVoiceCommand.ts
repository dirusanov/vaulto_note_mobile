/**
 * Local fallback for a spoken "tick this item" when the voice agent treated the
 * recording as dictation: if the phrase names an unchecked checklist item and
 * clearly says it is done ("купил молоко", "отметь молоко", "mark milk done"),
 * that item is checked. Anything else (a negation, a question, or a plain
 * mention of the item) leaves the list alone and the phrase is dictated.
 *
 * Pure, so it can be unit tested (tests/checklistVoiceCommand.test.cjs).
 */
import { isRichHtmlContent, richContentToAgentMarkdown } from './richContent';

const CHECKLIST_MUTABLE_LINE_REGEX = /^(\s*[-*]\s*)\[(?:([ xX]))?\](\s*)(.*)$/;
const RICH_TASK_ITEM_BLOCK_REGEX = /<li\b(?=[^>]*data-type=(["'])taskItem\1)[^>]*>[\s\S]*?<\/li>/gi;
const RICH_CHECKBOX_INPUT_TAG_REGEX = /<input\b(?=[^>]*type=(["'])checkbox\1)[^>]*>/i;
const RICH_DATA_CHECKED_ATTR_REGEX = /data-checked=(["'])(true|false)\1/i;
const RICH_BOOLEAN_CHECKED_ATTR_REGEX = /\schecked(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?/i;

export const normalizeChecklistCommandText = (value: string): string =>
    value
        .toLocaleLowerCase()
        .replace(/ /g, ' ')
        .replace(/[‘’ʼ]/g, "'")
        .replace(/\s+/g, ' ')
        .trim();

export type ParsedChecklistItem = {
    checked: boolean;
    text: string;
};

export const parseChecklistLineForCommandFallback = (line: string): ParsedChecklistItem | null => {
    const match = line.match(CHECKLIST_MUTABLE_LINE_REGEX);
    if (!match) return null;

    const text = normalizeChecklistCommandText(match[4] || '');
    if (!text) return null;

    return {
        checked: typeof match[2] === 'string' && match[2].toLowerCase() === 'x',
        text,
    };
};

export const parseChecklistItemsForCommandFallback = (content: string): ParsedChecklistItem[] => {
    if (!content) return [];

    if (!isRichHtmlContent(content)) {
        return (content || '')
            .split(/\r?\n/)
            .map(parseChecklistLineForCommandFallback)
            .filter((item): item is ParsedChecklistItem => !!item);
    }

    return Array.from(content.matchAll(RICH_TASK_ITEM_BLOCK_REGEX))
        .map((match) => parseChecklistLineForCommandFallback(richContentToAgentMarkdown(match[0])))
        .filter((item): item is ParsedChecklistItem => !!item);
};

const updateMarkdownChecklistItemsCheckedPreservingFormat = (
    content: string,
    itemTextsToCheck: Set<string>,
): string | null => {
    if (!content || itemTextsToCheck.size === 0) return null;

    let changed = false;
    const nextContent = content.replace(/^(\s*[-*]\s*)\[(?:([ xX]))?\](\s*)(.*)$/gm, (line, prefix, marker, spacing, text) => {
        const normalizedItemText = normalizeChecklistCommandText(text || '');
        const isChecked = typeof marker === 'string' && marker.toLowerCase() === 'x';
        if (!normalizedItemText || isChecked || !itemTextsToCheck.has(normalizedItemText)) {
            return line;
        }

        changed = true;
        return `${prefix}[x]${spacing}${text}`;
    });

    return changed ? nextContent : null;
};

const setRichTaskItemCheckedState = (block: string, checked: boolean): string => {
    let nextBlock = block;

    if (RICH_DATA_CHECKED_ATTR_REGEX.test(nextBlock)) {
        nextBlock = nextBlock.replace(
            RICH_DATA_CHECKED_ATTR_REGEX,
            (_match, quote: string) => `data-checked=${quote}${checked ? 'true' : 'false'}${quote}`
        );
    } else {
        nextBlock = nextBlock.replace(/^<li\b/i, `<li data-checked="${checked ? 'true' : 'false'}"`);
    }

    nextBlock = nextBlock.replace(RICH_CHECKBOX_INPUT_TAG_REGEX, (inputTag) => {
        const hasCheckedAttr = RICH_BOOLEAN_CHECKED_ATTR_REGEX.test(inputTag);
        if (checked) {
            if (hasCheckedAttr) return inputTag;
            return inputTag.replace(/\/?>$/, (closing) => ` checked${closing}`);
        }

        return inputTag.replace(RICH_BOOLEAN_CHECKED_ATTR_REGEX, '');
    });

    return nextBlock;
};

const updateRichChecklistItemsCheckedPreservingFormat = (
    content: string,
    itemTextsToCheck: Set<string>,
): string | null => {
    if (!content || itemTextsToCheck.size === 0) return null;

    let changed = false;
    const nextContent = content.replace(RICH_TASK_ITEM_BLOCK_REGEX, (block) => {
        const parsedItem = parseChecklistLineForCommandFallback(richContentToAgentMarkdown(block));
        if (!parsedItem || parsedItem.checked || !itemTextsToCheck.has(parsedItem.text)) {
            return block;
        }

        const updatedBlock = setRichTaskItemCheckedState(block, true);
        changed = changed || updatedBlock !== block;
        return updatedBlock;
    });

    return changed ? nextContent : null;
};

// ---- Intent of the words around the item name --------------------------------

const WORD_REGEX = /[\p{L}\p{N}']+/gu;

/** "не купил", "ещё не", "пока не", "нет", "not", "don't", "haven't", "no". */
const NEGATION_WORDS = new Set([
    'не', 'нет', 'ни', 'нельзя', 'никогда',
    'not', 'no', 'never', 'nope', 'cannot', 'dont', 'didnt', 'havent', 'hasnt',
    'isnt', 'arent', 'wasnt', 'werent', 'wont', 'cant', 'doesnt', 'shouldnt', 'couldnt', 'wouldnt',
]);

/** Asking to take a tick away is not a reason to set one. */
const UNCHECK_WORD_REGEX = /^(?:un(?:check|mark|tick)\w*|сним\w*|снят\w*|снима\w*)$/;

const RU_QUESTION_WORDS = new Set([
    'ли', 'разве', 'неужели', 'что', 'когда', 'где', 'зачем', 'почему', 'как', 'кто',
    'сколько', 'какой', 'какая', 'какое', 'какие', 'куда', 'чей',
]);
const EN_QUESTION_OPENERS = new Set([
    'did', 'do', 'does', 'have', 'has', 'is', 'are', 'was', 'were', 'should', 'can',
    'could', 'would', 'will', 'what', 'when', 'where', 'why', 'how', 'who', 'which', 'whether',
]);

/** Words that say the item is done or ask to tick it. */
const RU_DONE_STEM_REGEX = /^(?:отмет|отмеч|помет|помеч|выполн|сделал|сделан|готов|купил|куплен|взял|забрал|закрыл|закрыт|закончил|законч|вычеркн|зачеркн|галочк|галк|оплатил|оплачен|отправил|отправлен|позвонил|сдал|завершил|заверш)/;
const EN_DONE_WORDS = new Set([
    'mark', 'marked', 'check', 'checked', 'tick', 'ticked', 'done', 'bought', 'completed',
    'complete', 'finished', 'finish', 'got', 'cross', 'crossed', 'picked', 'purchased',
    'paid', 'sent', 'called', 'did', 'ready',
]);

const wordsOf = (text: string): string[] =>
    (text.match(WORD_REGEX) || []).map((word) => word.replace(/'/g, ''));

const isNegationWord = (word: string): boolean => NEGATION_WORDS.has(word);

/**
 * Whether the words spoken around a checklist item ask to tick it.
 * `transcript` is the whole normalized phrase, `residual` the same phrase with
 * the item names taken out.
 */
export const isChecklistCheckIntent = (transcript: string, residual: string): boolean => {
    const normalized = normalizeChecklistCommandText(transcript);
    if (!normalized || normalized.includes('?') || normalized.includes('¿')) return false;

    const allWords = wordsOf(normalized);
    if (allWords.some((word) => isNegationWord(word) || UNCHECK_WORD_REGEX.test(word))) return false;
    if (allWords.some((word) => word === 'ли' || word === 'разве' || word === 'неужели')) return false;
    const first = allWords[0] || '';
    if (RU_QUESTION_WORDS.has(first) || EN_QUESTION_OPENERS.has(first)) return false;

    const residualWords = wordsOf(normalizeChecklistCommandText(residual));
    return residualWords.some((word) => RU_DONE_STEM_REGEX.test(word) || EN_DONE_WORDS.has(word));
};

/**
 * The content with the unchecked items the phrase names ticked, or null when
 * the phrase is not a tick command (then it is dictated as usual).
 */
export const resolveDirectChecklistCheckFallback = (content: string, transcript: string): string | null => {
    const normalizedTranscript = normalizeChecklistCommandText(transcript);
    if (!normalizedTranscript) return null;

    const items = parseChecklistItemsForCommandFallback(content);
    if (items.length === 0) return null;

    const directlyMentionedUncheckedItems = items.filter((item) => (
        !item.checked &&
        item.text.length >= 2 &&
        normalizedTranscript.includes(item.text)
    ));
    if (directlyMentionedUncheckedItems.length === 0) return null;

    let residualIntent = normalizedTranscript;
    directlyMentionedUncheckedItems
        .slice()
        .sort((left, right) => right.text.length - left.text.length)
        .forEach((item) => {
            residualIntent = residualIntent.replace(item.text, ' ');
        });
    residualIntent = residualIntent
        .replace(/[.,!;:()[\]{}"`/\\+-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!residualIntent || !isChecklistCheckIntent(normalizedTranscript, residualIntent)) {
        return null;
    }

    const itemTextsToCheck = new Set(directlyMentionedUncheckedItems.map((item) => item.text));
    return isRichHtmlContent(content)
        ? updateRichChecklistItemsCheckedPreservingFormat(content, itemTextsToCheck)
        : updateMarkdownChecklistItemsCheckedPreservingFormat(content, itemTextsToCheck);
};
