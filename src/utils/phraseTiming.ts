/**
 * "Phrase → sound": when each phrase of a recording was said, and which
 * phrases of a note's current text still match it.
 *
 * A recording keeps a small timing map: the phrases of its transcript with
 * their start and end in seconds. Nothing in it points into the note text by
 * position, so editing the note cannot make a link point somewhere else: at
 * display time every sentence of the current text is compared with the
 * recorded phrases, and only a sentence that still says (almost) the same
 * thing is linked. A rewritten sentence simply has no link.
 *
 * Pure functions only, so the alignment can be tested without React Native.
 */

/** A stretch of audio with its recognised text (whisper segment, API segment). */
export interface TimedSegment {
    /** Seconds from the start of the recording. */
    start: number;
    end: number;
    text: string;
}

/** One phrase of the authoritative transcript with the time it was said. */
export interface TimedPhrase {
    text: string;
    start: number;
    end: number;
}

/**
 * - `device`: whisper on the phone; its segments are the transcript itself.
 * - `cloud`: the server returned segments for the same text.
 * - `aligned`: segments came from a second, timing-only pass whose wording may
 *   differ; times were carried over word by word, so they are close, not exact.
 */
export type TimingSource = 'device' | 'cloud' | 'aligned';

export interface RecordingTimings {
    v: 1;
    source: TimingSource;
    phrases: TimedPhrase[];
}

export interface PhraseLink {
    recordingId: string;
    start: number;
    end: number;
}

export interface LinkedPhrase {
    /** Stable within one rendering: index of the sentence in the text. */
    key: string;
    text: string;
    /** Character offsets of the sentence in the linked text. */
    from: number;
    to: number;
    link: PhraseLink | null;
}

export interface TimingSourceRecording {
    recordingId: string;
    timings: RecordingTimings;
}

// Same script ranges as noteSearch / taskExtraction (Hermes: no \p{…}).
const WORD_REGEX = /[0-9A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]+/g;

/** Starts a phrase slightly early: a word's estimated start is never exact. */
export const PHRASE_PREROLL_SECONDS = 0.25;

const MAX_PHRASES = 4000;
const MAX_PHRASE_CHARS = 600;

interface Token {
    word: string;
    stem: string;
    from: number;
    to: number;
}

const normalizeWord = (word: string): string => word.toLowerCase().replace(/ё/g, 'е');

/**
 * A crude, language-agnostic stem: enough for "смета"/"смету" or
 * "send"/"sends", and harmless elsewhere (comparisons are on many words).
 */
export const stemOf = (word: string): string => {
    const normalized = normalizeWord(word);
    if (normalized.length <= 4) return normalized;
    return normalized.slice(0, normalized.length === 5 ? 4 : 5);
};

export const tokenize = (text: string): Token[] => {
    const tokens: Token[] = [];
    for (const match of (text || '').matchAll(WORD_REGEX)) {
        const index = match.index ?? 0;
        tokens.push({ word: normalizeWord(match[0]), stem: stemOf(match[0]), from: index, to: index + match[0].length });
    }
    return tokens;
};

const HAS_WORD = new RegExp(WORD_REGEX.source);

