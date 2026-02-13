import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableWithoutFeedback, View } from 'react-native';
import { useEncryption } from '../context/EncryptionContext';
import { getSecretValidationError, PIN_LENGTH, SEED_PHRASE_WORDS, SecretMode } from '../crypto/e2ee';
import { Button } from './Button';
import { PinCodeInput } from './PinCodeInput';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { TextInput } from './TextInput';
import { SeedWordsGrid } from './SeedWordsGrid';

interface UnlockSyncModalProps {
    visible: boolean;
    onClose: () => void;
    onUnlocked?: () => void;
    onUnlocking?: () => void;
    onError?: (message: string) => void;
    errorMessage?: string | null;
}

const createEmptySeedWords = (): string[] => Array.from({ length: SEED_PHRASE_WORDS }, () => '');
const normalizeSeedWordInput = (value: string): string => value.toLowerCase().replace(/\s+/g, '');

export const UnlockSyncModal = ({
    visible,
    onClose,
    onUnlocked,
    onUnlocking,
    onError,
    errorMessage = null,
}: UnlockSyncModalProps) => {
    const { unlock, bundle, custodyMode } = useEncryption();
    const effectiveMode: SecretMode = custodyMode === 'strict_seed'
        ? 'seed_phrase'
        : (bundle?.secret_mode ?? 'pin');
    const [secret, setSecret] = useState('');
    const [seedWords, setSeedWords] = useState<string[]>(createEmptySeedWords);
    const [showSecret, setShowSecret] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const reset = () => {
        setSecret('');
        setSeedWords(createEmptySeedWords());
        setShowSecret(false);
        setError(null);
    };

    useEffect(() => {
        if (!visible) return;
        if (errorMessage) {
            setError(errorMessage);
            return;
        }
        setSecret('');
        setSeedWords(createEmptySeedWords());
        setShowSecret(false);
        setError(null);
    }, [visible, effectiveMode, errorMessage]);

    const handleClose = () => {
        if (loading) return;
        reset();
        onClose();
    };

    const handleUnlock = async () => {
        setError(null);
        const rawSecret = effectiveMode === 'seed_phrase' ? seedWords.join(' ') : secret;
        const validationError = getSecretValidationError(rawSecret, effectiveMode);
        if (validationError) {
            setError(validationError);
            return;
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
                            <Text style={styles.title}>Unlock Sync</Text>
                            <Text style={styles.subtitle}>
                                Enter your access key to unlock sync. This does not affect local access.
                            </Text>

                            {effectiveMode === 'pin' && custodyMode !== 'strict_seed' ? (
                                <PinCodeInput
                                    label={`PIN (${PIN_LENGTH} digits)`}
                                    value={secret}
                                    onChange={setSecret}
                                    length={PIN_LENGTH}
                                />
                            ) : (custodyMode === 'strict_seed') ? (
                                <>
                                    <Text style={styles.seedLabel}>{`Recovery phrase (${SEED_PHRASE_WORDS} words)`}</Text>
                                    <SeedWordsGrid
                                        words={seedWords}
                                        onChangeWord={(index, value) => {
                                            setSeedWords((prev) => {
                                                const next = [...prev];
                                                next[index] = normalizeSeedWordInput(value);
                                                return next;
                                            });
                                        }}
                                    />
                                </>
                            ) : (
                                <>
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
                                            {showSecret ? 'Hide phrase' : 'Show phrase'}
                                        </Text>
                                    </Pressable>
                                </>
                            )}
                            <Text style={styles.hint}>
                                {custodyMode === 'strict_seed'
                                    ? 'Recovery phrase mode: only your recovery phrase can unlock synced data.'
                                    : effectiveMode === 'passphrase'
                                        ? 'Use your exact passphrase. Unlock happens locally.'
                                        : 'PIN unlock is local and fast.'}
                            </Text>
                            {error && <Text style={styles.error}>{error}</Text>}
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
    seedLabel: {
        ...typography.captionBold,
        color: colors.textSecondary,
        marginBottom: spacing.s,
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
    actionButton: {
        flex: 1,
    },
});
