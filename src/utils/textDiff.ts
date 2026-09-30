export type DiffSegment = { type: 'same' | 'added' | 'removed'; text: string };

/** Above this many token pairs the word diff falls back to lines (memory/time). */
const MAX_WORD_CELLS = 2_000_000;

const tokenize = (text: string): string[] => (text || '').split(/(\s+)/).filter((token) => token.length > 0);

const lcsDiff = (a: string[], b: string[]): DiffSegment[] => {
    const n = a.length;
    const m = b.length;
    // Suffix-LCS table; the walk below reads the path back out of it.
    const lengths: Uint32Array[] = [];
    for (let i = 0; i <= n; i += 1) lengths.push(new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i -= 1) {
        const row = lengths[i];
        const below = lengths[i + 1];
        for (let j = m - 1; j >= 0; j -= 1) {
            row[j] = a[i] === b[j] ? below[j + 1] + 1 : Math.max(below[j], row[j + 1]);
        }
    }
    const out: DiffSegment[] = [];
    const push = (type: DiffSegment['type'], text: string) => {
        const last = out[out.length - 1];
        if (last && last.type === type) last.text += text;
        else out.push({ type, text });
    };
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            push('same', a[i]); i += 1; j += 1;
        } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
            push('removed', a[i]); i += 1;
        } else {
            push('added', b[j]); j += 1;
        }
    }
    while (i < n) { push('removed', a[i]); i += 1; }
    while (j < m) { push('added', b[j]); j += 1; }
    return out;
};

/**
 * Word-level diff of two plain texts (whitespace is kept as its own token so the
 * segments concatenate back to the originals). Very long texts diff by line.
 */
export const diffWords = (before: string, after: string): DiffSegment[] => {
    const a = tokenize(before);
    const b = tokenize(after);
    if (a.length * b.length > MAX_WORD_CELLS) {
        const lines = (text: string) => (text || '').match(/[^\n]*\n|[^\n]+$/g) || [];
        const la = lines(before);
        const lb = lines(after);
        return lcsDiff(la, lb);
    }
    return lcsDiff(a, b);
};

export const hasDifferences = (segments: DiffSegment[]): boolean =>
    segments.some((segment) => segment.type !== 'same' && segment.text.trim().length > 0);
