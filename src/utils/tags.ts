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
// The tag line: a last paragraph (or plain-text line) of nothing but #hashtags,
// where tags the AI suggests are written. Only that last line is ever touched:
// tags a user keeps anywhere else stay exactly where they are.

/** A block of nothing but hashtags, e.g. "#work #trip-2026". */
const TAG_LINE_REGEX = /^\s*(#[\p{L}\p{N}_][\p{L}\p{N}_-]{0,39}\s*)+$/u;

const decodeEntities = (text: string): string =>
    text.replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

const isRich = (content: string): boolean => /^\s*</.test(content || '');

const isTagLine = (text: string): boolean => TAG_LINE_REGEX.test(text) && extractTags(text).length > 0;

/** Paragraphs and line breaks that show nothing. */
const EMPTY_TAIL_REGEX = /^(\s|<p\b[^>]*>(\s|&nbsp;|<br\s*\/?>)*<\/p>)*$/;

/** Elements a paragraph can sit inside: one there is not the note's own last line. */
const CONTAINER_REGEX = /<(\/?)(li|ul|ol|blockquote|td|th|table|details|summary)\b[^>]*>/g;

type TagLine = {
    /** Where the line starts and ends in the content (its trailing empty lines follow). */
    start: number;
    end: number;
    /** Rich content: the paragraph's inner HTML, kept with its marks. */
    inner: string;
};

/** The note's last line when it is a tag line, or null. */
const trailingTagLine = (content: string): TagLine | null => {
    if (isRich(content)) {
        // The last top-level paragraph, found in one pass over the containers.
        let depth = 0;
        let last: TagLine | null = null;
        const tokens = /<(\/?)(li|ul|ol|blockquote|td|th|table|details|summary)\b[^>]*>|<p\b[^>]*>([\s\S]*?)<\/p>/g;
        let match: RegExpExecArray | null;
        while ((match = tokens.exec(content))) {
            if (match[2]) {
                depth = Math.max(0, depth + (match[1] ? -1 : 1));
            } else if (depth === 0 && decodeEntities(match[3].replace(/<[^>]*>/g, '')).trim()) {
                last = { start: match.index, end: match.index + match[0].length, inner: match[3] };
            }
        }
        if (!last || !EMPTY_TAIL_REGEX.test(content.slice(last.end))) return null;
        // Nothing else may follow it outside a paragraph (a list, a quote).
        CONTAINER_REGEX.lastIndex = 0;
        if (CONTAINER_REGEX.test(content.slice(last.end))) return null;
        return isTagLine(decodeEntities(last.inner.replace(/<[^>]*>/g, ''))) ? last : null;
    }
    const trimmed = content.replace(/\s+$/g, '');
    const start = trimmed.lastIndexOf('\n') + 1;
    const line = trimmed.slice(start);
    return isTagLine(line) ? { start, end: trimmed.length, inner: line } : null;
};

/**
 * The note with `tags` it does not have yet added to its tag line, or as a new
 * tag line at its end. Unchanged when every tag is already in the note.
 */
export const withTagLine = (content: string, tags: string[] = []): string => {
    const source = content || '';
    const rich = isRich(source);
    const present = new Set(extractTags(rich ? decodeEntities(source.replace(/<[^>]*>/g, ' ')) : source));
    const added: string[] = [];
    tags.forEach((raw) => {
        const tag = normalize((raw || '').trim().replace(/^#+/, ''));
        // Only what extractTags would read back as a tag.
        if (extractTags(`#${tag}`)[0] === tag && !present.has(tag) && !added.includes(tag)) {
            added.push(tag);
        }
    });
    if (!added.length) {
        return source;
    }
    const words = added.map((tag) => `#${tag}`).join(' ');
    const line = trailingTagLine(source);
    if (line) {
        if (rich) {
            const open = source.slice(line.start, line.end).match(/^<p\b[^>]*>/)?.[0] ?? '<p>';
            return `${source.slice(0, line.start)}${open}${line.inner.replace(/\s+$/g, '')} ${words}</p>${source.slice(line.end)}`;
        }
        return `${source.slice(0, line.end)} ${words}${source.slice(line.end)}`;
    }
    if (rich) {
        const trimmed = source.trim().replace(/(<p\b[^>]*>(\s|&nbsp;|<br\s*\/?>)*<\/p>\s*)+$/g, '');
        return `${trimmed}<p>${words}</p>`;
    }
    const trimmed = source.replace(/\s+$/g, '');
    return trimmed ? `${trimmed}\n\n${words}` : words;
};

/**
 * Appends with `append` above the note's tag line, if it ends with one, so text
 * dictated after the tags were written does not land below them.
 */
export const appendAboveTagLine = (content: string, append: (body: string) => string): string => {
    const source = content || '';
    const line = trailingTagLine(source);
    if (!line) {
        return append(source);
    }
    const body = source.slice(0, line.start);
    const tagBlock = source.slice(line.start, line.end);
    if (!isRich(source)) {
        const appended = append(body.replace(/\s+$/g, '')).replace(/\s+$/g, '');
        return appended ? `${appended}\n\n${tagBlock}` : tagBlock;
    }
    return `${append(body)}${tagBlock}`;
};