const SENTENCE_END = /[.!?…。！？]+["»”')\]]*(?=\s|$)|\n+/g;

type Span = { text: string; from: number; to: number };

const countWords = (text: string): number => (text.match(WORD_REGEX) || []).length;
/** Longer sentences are split at clause punctuation into phrases of a few words. */
const LONG_SENTENCE_WORDS = 14;
const MIN_PHRASE_WORDS = 4;
const CLAUSE_END = /[,;:—–]+(?=\s)/g;

/**
 * Splits a long run-on sentence (speech recognisers often write a whole
 * minute as one sentence with commas) at its commas, keeping every piece at
 * least a few words long so it stays recognisable.
 */
const splitLongSentence = (sentence: Span): Span[] => {
    if (countWords(sentence.text) <= LONG_SENTENCE_WORDS) return [sentence];
    const pieces: Span[] = [];
    let start = 0;
    const cuts = Array.from(sentence.text.matchAll(CLAUSE_END)).map((match) => (match.index ?? 0) + match[0].length);
    for (const cut of [...cuts, sentence.text.length]) {
        const chunk = sentence.text.slice(start, cut);
        const remaining = sentence.text.slice(cut);
        if (cut < sentence.text.length && (countWords(chunk) < MIN_PHRASE_WORDS || countWords(remaining) < MIN_PHRASE_WORDS)) continue;
        const lead = chunk.length - chunk.replace(/^\s+/, '').length;
        const trimmed = chunk.trim();
        if (trimmed) pieces.push({ text: trimmed, from: sentence.from + start + lead, to: sentence.from + start + lead + trimmed.length });
        start = cut;
    }
    return pieces.length ? pieces : [sentence];
};

/**
 * Phrases of a text with their offsets: sentences, with line breaks ending a
 * sentence too (a checklist item or heading is its own phrase), and long
 * sentences split at commas.
 */
export const splitSentences = (text: string): Span[] => {
    const source = text || '';
    const sentences: Span[] = [];
    let start = 0;
    const push = (end: number) => {
        const raw = source.slice(start, end);
        const lead = raw.length - raw.replace(/^\s+/, '').length;
        const trimmed = raw.trim();
        if (trimmed && HAS_WORD.test(trimmed)) {
            sentences.push(...splitLongSentence({ text: trimmed, from: start + lead, to: start + lead + trimmed.length }));
        }
    };
    for (const match of source.matchAll(SENTENCE_END)) {
        const end = (match.index ?? 0) + match[0].length;
        push(end);
        start = end;
    }
    push(source.length);
    return sentences;
};

interface TimedWord {
    stem: string;
    word: string;
    start: number;
    end: number;
}

/** Spreads each segment's time over its words in proportion to their length. */
const timedWords = (segments: TimedSegment[]): TimedWord[] => {
    const words: TimedWord[] = [];
    for (const segment of segments) {
        const tokens = tokenize(segment.text);
        if (!tokens.length) continue;
        const duration = Math.max(0, segment.end - segment.start);
        const weights = tokens.map((token) => token.word.length + 1);
        const total = weights.reduce((sum, weight) => sum + weight, 0);
        let elapsed = 0;
        tokens.forEach((token, index) => {
            const start = segment.start + (duration * elapsed) / total;
            elapsed += weights[index];
            words.push({ stem: token.stem, word: token.word, start, end: segment.start + (duration * elapsed) / total });
        });
    }
    return words;
};

const ALIGN_WINDOW = 12;

/**
 * Monotonic word alignment of `tokens` onto `stream`: each text word takes the
 * nearest unused equal word ahead (exact first, then same stem). Words the
 * timing pass did not hear stay unmatched.
 */
const alignTokens = (tokens: Token[], stream: TimedWord[]): Array<TimedWord | null> => {
    const result: Array<TimedWord | null> = [];
    let cursor = 0;
    for (const token of tokens) {
        let found = -1;
        const limit = Math.min(stream.length, cursor + ALIGN_WINDOW);
        for (let index = cursor; index < limit && found < 0; index += 1) {
            if (stream[index].word === token.word) found = index;
        }
        for (let index = cursor; index < limit && found < 0; index += 1) {
            if (stream[index].stem === token.stem) found = index;
        }
        if (found >= 0) {
            result.push(stream[found]);
            cursor = found + 1;
        } else {
            result.push(null);
        }
    }
    return result;
};

const round = (value: number): number => Math.round(value * 100) / 100;

const validSegments = (segments: TimedSegment[]): TimedSegment[] => (segments || [])
    .filter((segment) => segment
        && typeof segment.text === 'string'
        && Number.isFinite(segment.start)
        && Number.isFinite(segment.end)
        && segment.start >= 0
        && segment.end >= segment.start)
    .sort((a, b) => a.start - b.start);

/**
 * Timing map for the authoritative transcript `text` from timed `segments`.
 * The segments may come from a different pass with slightly different
 * wording: times are carried over by word alignment, and a sentence with too
 * few recognised words gets no timing at all (no link beats a wrong one).
 */
export const buildRecordingTimings = (
    text: string,
    segments: TimedSegment[],
    source: TimingSource,
): RecordingTimings | null => {
    const clean = validSegments(segments);
    if (!text || !text.trim() || clean.length === 0) return null;
    const stream = timedWords(clean);
    if (!stream.length) return null;
    const tokens = tokenize(text);
    const aligned = alignTokens(tokens, stream);

    const phrases: TimedPhrase[] = [];
    let tokenIndex = 0;
    for (const sentence of splitSentences(text)) {
        const sentenceWords: Array<TimedWord | null> = [];
        while (tokenIndex < tokens.length && tokens[tokenIndex].from < sentence.to) {
            if (tokens[tokenIndex].from >= sentence.from) sentenceWords.push(aligned[tokenIndex]);
            tokenIndex += 1;
        }
        const matched = sentenceWords.filter((word): word is TimedWord => word !== null);
        if (!sentenceWords.length || matched.length / sentenceWords.length < 0.5) continue;
        // The first words carry the start: a sentence whose opening was not
        // heard starts at its first heard word, estimated back by word count.
        const firstIndex = sentenceWords.findIndex((word) => word !== null);
        const first = sentenceWords[firstIndex] as TimedWord;
        const perWord = Math.max(0.15, (first.end - first.start));
        const start = Math.max(0, first.start - firstIndex * perWord);
        const end = Math.max(start, ...matched.map((word) => word.end));
        const previous = phrases[phrases.length - 1];
        phrases.push({
            text: sentence.text.slice(0, MAX_PHRASE_CHARS),
            start: round(previous ? Math.max(previous.start, start) : start),
            end: round(end),
        });
        if (phrases.length >= MAX_PHRASES) break;
    }
    return phrases.length ? { v: 1, source, phrases } : null;
};

/** Shifts segments of a meeting part to the position of that part in the whole recording. */
export const offsetSegments = (segments: TimedSegment[], offsetSeconds: number): TimedSegment[] =>
    validSegments(segments).map((segment) => ({
        ...segment,
        start: segment.start + offsetSeconds,
        end: segment.end + offsetSeconds,
    }));

/**
 * Joins the timed segments of consecutive meeting parts. A part with unknown
 * length makes every later offset unknowable, so timing stops there rather
 * than drifting: the remaining phrases just have no link.
 */
export const joinPartSegments = (
    parts: Array<{ segments?: TimedSegment[] | null; durationSeconds?: number | null }>,
): TimedSegment[] => {
    const joined: TimedSegment[] = [];
    let offset = 0;
    for (const part of parts) {
        if (part.segments?.length) joined.push(...offsetSegments(part.segments, offset));
        const length = part.durationSeconds;
        if (typeof length !== 'number' || !Number.isFinite(length) || length <= 0) break;
        offset += length;
    }
    return joined;
};

/**
 * Timing map (serialized) for a finished transcription, or undefined when the
 * transcriber gave no usable timestamps. Meeting parts are joined first.
 */
export const timingsFromTranscription = (
    text: string,
    result: {
        segments?: TimedSegment[];
        segmentsSource?: TimingSource;
        parts?: Array<{ segments?: TimedSegment[]; segmentsSource?: TimingSource; durationSeconds?: number }>;
    },
): string | undefined => {
    const parts = result.parts && result.parts.length > 1 ? result.parts : null;
    const segments = parts ? joinPartSegments(parts) : (result.segments || result.parts?.[0]?.segments || []);
    const sources = parts ? parts.map((part) => part.segmentsSource) : [result.segmentsSource ?? result.parts?.[0]?.segmentsSource];
    const source: TimingSource = sources.includes('aligned') ? 'aligned' : sources.includes('cloud') ? 'cloud' : 'device';
    return serializeTimings(buildRecordingTimings(text, segments, source));
};

export const serializeTimings = (timings: RecordingTimings | null | undefined): string | undefined =>
    timings && timings.phrases.length ? JSON.stringify(timings) : undefined;

/** Tolerant reader: anything unexpected (old notes, damaged data) is just "no timings". */
export const parseTimings = (raw: string | null | undefined): RecordingTimings | null => {
    if (!raw || typeof raw !== 'string') return null;
    try {
        const value = JSON.parse(raw) as Partial<RecordingTimings>;
        if (!value || value.v !== 1 || !Array.isArray(value.phrases)) return null;
        const source: TimingSource = value.source === 'cloud' || value.source === 'aligned' ? value.source : 'device';
        const phrases = value.phrases
            .filter((phrase): phrase is TimedPhrase => !!phrase
                && typeof phrase.text === 'string'
                && !!phrase.text.trim()
                && Number.isFinite(phrase.start)
                && Number.isFinite(phrase.end)
                && phrase.start >= 0
                && phrase.end >= phrase.start)
            .slice(0, MAX_PHRASES);
        return phrases.length ? { v: 1, source, phrases } : null;
    } catch {
        return null;
    }
};

const stemCounts = (tokens: Token[]): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const token of tokens) counts.set(token.stem, (counts.get(token.stem) || 0) + 1);
    return counts;
};

