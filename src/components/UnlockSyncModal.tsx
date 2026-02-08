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
    const preferredMode = custodyMode === 'strict_seed'
        ? 'seed_phrase'
        : (bundle?.secret_mode ?? 'pin');
    const [mode, setMode] = useState<SecretMode>(preferredMode);
    const [secret, setSecret] = useState('');
    const [seedWords, setSeedWords] = useState<string[]>(createEmptySeedWords);
    const [showSecret, setShowSecret] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const reset = () => {
        setMode(preferredMode);
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
        setMode(preferredMode);
        setSecret('');
        setSeedWords(createEmptySeedWords());
        setShowSecret(false);
        setError(null);
    }, [visible, preferredMode, errorMessage]);

    const handleClose = () => {
        if (loading) return;
        reset();
        onClose();
    };

    const handleUnlock = async () => {
        setError(null);
        const effectiveMode: SecretMode = custodyMode === 'strict_seed' ? 'seed_phrase' : mode;
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
                            {custodyMode !== 'strict_seed' && (
                                <View style={styles.modeRow}>
                                    <Pressable
                                        style={[styles.modeButton, mode === 'seed_phrase' && styles.modeButtonActive]}
                                        onPress={() => {
                                            setMode('seed_phrase');
                                            setError(null);
                                        }}
                                    >
                                        <Text style={[styles.modeTitle, mode === 'seed_phrase' && styles.modeTitleActive]}>
                                            Seed Phrase
                                        </Text>
                                    </Pressable>
                                    <Pressable
                                        style={[styles.modeButton, mode === 'passphrase' && styles.modeButtonActive]}
                                        onPress={() => {
                                            setMode('passphrase');
                                            setError(null);
                                        }}
                                    >
                                        <Text style={[styles.modeTitle, mode === 'passphrase' && styles.modeTitleActive]}>
                                            Code Phrase
                                        </Text>
                                    </Pressable>
                                    <Pressable
                                        style={[styles.modeButton, mode === 'pin' && styles.modeButtonActive]}
                                        onPress={() => {
                                            setMode('pin');
                                            setError(null);
                                        }}
                                    >
                                        <Text style={[styles.modeTitle, mode === 'pin' && styles.modeTitleActive]}>
                                            PIN
                                        </Text>
                                    </Pressable>
                                </View>
                            )}

                            {(custodyMode !== 'strict_seed' && mode === 'pin') ? (
                                <PinCodeInput
                                    label={`PIN (${PIN_LENGTH} digits)`}
                                    value={secret}
                                    onChange={setSecret}
                                    length={PIN_LENGTH}
                                />
                            ) : (custodyMode === 'strict_seed' || mode === 'seed_phrase') ? (
                                <>
                                    <Text style={styles.seedLabel}>{`Seed phrase (${SEED_PHRASE_WORDS} words)`}</Text>
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
                                        label="Code phrase"
                                        value={secret}
                                        onChangeText={setSecret}
                                        secureTextEntry={!showSecret}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        placeholder="Enter your code phrase"
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
                                    ? 'Strict seed mode: only your seed phrase can unlock synced data.'
                                    : mode === 'seed_phrase'
                                    ? 'Master key is decrypted locally on this device.'
                                    : mode === 'passphrase'
                                        ? 'Use your exact phrase. Unlock happens locally.'
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
    modeRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.s,
        marginBottom: spacing.m,
    },
    modeButton: {
        flexGrow: 1,
        minWidth: 100,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 10,
        paddingVertical: spacing.s,
        alignItems: 'center',
    },
    modeButtonActive: {
        borderColor: colors.primary,
        backgroundColor: colors.background,
    },
    modeTitle: {
        ...typography.caption,
        color: colors.text,
        fontWeight: '600',
    },
    modeTitleActive: {
        color: colors.primary,
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
