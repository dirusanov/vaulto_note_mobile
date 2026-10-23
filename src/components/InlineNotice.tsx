import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, isDarkScheme } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { createStyles } from '../theme/createStyles';

export interface InlineNoticeAction {
    label: string;
    onPress: () => void;
}

interface InlineNoticeProps {
    message: string | null;
    actions?: InlineNoticeAction[];
    onDismiss: () => void;
}

/**
 * A quiet bottom bar for something the user may act on but need not (a voice
 * request that could not be carried out, a limit that changes what recordings
 * do). Unlike a dialog it never blocks the note.
 */
export const InlineNotice = ({ message, actions = [], onDismiss }: InlineNoticeProps) => {
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    if (!message) return null;
    return (
        <View
            pointerEvents="box-none"
            // Same place as the undo bar: above the floating mic button.
            style={[styles.wrapper, { bottom: Math.max(insets.bottom, spacing.m) + 132 }]}
            accessibilityLiveRegion="polite"
        >
            <View style={styles.bar}>
                <View style={styles.topRow}>
                    <Text style={styles.message}>{message}</Text>
                    <TouchableOpacity
                        onPress={onDismiss}
                        hitSlop={10}
                        style={styles.close}
                        accessibilityRole="button"
                        accessibilityLabel={t('a11y.close', 'Close')}
                    >
                        <MaterialIcons name="close" size={18} color="rgba(255,255,255,0.7)" />
                    </TouchableOpacity>
                </View>
                {actions.length > 0 && (
                    <View style={styles.actions}>
                        {actions.map((action) => (
                            <TouchableOpacity
                                key={action.label}
                                onPress={action.onPress}
                                style={styles.actionButton}
                                accessibilityRole="button"
                            >
                                <Text style={styles.actionText}>{action.label}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                )}
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
        maxWidth: 560,
        backgroundColor: isDarkScheme() ? '#2E333A' : '#1F2328',
        borderRadius: 12,
        paddingTop: 12,
        paddingBottom: 4,
        paddingHorizontal: spacing.m,
    },
    topRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.s,
        paddingBottom: 8,
    },
    message: {
        flex: 1,
        color: colors.onPrimary,
        fontSize: 14,
        lineHeight: 20,
    },
    close: {
        paddingTop: 1,
    },
    actions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        flexWrap: 'wrap',
        gap: spacing.s,
    },
    // 44dp tall while the bar itself stays slim.
    actionButton: {
        minHeight: 44,
        justifyContent: 'center',
        paddingHorizontal: spacing.s,
    },
    actionText: {
        color: '#6EA8FF',
        fontSize: 14,
        fontWeight: '700',
    },
}));
