import { useTranslation } from 'react-i18next';
import React from 'react';
import { View, Text, TouchableOpacity, TouchableWithoutFeedback, Modal, ScrollView, StyleSheet } from 'react-native';
import { colors, isDarkScheme } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { createStyles } from '../theme/createStyles';


interface DeleteConfirmationDialogProps {
    visible: boolean;
    noteCount?: number;
    title?: string;
    message?: string;
    onConfirm: () => void;
    onCancel: () => void;
}

/** Same card as the app's other dialogs (AppAlert): title, text, a red Delete pill, Keep below. */
export const DeleteConfirmationDialog = ({
    visible,
    noteCount = 1,
    title,
    message,
    onConfirm,
    onCancel,
}: DeleteConfirmationDialogProps) => {
    const { t } = useTranslation();

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onCancel}
            statusBarTranslucent
        >
            <TouchableWithoutFeedback onPress={onCancel}>
                <View style={styles.overlay}>
                    <TouchableWithoutFeedback>
                        <View style={styles.card} accessibilityViewIsModal>
                            <ScrollView bounces={false} style={styles.body} contentContainerStyle={styles.bodyContent}>
                                <Text style={styles.title} accessibilityRole="header">
                                    {title || (noteCount === 1 ? t("aux.deleteNoteTitle") : t("aux.deleteNotesTitle", { count: noteCount }))}
                                </Text>
                                <Text style={styles.message}>
                                    {message || t("aux.permanentActionDesc")}
                                </Text>
                            </ScrollView>
                            <View style={styles.actions}>
                                <TouchableOpacity
                                    style={styles.deleteButton}
                                    onPress={onConfirm}
                                    activeOpacity={0.85}
                                    accessibilityRole="button"
                                >
                                    <Text style={styles.deleteText}>{t("aux.deleteBtn", "Delete")}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={styles.cancelButton}
                                    onPress={onCancel}
                                    activeOpacity={0.6}
                                    accessibilityRole="button"
                                >
                                    <Text style={styles.cancelText}>{t("aux.keepIt", "Keep it")}</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </TouchableWithoutFeedback>
                </View>
            </TouchableWithoutFeedback>
        </Modal>
    );
};

const styles = createStyles(() => ({
    overlay: {
        flex: 1,
        backgroundColor: colors.overlay,
        justifyContent: 'center',
        alignItems: 'center',
        padding: spacing.l,
    },
    card: {
        width: '100%',
        maxWidth: 340,
        maxHeight: '85%',
        backgroundColor: colors.surface,
        borderRadius: 20,
        paddingHorizontal: spacing.l,
        paddingTop: spacing.l,
        paddingBottom: spacing.s,
        borderWidth: isDarkScheme() ? StyleSheet.hairlineWidth : 0,
        borderColor: colors.border,
    },
    body: {
        flexGrow: 0,
    },
    bodyContent: {
        paddingBottom: spacing.l,
    },
    title: {
        fontSize: 20,
        lineHeight: 26,
        fontWeight: '700',
        letterSpacing: -0.3,
        color: colors.text,
        marginBottom: spacing.s,
    },
    message: {
        fontSize: 15,
        lineHeight: 21,
        color: colors.textSecondary,
    },
    actions: {
        gap: spacing.xs,
    },
    deleteButton: {
        minHeight: 48,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.m,
        backgroundColor: colors.error,
    },
    deleteText: {
        fontSize: 16,
        fontWeight: '600',
        // The dark theme's red is light: white on it would be hard to read.
        color: isDarkScheme() ? colors.background : colors.onPrimary,
        textAlign: 'center',
    },
    cancelButton: {
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    cancelText: {
        fontSize: 15,
        fontWeight: '500',
        color: colors.textSecondary,
    },
}));
