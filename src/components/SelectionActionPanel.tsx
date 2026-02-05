import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';

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
    return (
        <View style={styles.container}>
            <View style={styles.content}>
                <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                    <MaterialIcons name="close" size={24} color={colors.text} />
                </TouchableOpacity>

                <Text style={styles.countText}>{selectedCount} selected</Text>

                <View style={styles.actions}>
                    <TouchableOpacity onPress={allPinned ? onUnpin : onPin} style={styles.actionButton}>
                        <MaterialIcons
                            name={allPinned ? "push-pin" : "push-pin"}
                            size={24}
                            color={allPinned ? colors.primary : colors.text}
                        />
                    </TouchableOpacity>

                    <TouchableOpacity onPress={onDelete} style={styles.actionButton}>
                        <MaterialIcons name="delete" size={24} color={colors.text} />
                    </TouchableOpacity>
                </View>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
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
        marginRight: spacing.m,
        padding: spacing.xs,
    },
    countText: {
        flex: 1,
        fontSize: 16,
        fontWeight: '600',
        color: colors.text,
    },
    actions: {
        flexDirection: 'row',
        gap: spacing.m,
    },
    actionButton: {
        padding: spacing.s,
    },
});
