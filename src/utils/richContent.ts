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
