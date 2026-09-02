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
const RICH_TASK_ITEM_BLOCK_REGEX = /<li\b(?=[^>]*data-type=(["'])taskItem\1)[^>]*>[\s\S]*?<\/li>/gi;
const RICH_LIST_ITEM_BLOCK_REGEX = /<li\b[^>]*>[\s\S]*?<\/li>/gi;

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
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'");

const normalizeAgentTextWhitespace = (text: string): string =>
    text
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

const richHtmlFragmentToInlineText = (html: string): string => {
    if (!html) {
        return '';
    }

    const normalized = decodeHtmlEntities(
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
            .replace(/<[^>]+>/g, '')
    );

    return normalized
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
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

    normalized = normalized.replace(RICH_TASK_ITEM_BLOCK_REGEX, (block) => {
        const checked = /data-checked=(["'])true\1/i.test(block);
        const innerHtml = block.replace(/^<li\b[^>]*>/i, '').replace(/<\/li>\s*$/i, '');
        const text = richHtmlFragmentToInlineText(innerHtml);
        if (!text) {
            return '\n';
        }
        return `- [${checked ? 'x' : ' '}] ${text}\n`;
    });

    normalized = normalized.replace(RICH_LIST_ITEM_BLOCK_REGEX, (block) => {
        const innerHtml = block.replace(/^<li\b[^>]*>/i, '').replace(/<\/li>\s*$/i, '');
        const text = richHtmlFragmentToInlineText(innerHtml);
        if (!text) {
            return '\n';
        }
        return `- ${text}\n`;
    });

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