const overlap = (a: Map<string, number>, b: Map<string, number>): number => {
    let shared = 0;
    a.forEach((count, stem) => { shared += Math.min(count, b.get(stem) || 0); });
    return shared;
};

const sizeOf = (counts: Map<string, number>): number => {
    let size = 0;
    counts.forEach((count) => { size += count; });
    return size;
};

interface Shape {
    exact: string;
    counts: Map<string, number>;
    size: number;
    stems: string[];
}

const shapeOf = (text: string): Shape => {
    const tokens = tokenize(text);
    const counts = stemCounts(tokens);
    return { exact: tokens.map((token) => token.word).join(' '), counts, size: tokens.length, stems: tokens.map((token) => token.stem) };
};

/** A sentence must be this long, and this much of it in order, to be found inside a longer phrase. */
const MIN_CONTAINED_WORDS = 4;
const CONTAINED_SHARE = 0.85;

/**
 * Where a sentence sits inside a longer recorded phrase (the note split a
 * long recognised sentence differently), as a share of the phrase's words.
 */
const containedRun = (sentence: Shape, phrase: Shape): { from: number; to: number } | null => {
    if (sentence.size < MIN_CONTAINED_WORDS || phrase.size <= sentence.size) return null;
    let best: { at: number; hits: number } | null = null;
    for (let at = 0; at + sentence.size <= phrase.size; at += 1) {
        let hits = 0;
        for (let k = 0; k < sentence.size; k += 1) {
            if (phrase.stems[at + k] === sentence.stems[k]) hits += 1;
        }
        if (!best || hits > best.hits) best = { at, hits };
    }
    if (!best || best.hits / sentence.size < CONTAINED_SHARE) return null;
    return { from: best.at / phrase.size, to: (best.at + sentence.size) / phrase.size };
};

