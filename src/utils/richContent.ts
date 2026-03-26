import { stripMarkdownSyntax } from './markdownUtils';
import { normalizeHighlightColorForCss } from './highlightColors';
import { markdownToTiptapHtml } from './tiptapMarkdownAdapter';

const HTML_TAG_REGEX = /<\/?[a-z][\s\S]*>/i;
const AUDIO_MARKDOWN_TAG_REGEX = /\s*!\[audio\]\([^)]+\)\s*/gi;
const AUDIO_PREVIEW_IMAGE_REGEX = /<img\b[^>]*(?:alt=(["'])audio-preview\1|title=(["'])vaulto-audio:[^"']*\2)[^>]*>/gi;

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

const stripAudioMarkdownTag = (content: string, audioPath: string): string => {
    const filename = audioPath.split('/').pop();
    const escapedPath = audioPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedFilename = filename
        ? filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        : null;

    const exactPathRegex = new RegExp(`\\s*!\\[audio\\]\\(${escapedPath}\\)\\s*`, 'g');
    let next = content.replace(exactPathRegex, ' ');

    if (escapedFilename) {
        const filenameRegex = new RegExp(`\\s*!\\[audio\\]\\([^)]*${escapedFilename}\\)\\s*`, 'g');
        next = next.replace(filenameRegex, ' ');
    }

    return next;
};

export const stripAudioEmbedsFromRichContent = (content: string): string => {
    if (!content) {
        return '';
    }

    let next = content.replace(AUDIO_MARKDOWN_TAG_REGEX, ' ');

    if (isRichHtmlContent(next)) {
        next = next
            .replace(AUDIO_PREVIEW_IMAGE_REGEX, '')
            .trim();
        return next || '<p></p>';
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

export const richContentToEditorHtml = (content: string): string => {
    const sanitizedContent = stripAudioEmbedsFromRichContent(content);

    if (!sanitizedContent || sanitizedContent === '<p></p>') {
        return '<p></p>';
    }

    if (isRichHtmlContent(sanitizedContent)) {
        return normalizeRichHighlightColors(sanitizedContent);
    }

    return markdownToTiptapHtml(sanitizedContent);
};

export const richContentToPlainText = (content: string): string => {
    if (!content) {
        return '';
    }

    let normalized = content;

    if (isRichHtmlContent(normalized)) {
        normalized = normalized
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/(p|div|li|blockquote|h[1-6])>/gi, '\n')
            .replace(/<(li)\b[^>]*>/gi, '- ')
            .replace(/<\/(ul|ol)>/gi, '\n')
            .replace(/<[^>]+>/g, '');
        normalized = decodeHtmlEntities(normalized);
    }

    return stripMarkdownSyntax(normalized)
        .replace(/\u00a0/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
};

export const hasMeaningfulRichContent = (content: string): boolean => {
    const sanitizedContent = stripAudioEmbedsFromRichContent(content);

    if (!sanitizedContent || sanitizedContent === '<p></p>') {
        return false;
    }

    if (richContentToPlainText(sanitizedContent).trim().length > 0) {
        return true;
    }

    return /<img\b/i.test(sanitizedContent);
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
    if (!content) {
        return '';
    }

    let next = stripAudioMarkdownTag(content, audioPath);

    if (isRichHtmlContent(next)) {
        next = next
            .trim();
        return next || '<p></p>';
    }

    return next.replace(/\n{3,}/g, '\n\n').trim();
};
