/**
 * On-device retrieval for "Ask your notes". Notes are end-to-end encrypted, so the
 * server cannot index them; ranking happens here and only the few best matches are
 * sent to the model as context. Deliberately dependency-free and language-agnostic:
 * a crude prefix stem copes with Russian/European inflection well enough.
 */

export interface SearchableNote {
    id: string;
    title: string;
    text: string;
    updatedAt?: string;
}

export interface RankedNote {
    id: string;
    score: number;
}

export interface NoteSource {
    index: number;
    id: string;
    title: string;
    excerpt: string;
}

// Letters and digits of the scripts the app ships in (no \p{…}: Hermes support is not assumed).
const WORD_REGEX = /[0-9A-Za-zÀ-ɏͰ-ϿЀ-ӿ֐-׿؀-ۿऀ-ॿ぀-ヿ㐀-䶿一-鿿가-힯]+/g;

const STOPWORDS = new Set([
    'the', 'and', 'for', 'what', 'when', 'where', 'who', 'how', 'did', 'does', 'was', 'were', 'are', 'about',
    'with', 'from', 'that', 'this', 'have', 'has', 'had', 'you', 'your', 'my', 'me', 'can', 'will', 'which', 'any', 'all',
    'что', 'как', 'где', 'когда', 'кто', 'это', 'для', 'про', 'или', 'мне', 'меня', 'мой', 'мои', 'моих', 'был', 'была',
    'были', 'есть', 'все', 'всё', 'какие', 'какой', 'какая', 'там', 'уже', 'еще', 'ещё', 'надо', 'нужно', 'мы', 'вы',
]);

const STEM_LENGTH = 5;

const stem = (word: string): string => (word.length > STEM_LENGTH + 1 ? word.slice(0, STEM_LENGTH) : word);

export const tokenize = (text: string): string[] =>
    ((text || '').toLowerCase().replace(/ё/g, 'е').match(WORD_REGEX) || []);

export const queryTerms = (question: string): string[] => {
    const terms = tokenize(question)
        .filter((word) => word.length >= 3 || /\d/.test(word))
        .filter((word) => !STOPWORDS.has(word))
        .map(stem);
    return Array.from(new Set(terms));
};

const countStemHits = (tokens: string[], term: string): number => {
    let hits = 0;
    for (const token of tokens) {
        if (token.startsWith(term)) hits += 1;
    }
    return hits;
};

/**
 * Notes ordered by relevance to the question. With no usable terms (or no match
 * at all) the most recently updated notes are returned, so broad questions like
 * "what did I do this week?" still get context.
 */
export const rankNotesForQuestion = (notes: SearchableNote[], question: string, limit = 6): RankedNote[] => {
    const terms = queryTerms(question);
    const byRecency = [...notes].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    if (terms.length === 0) {
        return byRecency.slice(0, limit).map((note) => ({ id: note.id, score: 0 }));
    }
    const scored = notes.map((note) => {
        const titleTokens = tokenize(note.title);
        const bodyTokens = tokenize(note.text);
        let score = 0;
        let matchedTerms = 0;
        for (const term of terms) {
            const titleHits = countStemHits(titleTokens, term);
            const bodyHits = Math.min(countStemHits(bodyTokens, term), 5);
            if (titleHits + bodyHits > 0) matchedTerms += 1;
            score += titleHits * 3 + bodyHits;
        }
        // Covering more of the question matters more than repeating one word.
        score *= 1 + matchedTerms / terms.length;
        return { id: note.id, score };
    });
    const matched = scored.filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score);
    if (matched.length === 0) {
        return byRecency.slice(0, limit).map((note) => ({ id: note.id, score: 0 }));
    }
    return matched.slice(0, limit);
};

/** The part of a note around its first match, so long notes still contribute the relevant bit. */
export const excerptForQuestion = (text: string, question: string, maxChars = 1500): string => {
    const clean = (text || '').replace(/\s+\n/g, '\n').trim();
    if (clean.length <= maxChars) return clean;
    const lower = clean.toLowerCase().replace(/ё/g, 'е');
    let first = -1;
    for (const term of queryTerms(question)) {
        const at = lower.indexOf(term);
        if (at >= 0 && (first < 0 || at < first)) first = at;
    }
    const start = first < 0 ? 0 : Math.max(0, first - Math.floor(maxChars / 4));
    const slice = clean.slice(start, start + maxChars);
    return `${start > 0 ? '… ' : ''}${slice}${start + maxChars < clean.length ? ' …' : ''}`;
};

/** Numbered sources within a total character budget (the model's context). */
export const buildNoteSources = (
    notes: SearchableNote[],
    question: string,
    { limit = 6, perNoteChars = 1500, totalChars = 7000 }: { limit?: number; perNoteChars?: number; totalChars?: number } = {},
): NoteSource[] => {
    const byId = new Map(notes.map((note) => [note.id, note]));
    const sources: NoteSource[] = [];
    let used = 0;
    for (const ranked of rankNotesForQuestion(notes, question, limit)) {
        const note = byId.get(ranked.id);
        if (!note) continue;
        const budget = Math.min(perNoteChars, totalChars - used);
        if (budget < 200) break;
        const excerpt = excerptForQuestion(note.text, question, budget);
        if (!excerpt) continue;
        sources.push({ index: sources.length + 1, id: note.id, title: note.title, excerpt });
        used += excerpt.length;
    }
    return sources;
};

export const formatSourcesForModel = (sources: NoteSource[]): string =>
    sources.map((source) => `[${source.index}] ${source.title || 'Untitled'}\n${source.excerpt}`).join('\n\n---\n\n');

const normalizeForMatch = (text: string): string => (text || '').toLowerCase().replace(/ё/g, 'е');

/**
 * Query words the list search looks for. A long word loses its last two letters so
 * inflected forms still match ("запуска" finds "запуск", "meetings" finds "meeting").
 */
export const listSearchTerms = (query: string): string[] =>
    Array.from(new Set(tokenize(query).map((word) => (word.length >= 6 ? word.slice(0, -2) : word))));

/**
 * The list search: every query word must occur somewhere in the note (title, text,
 * versions), in any order. Runs over decrypted plain text, never markup.
 */
export const matchesListQuery = (haystack: string, terms: string[]): boolean => {
    if (terms.length === 0) return true;
    const text = normalizeForMatch(haystack);
    return terms.every((term) => text.includes(term));
};
