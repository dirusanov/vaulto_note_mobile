import { useTranslation } from 'react-i18next';
import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TouchableWithoutFeedback, View, TouchableOpacity } from 'react-native';
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
    onError?: (message: string) => void;
    errorMessage?: string | null;
}

export const UnlockSyncModal = ({
    visible,
    onClose,
    onUnlocked,
    onUnlocking,
    onError,
    errorMessage = null,
}: UnlockSyncModalProps) => {
    const { t } = useTranslation();

    const { unlock, bundle } = useEncryption();
    const isLegacyNumericPassphrase = bundle?.secret_mode === 'pin';
    const [secret, setSecret] = useState('');
    const [showSecret, setShowSecret] = useState(false);
    const [showPassphraseInput, setShowPassphraseInput] = useState(true);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showReset, setShowReset] = useState(false);
    const [showUseRecoveryCode, setShowUseRecoveryCode] = useState(false);

    const reset = () => {
        setSecret('');
        setShowSecret(false);
        setShowPassphraseInput(false);
        setError(null);
        setShowReset(false);
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
                setError('Legacy numeric passphrase must be exactly 8 digits.');
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
        onClose();
        setTimeout(() => {
            void (async () => {
                try {
                    await unlock(secretValue);
                    reset();
                    onUnlocked?.();
                } catch (e: any) {
                    const message = e?.message || 'Failed to unlock sync.';
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
                                <Text style={styles.title}>{t("notes.unlockSync", "Unlock Sync")}</Text>
                                <Text style={styles.subtitle}>Enter your passphrase to unlock sync.</Text>

                                <TextInput
                                    label="Passphrase"
                                    value={secret}
                                    onChangeText={setSecret}
                                    secureTextEntry={!showSecret}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    placeholder="Enter your passphrase"
                                />
                                <Pressable onPress={() => setShowSecret((prev) => !prev)} style={styles.revealRow}>
                                    <Text style={styles.revealText}>
                                        {showSecret ? 'Hide passphrase' : 'Show passphrase'}
                                    </Text>
                                </Pressable>

                                <Text style={styles.hint}>
                                    {isLegacyNumericPassphrase
                                        ? 'Legacy mode detected: your passphrase is an 8-digit numeric code.'
                                        : 'Use your exact passphrase. Unlock happens locally.'}
                                </Text>

                                {error && <Text style={styles.error}>{error}</Text>}

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
                                        <Text style={styles.resetButtonText}>{t("aux.forgotPassReset", "Reset encryption")}</Text>
                                    </TouchableOpacity>
                                </View>

                                <View style={styles.actions}>
                                    <Button
                                        title="Cancel"
                                        variant="outline"
                                        onPress={handleClose}
                                        disabled={loading}
                                        style={styles.actionButton}
                                    />
                                    {showPassphraseInput && (
                                        <Button
                                            title="Unlock"
                                            onPress={handleUnlock}
                                            loading={loading}
                                            disabled={loading}
                                            style={styles.actionButton}
                                        />
                                    )}
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
        borderRadius: 20,
        padding: spacing.l,
        borderWidth: 1,
        borderColor: colors.border,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.1,
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
    revealRow: {
        marginTop: -spacing.s,
        marginBottom: spacing.s,
    },
    revealText: {
        ...typography.caption,
        color: colors.primary,
    },
    hint: {
        ...typography.caption,
        color: colors.textMuted,
        marginBottom: spacing.s,
    },
    error: {
        ...typography.caption,
        color: colors.error,
        marginBottom: spacing.s,
    },
    actions: {
        flexDirection: 'row',
        gap: spacing.s,
        marginTop: spacing.s,
    },
    resetButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        width: '100%',
        paddingVertical: spacing.s,
        backgroundColor: colors.error + '10',
        borderRadius: 8,
    },
    resetButtonText: {
        ...typography.captionBold,
        color: colors.error,
    },
    recoveryOptions: {
        flexDirection: 'column',
        alignItems: 'center',
        gap: spacing.s,
        marginTop: spacing.s,
        marginBottom: spacing.s,
    },
    recoveryButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        width: '100%',
        paddingVertical: spacing.s,
        backgroundColor: colors.primary + '10',
        borderRadius: 8,
    },
    recoveryButtonText: {
        ...typography.captionBold,
        color: colors.primary,
    },
    actionButton: {
        flex: 1,
    },
    biometricButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.s,
        paddingVertical: spacing.m,
        backgroundColor: colors.primary + '10',
        borderRadius: 12,
        marginBottom: spacing.m,
        borderWidth: 1,
        borderColor: colors.primary + '30',
    },
    biometricText: {
        ...typography.bodyBold,
        color: colors.primary,
    },
});
