import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { createStyles } from '../theme/createStyles';

interface SelectionActionPanelProps {
    selectedCount: number;
    onPin: () => void;
    onUnpin: () => void;
    onDelete: () => void;
    onClose: () => void;
    allPinned: boolean; // true if all selected notes are pinned
}

export const SelectionActionPanel = ({
    selectedCount,
    onPin,
    onUnpin,
    onDelete,
    onClose,
    allPinned,
}: SelectionActionPanelProps) => {
    const { t } = useTranslation();

    return (
        <View style={styles.container}>
            <View style={styles.content}>
                <TouchableOpacity
                    onPress={onClose}
                    style={styles.closeButton}
                    accessibilityRole="button"
                    accessibilityLabel={t('a11y.clearSelection', 'Clear selection')}
                >
                    <MaterialIcons name="close" size={24} color={colors.text} />
                </TouchableOpacity>

                <Text style={styles.countText}>{t('notes.selectedCount', '{{count}} selected', { count: selectedCount })}</Text>

                <View style={styles.actions}>
                    <TouchableOpacity
                        onPress={allPinned ? onUnpin : onPin}
                        style={styles.actionButton}
                        accessibilityRole="button"
                        accessibilityLabel={allPinned ? t('a11y.unpin', 'Unpin') : t('a11y.pin', 'Pin')}
                    >
                        <MaterialIcons
                            name="push-pin"
                            size={24}
                            color={allPinned ? colors.primary : colors.text}
                        />
                    </TouchableOpacity>

                    <TouchableOpacity
                        onPress={onDelete}
                        style={styles.actionButton}
                        accessibilityRole="button"
                        accessibilityLabel={t('a11y.deleteSelected', 'Delete selected notes')}
                    >
                        <MaterialIcons name="delete" size={24} color={colors.text} />
                    </TouchableOpacity>
                </View>
            </View>
        </View>
    );
};

const styles = createStyles(() => ({
    container: {
        backgroundColor: colors.surface,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 4,
    },
    content: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.m,
        paddingVertical: spacing.m,
        minHeight: 60,
    },
    closeButton: {
        width: 48,
        height: 48,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: -spacing.s,
        marginRight: spacing.xs,
    },
    countText: {
        flex: 1,
        fontSize: 16,
        fontWeight: '600',
        color: colors.text,
    },
    actions: {
        flexDirection: 'row',
        gap: spacing.s,
        marginRight: -spacing.s,
    },
    actionButton: {
        width: 48,
        height: 48,
        alignItems: 'center',
        justifyContent: 'center',
    },
}));
