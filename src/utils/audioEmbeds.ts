import { colors, isDarkScheme, onColorSchemeChange } from '../theme/colors';

export const AUDIO_EMBED_NODE_NAME = 'vaultoAudioEmbed';
export const AUDIO_EMBED_ATTR = 'data-audio-player';
export const AUDIO_EMBED_PATH_ATTR = 'data-audio-path';
export const AUDIO_EMBED_DURATION_ATTR = 'data-audio-duration';
export const AUDIO_EMBED_SRC_ATTR = 'data-audio-src';
export const LEGACY_AUDIO_TITLE_PREFIX = 'vaulto-audio:';
export const AUDIO_PREVIEW_MARKER = '#vaulto-audio=';
export const AUDIO_PREVIEW_ALT = 'audio-preview';
export const AUDIO_PREVIEW_VIEWBOX_WIDTH = 680;
export const AUDIO_PREVIEW_VIEWBOX_HEIGHT = 176;
export const AUDIO_PREVIEW_PLAY_END = 184;
export const AUDIO_PREVIEW_PROGRESS_START = 196;
export const AUDIO_PREVIEW_PROGRESS_END = 524;
export const AUDIO_PREVIEW_PROGRESS_TOP = 98;
export const AUDIO_PREVIEW_PROGRESS_BOTTOM = 122;
export const AUDIO_PREVIEW_SPEED_START = 544;
export const AUDIO_PREVIEW_SPEED_END = 648;
export const AUDIO_PREVIEW_SPEED_TOP = 66;
export const AUDIO_PREVIEW_SPEED_BOTTOM = 110;
// Colours of the in-note audio card. They are `let` so they follow the theme:
// importers read the live binding each time they build the card.
type AudioPreviewPalette = {
    cardBackground: string; cardBorder: string; accent: string; accentSoft: string; track: string;
    text: string; subtext: string; speedBackground: string; speedBorder: string; waveIdle: string; waveLoading: string;
};
const audioPreviewPalette = (): AudioPreviewPalette => (isDarkScheme()
    ? {
        cardBackground: colors.surface, cardBorder: colors.border, accent: colors.primary,
        accentSoft: 'rgba(61, 139, 255, 0.22)', track: '#26344D', text: colors.text, subtext: colors.textSecondary,
        speedBackground: '#23272C', speedBorder: '#3A4047', waveIdle: '#3A4047', waveLoading: '#30353B',
    }
    : {
        cardBackground: colors.surface, cardBorder: colors.border, accent: colors.primary,
        accentSoft: '#DCE8FF', track: '#E8F0FF', text: colors.text, subtext: colors.textSecondary,
        speedBackground: '#F2F5F8', speedBorder: '#DCE3EC', waveIdle: '#DCE3EC', waveLoading: '#D7DFEA',
    });
export let AUDIO_PREVIEW_CARD_BACKGROUND = '';
export let AUDIO_PREVIEW_CARD_BORDER = '';
export let AUDIO_PREVIEW_ACCENT = '';
export let AUDIO_PREVIEW_ACCENT_SOFT = '';
export let AUDIO_PREVIEW_TRACK = '';
export let AUDIO_PREVIEW_TEXT = '';
export let AUDIO_PREVIEW_SUBTEXT = '';
export let AUDIO_PREVIEW_SPEED_BACKGROUND = '';
export let AUDIO_PREVIEW_SPEED_BORDER = '';
export let AUDIO_PREVIEW_WAVE_IDLE = '';
export let AUDIO_PREVIEW_WAVE_LOADING = '';
const applyAudioPreviewPalette = () => {
    const palette = audioPreviewPalette();
    AUDIO_PREVIEW_CARD_BACKGROUND = palette.cardBackground;
    AUDIO_PREVIEW_CARD_BORDER = palette.cardBorder;
    AUDIO_PREVIEW_ACCENT = palette.accent;
    AUDIO_PREVIEW_ACCENT_SOFT = palette.accentSoft;
    AUDIO_PREVIEW_TRACK = palette.track;
    AUDIO_PREVIEW_TEXT = palette.text;
    AUDIO_PREVIEW_SUBTEXT = palette.subtext;
    AUDIO_PREVIEW_SPEED_BACKGROUND = palette.speedBackground;
    AUDIO_PREVIEW_SPEED_BORDER = palette.speedBorder;
    AUDIO_PREVIEW_WAVE_IDLE = palette.waveIdle;
    AUDIO_PREVIEW_WAVE_LOADING = palette.waveLoading;
};
applyAudioPreviewPalette();
onColorSchemeChange(applyAudioPreviewPalette);
export const AUDIO_PREVIEW_WAVE_HEIGHTS = [16, 30, 22, 36, 18, 28, 14, 32, 24, 38, 18, 30, 16, 36, 20, 28, 14, 22];