const scoreShapes = (a: Shape, b: Shape): number => {
    if (!a.size || !b.size) return 0;
    if (a.exact === b.exact) return 1;
    // Short sentences ("Okay.") must match exactly: a loose match there would
    // point to an arbitrary place.
    if (a.size < 4 || b.size < 4) return 0;
    return (2 * overlap(a.counts, b.counts)) / (a.size + b.size);
};

/** How well a sentence of the note still matches a recorded phrase, 0..1. */
export const phraseMatchScore = (sentence: string, phrase: string): number =>
    scoreShapes(shapeOf(sentence), shapeOf(phrase));

/** At or above this a sentence is the recorded phrase, lightly edited. */
export const LINK_THRESHOLD = 0.75;
// Dice >= 0.75 is impossible when one side has under 0.6x the words of the other.
const SIZE_RATIO = 0.6;

interface Candidate {
    recordingId: string;
    order: number;
    phrase: TimedPhrase;
    shape: Shape;
}

/**
 * Links each sentence of `text` to the recorded phrase it still matches.
 * Prefers the next phrase after the previous link (transcripts are read in
 * order, and a repeated "Okay." should not jump back), and uses a phrase once
 * while another candidate is left.
 */
export const linkTextToRecordings = (text: string, sources: TimingSourceRecording[]): LinkedPhrase[] => {
    const sentences = splitSentences(text);
    const candidates: Candidate[] = [];
    for (const source of sources) {
        source.timings.phrases.forEach((phrase, order) => candidates.push({
            recordingId: source.recordingId, order, phrase, shape: shapeOf(phrase.text),
        }));
    }
    const used = new Set<Candidate>();
    let previous: Candidate | null = null;
    return sentences.map((sentence, index) => {
        let best: { candidate: Candidate; score: number; part?: { from: number; to: number } } | null = null;
        const shape = shapeOf(sentence.text);
        for (const candidate of candidates) {
            const part = containedRun(shape, candidate.shape);
            if (part) {
                // Part of a longer recorded phrase: its time is estimated by word position.
                const score = 0.8 + (previous && candidate.recordingId === previous.recordingId && candidate.order >= previous.order ? 0.01 : 0);
                if (!best || score > best.score) best = { candidate, score, part };
                continue;
            }
            const sizes = [shape.size, candidate.shape.size];
            if (Math.min(...sizes) < SIZE_RATIO * Math.max(...sizes)) continue;
            let score = scoreShapes(shape, candidate.shape);
            if (score < LINK_THRESHOLD) continue;
            // Tie-breakers stay below the gap between real scores.
            if (!used.has(candidate)) score += 0.02;
            if (previous && candidate.recordingId === previous.recordingId && candidate.order > previous.order) score += 0.01;
            if (!best || score > best.score) best = { candidate, score };
        }
        if (best) {
            used.add(best.candidate);
            previous = best.candidate;
        }
        let link: PhraseLink | null = null;
        if (best) {
            const { phrase } = best.candidate;
            const span = phrase.end - phrase.start;
            link = best.part
                ? {
                    recordingId: best.candidate.recordingId,
                    start: round(phrase.start + span * best.part.from),
                    end: round(phrase.start + span * best.part.to),
                }
                : { recordingId: best.candidate.recordingId, start: phrase.start, end: phrase.end };
        }
        return { key: `p${index}`, text: sentence.text, from: sentence.from, to: sentence.to, link };
    });
};

