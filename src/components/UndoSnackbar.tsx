import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, isDarkScheme } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { createStyles } from '../theme/createStyles';

interface UndoSnackbarProps {
    message: string | null;
    onUndo: () => void;
}

/** Bottom bar offering to take back an action that was applied immediately. */
export const UndoSnackbar = ({ message, onUndo }: UndoSnackbarProps) => {
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    if (!message) return null;
    return (
        <View
            pointerEvents="box-none"
            // Sits above the floating mic button so taps reach Undo, not the mic.
            style={[styles.wrapper, { bottom: Math.max(insets.bottom, spacing.m) + 132 }]}
            accessibilityLiveRegion="polite"
        >
            <View style={styles.bar}>
                <Text style={styles.message} numberOfLines={2}>{message}</Text>
                <TouchableOpacity onPress={onUndo} style={styles.undoButton} accessibilityRole="button">
                    <Text style={styles.undo}>{t('edit.versions.undo', 'Undo')}</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
};

const styles = createStyles(() => ({
    wrapper: {
        position: 'absolute',
        left: spacing.m,
        right: spacing.m,
        alignItems: 'center',
        zIndex: 1000,
        elevation: 12,
    },
    bar: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: isDarkScheme() ? '#2E333A' : '#1F2328',
        borderRadius: 12,
        paddingVertical: 12,
        paddingHorizontal: spacing.m,
        gap: spacing.m,
    },
    // 48dp tall while the bar itself stays slim.
    undoButton: {
        minHeight: 48,
        justifyContent: 'center',
        paddingHorizontal: spacing.s,
        marginVertical: -12,
        marginRight: -spacing.s,
    },
    message: {
        flex: 1,
        color: colors.onPrimary,
        fontSize: 14,
    },
    undo: {
        color: '#6EA8FF',
        fontSize: 14,
        fontWeight: '700',
    },
}));
