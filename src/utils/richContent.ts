import { stripMarkdownSyntax } from './markdownUtils';
import { normalizeHighlightColorForCss } from './highlightColors';
import { markdownToTiptapHtml } from './tiptapMarkdownAdapter';
import {
    applyAudioSourceMapToHtml,
    extractAudioEmbedPaths,
    getAudioEmbedAttributesFromHtml,
    hasAudioEmbeds,
    removeAudioEmbedFromContent,
    stripTransientAudioEmbedState,
} from './audioEmbeds';

const HTML_TAG_REGEX = /<\/?[a-z][\s\S]*>/i;
const TASK_ITEM_HTML_REGEX = /<li\b[^>]*data-type=(["'])taskItem\1/i;
const EMPTY_CHECKLIST_MARKDOWN_REGEX = /(?:^|\n)\s*-\s\[(?: |x|X)\]\s*(?=\n|$)/;
const TRAILING_IMG_TAG_REGEX = /<img\b[^>]*>\s*$/i;
/** An <li> with no further <li> inside it - i.e. the innermost item. */
const LEAF_LIST_ITEM_REGEX = /<li\b([^>]*)>((?:(?!<li\b)[\s\S])*?)<\/li>/i;

const escapeHtml = (text: string): string =>
    text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const decodeHtmlEntities = (text: string): string =>
    text
        .replace(/&nbsp;/gi, ' ')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        // Last on purpose: decoding it earlier would turn "&amp;lt;" into "<".
        .replace(/&amp;/gi, '&');

const LIST_LINE_REGEX = /^[ \t]*(?:[-*]\s|\d+[.)]\s)/;

/**
 * Collapses runs of spaces without touching the indentation that carries list
 * nesting - a blanket "\n[ \t]+" strip used to flatten every nested bullet.
 */
const normalizeAgentTextWhitespace = (text: string): string => {
    let insideList = false;

    return text
        .replace(/\u00a0/g, ' ')
        .split('\n')
        .map((line) => {
            const body = line.trim().replace(/[ \t]{2,}/g, ' ');
            if (!body) {
                insideList = false;
                return '';
            }

            const isListLine = LIST_LINE_REGEX.test(line);
            const isIndentedContinuation = insideList && /^[ \t]/.test(line);
            if (!isListLine && !isIndentedContinuation) {
                insideList = false;
                return body;
            }

            insideList = true;
            const indent = (line.match(/^[ \t]*/)?.[0] || '').replace(/\t/g, '  ');
            return `${indent}${body}`;
        })
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
};

const richHtmlFragmentToRawText = (html: string): string =>
    html
        .replace(/<img\b[^>]*>/gi, (match) => (getAudioEmbedAttributesFromHtml(match) ? ' ' : match))
        .replace(/<div\b[^>]*data-audio-player=(["'])true\1[^>]*><\/div>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|blockquote|h[1-6]|li)>/gi, '\n')
        .replace(/<li\b[^>]*>/gi, ' ')
        .replace(/<label\b[^>]*>/gi, '')
        .replace(/<\/label>/gi, ' ')
        .replace(/<input\b[^>]*>/gi, '')
        .replace(/<[^>]+>/g, '');

/**
 * Same cleanup, but line breaks survive and entities stay encoded, so the text
 * can be spliced back into the HTML that is still being processed.
 */
const richHtmlFragmentToRawLines = (html: string): string[] =>
    richHtmlFragmentToRawText(html || '')
        .split('\n')
        .map((line) => {
            // Leading whitespace is kept: on a line this function is re-reading,
            // it is the indentation of an already converted nested list item.
            const indent = line.match(/^[ \t]*/)?.[0] || '';
            const body = line.slice(indent.length).replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
            return body ? `${indent}${body}` : '';
        })
        .filter((line) => line.length > 0);

/** Nesting level of the <li> that starts at `index`, counted in open lists. */
const listDepthAt = (html: string, index: number): number => {
    const prefix = html.slice(0, index);
    const opened = (prefix.match(/<(?:ul|ol)\b/gi) || []).length;
    const closed = (prefix.match(/<\/(?:ul|ol)>/gi) || []).length;
    return Math.max(0, opened - closed - 1);
};

/**
 * Rewrites list items innermost-first, so a nested list keeps its own lines and
 * its indentation instead of being glued onto the end of its parent bullet
 * ("- Top Child"), which is what a single flat regex pass produced.
 */
const convertListItemsToMarkdown = (html: string): string => {
    let current = html;

    // Each pass removes one <li>, so the loop always terminates; the bound is
    // only a backstop for pathological input.
    for (let guard = 0; guard < 2000; guard += 1) {
        const match = LEAF_LIST_ITEM_REGEX.exec(current);
        if (!match) {
            break;
        }

        const [block, attributes, inner] = match;
        const isTask = /data-type=(["'])taskItem\1/i.test(attributes);
        const checked = /data-checked=(["'])true\1/i.test(attributes);
        const marker = isTask ? `- [${checked ? 'x' : ' '}] ` : '- ';
        const indent = '  '.repeat(listDepthAt(current, match.index));

        const lines = richHtmlFragmentToRawLines(inner);
        const ownText = (lines.shift() || '').trim();
        // Wrapped lines of the same item are indented under its text; lines that
        // are already list items keep the indentation they were rendered with.
        const continuation = lines.map((line) => (
            LIST_LINE_REGEX.test(line) ? line : `${indent}${' '.repeat(marker.length)}${line}`
        ));
        const rendered = ownText || continuation.length > 0
            ? [`${indent}${marker}${ownText}`.trimEnd(), ...continuation].join('\n')
            : '';

        // Leading break only: a trailing one would put a blank line between
        // every pair of items once the next item is spliced in.
        current = `${current.slice(0, match.index)}\n${rendered}${current.slice(match.index + block.length)}`;
    }

    return current;
};

export const stripAudioEmbedsFromRichContent = (content: string): string => {
    if (!content) {
        return '';
    }

    const next = stripTransientAudioEmbedState(content);

    if (isRichHtmlContent(next)) {
        return next.trim() || '<p></p>';
    }

    return next.replace(/\n{3,}/g, '\n\n').trim();
};

export const isRichHtmlContent = (content: string): boolean =>
    HTML_TAG_REGEX.test(content || '');

export const normalizeRichHighlightColors = (content: string): string =>
    content.replace(/<mark\b[^>]*>/gi, (tag) => {
        let nextTag = tag.replace(
            /data-color=(["'])([^"']+)\1/gi,
            (_match, quote: string, value: string) => `data-color=${quote}${normalizeHighlightColorForCss(value, value)}${quote}`
        );

        nextTag = nextTag.replace(
            /background-color\s*:\s*([^;"']+)/gi,
            (_match, value: string) => `background-color: ${normalizeHighlightColorForCss(value, value)}`
        );

        return nextTag;
    });

const ensureTrailingEditorParagraph = (html: string): string => {
    const trimmed = (html || '').trim();
    const trailingImageMatch = trimmed.match(TRAILING_IMG_TAG_REGEX);
    if (!trailingImageMatch) {
        return trimmed;
    }

    const trailingImageHtml = trailingImageMatch[0].trim();
    if (!getAudioEmbedAttributesFromHtml(trailingImageHtml)) {
        return trimmed;
    }

    return `${trimmed}<p></p>`;
};

export const richContentToEditorHtml = (
    content: string
): string => {
    const sanitizedContent = stripAudioEmbedsFromRichContent(content);

    if (!sanitizedContent || sanitizedContent === '<p></p>') {
        return '<p></p>';
    }

    if (isRichHtmlContent(sanitizedContent)) {
        return ensureTrailingEditorParagraph(
            normalizeRichHighlightColors(applyAudioSourceMapToHtml(sanitizedContent))
        );
    }

    return ensureTrailingEditorParagraph(
        applyAudioSourceMapToHtml(markdownToTiptapHtml(sanitizedContent))
    );
};

export const richContentToPlainText = (content: string): string => {
    if (!content) {
        return '';
    }

    let normalized = content;

    if (isRichHtmlContent(normalized)) {
        normalized = normalized
            .replace(/<img\b[^>]*>/gi, (match) => (getAudioEmbedAttributesFromHtml(match) ? '\n' : match))
            .replace(/<div\b[^>]*data-audio-player=(["'])true\1[^>]*><\/div>/gi, '\n')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<br\s*\/?>/gi, '\n')
            // A paragraph that only wraps a list item must not contribute its own
            // line break, otherwise every bullet is followed by a blank line.
            .replace(/(?:<\/(?:p|div)>\s*)+(?=<\/li>)/gi, '')
            .replace(/<\/(p|div|li|blockquote|h[1-6])>/gi, '\n')
            .replace(/<(li)\b[^>]*>/gi, '- ')
            .replace(/<\/(ul|ol)>/gi, '\n')
            .replace(/<[^>]+>/g, '');
        normalized = decodeHtmlEntities(normalized);
    }

    return stripMarkdownSyntax(normalized.replace(/!\[audio\]\([^)]+\)/gi, ' '))
        .replace(/\u00a0/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
};

export const richContentToAgentMarkdown = (content: string): string => {
    if (!content) {
        return '';
    }

    const sanitizedContent = stripAudioEmbedsFromRichContent(content);
    if (!isRichHtmlContent(sanitizedContent)) {
        return sanitizedContent.trim();
    }

    let normalized = sanitizedContent
        .replace(/<img\b[^>]*>/gi, (match) => (getAudioEmbedAttributesFromHtml(match) ? '\n' : match))
        .replace(/<div\b[^>]*data-audio-player=(["'])true\1[^>]*><\/div>/gi, '\n')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '');

    normalized = convertListItemsToMarkdown(normalized);

    normalized = decodeHtmlEntities(
        normalized
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/(p|div|blockquote|h[1-6])>/gi, '\n')
            .replace(/<\/(ul|ol)>/gi, '\n')
            .replace(/<[^>]+>/g, '')
    );

    return normalizeAgentTextWhitespace(normalized);
};

// Private-use sentinels: underline has no Markdown syntax, so the adapter keeps
// it as literal <u>...</u>, which the blanket tag strip below would eat.
const UNDERLINE_OPEN_TOKEN = '\uE000';
const UNDERLINE_CLOSE_TOKEN = '\uE001';

const convertInlineMarksToMarkdown = (html: string): string =>
    html
        .replace(/<a\b[^>]*\bhref=(["'])([^"']*)\1[^>]*>([\s\S]*?)<\/a>/gi, (_match, _quote, href: string, text: string) => (
            href ? `[${text}](${href})` : text
        ))
        .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
        .replace(/<mark\b[^>]*>([\s\S]*?)<\/mark>/gi, '==$1==')
        .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
        .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, '_$2_')
        .replace(/<(s|del|strike)\b[^>]*>([\s\S]*?)<\/\1>/gi, '~~$2~~')
        .replace(/<u\b[^>]*>/gi, UNDERLINE_OPEN_TOKEN)
        .replace(/<\/u>/gi, UNDERLINE_CLOSE_TOKEN);

/**
 * Stored rich HTML as Markdown in the adapter's dialect (one line per block, an
 * empty line per empty paragraph). The live editor serializes its own document
 * more precisely; this is the fallback for when it is not mounted, e.g. while
 * the raw view is open or when copying a note.
 */
export const richContentToMarkdown = (content: string): string => {
    if (!content) {
        return '';
    }

    const sanitizedContent = stripAudioEmbedsFromRichContent(content);
    if (!isRichHtmlContent(sanitizedContent)) {
        return sanitizedContent.trim();
    }

    let normalized = sanitizedContent
        .replace(/<img\b[^>]*>/gi, (match) => {
            const audio = getAudioEmbedAttributesFromHtml(match);
            return audio?.path ? `<p>![audio](${audio.path})</p>` : '';
        })
        .replace(/<div\b[^>]*data-audio-player=(["'])true\1[^>]*><\/div>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '');

    normalized = convertInlineMarksToMarkdown(normalized)
        .replace(/<h([1-6])\b[^>]*>/gi, (_match, level: string) => `${'#'.repeat(Number(level))} `)
        .replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_match, inner: string) => (
            inner
                .replace(/<p\b[^>]*>/gi, '> ')
                .replace(/<\/p>/gi, '\n')
        ));

    normalized = convertListItemsToMarkdown(normalized);

    normalized = decodeHtmlEntities(
        normalized
            // An empty paragraph is one empty line, not its <br> plus its close.
            .replace(/<p\b[^>]*>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, '\n')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/(p|div|h[1-6])>/gi, '\n')
            .replace(/<\/(ul|ol)>/gi, '\n')
            .replace(/<[^>]+>/g, '')
    );

    return normalized
        .split(UNDERLINE_OPEN_TOKEN).join('<u>')
        .split(UNDERLINE_CLOSE_TOKEN).join('</u>')
        .replace(/\u00a0/g, ' ')
        // A list is closed right after its last item's line break.
        .replace(/\n\n(?=\s*(?:[-*]\s|\d+[.)]\s))/g, '\n')
        .replace(/[ \t]+$/gm, '')
        .replace(/\n+$/, '')
        .replace(/^\n+/, '');
};

/**
 * Short multi-line preview for note cards: keeps line structure and shows
 * checklist state instead of folding everything into one run-on sentence.
 */
export const richContentToPreviewText = (content: string, maxLines: number = 8, maxLength: number = 220): string => {
    const markdown = richContentToMarkdown(content);
    const lines: string[] = [];
    let length = 0;

    for (const rawLine of markdown.split('\n')) {
        if (lines.length >= maxLines || length >= maxLength) {
            break;
        }
        if (/^\s*!\[(?:audio|processing)\]\([^)]*\)\s*$/i.test(rawLine)) {
            continue;
        }

        const indent = (rawLine.match(/^\s*/)?.[0].length || 0) >= 2 ? '  ' : '';
        const task = rawLine.match(/^\s*[-*]\s*\[([ xX]?)\]\s*(.*)$/);
        const bullet = task ? null : rawLine.match(/^\s*[-*+]\s+(.*)$/);
        const ordered = task || bullet ? null : rawLine.match(/^\s*(\d+[.)])\s+(.*)$/);
        const body = task?.[2] ?? bullet?.[1] ?? ordered?.[2] ?? rawLine.replace(/^\s*(?:#{1,6}\s+|>\s?)/, '');
        const text = stripMarkdownSyntax(body).replace(/<\/?u>/gi, '').replace(/\s+/g, ' ').trim();
        if (!text) {
            continue;
        }

        const marker = task
            ? (task[1].trim() ? '☑ ' : '☐ ')
            : bullet
                ? '• '
                : ordered
                    ? `${ordered[1]} `
                    : '';
        const line = `${indent}${marker}${text}`;
        lines.push(line);
        length += line.length;
    }

    const preview = lines.join('\n');
    return preview.length > maxLength ? `${preview.slice(0, maxLength).trimEnd()}…` : preview;
};

/**
 * Title shown for an untitled note, taken from its first line so a heading
 * like "Weekend plan" does not borrow words from the list below it. A short
 * first sentence is used whole; a longer one is cut to its first words with
 * an ellipsis, so the title never reads as a finished phrase ("Ship v2 is").
 */
export const deriveAutoTitleFromPlainText = (plainText: string, maxWords: number = 6): string => {
    const firstLine = (plainText || '')
        .split('\n')
        .map((line) => line.trim())
        .find(Boolean) || '';
    const sentence = firstLine.split(/(?<=[.!?。！？])\s|[:;]\s/)[0].replace(/[.!?。！？:;,]+$/, '');
    const words = sentence
        .split(/\s+/)
        .filter((token) => token && !/^[-*_•☐☑]+$/.test(token));

    if (words.length <= maxWords) {
        const title = words.join(' ');
        // Scripts without spaces (Chinese, Japanese) arrive as one long token.
        return title.length > 40 ? `${title.slice(0, 24).trimEnd()}…` : title;
    }
    return `${words.slice(0, Math.min(4, maxWords)).join(' ').replace(/[,;:]+$/, '')}…`;
};

const SCRIPT_RANGES: Array<[string, RegExp]> = [
    ['latin', /[A-Za-z\u00c0-\u024f]/],
    ['cyrillic', /[\u0400-\u04ff]/],
    ['greek', /[\u0370-\u03ff]/],
    ['arabic', /[\u0600-\u06ff]/],
    ['hebrew', /[\u0590-\u05ff]/],
    ['devanagari', /[\u0900-\u097f]/],
    ['kana', /[\u3040-\u30ff]/],
    ['han', /[\u3400-\u4dbf\u4e00-\u9fff]/],
    ['hangul', /[\uac00-\ud7af]/],
];

const scriptsIn = (text: string): Set<string> => {
    const found = new Set<string>();
    for (const char of text || '') {
        for (const [name, regex] of SCRIPT_RANGES) {
            if (regex.test(char)) {
                found.add(name);
                break;
            }
        }
    }
    return found;
};

/**
 * True when every writing system used by `title` also appears in `context`.
 * The agent is told to keep the note's language but occasionally answers an
 * English checklist with a Russian title; such a title is dropped so the
 * caller falls back to one derived from the content itself.
 */
export const titleMatchesContextScript = (title: string, context: string): boolean => {
    const titleScripts = scriptsIn(title);
    if (titleScripts.size === 0) {
        return true;
    }
    const contextScripts = scriptsIn(context);
    if (contextScripts.size === 0) {
        return true;
    }
    for (const script of titleScripts) {
        if (!contextScripts.has(script)) {
            return false;
        }
    }
    return true;
};

const STRUCTURAL_MARKDOWN_LINE_REGEX = /^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>)/;

/**
 * Model output is CommonMark, where a blank line merely separates blocks. The
 * editor adapter maps every blank line to an empty paragraph, so a heading
 * followed by "\n\n" rendered with a visible gap the preview did not have.
 * Blank lines next to headings, list items and quotes are dropped; a single
 * blank line between two plain paragraphs is kept as their separator.
 */
export const normalizeModelMarkdownForEditor = (markdown: string): string => {
    if (!markdown || isRichHtmlContent(markdown)) {
        return markdown || '';
    }

    const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
    const result: string[] = [];
    let insideFence = false;

    lines.forEach((line, index) => {
        if (/^\s*```/.test(line)) {
            insideFence = !insideFence;
        }

        if (insideFence || line.trim() !== '') {
            result.push(line);
            return;
        }

        const previous = result[result.length - 1];
        const next = lines.slice(index + 1).find((candidate) => candidate.trim() !== '');
        if (previous === undefined || next === undefined || previous.trim() === '') {
            return;
        }

        if (STRUCTURAL_MARKDOWN_LINE_REGEX.test(previous) || STRUCTURAL_MARKDOWN_LINE_REGEX.test(next)) {
            return;
        }

        result.push('');
    });

    return result.join('\n');
};

export const hasMeaningfulRichContent = (content: string): boolean => {
    const sanitizedContent = stripAudioEmbedsFromRichContent(content);

    if (!sanitizedContent || sanitizedContent === '<p></p>') {
        return false;
    }

    if (richContentToPlainText(sanitizedContent).trim().length > 0) {
        return true;
    }

    if (TASK_ITEM_HTML_REGEX.test(sanitizedContent) || EMPTY_CHECKLIST_MARKDOWN_REGEX.test(sanitizedContent)) {
        return true;
    }

    return /<img\b/i.test(sanitizedContent) || hasAudioEmbeds(sanitizedContent);
};

export const appendPlainTextSnippetToRichContent = (base: string, snippet: string): string => {
    const normalizedSnippet = (snippet || '').trim();
    if (!normalizedSnippet) {
        return base || '';
    }

    if (!base) {
        return isRichHtmlContent(base) ? `<p>${escapeHtml(normalizedSnippet)}</p>` : normalizedSnippet;
    }

    if (!isRichHtmlContent(base)) {
        const normalizedBase = base.replace(/\s+$/g, '');
        if (!normalizedBase) {
            return normalizedSnippet;
        }
        if (normalizedBase.endsWith('\n')) {
            return `${normalizedBase}${normalizedSnippet}`;
        }
        return `${normalizedBase}\n${normalizedSnippet}`;
    }

    const trimmedBase = base.trim();
    const snippetHtml = isRichHtmlContent(normalizedSnippet)
        ? normalizedSnippet.trim()
        : markdownToTiptapHtml(normalizedSnippet);
    return `${trimmedBase}${snippetHtml}`;
};

export const removeAudioFromRichContent = (content: string, audioPath: string): string => {
    return removeAudioEmbedFromContent(content, audioPath);
};

export const extractEmbeddedAudioPaths = (content: string): string[] =>
    extractAudioEmbedPaths(stripAudioEmbedsFromRichContent(content));
