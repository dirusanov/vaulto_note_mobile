import { useTranslation } from 'react-i18next';
import React, { useEffect, useState } from 'react';
import {
    KeyboardAvoidingView,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEncryption } from '../context/EncryptionContext';
import { getSecretValidationError } from '../crypto/e2ee';
import { Button } from './Button';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { TextInput } from './TextInput';
import { ResetEncryptionModal } from './ResetEncryptionModal';
import { UseRecoveryCodeModal } from './UseRecoveryCodeModal';

interface UnlockSyncModalProps {
    visible: boolean;
    onClose: () => void;
    onUnlocked?: () => void;
    onUnlocking?: () => void;
    onProgress?: (progress: number) => void;
    onError?: (message: string) => void;
    errorMessage?: string | null;
}

const waitForCompletionFrame = () => new Promise<void>((resolve) => {
    setTimeout(resolve, 350);
});

export const UnlockSyncModal = ({
    visible,
    onClose,
    onUnlocked,
    onUnlocking,
    onProgress,
    onError,
    errorMessage = null,
}: UnlockSyncModalProps) => {
    const { t } = useTranslation();

    const { unlock, bundle } = useEncryption();
    const isLegacyNumericPassphrase = bundle?.secret_mode === 'pin';
    const [secret, setSecret] = useState('');
    const [showSecret, setShowSecret] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showReset, setShowReset] = useState(false);
    const [showUseRecoveryCode, setShowUseRecoveryCode] = useState(false);

    const reset = () => {
        setSecret('');
        setShowSecret(false);
        setError(null);
        setShowReset(false);
        setShowUseRecoveryCode(false);
    };

    useEffect(() => {
        if (!visible) return;
        if (errorMessage) {
            setError(errorMessage);
            return;
        }
        setSecret('');
        setShowSecret(false);
        setError(null);
        setShowReset(false);
    }, [visible, errorMessage]);

    const handleClose = () => {
        if (loading) return;
        reset();
        onClose();
    };

    const handleUnlock = async () => {
        setError(null);
        const rawSecret = secret;

        if (isLegacyNumericPassphrase) {
            if (!/^\d{8}$/.test(rawSecret.trim())) {
                setError(t("aux.legacyPinError"));
                return;
            }
        } else {
            const validationError = getSecretValidationError(rawSecret, 'passphrase');
            if (validationError) {
                setError(validationError);
                return;
            }
        }

        setLoading(true);
        const secretValue = rawSecret;
        onUnlocking?.();
        onProgress?.(8);
        onClose();
        setTimeout(() => {
            void (async () => {
                try {
                    await unlock(secretValue, onProgress);
                    onProgress?.(100);
                    await waitForCompletionFrame();
                    reset();
                    onUnlocked?.();
                } catch (e: any) {
                    const message = e?.message || t("aux.unlockFailed");
                    setError(message);
                    onError?.(message);
                } finally {
                    setLoading(false);
                }
            })();
        }, 0);
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
                                <View style={styles.headerIcon}>
                                    <MaterialCommunityIcons name="lock-open-variant-outline" size={26} color={colors.primary} />
                                </View>
                                <Text style={styles.title}>
                                    {t("notes.unlockSync", "Unlock encrypted notes")}
                                </Text>
                                <Text style={styles.subtitle}>
                                    {t(
                                        "notes.syncLockedDescription",
                                        "Encrypted notes are on the server. Enter your passphrase to show them on this device."
                                    )}
                                </Text>

                                <TextInput
                                    label={t("settings.ui.passphraseLabel", "Passphrase")}
                                    value={secret}
                                    onChangeText={setSecret}
                                    secureTextEntry={!showSecret}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    placeholder={t("settings.ui.enterPassphrasePlaceholder", "Enter your passphrase")}
                                    containerStyle={styles.secretInput}
                                />
                                <Pressable onPress={() => setShowSecret((prev) => !prev)} style={styles.revealRow}>
                                    <Text style={styles.revealText}>
                                        {showSecret
                                            ? t("settings.ui.hidePassphrase", "Hide passphrase")
                                            : t("settings.ui.showPassphrase", "Show passphrase")}
                                    </Text>
                                </Pressable>

                                <View style={styles.hintBox}>
                                    <MaterialCommunityIcons name="shield-check-outline" size={16} color={colors.accentGreen} />
                                    <Text style={styles.hint}>
                                        {isLegacyNumericPassphrase
                                            ? t("settings.ui.legacyPassphraseHint", "Legacy mode: enter your 8-digit code.")
                                            : t("settings.ui.unlockLocalHint", "Your passphrase is checked on this device.")}
                                    </Text>
                                </View>

                                {error && <Text style={styles.error}>{error}</Text>}

                                <View style={styles.actions}>
                                    <Button
                                        title={t("common.cancel", "Cancel")}
                                        variant="outline"
                                        onPress={handleClose}
                                        disabled={loading}
                                        style={styles.actionButton}
                                    />
                                    <Button
                                        title={t("settings.ui.unlock", "Unlock")}
                                        onPress={handleUnlock}
                                        loading={loading}
                                        disabled={loading || !secret.trim()}
                                        style={styles.actionButton}
                                    />
                                </View>

                                <View style={styles.recoveryOptions}>
                                    <TouchableOpacity
                                        onPress={() => setShowUseRecoveryCode(true)}
                                        style={styles.recoveryButton}
                                        disabled={loading}
                                    >
                                        <MaterialCommunityIcons name="key-chain" size={16} color={colors.primary} />
                                        <Text style={styles.recoveryButtonText}>{t("settings.recovery.useBtn", "Use Recovery Code")}</Text>
                                    </TouchableOpacity>

                                    <TouchableOpacity
                                        onPress={() => setShowReset(true)}
                                        style={styles.resetButton}
                                        disabled={loading}
                                    >
                                        <MaterialCommunityIcons name="alert-circle-outline" size={16} color={colors.error} />
                                        <Text style={styles.resetButtonText}>{t("aux.forgotPassReset", "Forgot passphrase? Reset encryption")}</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        </Pressable>
                    </ScrollView>
                </KeyboardAvoidingView>
            </View>
            <ResetEncryptionModal
                visible={showReset}
                onClose={() => setShowReset(false)}
                onReset={() => {
                    setShowReset(false);
                    handleClose();
                }}
            />
            <UseRecoveryCodeModal
                visible={showUseRecoveryCode}
                onClose={() => setShowUseRecoveryCode(false)}
                onSuccess={() => {
                    setShowUseRecoveryCode(false);
                    handleClose();
                    onUnlocked?.();
                }}
            />
        </Modal>
    );
};

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.35)',
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
        borderRadius: 28,
        padding: spacing.l,
        borderWidth: 1,
        borderColor: colors.border,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.12,
        shadowRadius: 22,
        elevation: 6,
        alignItems: 'stretch',
    },
    headerIcon: {
        width: 58,
        height: 58,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'center',
        backgroundColor: colors.primary + '10',
        borderWidth: 1,
        borderColor: colors.primary + '18',
        marginBottom: spacing.m,
    },
    title: {
        ...typography.h3,
        textAlign: 'center',
        marginBottom: spacing.xs,
    },
    subtitle: {
        ...typography.bodySmall,
        textAlign: 'center',
        color: colors.textSecondary,
        marginBottom: spacing.l,
    },
    secretInput: {
        marginBottom: spacing.s,
    },
    revealRow: {
        alignSelf: 'flex-end',
        minHeight: 44,
        justifyContent: 'center',
        paddingHorizontal: spacing.xs,
        marginBottom: spacing.s,
    },
    revealText: {
        ...typography.captionBold,
        color: colors.primary,
    },
    hintBox: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
        backgroundColor: colors.accentGreen + '0F',
        borderRadius: 12,
        paddingHorizontal: spacing.m,
        paddingVertical: spacing.s,
        marginBottom: spacing.s,
    },
    hint: {
        ...typography.caption,
        color: colors.textSecondary,
        flex: 1,
    },
    error: {
        ...typography.captionBold,
        color: colors.error,
        marginTop: spacing.xs,
        marginBottom: spacing.s,
        textAlign: 'center',
    },
    actions: {
        flexDirection: 'row',
        gap: spacing.s,
        marginTop: spacing.m,
    },
    resetButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        width: '100%',
        minHeight: 48,
        paddingVertical: spacing.s,
        backgroundColor: colors.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.error + '18',
    },
    resetButtonText: {
        ...typography.captionBold,
        color: colors.error,
    },
    recoveryOptions: {
        flexDirection: 'column',
        alignItems: 'center',
        gap: spacing.s,
        marginTop: spacing.m,
        paddingTop: spacing.m,
        borderTopWidth: 1,
        borderTopColor: colors.border,
    },
    recoveryButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        width: '100%',
        minHeight: 48,
        paddingVertical: spacing.s,
        backgroundColor: colors.primary + '08',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.primary + '14',
    },
    recoveryButtonText: {
        ...typography.captionBold,
        color: colors.primary,
    },
    actionButton: {
        flex: 1,
    },
});
