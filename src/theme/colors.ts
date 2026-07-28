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

export const colors = {
    ...sharedColors,

    // Notes-specific
    activeWordHighlight: 'rgba(0, 102, 255, 0.1)',
};
