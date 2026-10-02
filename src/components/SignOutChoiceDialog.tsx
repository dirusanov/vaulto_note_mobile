import { useTranslation } from 'react-i18next';
import React from 'react';
import { View, Text, Modal, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { createStyles } from '../theme/createStyles';

interface SignOutChoiceDialogProps {
    visible: boolean;
    unsyncedCount: number;
    onKeep: () => void;
    onDelete: () => void;
    onCancel: () => void;
    hasE2EE?: boolean;
    recoveryCode?: string | null;
}

export const SignOutChoiceDialog: React.FC<SignOutChoiceDialogProps> = ({
    visible,
    unsyncedCount,
    onKeep,
    onDelete,
    onCancel,
    hasE2EE,
}) => {
    const { t } = useTranslation();
    const [isConfirmingDelete, setIsConfirmingDelete] = React.useState(false);

    const hasUnsynced = unsyncedCount > 0;

    const resetAndCancel = () => {
        setIsConfirmingDelete(false);
        onCancel();
    };

    React.useEffect(() => {
        if (!visible) {
            setIsConfirmingDelete(false);
        }
    }, [visible]);

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
                        <MaterialIcons 
                            name={isConfirmingDelete ? "warning" : "logout"} 
                            size={32} 
                            color={isConfirmingDelete ? colors.warning : colors.error} 
                        />
                    </View>

                    <Text style={styles.title}>
                        {isConfirmingDelete ? t("aux.confirmDeletion", "Confirm Deletion") : t("settings.account.signOut", "Sign Out")}
                    </Text>
                    
                    {!isConfirmingDelete ? (
                        <>
                            <Text style={styles.message}>
                                {t("settings.ui.signOutMessage", "What should we do with your notes on this device?")}
                            </Text>

                            <View style={styles.actions}>
                                <TouchableOpacity
                                    style={[styles.button, styles.keepButton]}
                                    onPress={onKeep}
                                    activeOpacity={0.8}
                                >
                                    <View style={styles.buttonRow}>
                                        <MaterialIcons name="storage" size={18} color={colors.text} />
                                        <Text style={styles.keepButtonText}>{t("aux.keepOnDevice", "Keep on Device")}</Text>
                                    </View>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={[styles.button, styles.deleteButtonOutline]}
                                    onPress={() => setIsConfirmingDelete(true)}
                                    activeOpacity={0.8}
                                >
                                    <View style={styles.buttonRow}>
                                        <MaterialIcons name="delete-outline" size={18} color={colors.error} />
                                        <Text style={styles.deleteOutlineText}>{t("aux.deleteFromDevice", "Delete from Device")}</Text>
                                    </View>
                                </TouchableOpacity>
                            </View>
                        </>
                    ) : (
                        <>
                            <Text style={styles.message}>
                                {t("settings.ui.confirmDeleteFull", "This will permanently remove all local data for this account.")}
                            </Text>

                            <View style={styles.warningStack}>
                                {hasUnsynced && (
                                    <View style={styles.dangerBoxSmall}>
                                        <MaterialIcons name="sync-problem" size={18} color={colors.error} />
                                        <Text style={styles.dangerTextSmall}>
                                            {unsyncedCount} {t("aux.unsyncedNotesWarn", "unsynced notes will be lost forever.")}
                                        </Text>
                                    </View>
                                )}

                                {hasE2EE && (
                                    <View style={styles.infoBoxSmall}>
                                        <MaterialIcons name="security" size={18} color={colors.primary} />
                                        <Text style={styles.infoTextSmall}>
                                            {t("settings.ui.saveRecoveryFirst", "Ensure you have saved your Recovery Code to access notes on other devices.")}
                                        </Text>
                                    </View>
                                )}
                            </View>

                            <View style={styles.actions}>
                                <TouchableOpacity
                                    style={[styles.button, styles.deleteButton]}
                                    onPress={onDelete}
                                    activeOpacity={0.8}
                                >
                                    <Text style={styles.deleteButtonText}>{t("aux.confirmAndDelete", "Yes, Delete Everything")}</Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={[styles.button, styles.backButton]}
                                    onPress={() => setIsConfirmingDelete(false)}
                                    activeOpacity={0.8}
                                >
                                    <Text style={styles.backButtonText}>{t("aux.goBack", "Go Back")}</Text>
                                </TouchableOpacity>
                            </View>
                        </>
                    )}

                    <TouchableOpacity
                        style={styles.cancelLink}
                        onPress={resetAndCancel}
                        activeOpacity={0.7}
                    >
                        <Text style={styles.cancelText}>{t("settings.ui.cancelBtn", "Cancel")}</Text>
                    </TouchableOpacity>
                </View>
            </View>
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
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: colors.background,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: spacing.m,
        borderWidth: 1,
        borderColor: colors.border,
    },
    title: {
        ...typography.h3,
        textAlign: 'center',
        marginBottom: spacing.xs,
        color: colors.text,
    },
    message: {
        ...typography.caption,
        textAlign: 'center',
        color: colors.textSecondary,
        marginBottom: spacing.l,
        paddingHorizontal: spacing.m,
    },
    warningStack: {
        width: '100%',
        gap: spacing.s,
        marginBottom: spacing.l,
    },
    dangerBoxSmall: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.error + '08',
        borderRadius: 12,
        padding: spacing.m,
        gap: spacing.s,
    },
    dangerTextSmall: {
        ...typography.captionBold,
        color: colors.error,
        flex: 1,
    },
    infoBoxSmall: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.primary + '08',
        borderRadius: 12,
        padding: spacing.m,
        gap: spacing.s,
    },
    infoTextSmall: {
        ...typography.captionBold,
        color: colors.primary,
        flex: 1,
    },
    actions: {
        width: '100%',
        gap: spacing.m,
    },
    button: {
        width: '100%',
        paddingVertical: spacing.m,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    buttonRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
    },
    keepButton: {
        backgroundColor: colors.primary,
    },
    keepButtonText: {
        ...typography.buttonSmall,
        color: '#FFFFFF',
    },
    deleteButtonOutline: {
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: colors.error + '40',
    },
    deleteOutlineText: {
        ...typography.buttonSmall,
        color: colors.error,
    },
    deleteButton: {
        backgroundColor: colors.error,
    },
    deleteButtonText: {
        ...typography.buttonSmall,
        color: '#FFFFFF',
    },
    backButton: {
        backgroundColor: colors.background,
        borderWidth: 1,
        borderColor: colors.border,
    },
    backButtonText: {
        ...typography.buttonSmall,
        color: colors.textSecondary,
    },
    cancelLink: {
        marginTop: spacing.m,
        paddingVertical: spacing.xs,
    },
    cancelText: {
        ...typography.captionBold,
        color: colors.textSecondary,
    },
}));
