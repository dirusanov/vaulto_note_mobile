import { useTranslation } from 'react-i18next';
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableWithoutFeedback, View } from 'react-native';
import { useEncryption } from '../context/EncryptionContext';
import { getSecretValidationError } from '../crypto/e2ee';
import { Button } from './Button';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { TextInput } from './TextInput';
import { ResetEncryptionModal } from './ResetEncryptionModal';

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
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showReset, setShowReset] = useState(false);

    const reset = () => {
        setSecret('');
        setShowSecret(false);
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
            <TouchableWithoutFeedback onPress={handleClose}>
                <View style={styles.backdrop}>
                    <TouchableWithoutFeedback>
                        <View style={styles.card}>
                            <Text style={styles.title}>{t("notes.unlockSync", "Unlock Sync")}</Text>
                            <Text style={styles.subtitle}>
                                Enter your passphrase to unlock sync. This does not affect local access.
                            </Text>

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

                            <Pressable
                                onPress={() => setShowReset(true)}
                                style={styles.resetRow}
                                disabled={loading}
                            >
                                <Text style={styles.resetText}>{t("aux.forgotPassReset", "Forgot passphrase? Reset encryption")}</Text>
                            </Pressable>

                            <View style={styles.actions}>
                                <Button
                                    title="Cancel"
                                    variant="outline"
                                    onPress={handleClose}
                                    disabled={loading}
                                    style={styles.actionButton}
                                />
                                <Button
                                    title="Unlock"
                                    onPress={handleUnlock}
                                    loading={loading}
                                    disabled={loading}
                                    style={styles.actionButton}
                                />
                            </View>
                        </View>
                    </TouchableWithoutFeedback>
                </View>
            </TouchableWithoutFeedback>
            <ResetEncryptionModal
                visible={showReset}
                onClose={() => setShowReset(false)}
                onReset={() => {
                    setShowReset(false);
                    handleClose();
                }}
            />
        </Modal>
    );
};

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.35)',
        justifyContent: 'center',
        padding: spacing.l,
    },
    card: {
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
    },
    title: {
        ...typography.h2,
        marginBottom: spacing.s,
    },
    subtitle: {
        ...typography.body,
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
    resetRow: {
        marginTop: spacing.xs,
        marginBottom: spacing.s,
        alignSelf: 'flex-start',
    },
    resetText: {
        ...typography.captionBold,
        color: colors.error,
    },
    actionButton: {
        flex: 1,
    },
});
