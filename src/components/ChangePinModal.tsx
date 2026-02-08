import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableWithoutFeedback, View } from 'react-native';
import { useEncryption } from '../context/EncryptionContext';
import {
    getSecretValidationError,
    normalizeSecretInput,
    PASSPHRASE_MIN_LENGTH,
    PASSPHRASE_MIN_WORDS,
    PIN_LENGTH,
    SEED_PHRASE_WORDS,
    SecretMode,
} from '../crypto/e2ee';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { Button } from './Button';
import { PinCodeInput } from './PinCodeInput';
import { TextInput } from './TextInput';
import { generateMnemonic } from '../crypto/bip39';

interface ChangePinModalProps {
    visible: boolean;
    onClose: () => void;
    onChanged?: () => void;
    onChanging?: () => void;
    onError?: (message: string) => void;
}

type ChangeStep = 'enter_secret' | 'confirm_seed';
const SEED_CONFIRMATION_WORDS = 3;

const normalizeSeedWordInput = (value: string): string => value.toLowerCase().replace(/\s+/g, '');

const pickUniqueRandomIndexes = (wordCount: number, count: number): number[] => {
    const target = Math.min(wordCount, count);
    const indexes = new Set<number>();

    while (indexes.size < target) {
        indexes.add(Math.floor(Math.random() * wordCount));
    }

    return Array.from(indexes).sort((a, b) => a - b);
};

