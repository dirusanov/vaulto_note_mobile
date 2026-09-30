import { useTranslation } from 'react-i18next';
import React, { useEffect, useMemo, useState } from 'react';
import {
    Alert,
    KeyboardAvoidingView,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useEncryption } from '../context/EncryptionContext';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { Button } from './Button';
import { TextInput } from './TextInput';

interface DisableEncryptionModalProps {
    visible: boolean;
    onClose: () => void;
    onDisable?: (result: 'purged' | 'partial') => void;
}

const REQUIRED_CONFIRM = 'DISABLE';

export const DisableEncryptionModal = ({ visible, onClose, onDisable }: DisableEncryptionModalProps) => {
    const { t } = useTranslation();

    const { resetEncryption } = useEncryption();
    const [confirmText, setConfirmText] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const canConfirm = useMemo(
        () => confirmText.trim().toUpperCase() === REQUIRED_CONFIRM,
        [confirmText],
    );

    useEffect(() => {
        if (!visible) return;
        setConfirmText('');
        setLoading(false);
        setError(null);
    }, [visible]);

    const handleClose = () => {
        if (loading) return;
        onClose();
    };

    const handleDisable = async () => {
        if (!canConfirm) return;
        setError(null);
        setLoading(true);
        try {
            const { purged, syncSucceeded } = await resetEncryption();
            
            if (!syncSucceeded) {
                Alert.alert(
                    t("settings.ui.encryptionDisabledTitle", "Encryption Disabled"),
                    t("settings.ui.syncPendingMessage", "End-to-end encryption has been disabled on this device. However, your notes could not be synced to the server right now. They will be automatically updated to plain text as soon as you have an internet connection.")
                );
            }
            
            onDisable?.(purged && syncSucceeded ? 'purged' : 'partial');
            onClose();
        } catch (e: any) {
            setError(e?.message || t('aux.disableEncryptionFailed', 'Failed to disable encryption.'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
            <View style={styles.backdrop}>
                <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />
                <KeyboardAvoidingView
                    behavior="padding"
                    style={styles.avoider}
                    pointerEvents="box-none"
                >
                    <ScrollView
                        style={styles.scrollView}
                        contentContainerStyle={styles.scrollContent}
                        bounces={false}
                        showsVerticalScrollIndicator={false}
                        keyboardShouldPersistTaps="handled"
                        pointerEvents="box-none"
                    >
                        <Pressable style={styles.cardPressable} pointerEvents="auto">
                            <View style={styles.card}>
                                <Text style={styles.title}>{t("settings.ui.disableEncryptionTitle", "Disable Encryption")}</Text>
                                <Text style={styles.subtitle}>
                                    {t("settings.ui.disableEncryptionSubtitle", "Disabling end-to-end encryption will remove your personal encryption key. Your notes will now be secured exclusively by standard server-side encryption.")}
                                </Text>

                                <View style={styles.warningBox}>
                                    <Text style={styles.warningTitle}>{t("aux.resetEncryptionWarn2", "You will lose:")}</Text>
                                    <Text style={styles.warningText}>{t("settings.ui.disableEncryptionWarn1", "Your personal encryption key")}</Text>
                                    <Text style={styles.warningText}>{t("settings.ui.disableEncryptionWarn2", "End-to-end privacy for synced notes")}</Text>
                                    <Text style={[styles.warningText, { marginTop: spacing.s, color: colors.warning }]}>
                                        {t("settings.ui.disableEncryptionNote", "Note: Your local notes will NOT be deleted.")}
                                    </Text>
                                </View>

                                <TextInput
                                    label={t("settings.ui.typeToConfirm", "Type \"DISABLE\" to confirm")}
                                    value={confirmText}
                                    onChangeText={setConfirmText}
                                    autoCapitalize="characters"
                                    autoCorrect={false}
                                    placeholder={REQUIRED_CONFIRM}
                                />

                                {error && <Text style={styles.error}>{error}</Text>}

                                <View style={styles.actions}>
                                    <Button
                                        title={t("settings.ui.cancelBtn", "Cancel")}
                                        variant="outline"
                                        onPress={handleClose}
                                        disabled={loading}
                                        style={styles.actionButton}
                                    />
                                    <Button
                                        title={t("settings.ui.disableBtn", "Disable")}
                                        onPress={handleDisable}
                                        loading={loading}
                                        disabled={loading || !canConfirm}
                                        style={[styles.actionButton, styles.dangerButton]}
                                    />
                                </View>
                            </View>
                        </Pressable>
                    </ScrollView>
                </KeyboardAvoidingView>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.45)',
    },
    avoider: {
        flex: 1,
    },
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        flexGrow: 1,
        justifyContent: 'center',
        padding: spacing.l,
    },
    cardPressable: {
        width: '100%',
        alignItems: 'center',
    },
    card: {
        width: '100%',
        maxWidth: 400,
        backgroundColor: colors.surface,
        borderRadius: 22,
        padding: spacing.l,
        borderWidth: 1,
        borderColor: colors.border,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.12,
        shadowRadius: 12,
        elevation: 3,
        alignItems: 'stretch',
    },
    title: {
        ...typography.h2,
        textAlign: 'center',
        marginBottom: spacing.s,
    },
    subtitle: {
        ...typography.body,
        textAlign: 'center',
        color: colors.textSecondary,
        marginBottom: spacing.m,
    },
    warningBox: {
        borderWidth: 1,
        borderColor: colors.warning + '55',
        backgroundColor: colors.warning + '10',
        borderRadius: 14,
        padding: spacing.m,
        marginBottom: spacing.m,
    },
    warningTitle: {
        ...typography.captionBold,
        color: colors.warning,
        marginBottom: spacing.xs,
    },
    warningText: {
        ...typography.caption,
        color: colors.text,
        marginTop: 2,
    },
    error: {
        ...typography.captionBold,
        color: colors.error,
        marginTop: spacing.s,
        marginBottom: spacing.s,
    },
    actions: {
        flexDirection: 'row',
        gap: spacing.s,
        marginTop: spacing.s,
    },
    actionButton: {
        flex: 1,
    },
    dangerButton: {
        backgroundColor: colors.warning,
        borderColor: colors.warning,
    },
});