/**
 * The linked sentence that holds a quote (e.g. the words a task came from).
 * The quote must be (nearly) contained in one sentence that still has its link.
 */
export const findQuoteLink = (quote: string | null | undefined, phrases: LinkedPhrase[]): LinkedPhrase | null => {
    const tokens = tokenize(quote || '');
    if (!tokens.length) return null;
    const quoteCounts = stemCounts(tokens);
    const needed = sizeOf(quoteCounts);
    let best: { phrase: LinkedPhrase; coverage: number } | null = null;
    for (const phrase of phrases) {
        if (!phrase.link) continue;
        const coverage = overlap(quoteCounts, stemCounts(tokenize(phrase.text))) / needed;
        if (coverage >= 0.6 && (needed >= 2 || coverage === 1) && (!best || coverage > best.coverage)) {
            best = { phrase, coverage };
        }
    }
    return best?.phrase ?? null;
};

/** The phrase being heard at `position` seconds of `recordingId`, for highlighting. */
export const activePhraseKey = (
    phrases: LinkedPhrase[],
    recordingId: string | null,
    position: number,
): string | null => {
    if (!recordingId || !Number.isFinite(position)) return null;
    let current: LinkedPhrase | null = null;
    for (const phrase of phrases) {
        const link = phrase.link;
        if (!link || link.recordingId !== recordingId) continue;
        if (link.start - PHRASE_PREROLL_SECONDS <= position && (!current || link.start >= current.link!.start)) {
            current = phrase;
        }
    }
    if (!current) return null;
    // Past the end of that phrase and in a pause (or edited text): nothing lit.
    return position <= current.link!.end + 1.5 ? current.key : null;
};

/** Where to start playing a phrase: a little before its first word. */
export const playbackStartFor = (link: Pick<PhraseLink, 'start'>): number =>
    Math.max(0, link.start - PHRASE_PREROLL_SECONDS);

/** Whole-recording fallback: its own phrases, each linked to itself. */
export const phrasesOfRecording = (source: TimingSourceRecording): LinkedPhrase[] =>
    source.timings.phrases.map((phrase, index) => ({
        key: `${source.recordingId}:${index}`,
        text: phrase.text,
        from: 0,
        to: 0,
        link: { recordingId: source.recordingId, start: phrase.start, end: phrase.end },
    }));

/** "1:05" / "1:02:05". */
export const formatPhraseTime = (seconds: number): string => {
    const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const secs = String(safe % 60).padStart(2, '0');
    return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`;
};
