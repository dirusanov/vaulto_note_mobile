export const AUDIO_EMBED_NODE_NAME = 'vaultoAudioEmbed';
export const AUDIO_EMBED_ATTR = 'data-audio-player';
export const AUDIO_EMBED_PATH_ATTR = 'data-audio-path';
export const AUDIO_EMBED_DURATION_ATTR = 'data-audio-duration';
export const AUDIO_EMBED_SRC_ATTR = 'data-audio-src';
export const LEGACY_AUDIO_TITLE_PREFIX = 'vaulto-audio:';

const AUDIO_EMBED_BLOCK_REGEX = /<div\b[^>]*data-audio-player=(["'])true\1[^>]*><\/div>/gi;
const AUDIO_MARKDOWN_REGEX = /!\[audio\]\((.*?)\)/gi;
const LEGACY_AUDIO_PREVIEW_IMAGE_REGEX = /<img\b[^>]*(?:alt=(["'])audio-preview\1|title=(["'])vaulto-audio:[^"']*\2)[^>]*>/gi;
const EMPTY_HTML_BLOCK_REGEX = /<(p|div)>(\s|&nbsp;|<br\s*\/?>)*<\/\1>/gi;
const HTML_TAG_REGEX = /<\/?[a-z][\s\S]*>/i;

export type AudioEmbedAttributes = {
    path: string;
    duration?: number | null;
    src?: string | null;
};

const escapeHtml = (text: string): string =>
    text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const escapeHtmlAttribute = (value: string): string =>
    escapeHtml(value).replace(/`/g, '&#96;');

const decodeHtmlAttribute = (value: string): string =>
    value
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'");

const getHtmlAttributeValue = (html: string, attr: string): string | null => {
    const match = html.match(new RegExp(`\\b${attr}=(["'])(.*?)\\1`, 'i'));
    if (!match) {
        return null;
    }

    return decodeHtmlAttribute(match[2]);
};

const normalizeAudioPath = (value?: string | null): string | null => {
    const normalized = (value || '').trim();
    return normalized.length > 0 ? normalized : null;
};

const audioPathMatches = (candidate?: string | null, target?: string | null): boolean => {
    const normalizedCandidate = normalizeAudioPath(candidate);
    const normalizedTarget = normalizeAudioPath(target);

    if (!normalizedCandidate || !normalizedTarget) {
        return false;
    }

    if (normalizedCandidate === normalizedTarget) {
        return true;
    }

    const candidateFileName = normalizedCandidate.split('/').pop();
    const targetFileName = normalizedTarget.split('/').pop();
    return !!candidateFileName && !!targetFileName && candidateFileName === targetFileName;
};

const decodeLegacyAudioPath = (titleValue: string): string | null => {
    if (!titleValue.startsWith(LEGACY_AUDIO_TITLE_PREFIX)) {
        return null;
    }

    const encodedPath = titleValue.slice(LEGACY_AUDIO_TITLE_PREFIX.length);
    try {
        return decodeURIComponent(encodedPath);
    } catch {
        return encodedPath;
    }
};

const normalizeLegacyAudioEmbeds = (content: string): string => (
    content.replace(LEGACY_AUDIO_PREVIEW_IMAGE_REGEX, (match) => {
        const title = getHtmlAttributeValue(match, 'title');
        const path = title ? decodeLegacyAudioPath(title) : null;
        if (!path) {
            return '';
        }

        return buildAudioEmbedHtml({ path });
    })
);

export const buildAudioEmbedHtml = ({ path, duration, src }: AudioEmbedAttributes): string => {
    const normalizedPath = normalizeAudioPath(path);
    if (!normalizedPath) {
        return '';
    }

    const normalizedDuration = typeof duration === 'number' && Number.isFinite(duration) && duration > 0
        ? Math.max(0, Math.round(duration))
        : null;
    const normalizedSrc = normalizeAudioPath(src);

    const attrs = [
        `${AUDIO_EMBED_ATTR}="true"`,
        `${AUDIO_EMBED_PATH_ATTR}="${escapeHtmlAttribute(normalizedPath)}"`,
    ];

    if (normalizedDuration !== null) {
        attrs.push(`${AUDIO_EMBED_DURATION_ATTR}="${normalizedDuration}"`);
    }

    if (normalizedSrc) {
        attrs.push(`${AUDIO_EMBED_SRC_ATTR}="${escapeHtmlAttribute(normalizedSrc)}"`);
    }

    return `<div ${attrs.join(' ')}></div>`;
};

export const getAudioEmbedAttributesFromHtml = (html: string): AudioEmbedAttributes | null => {
    const path = normalizeAudioPath(getHtmlAttributeValue(html, AUDIO_EMBED_PATH_ATTR));
    if (!path) {
        return null;
    }

    const durationValue = getHtmlAttributeValue(html, AUDIO_EMBED_DURATION_ATTR);
    const parsedDuration = durationValue !== null ? Number(durationValue) : null;
    const duration = Number.isFinite(parsedDuration) ? parsedDuration : null;
    const src = normalizeAudioPath(getHtmlAttributeValue(html, AUDIO_EMBED_SRC_ATTR));

    return {
        path,
        duration,
        src,
    };
};

export const stripTransientAudioEmbedState = (content: string): string => {
    if (!content) {
        return '';
    }

    const normalizedContent = normalizeLegacyAudioEmbeds(content);

    return normalizedContent.replace(AUDIO_EMBED_BLOCK_REGEX, (match) => {
        const attrs = getAudioEmbedAttributesFromHtml(match);
        return attrs
            ? buildAudioEmbedHtml({
                path: attrs.path,
                duration: attrs.duration,
            })
            : '';
    });
};

export const applyAudioSourceMapToHtml = (
    content: string,
    audioSourceMap?: Record<string, string | null | undefined>
): string => {
    if (!content) {
        return '';
    }

    const normalizedContent = normalizeLegacyAudioEmbeds(content);

    return normalizedContent.replace(AUDIO_EMBED_BLOCK_REGEX, (match) => {
        const attrs = getAudioEmbedAttributesFromHtml(match);
        if (!attrs) {
            return '';
        }

        const resolvedSrc = audioSourceMap?.[attrs.path] ?? attrs.src;
        return buildAudioEmbedHtml({
            path: attrs.path,
            duration: attrs.duration,
            src: resolvedSrc,
        });
    });
};

export const extractAudioEmbedPaths = (content: string): string[] => {
    if (!content) {
        return [];
    }

    const normalizedContent = normalizeLegacyAudioEmbeds(content);
    const orderedPaths: string[] = [];
    const seenPaths = new Set<string>();

    normalizedContent.replace(AUDIO_EMBED_BLOCK_REGEX, (match) => {
        const attrs = getAudioEmbedAttributesFromHtml(match);
        if (attrs?.path && !seenPaths.has(attrs.path)) {
            seenPaths.add(attrs.path);
            orderedPaths.push(attrs.path);
        }
        return match;
    });

    normalizedContent.replace(AUDIO_MARKDOWN_REGEX, (_match, rawPath: string) => {
        const path = normalizeAudioPath(rawPath);
        if (path && !seenPaths.has(path)) {
            seenPaths.add(path);
            orderedPaths.push(path);
        }
        return _match;
    });

    return orderedPaths;
};

export const removeAudioEmbedFromContent = (content: string, targetPath: string): string => {
    if (!content) {
        return '';
    }

    let next = normalizeLegacyAudioEmbeds(content);
    const isHtmlContent = HTML_TAG_REGEX.test(next);

    next = next.replace(AUDIO_EMBED_BLOCK_REGEX, (match) => {
        const attrs = getAudioEmbedAttributesFromHtml(match);
        if (!attrs || !audioPathMatches(attrs.path, targetPath)) {
            return match;
        }

        return '';
    });

    next = next.replace(AUDIO_MARKDOWN_REGEX, (match, rawPath: string) => (
        audioPathMatches(rawPath, targetPath) ? '' : match
    ));

    const collapsed = next
        .replace(EMPTY_HTML_BLOCK_REGEX, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    if (collapsed) {
        return collapsed;
    }

    return isHtmlContent ? '<p></p>' : '';
};

export const hasAudioEmbeds = (content: string): boolean =>
    extractAudioEmbedPaths(content).length > 0;
