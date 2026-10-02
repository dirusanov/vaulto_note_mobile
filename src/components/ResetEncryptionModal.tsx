import { useTranslation } from 'react-i18next';
import React, { useEffect, useMemo, useState } from 'react';
import {
    KeyboardAvoidingView,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { ResetEncryptionResult, useEncryption } from '../context/EncryptionContext';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { Button } from './Button';
import { TextInput } from './TextInput';
import { createStyles } from '../theme/createStyles';

interface ResetEncryptionModalProps {
    visible: boolean;
    onClose: () => void;
    onReset?: (result: ResetEncryptionResult) => void;
}

const REQUIRED_CONFIRM = 'DELETE';

export const ResetEncryptionModal = ({ visible, onClose, onReset }: ResetEncryptionModalProps) => {
    const { t } = useTranslation();

    const { forceResetEncryption } = useEncryption();
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

    const handleReset = async () => {
        if (!canConfirm) return;
        setError(null);
        setLoading(true);
        try {
            const result = await forceResetEncryption();
            onReset?.(result);
            onClose();
        } catch (e: any) {
            setError(e?.message || t("aux.resetFailed"));
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
                                <Text style={styles.title}>{t("aux.resetEncryptionTitle", "Reset Encryption")}</Text>
                                <Text style={styles.subtitle}>
                                    {t("aux.resetEncryptionWarn1", "This permanently deletes the encrypted cloud vault and its synced copy on this device. Readable device-local notes are preserved; data protected only by the lost key cannot be recovered. Sync stays off until you choose a new mode.")}
                                </Text>

                                <View style={styles.warningBox}>
                                    <Text style={styles.warningTitle}>{t("aux.resetEncryptionWarn2", "You will lose:")}</Text>
                                    <Text style={styles.warningText}>{t("aux.resetEncryptionWarn4", "Encrypted synced notes on the server")}</Text>
                                    <Text style={styles.warningText}>{t("aux.resetEncryptionWarn5", "The current encryption key")}</Text>
                                </View>

                                <TextInput
                                    label={t("aux.typeConfirm", { confirm: REQUIRED_CONFIRM })}
                                    value={confirmText}
                                    onChangeText={setConfirmText}
                                    autoCapitalize="characters"
                                    autoCorrect={false}
                                    placeholder={REQUIRED_CONFIRM}
                                />

                                {error && <Text style={styles.error}>{error}</Text>}

                                <View style={styles.actions}>
                                    <Button
                                        title={t("common.cancel")}
                                        variant="outline"
                                        onPress={handleClose}
                                        disabled={loading}
                                        style={styles.actionButton}
                                    />
                                    <Button
                                        title={t("common.reset")}
                                        onPress={handleReset}
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

const styles = createStyles(() => ({
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
        borderColor: colors.error + '55',
        backgroundColor: colors.error + '10',
        borderRadius: 14,
        padding: spacing.m,
        marginBottom: spacing.m,
    },
    warningTitle: {
        ...typography.captionBold,
        color: colors.error,
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
        backgroundColor: colors.error,
        borderColor: colors.error,
    },
}));
