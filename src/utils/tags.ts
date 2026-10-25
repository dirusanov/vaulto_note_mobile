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

// ---------------------------------------------------------------------------
// The tag line: a paragraph (or plain-text line) of nothing but #hashtags at the
// end of a note, where tags the AI suggests are written and where they stay.

/** A block of nothing but hashtags, e.g. "#work #trip-2026". */
const TAG_LINE_REGEX = /^\s*(#[\p{L}\p{N}_][\p{L}\p{N}_-]{0,39}\s*)+$/u;

const decodeEntities = (text: string): string =>
    text.replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

const isRich = (content: string): boolean => /^\s*</.test(content || '');

type Block = { start: number; end: number; text: string };

/** Top-level paragraphs of rich content (not those inside list items) with their plain text. */
const paragraphs = (html: string): Block[] => {
    const blocks: Block[] = [];
    const regex = /<p\b[^>]*>([\s\S]*?)<\/p>/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(html))) {
        const before = html.slice(0, match.index);
        const openItems = (before.match(/<li\b/g) || []).length - (before.match(/<\/li>/g) || []).length;
        if (openItems > 0) continue;
        blocks.push({ start: match.index, end: match.index + match[0].length, text: decodeEntities(match[1].replace(/<[^>]*>/g, '')) });
    }
    return blocks;
};

const lines = (text: string): Block[] => {
    const blocks: Block[] = [];
    let start = 0;
    text.split('\n').forEach((line) => {
        blocks.push({ start, end: start + line.length, text: line });
        start += line.length + 1;
    });
    return blocks;
};

const isTagLine = (text: string): boolean => TAG_LINE_REGEX.test(text) && extractTags(text).length > 0;

/**
 * The note with its tag line at the end, holding the tags already in tag lines
 * plus `tags` not yet anywhere in the note. Tag lines elsewhere (text dictated
 * after them) are merged into the last one. Unchanged when there is nothing to do.
 */
export const withTagLine = (content: string, tags: string[] = []): string => {
    const source = content || '';
    const rich = isRich(source);
    const blocks = rich ? paragraphs(source) : lines(source);
    const tagBlocks = blocks.filter((block) => isTagLine(block.text));
    const present = new Set(extractTags(rich ? decodeEntities(source.replace(/<[^>]*>/g, ' ')) : source));
    const merged: string[] = [];
    tagBlocks.forEach((block) => extractTags(block.text).forEach((tag) => {
        if (!merged.includes(tag)) merged.push(tag);
    }));
    const added: string[] = [];
    tags.forEach((raw) => {
        const tag = normalize((raw || '').trim().replace(/^#+/, ''));
        // Only what extractTags would read back as a tag.
        if (extractTags(`#${tag}`)[0] === tag && !present.has(tag) && !merged.includes(tag) && !added.includes(tag)) {
            added.push(tag);
        }
    });
    merged.push(...added);
    if (!merged.length) {
        return source;
    }
    // Already one tag line, last of all text, and nothing new: leave it as it is.
    const nonEmpty = blocks.filter((block) => block.text.trim());
    const last = nonEmpty[nonEmpty.length - 1];
    if (!added.length && tagBlocks.length === 1 && last === tagBlocks[0]) {
        return source;
    }
    let rest = source;
    for (let i = tagBlocks.length - 1; i >= 0; i--) {
        const block = tagBlocks[i];
        // A plain-text line takes its line break with it.
        const end = !rich && rest[block.end] === '\n' ? block.end + 1 : block.end;
        rest = rest.slice(0, block.start) + rest.slice(end);
    }
    const line = merged.map((tag) => `#${tag}`).join(' ');
    if (rich) {
        const trimmed = rest.trim().replace(/(<p\b[^>]*>(\s|&nbsp;|<br\s*\/?>)*<\/p>\s*)+$/g, '');
        return `${trimmed}<p>${line}</p>`;
    }
    const trimmed = rest.replace(/\s+$/g, '');
    return trimmed ? `${trimmed}\n\n${line}` : line;
};

/** Text dictated after the tag line goes above it: the tags stay last. */
export const keepTagLineLast = (content: string): string => withTagLine(content, []);