export const AUDIO_EMBED_BLOCK_REGEX = /<div\b[^>]*data-audio-player=(["'])true\1[^>]*><\/div>/gi;
export const AUDIO_IMG_EMBED_REGEX = /<img\b[^>]*>/gi;
export const LEGACY_AUDIO_EMBED_BLOCK_REGEX = /<div\b[^>]*data-audio-player=(["'])true\1[^>]*><\/div>/gi;
export const LEGACY_CODEBLOCK_AUDIO_REGEX = /<pre>\s*<code\b[^>]*class=(["'])language-vaulto-audio\1[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi;

const AUDIO_MARKDOWN_REGEX = /!\[audio\]\((.*?)\)/gi;
const LEGACY_AUDIO_PREVIEW_IMAGE_REGEX = /<img\b[^>]*(?:alt=(["'])audio-preview\1|title=(["'])vaulto-audio:(?!\/\/)[^"']*\2)[^>]*>/gi;
const EMPTY_HTML_BLOCK_REGEX = /<(p|div)>(\s|&nbsp;|<br\s*\/?>)*<\/\1>/gi;
const HTML_TAG_REGEX = /<\/?[a-z][\s\S]*>/i;

export type AudioEmbedAttributes = {
    path: string;
    duration?: number | null;
    src?: string | null;
};

type AudioPreviewPayload = {
    kind: 'vaulto-audio';
    path: string;
    duration?: number;
    position?: number;
    isPlaying?: boolean;
    playbackSpeed?: number;
    isLoading?: boolean;
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

const formatDuration = (value?: number | null): string => {
    const safeValue = typeof value === 'number' && Number.isFinite(value)
        ? Math.max(0, value)
        : 0;
    const minutes = Math.floor(safeValue / 60);
    const seconds = Math.floor(safeValue % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const normalizeAudioPath = (value?: string | null): string | null => {
    if (!value) {
        return null;
    }

    let normalized = value.trim();

    while (normalized.includes('vaulto-audio:')) {
        const index = normalized.indexOf('vaulto-audio:');
        normalized = normalized.slice(index + 'vaulto-audio:'.length);

        if (normalized.startsWith('//')) {
            normalized = normalized.slice(2);
        }

        try {
            const decoded = decodeURIComponent(normalized);
            if (decoded !== normalized) {
                normalized = decoded;
            } else {
                break;
            }
        } catch {
            break;
        }
    }

    normalized = normalized.replace(/^\/+(file:\/\/\/)/i, '$1');
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

const buildAudioPreviewSvg = (payload: AudioPreviewPayload): string => {
    const duration = typeof payload.duration === 'number' && Number.isFinite(payload.duration)
        ? Math.max(0, payload.duration)
        : 0;
    const position = typeof payload.position === 'number' && Number.isFinite(payload.position)
        ? Math.max(0, Math.min(duration || 0, payload.position))
        : 0;
    const progressRatio = duration > 0 ? Math.max(0, Math.min(1, position / duration)) : 0;
    const playbackSpeed = typeof payload.playbackSpeed === 'number' && Number.isFinite(payload.playbackSpeed)
        ? payload.playbackSpeed
        : 1;
    const isPlaying = !!payload.isPlaying;
    const isLoading = !!payload.isLoading;
    const progressTrackWidth = AUDIO_PREVIEW_PROGRESS_END - AUDIO_PREVIEW_PROGRESS_START;
    const progressWidth = Math.round(progressTrackWidth * progressRatio);
    const progressKnobX = AUDIO_PREVIEW_PROGRESS_START + progressWidth;
    const remaining = Math.max(0, duration - position);
    // Same drawn icons as the editor runtime (richTextAudioBridge), not text glyphs.
    const iconSvg = isLoading
        ? '<circle cx="78" cy="88" r="6" fill="#FFFFFF"/><circle cx="94" cy="88" r="6" fill="#FFFFFF"/><circle cx="110" cy="88" r="6" fill="#FFFFFF"/>'
        : (isPlaying
            ? '<rect x="79" y="70" width="11" height="36" rx="3" fill="#FFFFFF"/><rect x="98" y="70" width="11" height="36" rx="3" fill="#FFFFFF"/>'
            : '<path d="M84 68 L84 108 Q84 113 89 110 L116 92 Q120 88 116 84 L89 66 Q84 63 84 68 Z" fill="#FFFFFF"/>');
    const speedText = `${String(playbackSpeed).replace(/\.0$/, '')}x`;
    const waveStartX = 198;
    const waveBaseY = 58;
    const waveBarWidth = 10;
    const waveGap = 9;
    const playedWaveCount = Math.max(0, Math.min(
        AUDIO_PREVIEW_WAVE_HEIGHTS.length,
        Math.round(AUDIO_PREVIEW_WAVE_HEIGHTS.length * progressRatio)
    ));
    const waveBars = AUDIO_PREVIEW_WAVE_HEIGHTS.map((height, index) => {
        const x = waveStartX + index * (waveBarWidth + waveGap);
        const y = waveBaseY - Math.round(height / 2);
        const fill = isLoading
            ? AUDIO_PREVIEW_WAVE_LOADING
            : (index < playedWaveCount ? AUDIO_PREVIEW_ACCENT : AUDIO_PREVIEW_WAVE_IDLE);
        return `<rect x="${x}" y="${y}" width="${waveBarWidth}" height="${height}" rx="5" fill="${fill}"/>`;
    }).join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${AUDIO_PREVIEW_VIEWBOX_WIDTH}" height="${AUDIO_PREVIEW_VIEWBOX_HEIGHT}" viewBox="0 0 ${AUDIO_PREVIEW_VIEWBOX_WIDTH} ${AUDIO_PREVIEW_VIEWBOX_HEIGHT}">
<rect x="8" y="10" width="664" height="156" rx="32" fill="${AUDIO_PREVIEW_CARD_BACKGROUND}" stroke="${AUDIO_PREVIEW_CARD_BORDER}" stroke-width="2"/>
<circle cx="94" cy="88" r="52" fill="${AUDIO_PREVIEW_ACCENT_SOFT}"/>
<circle cx="94" cy="88" r="45" fill="${AUDIO_PREVIEW_ACCENT}"/>
${iconSvg}
${waveBars}
<rect x="${AUDIO_PREVIEW_SPEED_START}" y="${AUDIO_PREVIEW_SPEED_TOP}" width="${AUDIO_PREVIEW_SPEED_END - AUDIO_PREVIEW_SPEED_START}" height="${AUDIO_PREVIEW_SPEED_BOTTOM - AUDIO_PREVIEW_SPEED_TOP}" rx="19" fill="${AUDIO_PREVIEW_SPEED_BACKGROUND}" stroke="${AUDIO_PREVIEW_SPEED_BORDER}" stroke-width="2"/>
<text x="${Math.round((AUDIO_PREVIEW_SPEED_START + AUDIO_PREVIEW_SPEED_END) / 2)}" y="94" text-anchor="middle" font-family="Arial, sans-serif" font-size="19" font-weight="700" fill="${AUDIO_PREVIEW_TEXT}">${escapeHtml(speedText)}</text>
<rect x="${AUDIO_PREVIEW_PROGRESS_START}" y="106" width="${progressTrackWidth}" height="8" rx="4" fill="${AUDIO_PREVIEW_TRACK}"/>
<rect x="${AUDIO_PREVIEW_PROGRESS_START}" y="106" width="${progressWidth}" height="8" rx="4" fill="${AUDIO_PREVIEW_ACCENT}"/>
<circle cx="${progressKnobX}" cy="110" r="8" fill="#FFFFFF" stroke="${AUDIO_PREVIEW_ACCENT}" stroke-width="4"/>
<text x="${AUDIO_PREVIEW_PROGRESS_START}" y="144" text-anchor="start" font-family="Arial, sans-serif" font-size="15" font-weight="600" fill="${AUDIO_PREVIEW_SUBTEXT}">${escapeHtml(formatDuration(position))}</text>
<text x="${AUDIO_PREVIEW_SPEED_END}" y="144" text-anchor="end" font-family="Arial, sans-serif" font-size="15" font-weight="600" fill="${AUDIO_PREVIEW_SUBTEXT}">${escapeHtml(formatDuration(remaining))}</text>
</svg>`;
};

const parseAudioPreviewPayload = (encodedPayload: string): AudioPreviewPayload | null => {
    try {
        const decoded = decodeURIComponent(encodedPayload);
        const parsed = JSON.parse(decoded) as Partial<AudioPreviewPayload>;
        const normalizedPath = normalizeAudioPath(parsed.path);
        if (!normalizedPath) {
            return null;
        }

        return {
            kind: 'vaulto-audio',
            path: normalizedPath,
            duration: typeof parsed.duration === 'number' && Number.isFinite(parsed.duration)
                ? Math.max(0, parsed.duration)
                : undefined,
            position: typeof parsed.position === 'number' && Number.isFinite(parsed.position)
                ? Math.max(0, parsed.position)
                : undefined,
            isPlaying: !!parsed.isPlaying,
            playbackSpeed: typeof parsed.playbackSpeed === 'number' && Number.isFinite(parsed.playbackSpeed)
                ? parsed.playbackSpeed
                : undefined,
            isLoading: !!parsed.isLoading,
        };
    } catch {
        return null;
    }
};

const buildAudioPreviewPayload = (
    payload: AudioEmbedAttributes & {
        position?: number;
        isPlaying?: boolean;
        playbackSpeed?: number;
        isLoading?: boolean;
    }
): AudioPreviewPayload | null => {
    const normalizedPath = normalizeAudioPath(payload.path);
    if (!normalizedPath) {
        return null;
    }

    return {
        kind: 'vaulto-audio',
        path: normalizedPath,
        duration: typeof payload.duration === 'number' && Number.isFinite(payload.duration)
            ? Math.max(0, payload.duration)
            : undefined,
        position: typeof payload.position === 'number' && Number.isFinite(payload.position)
            ? Math.max(0, payload.position)
            : undefined,
        isPlaying: !!payload.isPlaying,
        playbackSpeed: typeof payload.playbackSpeed === 'number' && Number.isFinite(payload.playbackSpeed)
            ? payload.playbackSpeed
            : undefined,
        isLoading: !!payload.isLoading,
    };
};

export const isAudioEmbedImageSrc = (src?: string | null): boolean =>
    typeof src === 'string' && src.includes(AUDIO_PREVIEW_MARKER);

export const getAudioEmbedAttributesFromImageSrc = (src?: string | null): AudioEmbedAttributes | null => {
    if (!isAudioEmbedImageSrc(src)) {
        return null;
    }

    const markerIndex = (src || '').indexOf(AUDIO_PREVIEW_MARKER);
    if (markerIndex === -1) {
        return null;
    }

    const payload = parseAudioPreviewPayload((src || '').slice(markerIndex + AUDIO_PREVIEW_MARKER.length));
    if (!payload?.path) {
        return null;
    }

    return {
        path: payload.path,
        duration: typeof payload.duration === 'number' ? payload.duration : null,
        src: null,
    };
};

export const buildAudioEmbedPreviewSrc = (
    payload: AudioEmbedAttributes & {
        position?: number;
        isPlaying?: boolean;
        playbackSpeed?: number;
        isLoading?: boolean;
    }
): string => {
    const normalizedPayload = buildAudioPreviewPayload(payload);
    if (!normalizedPayload) {
        return '';
    }

    const svg = buildAudioPreviewSvg(normalizedPayload);
    const metadata = encodeURIComponent(JSON.stringify(normalizedPayload));
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}${AUDIO_PREVIEW_MARKER}${metadata}`;
};

const normalizeLegacyAudioEmbeds = (content: string): string => {
    let nextContent = content.replace(LEGACY_AUDIO_PREVIEW_IMAGE_REGEX, (match) => {
        const attrs = getAudioEmbedAttributesFromHtml(match);
        return attrs ? buildAudioEmbedHtml(attrs) : '';
    });

    nextContent = nextContent.replace(LEGACY_AUDIO_EMBED_BLOCK_REGEX, (match) => {
        const attrs = getAudioEmbedAttributesFromHtml(match);
        return attrs ? buildAudioEmbedHtml(attrs) : '';
    });

    nextContent = nextContent.replace(LEGACY_CODEBLOCK_AUDIO_REGEX, (match, _quote, json) => {
        try {
            const payload = JSON.parse(decodeHtmlAttribute(json));
            return buildAudioEmbedHtml({
                path: payload.path,
                duration: payload.duration,
            });
        } catch {
            return match;
        }
    });

    nextContent = nextContent.replace(AUDIO_IMG_EMBED_REGEX, (match) => {
        const attrs = getAudioEmbedAttributesFromHtml(match);
        return attrs ? buildAudioEmbedHtml(attrs) : match;
    });

    return nextContent;
};

export const buildAudioEmbedHtml = ({ path, duration }: AudioEmbedAttributes): string => {
    const normalizedPath = normalizeAudioPath(path);
    if (!normalizedPath) {
        return '';
    }

    const previewSrc = buildAudioEmbedPreviewSrc({
        path: normalizedPath,
        duration,
    });
    if (!previewSrc) {
        return '';
    }

    return `<img src="${escapeHtmlAttribute(previewSrc)}" alt="${AUDIO_PREVIEW_ALT}" title="${LEGACY_AUDIO_TITLE_PREFIX}${encodeURIComponent(normalizedPath)}">`;
};

export const getAudioEmbedAttributesFromHtml = (html: string): AudioEmbedAttributes | null => {
    const imageSrc = getHtmlAttributeValue(html, 'src');
    const imageAttrs = getAudioEmbedAttributesFromImageSrc(imageSrc);
    if (imageAttrs) {
        return imageAttrs;
    }

    const legacyPath = normalizeAudioPath(getHtmlAttributeValue(html, AUDIO_EMBED_PATH_ATTR));
    if (legacyPath) {
        const durationValue = getHtmlAttributeValue(html, AUDIO_EMBED_DURATION_ATTR);
        const parsedDuration = durationValue !== null ? Number(durationValue) : null;
        return {
            path: legacyPath,
            duration: Number.isFinite(parsedDuration) ? parsedDuration : null,
            src: null,
        };
    }

    const title = getHtmlAttributeValue(html, 'title');
    const decodedLegacyPath = title ? decodeLegacyAudioPath(title) : null;
    if (decodedLegacyPath) {
        return {
            path: decodedLegacyPath,
            duration: null,
            src: null,
        };
    }

    return null;
};

export const stripTransientAudioEmbedState = (content: string): string => {
    if (!content) {
        return '';
    }

    return normalizeLegacyAudioEmbeds(content);
};

export const applyAudioSourceMapToHtml = (
    content: string,
    _audioSourceMap?: Record<string, string | null | undefined>
): string => stripTransientAudioEmbedState(content);

export const extractAudioEmbedPaths = (content: string): string[] => {
    if (!content) {
        return [];
    }

    const normalizedContent = normalizeLegacyAudioEmbeds(content);
    const orderedPaths: string[] = [];
    const seenPaths = new Set<string>();

    normalizedContent.replace(AUDIO_IMG_EMBED_REGEX, (match) => {
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

    next = next.replace(AUDIO_IMG_EMBED_REGEX, (match) => {
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
