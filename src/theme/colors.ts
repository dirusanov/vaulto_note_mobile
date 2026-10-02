// ─── Shared Vaulto palette ───────────────────────────────────────────────────
// This block is byte-identical in vaulto-cards and vaulto_note_mobile, and the
// Chrome extension mirrors the same roles in tailwind.config.js. The table in
// DESIGN_TOKENS.md is the reference; change a value in all three or in none.
// App-specific colours belong below `colors`, not in here.
export const sharedColors = {
    // Backgrounds
    background: '#F8F9FA',
    backgroundSecondary: '#E9ECEF',

    // Surfaces
    surface: '#FFFFFF',
    surfaceElevated: '#FFFFFF',

    // Primary
    primary: '#0066FF',
    primaryLight: 'rgba(0, 102, 255, 0.12)',
    primaryHover: '#0052CC',

    // Text hierarchy
    text: '#1A1A1A',
    textSecondary: '#6C757D',
    textTertiary: '#ADB5BD',
    textMuted: '#CED4DA',

    // Accents
    accent: '#0066FF',
    accentLight: '#4D94FF',
    accentPurple: '#8B5CF6',
    accentPink: '#EC4899',
    accentGreen: '#10B981',
    accentOrange: '#F59E0B',
    accentYellow: '#FFC107',

    // Borders
    border: '#DEE2E6',
    borderHover: '#CED4DA',

    // States
    error: '#DC3545',
    success: '#10B981',
    warning: '#F59E0B',

    // Overlays
    overlay: 'rgba(0, 0, 0, 0.5)',
    cardShadow: 'rgba(0, 0, 0, 0.06)',

    // Highlight palette
    highlight: {
        yellow: '#FFFFBA',
        red: '#FFB3BA',
        orange: '#FFDFBA',
        green: '#BAFFC9',
        blue: '#BAE1FF',
        purple: '#E2BAFF',
        pink: '#FFC4E1',
        cyan: '#B5F2EA',
        lime: '#E7FFAC',
        white: '#FFFFFF',
    },
};
// ─── End shared Vaulto palette ───────────────────────────────────────────────

const lightColors = {
    ...sharedColors,

    // Notes-specific
    activeWordHighlight: 'rgba(0, 102, 255, 0.1)',
    /** Text and icons drawn on a `primary` (or other saturated) fill. */
    onPrimary: '#FFFFFF',
    /** Translucent wash behind warnings and errors. */
    errorLight: 'rgba(220, 53, 69, 0.08)',
    warningLight: 'rgba(245, 158, 11, 0.1)',
    successLight: 'rgba(16, 185, 129, 0.1)',
};

export type Palette = typeof lightColors;
export type ColorScheme = 'light' | 'dark';

// Dark counterparts of the same roles. Surfaces step up in lightness instead of
// relying on shadows, which barely show on a dark background.
const darkColors: Palette = {
    background: '#0F1113',
    backgroundSecondary: '#1F2329',

    surface: '#181B1F',
    surfaceElevated: '#252A30',

    primary: '#3D8BFF',
    primaryLight: 'rgba(61, 139, 255, 0.18)',
    primaryHover: '#66A3FF',

    text: '#ECEEF1',
    textSecondary: '#A1A8B1',
    textTertiary: '#737B85',
    textMuted: '#4E555E',

    accent: '#3D8BFF',
    accentLight: '#66A3FF',
    accentPurple: '#A78BFA',
    accentPink: '#F472B6',
    accentGreen: '#34D399',
    accentOrange: '#FBBF24',
    accentYellow: '#FCD34D',

    border: '#2B3036',
    borderHover: '#3A4047',

    error: '#F26B78',
    success: '#34D399',
    warning: '#FBBF24',

    overlay: 'rgba(0, 0, 0, 0.6)',
    cardShadow: 'rgba(0, 0, 0, 0.4)',

    // Highlights keep their pastel fill; the editor draws dark text on them.
    highlight: { ...sharedColors.highlight },

    activeWordHighlight: 'rgba(61, 139, 255, 0.2)',
    onPrimary: '#FFFFFF',
    errorLight: 'rgba(242, 107, 120, 0.14)',
    warningLight: 'rgba(251, 191, 36, 0.14)',
    successLight: 'rgba(52, 211, 153, 0.14)',
};

const palettes: Record<ColorScheme, Palette> = { light: lightColors, dark: darkColors };
let activeScheme: ColorScheme = 'light';
const listeners = new Set<(scheme: ColorScheme) => void>();

export const getColorScheme = (): ColorScheme => activeScheme;
export const isDarkScheme = (): boolean => activeScheme === 'dark';

/**
 * Switches the palette every `colors.x` read resolves to. Styles made with
 * `createStyles` follow on their next read; the ThemeProvider remounts the UI
 * so already-rendered components pick the new values up.
 */
export const setColorScheme = (scheme: ColorScheme) => {
    if (scheme === activeScheme) return;
    activeScheme = scheme;
    listeners.forEach((listener) => listener(scheme));
};

export const onColorSchemeChange = (listener: (scheme: ColorScheme) => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

/** Reads always go to the active palette, so `colors.text` is right in either theme. */
export const colors: Palette = new Proxy({} as Palette, {
    get: (_target, key) => (palettes[activeScheme] as any)[key],
    has: (_target, key) => key in palettes[activeScheme],
    ownKeys: () => Reflect.ownKeys(palettes[activeScheme]),
    getOwnPropertyDescriptor: (_target, key) => {
        const descriptor = Reflect.getOwnPropertyDescriptor(palettes[activeScheme], key);
        return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
});
