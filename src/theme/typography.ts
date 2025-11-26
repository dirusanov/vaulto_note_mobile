import { TextStyle } from 'react-native';
import { colors } from './colors';

export const typography: Record<string, TextStyle> = {
    // Headings
    h1: {
        fontSize: 32,
        fontWeight: '700',
        color: colors.text,
        lineHeight: 38,
        letterSpacing: -0.5,
    },
    h2: {
        fontSize: 24,
        fontWeight: '600',
        color: colors.text,
        lineHeight: 32,
        letterSpacing: -0.3,
    },
    h3: {
        fontSize: 20,
        fontWeight: '600',
        color: colors.text,
        lineHeight: 28,
    },

    // Body text
    body: {
        fontSize: 16,
        fontWeight: '400',
        color: colors.text,
        lineHeight: 24,
    },
    bodyLarge: {
        fontSize: 18,
        fontWeight: '400',
        color: colors.text,
        lineHeight: 28,
    },
    bodySmall: {
        fontSize: 14,
        fontWeight: '400',
        color: colors.textSecondary,
        lineHeight: 20,
    },

    // Captions and metadata
    caption: {
        fontSize: 13,
        fontWeight: '400',
        color: colors.textTertiary,
        lineHeight: 18,
    },
    captionBold: {
        fontSize: 13,
        fontWeight: '600',
        color: colors.textSecondary,
        lineHeight: 18,
    },

    // Interactive elements
    button: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.surface,
        letterSpacing: -0.2,
    },
    buttonSmall: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.surface,
    },

    // Note-specific
    noteTitle: {
        fontSize: 17,
        fontWeight: '600',
        color: colors.text,
        lineHeight: 24,
        letterSpacing: -0.2,
    },
    notePreview: {
        fontSize: 15,
        fontWeight: '400',
        color: colors.textSecondary,
        lineHeight: 22,
    },
};
