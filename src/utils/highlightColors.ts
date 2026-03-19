import { colors } from '../theme/colors';

export type HighlightPaletteEntry = {
    name: string;
    hex: string;
};

const HEX_COLOR_REGEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_COLOR_REGEX = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(\d*\.?\d+))?\s*\)$/i;
const HSL_COLOR_REGEX = /^hsla?\(\s*[-\d.]+\s*,\s*[-\d.]+%\s*,\s*[-\d.]+%(?:\s*,\s*(\d*\.?\d+))?\s*\)$/i;

const clampColorComponent = (value: number): number =>
    Math.max(0, Math.min(255, Math.round(value)));

const toHexComponent = (value: number): string =>
    clampColorComponent(value).toString(16).padStart(2, '0');

const expandShortHex = (value: string): string =>
    `#${value.slice(1).split('').map((part) => part + part).join('')}`;

const normalizeHexColor = (value: string): string => {
    const trimmed = value.trim().toLowerCase();
    if (trimmed.length === 4) {
        return expandShortHex(trimmed);
    }

    if (trimmed.length === 9) {
        return trimmed.slice(0, 7);
    }

    return trimmed;
};

const normalizeRgbColor = (value: string): string => {
    const match = value.trim().match(RGB_COLOR_REGEX);
    if (!match) {
        return value.trim().toLowerCase();
    }

    const [, red, green, blue] = match;
    return `#${toHexComponent(Number(red))}${toHexComponent(Number(green))}${toHexComponent(Number(blue))}`;
};

export const highlightPalette: HighlightPaletteEntry[] = Object.entries(colors.highlight).map(([name, hex]) => ({
    name,
    hex,
}));

export const normalizeColorForComparison = (value?: string | null): string => {
    const trimmed = value?.trim().toLowerCase() || '';
    if (!trimmed) {
        return '';
    }

    const paletteEntry = highlightPalette.find((entry) => entry.name === trimmed);
    if (paletteEntry) {
        return paletteEntry.hex.toLowerCase();
    }

    if (HEX_COLOR_REGEX.test(trimmed)) {
        return normalizeHexColor(trimmed);
    }

    if (RGB_COLOR_REGEX.test(trimmed)) {
        return normalizeRgbColor(trimmed);
    }

    return trimmed;
};

export const findHighlightPaletteEntry = (value?: string | null): HighlightPaletteEntry | undefined => {
    const normalized = normalizeColorForComparison(value);
    if (!normalized) {
        return undefined;
    }

    return highlightPalette.find((entry) => normalizeColorForComparison(entry.hex) === normalized);
};

export const normalizeHighlightColorForCss = (value?: string | null, fallback?: string): string => {
    const trimmed = value?.trim();
    if (!trimmed) {
        return fallback ?? colors.highlight.yellow;
    }

    const paletteEntry = findHighlightPaletteEntry(trimmed);
    if (paletteEntry) {
        return paletteEntry.hex;
    }

    return trimmed;
};

export const isHighlightColorToken = (value?: string | null): boolean => {
    const trimmed = value?.trim();
    if (!trimmed) {
        return false;
    }

    return !!findHighlightPaletteEntry(trimmed)
        || HEX_COLOR_REGEX.test(trimmed)
        || RGB_COLOR_REGEX.test(trimmed)
        || HSL_COLOR_REGEX.test(trimmed);
};

export const isDefaultHighlightColor = (value?: string | null): boolean => {
    if (!value?.trim()) {
        return true;
    }

    const paletteEntry = findHighlightPaletteEntry(value);
    if (paletteEntry) {
        return paletteEntry.name === 'yellow';
    }

    return normalizeColorForComparison(value) === normalizeColorForComparison(colors.highlight.yellow);
};
