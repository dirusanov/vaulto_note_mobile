/**
 * Tags are hashtags written in the note itself (#work, #идеи). Keeping them in
 * the text means they are encrypted and synced with it and need no schema: a
 * separate plaintext tag column would reveal what encrypted notes are about.
 */

// A tag starts after whitespace or line start (so URL fragments like
// example.com/#top are not tags), then letters/digits/_/- in any script.
const TAG_REGEX = /(^|[\s(])#([\p{L}\p{N}_][\p{L}\p{N}_-]{0,39})/gu;

const normalize = (tag: string) => tag.toLocaleLowerCase();

/** Unique tags of a text, lower-cased, in order of first appearance. */
export const extractTags = (plainText: string): string[] => {
    const seen = new Set<string>();
    const tags: string[] = [];
    for (const match of (plainText || '').matchAll(TAG_REGEX)) {
        const raw = match[2].replace(/[-_]+$/, '');
        // "#1" or "#2024" is a number, not a tag.
        if (!raw || /^\p{N}+$/u.test(raw)) continue;
        const tag = normalize(raw);
        if (!seen.has(tag)) {
            seen.add(tag);
            tags.push(tag);
        }
    }
    return tags;
};

/** Tag -> number of notes, most used first, then alphabetically. */
export const countTags = (texts: string[]): Array<{ tag: string; count: number }> => {
    const counts = new Map<string, number>();
    texts.forEach((text) => extractTags(text).forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1)));
    return Array.from(counts, ([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
};

export const hasTag = (plainText: string, tag: string): boolean =>
    extractTags(plainText).includes(normalize(tag));

/** Splits text into plain and #tag pieces, for highlighting tags in place. */
export const splitTags = (text: string): Array<{ text: string; tag: boolean }> => {
    const parts: Array<{ text: string; tag: boolean }> = [];
    let last = 0;
    for (const match of (text || '').matchAll(TAG_REGEX)) {
        const lead = match[1];
        const raw = match[2];
        if (/^\p{N}+$/u.test(raw)) continue;
        const start = (match.index ?? 0) + lead.length;
        if (start > last) parts.push({ text: text.slice(last, start), tag: false });
        parts.push({ text: `#${raw}`, tag: true });
        last = start + raw.length + 1;
    }
    if (last < (text || '').length) parts.push({ text: text.slice(last), tag: false });
    return parts;
};