export const ChangePinModal = ({ visible, onClose, onChanged, onChanging, onError }: ChangePinModalProps) => {
    const { changePin, bundle, custodyMode } = useEncryption();
    const preferredMode = custodyMode === 'strict_seed'
        ? 'seed_phrase'
        : (bundle?.secret_mode ?? 'pin');
    const [step, setStep] = useState<ChangeStep>('enter_secret');
    const [mode, setMode] = useState<SecretMode>(preferredMode);
    const [secret, setSecret] = useState('');
    const [confirmSecret, setConfirmSecret] = useState('');
    const [seedConfirmationIndexes, setSeedConfirmationIndexes] = useState<number[]>([]);
    const [seedConfirmationInputs, setSeedConfirmationInputs] = useState<Record<number, string>>({});
    const [showSecret, setShowSecret] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const reset = () => {
        setStep('enter_secret');
        setMode(preferredMode);
        setSecret('');
        setConfirmSecret('');
        setSeedConfirmationIndexes([]);
        setSeedConfirmationInputs({});
        setShowSecret(false);
        setError(null);
    };

    useEffect(() => {
        if (!visible) return;
        setStep('enter_secret');
        setMode(preferredMode);
        setSeedConfirmationIndexes([]);
        setSeedConfirmationInputs({});
        setError(null);
    }, [visible, preferredMode]);

    const handleClose = () => {
        if (loading) return;
        reset();
        onClose();
    };

    const handleChange = async () => {
        setError(null);
        const validationError = getSecretValidationError(secret, mode);
        if (validationError) {
            setError(validationError);
            return;
        }
        const normalizedSecret = normalizeSecretInput(secret, mode);
        const normalizedConfirm = normalizeSecretInput(confirmSecret, mode);
        if (normalizedSecret !== normalizedConfirm) {
            if (mode === 'pin') {
                setError('PINs do not match.');
            } else if (mode === 'seed_phrase') {
                setError('Seed phrases do not match.');
            } else {
                setError('Passphrases do not match.');
            }
            return;
        }

        if (mode === 'seed_phrase' && step === 'enter_secret') {
            const words = normalizedSecret.split(' ').filter(Boolean);
            if (words.length !== SEED_PHRASE_WORDS) {
                setError(`Seed phrase must contain ${SEED_PHRASE_WORDS} words.`);
                return;
            }
            const indexes = pickUniqueRandomIndexes(words.length, SEED_CONFIRMATION_WORDS);
            setSeedConfirmationIndexes(indexes);
            setSeedConfirmationInputs({});
            setStep('confirm_seed');
            return;
        }

        if (mode === 'seed_phrase') {
            const words = normalizedSecret.split(' ').filter(Boolean);
            for (const index of seedConfirmationIndexes) {
                const expected = normalizeSeedWordInput(words[index] || '');
                const provided = normalizeSeedWordInput(seedConfirmationInputs[index] || '');
                if (!provided) {
                    setError(`Enter word #${index + 1}.`);
                    return;
                }
                if (provided !== expected) {
                    setError(`Word #${index + 1} is incorrect. Please check your backup.`);
                    return;
                }
            }
        }

        setLoading(true);
        const secretValue = normalizedSecret;
        onChanging?.();
        onClose();
        setTimeout(() => {
            void (async () => {
                try {
                    await changePin(secretValue, mode);
                    reset();
                    onChanged?.();
                } catch (e: any) {
                    const message = e?.message || 'Failed to change access key.';
                    setError(message);
                    onError?.(message);
                } finally {
                    setLoading(false);
                }
            })();
        }, 0);
    };

    const handleGenerateSeed = async () => {
        try {
            const seed = await generateMnemonic(SEED_PHRASE_WORDS as 12);
            setSecret(seed);
            setConfirmSecret('');
            setStep('enter_secret');
            setSeedConfirmationIndexes([]);
            setSeedConfirmationInputs({});
            setError(null);
            setShowSecret(true);
        } catch (e: any) {
            setError(e?.message || 'Failed to generate seed phrase.');
        }
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={handleClose}
        >
            <TouchableWithoutFeedback onPress={handleClose}>
                <View style={styles.backdrop}>
                    <TouchableWithoutFeedback>
                        <View style={styles.card}>
                            <Text style={styles.title}>Change Access Key</Text>
                            <Text style={styles.subtitle}>
                                Your notes stay encrypted. The server only stores the updated key bundle.
                            </Text>
                            <View style={styles.modeRow}>
                                <Pressable
                                    style={[styles.modeButton, mode === 'seed_phrase' && styles.modeButtonActive]}
                                    onPress={() => {
                                        setStep('enter_secret');
                                        setMode('seed_phrase');
                                        setSeedConfirmationIndexes([]);
                                        setSeedConfirmationInputs({});
                                        setError(null);
                                    }}
                                >
                                    <Text style={[styles.modeTitle, mode === 'seed_phrase' && styles.modeTitleActive]}>
                                        Seed Phrase (Recommended)
                                    </Text>
                                </Pressable>
                                <Pressable
                                    style={[styles.modeButton, mode === 'passphrase' && styles.modeButtonActive]}
                                    onPress={() => {
                                        setStep('enter_secret');
                                        setMode('passphrase');
                                        setSeedConfirmationIndexes([]);
                                        setSeedConfirmationInputs({});
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
                                        setStep('enter_secret');
                                        setMode('pin');
                                        setSeedConfirmationIndexes([]);
                                        setSeedConfirmationInputs({});
                                        setError(null);
                                    }}
                                >
                                    <Text style={[styles.modeTitle, mode === 'pin' && styles.modeTitleActive]}>
                                        PIN
                                    </Text>
                                </Pressable>
                            </View>

                            {mode === 'pin' ? (
                                <>
                                    <PinCodeInput
                                        label={`New PIN (${PIN_LENGTH} digits)`}
                                        value={secret}
                                        onChange={setSecret}
                                        length={PIN_LENGTH}
                                    />
                                    <PinCodeInput
                                        label="Confirm PIN"
                                        value={confirmSecret}
                                        onChange={setConfirmSecret}
                                        length={PIN_LENGTH}
                                    />
                                </>
                            ) : mode === 'seed_phrase' && step === 'enter_secret' ? (
                                <>
                                    <TextInput
                                        label={`New seed phrase (${SEED_PHRASE_WORDS} words)`}
                                        value={secret}
                                        onChangeText={setSecret}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        placeholder="abandon ability ... (12 words)"
                                        multiline
                                        style={styles.seedInput}
                                    />
                                    <TextInput
                                        label="Confirm seed phrase"
                                        value={confirmSecret}
                                        onChangeText={setConfirmSecret}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        placeholder="Repeat the same 12 words"
                                        multiline
                                        style={styles.seedInput}
                                    />
                                    <Pressable onPress={handleGenerateSeed} style={styles.revealRow}>
                                        <Text style={styles.revealText}>
                                            Generate {SEED_PHRASE_WORDS}-word seed
                                        </Text>
                                    </Pressable>
                                </>
                            ) : mode === 'seed_phrase' ? (
                                <>
                                    <Pressable
                                        onPress={() => {
                                            setStep('enter_secret');
                                            setSeedConfirmationInputs({});
                                            setError(null);
                                        }}
                                        style={styles.backRow}
                                    >
                                        <Text style={styles.backText}>Back to seed phrase</Text>
                                    </Pressable>
                                    <Text style={styles.confirmTitle}>Confirm your backup</Text>
                                    <Text style={styles.confirmSubtitle}>
                                        Enter the requested words to verify you saved the phrase.
                                    </Text>
                                    {seedConfirmationIndexes.map((index) => (
                                        <TextInput
                                            key={index}
                                            label={`Word #${index + 1}`}
                                            value={seedConfirmationInputs[index] || ''}
                                            onChangeText={(value) => {
                                                setSeedConfirmationInputs((prev) => ({ ...prev, [index]: value }));
                                            }}
                                            autoCapitalize="none"
                                            autoCorrect={false}
                                            placeholder={`Type word #${index + 1}`}
                                        />
                                    ))}
                                </>
                            ) : (
                                <>
                                    <TextInput
                                        label="New code phrase"
                                        value={secret}
                                        onChangeText={setSecret}
                                        secureTextEntry={!showSecret}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        placeholder="e.g. orbit lake amber sunrise"
                                    />
                                    <TextInput
                                        label="Confirm code phrase"
                                        value={confirmSecret}
                                        onChangeText={setConfirmSecret}
                                        secureTextEntry={!showSecret}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        placeholder="Repeat your code phrase"
                                    />
                                    <Pressable onPress={() => setShowSecret((prev) => !prev)} style={styles.revealRow}>
                                        <Text style={styles.revealText}>
                                            {showSecret ? 'Hide phrase' : 'Show phrase'}
                                        </Text>
                                    </Pressable>
                                </>
                            )}
                            <Text style={styles.hint}>
                                {mode === 'pin'
                                    ? 'PIN is faster to type, but weaker against offline brute-force.'
                                    : mode === 'seed_phrase'
                                        ? step === 'enter_secret'
                                            ? 'With seed phrase, you keep full control. You must verify backup words before update.'
                                            : 'Verification required before applying your new seed phrase.'
                                        : `Use ${PASSPHRASE_MIN_WORDS}-5 words or ${PASSPHRASE_MIN_LENGTH}+ characters for stronger protection.`}
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
                                    title={mode === 'seed_phrase' && step === 'enter_secret' ? 'Continue' : 'Update Key'}
                                    onPress={handleChange}
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
        backgroundColor: colors.surface,
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
    backRow: {
        marginBottom: spacing.s,
    },
    backText: {
        ...typography.caption,
        color: colors.primary,
        fontWeight: '600',
    },
    confirmTitle: {
        ...typography.body,
        color: colors.text,
        fontWeight: '700',
        marginBottom: spacing.xs,
    },
    confirmSubtitle: {
        ...typography.caption,
        color: colors.textSecondary,
        marginBottom: spacing.s,
    },
    seedInput: {
        minHeight: 84,
        textAlignVertical: 'top',
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
