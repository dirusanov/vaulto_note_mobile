// Colour conversions for the custom colour picker (hue 0..360, s/v 0..1).

export type Hsv = { h: number; s: number; v: number };

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export const normalizeHex = (hex: string): string | null => {
    const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
    if (!match) {
        return null;
    }
    const digits = match[1].length === 3 ? match[1].split('').map((c) => c + c).join('') : match[1];
    return `#${digits.toUpperCase()}`;
};

export const hexToHsv = (hex: string): Hsv => {
    const value = parseInt((normalizeHex(hex) || '#000000').slice(1), 16);
    const r = ((value >> 16) & 255) / 255;
    const g = ((value >> 8) & 255) / 255;
    const b = (value & 255) / 255;
    const max = Math.max(r, g, b);
    const delta = max - Math.min(r, g, b);
    let h = 0;
    if (delta > 0) {
        if (max === r) {
            h = 60 * (((g - b) / delta) % 6);
        } else if (max === g) {
            h = 60 * ((b - r) / delta + 2);
        } else {
            h = 60 * ((r - g) / delta + 4);
        }
    }
    return { h: (h + 360) % 360, s: max === 0 ? 0 : delta / max, v: max };
};

export const hsvToHex = ({ h, s, v }: Hsv): string => {
    const hue = ((h % 360) + 360) % 360;
    const sat = clamp01(s);
    const val = clamp01(v);
    const c = val * sat;
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = val - c;
    const [r, g, b] = hue < 60 ? [c, x, 0]
        : hue < 120 ? [x, c, 0]
            : hue < 180 ? [0, c, x]
                : hue < 240 ? [0, x, c]
                    : hue < 300 ? [x, 0, c]
                        : [c, 0, x];
    const toHex = (channel: number) => Math.round((channel + m) * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
};

/** Most recent first, without duplicates, at most `limit` colours. */
export const pushRecentColor = (recent: string[], color: string, limit = 8): string[] => {
    const normalized = normalizeHex(color);
    if (!normalized) {
        return recent;
    }
    return [normalized, ...recent.filter((item) => item !== normalized)].slice(0, limit);
};
