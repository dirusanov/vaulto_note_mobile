import { useTranslation } from 'react-i18next';
import React from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

interface SignOutChoiceDialogProps {
    visible: boolean;
    unsyncedCount: number;
    onKeep: () => void;
    onDelete: () => void;
    onCancel: () => void;
}

export const SignOutChoiceDialog: React.FC<SignOutChoiceDialogProps> = ({
    visible,
    unsyncedCount,
    onKeep,
    onDelete,
    onCancel,
}) => {
    const { t } = useTranslation();

    const hasUnsynced = unsyncedCount > 0;

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onCancel}
        >
            <View style={styles.overlay}>
                <View style={styles.dialog}>
                    <View style={styles.iconContainer}>
                        <MaterialIcons name="logout" size={40} color={colors.error} />
                    </View>

                    <Text style={styles.title}>{t("settings.account.signOut", "Sign Out")}</Text>
                    <Text style={styles.message}>
                        Choose what happens to your local notes on this device.
                    </Text>

                    {hasUnsynced && (
                        <View style={styles.dangerBox}>
                            <View style={styles.alertRow}>
                                <MaterialIcons name="warning-amber" size={20} color={colors.error} />
                                <View style={styles.alertTextWrap}>
                                    <Text style={styles.dangerTitle}>{t("aux.unsyncedChanges", "Unsynced changes")}</Text>
                                    <Text style={styles.dangerText}>
                                        {unsyncedCount} change{unsyncedCount === 1 ? '' : 's'} not uploaded.
                                        Deleting will permanently lose them.
                                    </Text>
                                </View>
                            </View>
                        </View>
                    )}

                    <View style={styles.warningBox}>
                        <View style={styles.alertRow}>
                            <MaterialIcons name="visibility" size={20} color={colors.warning} />
                            <View style={styles.alertTextWrap}>
                                <Text style={styles.warningTitle}>{t("aux.signOutPrivacyWarn", "Privacy warning")}</Text>
                                <Text style={styles.warningText}>
                                    If you keep notes on this device, anyone with access to this phone can read them
                                    while you are signed out.
                                </Text>
                            </View>
                        </View>
                    </View>

                    <View style={styles.actions}>
                        <TouchableOpacity
                            style={[styles.button, styles.keepButton]}
                            onPress={onKeep}
                            activeOpacity={0.8}
                        >
                            <Text style={styles.keepButtonText}>{t("aux.keepOnDevice", "Keep on Device")}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.button, styles.deleteButton]}
                            onPress={onDelete}
                            activeOpacity={0.8}
                        >
                            <Text style={styles.deleteButtonText}>{t("aux.deleteFromDevice", "DELETE FROM DEVICE")}</Text>
                        </TouchableOpacity>
                    </View>

                    <TouchableOpacity
                        style={styles.cancelLink}
                        onPress={onCancel}
                        activeOpacity={0.7}
                    >
                        <Text style={styles.cancelText}>{t("settings.ui.cancelBtn", "Cancel")}</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: colors.overlay,
        justifyContent: 'center',
        alignItems: 'center',
        padding: spacing.l,
    },
    dialog: {
        backgroundColor: colors.surface,
        borderRadius: 24,
        padding: spacing.xl,
        width: '100%',
        maxWidth: 420,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.25,
        shadowRadius: 16,
        elevation: 10,
    },
    iconContainer: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: `${colors.error}15`,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: spacing.m,
    },
    title: {
        ...typography.h2,
        textAlign: 'center',
        marginBottom: spacing.s,
    },
    message: {
        ...typography.bodySmall,
        textAlign: 'center',
        color: colors.textSecondary,
        marginBottom: spacing.l,
    },
    dangerBox: {
        width: '100%',
        backgroundColor: `${colors.error}12`,
        borderColor: `${colors.error}55`,
        borderWidth: 1,
        borderRadius: 14,
        padding: spacing.m,
        marginBottom: spacing.m,
    },
    warningBox: {
        width: '100%',
        backgroundColor: `${colors.warning}12`,
        borderColor: `${colors.warning}55`,
        borderWidth: 1,
        borderRadius: 14,
        padding: spacing.m,
        marginBottom: spacing.l,
    },
    alertRow: {
        flexDirection: 'row',
        gap: spacing.s,
        alignItems: 'flex-start',
    },
    alertTextWrap: {
        flex: 1,
    },
    dangerTitle: {
        ...typography.captionBold,
        color: colors.error,
        marginBottom: spacing.xs,
    },
    dangerText: {
        ...typography.bodySmall,
        color: colors.textSecondary,
        lineHeight: 20,
    },
    warningTitle: {
        ...typography.captionBold,
        color: colors.warning,
        marginBottom: spacing.xs,
    },
    warningText: {
        ...typography.bodySmall,
        color: colors.textSecondary,
        lineHeight: 20,
    },
    actions: {
        width: '100%',
        gap: spacing.s,
    },
    button: {
        width: '100%',
        paddingVertical: spacing.m,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    keepButton: {
        backgroundColor: colors.background,
        borderWidth: 1,
        borderColor: colors.border,
    },
    keepButtonText: {
        ...typography.buttonSmall,
        color: colors.text,
    },
    deleteButton: {
        backgroundColor: colors.error,
    },
    deleteButtonText: {
        ...typography.buttonSmall,
        color: '#FFFFFF',
        letterSpacing: 0.3,
    },
    cancelLink: {
        marginTop: spacing.m,
        paddingVertical: spacing.xs,
    },
    cancelText: {
        ...typography.captionBold,
        color: colors.textSecondary,
    },
});
