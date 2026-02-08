import React, { useMemo, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { MaterialIcons } from '@expo/vector-icons';
import {
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TouchableWithoutFeedback,
    View,
} from 'react-native';
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
import { syncService } from '../services/SyncService';
import { generateMnemonic } from '../crypto/bip39';
import { UnlockingOverlay } from './UnlockingOverlay';
import { SeedWordsGrid } from './SeedWordsGrid';

interface EnableSyncModalProps {
    visible: boolean;
    onClose: () => void;
    onEnabled?: () => void;
}

type SetupStep = 'choose_method' | 'enter_secret' | 'advanced_secure' | 'create_seed' | 'confirm_seed' | 'restore_seed';

const SEED_CONFIRMATION_WORDS = 3;

const createEmptySeedWords = (): string[] => Array.from({ length: SEED_PHRASE_WORDS }, () => '');

const normalizeSeedWordInput = (value: string): string => value.toLowerCase().replace(/\s+/g, '');

const pickUniqueRandomIndexes = (wordCount: number, count: number): number[] => {
    const target = Math.min(wordCount, count);
    const indexes = new Set<number>();

    while (indexes.size < target) {
        indexes.add(Math.floor(Math.random() * wordCount));
    }

    return Array.from(indexes).sort((a, b) => a - b);
};

const waitForUiFrame = () => new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
});

export const EnableSyncModal = ({ visible, onClose, onEnabled }: EnableSyncModalProps) => {
    const { enableE2EE } = useEncryption();
    const [step, setStep] = useState<SetupStep>('choose_method');
    const [mode, setMode] = useState<SecretMode>('pin');
    const [secret, setSecret] = useState('');
    const [confirmSecret, setConfirmSecret] = useState('');
    const [seedPhrase, setSeedPhrase] = useState('');
    const [seedConfirmationIndexes, setSeedConfirmationIndexes] = useState<number[]>([]);
    const [seedConfirmationInputs, setSeedConfirmationInputs] = useState<Record<number, string>>({});
    const [restoreSeedWords, setRestoreSeedWords] = useState<string[]>(createEmptySeedWords);
    const [seedCopied, setSeedCopied] = useState(false);
    const [showSecret, setShowSecret] = useState(false);
    const [loading, setLoading] = useState(false);
    const [loadingMode, setLoadingMode] = useState<SecretMode | null>(null);
    const [error, setError] = useState<string | null>(null);

    const reset = () => {
        setStep('choose_method');
        setMode('pin');
        setSecret('');
        setConfirmSecret('');
        setSeedPhrase('');
        setSeedConfirmationIndexes([]);
        setSeedConfirmationInputs({});
        setRestoreSeedWords(createEmptySeedWords());
        setSeedCopied(false);
        setShowSecret(false);
        setLoadingMode(null);
        setError(null);
    };

    const handleClose = () => {
        if (loading) return;
        reset();
        onClose();
    };

    const handleEnable = async (rawSecret: string, selectedMode: SecretMode) => {
        const validationError = getSecretValidationError(rawSecret, selectedMode);
        if (validationError) {
            setError(validationError);
            return;
        }
        const normalizedSecret = normalizeSecretInput(rawSecret, selectedMode);
        setLoadingMode(selectedMode);
        setLoading(true);
        try {
            await waitForUiFrame();
            await enableE2EE(normalizedSecret, selectedMode);
            setTimeout(() => {
                void syncService.syncNow('manual');
            }, 0);
            reset();
            onEnabled?.();
        } catch (e: any) {
            setError(e?.message || 'Failed to enable sync.');
        } finally {
            setLoading(false);
            setLoadingMode(null);
        }
    };

    const handleCreateSeed = async () => {
        setError(null);
        try {
            const seed = await generateMnemonic(SEED_PHRASE_WORDS as 12);
            setSeedPhrase(seed);
            setSeedCopied(false);
            setSeedConfirmationIndexes([]);
            setSeedConfirmationInputs({});
            setStep('create_seed');
        } catch (e: any) {
            setError(e?.message || 'Failed to generate seed phrase.');
        }
    };

    const handlePrepareSeedConfirmation = () => {
        setError(null);
        const normalizedSeed = normalizeSecretInput(seedPhrase, 'seed_phrase');
        const words = normalizedSeed.split(' ').filter(Boolean);
        if (words.length !== SEED_PHRASE_WORDS) {
            setError('Seed phrase must contain 12 words.');
            return;
        }
        const indexes = pickUniqueRandomIndexes(words.length, SEED_CONFIRMATION_WORDS);
        setSeedConfirmationIndexes(indexes);
        setSeedConfirmationInputs({});
        setStep('confirm_seed');
    };

    const handleEnableWithPinOrPassphrase = async () => {
        setError(null);
        const validationError = getSecretValidationError(secret, mode);
        if (validationError) {
            setError(validationError);
            return;
        }
        const normalizedSecret = normalizeSecretInput(secret, mode);
        const normalizedConfirm = normalizeSecretInput(confirmSecret, mode);
        if (normalizedSecret !== normalizedConfirm) {
            setError(mode === 'pin' ? 'PINs do not match.' : 'Passphrases do not match.');
            return;
        }
        await handleEnable(normalizedSecret, mode);
    };

    const handleEnableWithRestoredSeed = async () => {
        setError(null);
        const missingWordIndex = restoreSeedWords.findIndex((word) => !word.trim());
        if (missingWordIndex !== -1) {
            setError(`Enter word #${missingWordIndex + 1}.`);
            return;
        }
        const restoredSeed = normalizeSecretInput(restoreSeedWords.join(' '), 'seed_phrase');
        await handleEnable(restoredSeed, 'seed_phrase');
    };

    const handlePasteRestoreSeed = async () => {
        setError(null);
        const clipboardText = await Clipboard.getStringAsync();
        const normalized = normalizeSecretInput(clipboardText, 'seed_phrase');
        const words = normalized.split(' ').filter(Boolean);
        if (words.length !== SEED_PHRASE_WORDS) {
            setError(`Clipboard seed must contain ${SEED_PHRASE_WORDS} words.`);
            return;
        }
        setRestoreSeedWords(words);
    };

    const handleEnableWithCreatedSeed = async () => {
        setError(null);
        const normalizedSeed = normalizeSecretInput(seedPhrase, 'seed_phrase');
        const words = normalizedSeed.split(' ').filter(Boolean);
        for (const index of seedConfirmationIndexes) {
            const expected = words[index];
            const provided = (seedConfirmationInputs[index] || '').trim().toLowerCase();
            if (!provided) {
                setError(`Enter word #${index + 1}.`);
                return;
            }
            if (provided !== expected) {
                setError(`Word #${index + 1} is incorrect. Please check your backup.`);
                return;
            }
        }
        await handleEnable(normalizedSeed, 'seed_phrase');
    };

    const seedWords = useMemo(
        () => normalizeSecretInput(seedPhrase, 'seed_phrase').split(' ').filter(Boolean),
        [seedPhrase],
    );

    const progress = useMemo(() => {
        if (step === 'choose_method') return { current: 1, total: 1, label: 'Choose security level' };
        if (step === 'enter_secret') return { current: 1, total: 2, label: mode === 'pin' ? 'Set PIN' : 'Set code phrase' };
        if (step === 'advanced_secure') return { current: 1, total: 3, label: 'Advanced secure options' };
        if (step === 'create_seed') return { current: 2, total: 3, label: 'Back up your seed' };
        if (step === 'confirm_seed') return { current: 3, total: 3, label: 'Confirm backup words' };
        return { current: 2, total: 3, label: 'Restore existing seed' };
    }, [mode, step]);

    const loadingCopy = useMemo(() => {
        if (loadingMode === 'seed_phrase') {
            return {
                title: 'Enabling Sync with Seed',
                subtitle: 'Deriving keys and securing sync with your seed phrase. Please wait a few seconds.',
            };
        }
        if (loadingMode === 'passphrase') {
            return {
                title: 'Enabling Sync with Code Phrase',
                subtitle: 'Deriving encryption keys from your phrase. Please wait a few seconds.',
            };
        }
        return {
            title: 'Enabling Sync with PIN',
            subtitle: 'Preparing encrypted sync and wrapping your master key. Please wait a few seconds.',
        };
    }, [loadingMode]);

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
                        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.avoider}>
                            <View style={styles.card}>
                                <View style={styles.headerBlock}>
                                    <Text style={styles.title}>Secure Sync Setup</Text>
                                    <Text style={styles.subtitle}>
                                        Start simple or choose advanced custody. Master key never leaves this device unencrypted.
                                    </Text>
                                    <View style={styles.progressRow}>
                                        <Text style={styles.progressText}>
                                            Step {progress.current} of {progress.total}
                                        </Text>
                                        <Text style={styles.progressLabel}>{progress.label}</Text>
                                    </View>
                                </View>

                                <ScrollView
                                    style={styles.scrollArea}
                                    contentContainerStyle={styles.scrollContent}
                                    showsVerticalScrollIndicator={false}
                                    keyboardShouldPersistTaps="handled"
                                    keyboardDismissMode="on-drag"
                                >
                                    {step === 'choose_method' && (
                                        <>
                                            <Pressable
                                                style={styles.choiceCard}
                                                onPress={() => {
                                                    setMode('pin');
                                                    setSecret('');
                                                    setConfirmSecret('');
                                                    setError(null);
                                                    setStep('enter_secret');
                                                }}
                                            >
                                                <View style={styles.choiceIcon}>
                                                    <MaterialIcons name="dialpad" size={18} color={colors.primary} />
                                                </View>
                                                <View style={styles.choiceCopy}>
                                                    <Text style={styles.choiceTitle}>PIN (Quick)</Text>
                                                    <Text style={styles.choiceDescription}>Fast unlock on daily use</Text>
                                                </View>
                                            </Pressable>

                                            <Pressable
                                                style={styles.choiceCard}
                                                onPress={() => {
                                                    setMode('passphrase');
                                                    setSecret('');
                                                    setConfirmSecret('');
                                                    setError(null);
                                                    setStep('enter_secret');
                                                }}
                                            >
                                                <View style={styles.choiceIcon}>
                                                    <MaterialIcons name="password" size={18} color={colors.primary} />
                                                </View>
                                                <View style={styles.choiceCopy}>
                                                    <Text style={styles.choiceTitle}>Code Phrase (Medium secure)</Text>
                                                    <Text style={styles.choiceDescription}>Much stronger against offline brute-force</Text>
                                                </View>
                                            </Pressable>

                                            <Pressable
                                                style={[styles.choiceCard, styles.advancedCard]}
                                                onPress={() => {
                                                    setError(null);
                                                    setStep('advanced_secure');
                                                }}
                                            >
                                                <View style={[styles.choiceIcon, styles.advancedIcon]}>
                                                    <MaterialIcons name="security" size={18} color={colors.accentGreen} />
                                                </View>
                                                <View style={styles.choiceCopy}>
                                                    <Text style={styles.choiceTitle}>Advanced Secure</Text>
                                                    <Text style={styles.choiceDescription}>Create or restore BIP39 seed phrase</Text>
                                                </View>
                                            </Pressable>

                                            <View style={styles.actions}>
                                                <Button
                                                    title="Cancel"
                                                    variant="outline"
                                                    onPress={handleClose}
                                                    disabled={loading}
                                                    style={styles.actionButton}
                                                />
                                            </View>
                                        </>
                                    )}

                                    {step === 'enter_secret' && (
                                        <>
                                            <Pressable
                                                onPress={() => {
                                                    setError(null);
                                                    setStep('choose_method');
                                                }}
                                                style={styles.backRow}
                                            >
                                                <MaterialIcons name="arrow-back" size={16} color={colors.primary} />
                                                <Text style={styles.backText}>Back to security options</Text>
                                            </Pressable>

                                            {mode === 'pin' ? (
                                                <>
                                                    <PinCodeInput
                                                        label={`PIN (${PIN_LENGTH} digits)`}
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
                                            ) : (
                                                <>
                                                    <TextInput
                                                        label="Code phrase"
                                                        value={secret}
                                                        onChangeText={setSecret}
                                                        secureTextEntry={!showSecret}
                                                        autoCapitalize="none"
                                                        autoCorrect={false}
                                                        placeholder="e.g. orbit drift amber sunrise"
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
                                                    <Pressable
                                                        onPress={() => setShowSecret((prev) => !prev)}
                                                        style={styles.toggleRow}
                                                    >
                                                        <Text style={styles.toggleText}>
                                                            {showSecret ? 'Hide phrase' : 'Show phrase'}
                                                        </Text>
                                                    </Pressable>
                                                </>
                                            )}

                                            <Text style={styles.hint}>
                                                {mode === 'pin'
                                                    ? 'Quick option: convenient, but weaker if attacker gets your key bundle.'
                                                    : `Use ${PASSPHRASE_MIN_WORDS}-5 words or ${PASSPHRASE_MIN_LENGTH}+ characters.`}
                                            </Text>

                                            <View style={styles.actions}>
                                                <Button
                                                    title="Cancel"
                                                    variant="outline"
                                                    onPress={handleClose}
                                                    disabled={loading}
                                                    style={styles.actionButton}
                                                />
                                                <Button
                                                    title="Enable Sync"
                                                    onPress={handleEnableWithPinOrPassphrase}
                                                    loading={loading}
                                                    disabled={loading}
                                                    style={styles.actionButton}
                                                />
                                            </View>
                                        </>
                                    )}

                                    {step === 'advanced_secure' && (
                                        <>
                                            <Pressable
                                                onPress={() => {
                                                    setError(null);
                                                    setStep('choose_method');
                                                }}
                                                style={styles.backRow}
                                            >
                                                <MaterialIcons name="arrow-back" size={16} color={colors.primary} />
                                                <Text style={styles.backText}>Back to security options</Text>
                                            </Pressable>

                                            <Pressable
                                                style={styles.choiceCard}
                                                onPress={() => {
                                                    void handleCreateSeed();
                                                }}
                                            >
                                                <View style={styles.choiceIcon}>
                                                    <MaterialIcons name="auto-awesome" size={18} color={colors.primary} />
                                                </View>
                                                <View style={styles.choiceCopy}>
                                                    <Text style={styles.choiceTitle}>Create New Seed</Text>
                                                    <Text style={styles.choiceDescription}>App generates a fresh 12-word phrase</Text>
                                                </View>
                                            </Pressable>

                                            <Pressable
                                                style={styles.choiceCard}
                                                onPress={() => {
                                                    setRestoreSeedWords(createEmptySeedWords());
                                                    setError(null);
                                                    setStep('restore_seed');
                                                }}
                                            >
                                                <View style={styles.choiceIcon}>
                                                    <MaterialIcons name="history" size={18} color={colors.primary} />
                                                </View>
                                                <View style={styles.choiceCopy}>
                                                    <Text style={styles.choiceTitle}>Restore Existing Seed</Text>
                                                    <Text style={styles.choiceDescription}>Use a phrase from your backup</Text>
                                                </View>
                                            </Pressable>
                                        </>
                                    )}

                                    {step === 'create_seed' && (
                                        <>
                                            <Pressable
                                                onPress={() => {
                                                    setError(null);
                                                    setStep('advanced_secure');
                                                }}
                                                style={styles.backRow}
                                            >
                                                <MaterialIcons name="arrow-back" size={16} color={colors.primary} />
                                                <Text style={styles.backText}>Back to advanced options</Text>
                                            </Pressable>

                                            <View style={styles.seedCard}>
                                                <Text style={styles.seedTitle}>Your recovery seed phrase</Text>
                                                <Text style={styles.seedSubtitle}>Write this down. Anyone with it can decrypt your synced notes.</Text>
                                                <SeedWordsGrid words={seedWords} editable={false} />
                                                <Button
                                                    title={seedCopied ? 'Copied' : 'Copy Seed'}
                                                    variant={seedCopied ? 'secondary' : 'outline'}
                                                    onPress={() => {
                                                        if (!seedPhrase) return;
                                                        void Clipboard.setStringAsync(seedPhrase);
                                                        setSeedCopied(true);
                                                    }}
                                                    style={styles.seedAction}
                                                />
                                            </View>

                                            <View style={styles.actions}>
                                                <Button
                                                    title="Cancel"
                                                    variant="outline"
                                                    onPress={handleClose}
                                                    disabled={loading}
                                                    style={styles.actionButton}
                                                />
                                                <Button
                                                    title="I Saved It"
                                                    onPress={() => {
                                                        handlePrepareSeedConfirmation();
                                                    }}
                                                    loading={loading}
                                                    disabled={loading}
                                                    style={styles.actionButton}
                                                />
                                            </View>
                                        </>
                                    )}

                                    {step === 'confirm_seed' && (
                                        <>
                                            <Pressable
                                                onPress={() => {
                                                    setError(null);
                                                    setStep('create_seed');
                                                }}
                                                style={styles.backRow}
                                            >
                                                <MaterialIcons name="arrow-back" size={16} color={colors.primary} />
                                                <Text style={styles.backText}>Back to seed backup</Text>
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

                                            <View style={styles.actions}>
                                                <Button
                                                    title="Cancel"
                                                    variant="outline"
                                                    onPress={handleClose}
                                                    disabled={loading}
                                                    style={styles.actionButton}
                                                />
                                                <Button
                                                    title="Enable Sync"
                                                    onPress={() => {
                                                        void handleEnableWithCreatedSeed();
                                                    }}
                                                    loading={loading}
                                                    disabled={loading}
                                                    style={styles.actionButton}
                                                />
                                            </View>
                                        </>
                                    )}

                                    {step === 'restore_seed' && (
                                        <>
                                            <Pressable
                                                onPress={() => {
                                                    setError(null);
                                                    setStep('advanced_secure');
                                                }}
                                                style={styles.backRow}
                                            >
                                                <MaterialIcons name="arrow-back" size={16} color={colors.primary} />
                                                <Text style={styles.backText}>Back to advanced options</Text>
                                            </Pressable>

                                            <Button
                                                title="Paste full phrase"
                                                variant="outline"
                                                onPress={() => {
                                                    void handlePasteRestoreSeed();
                                                }}
                                                style={styles.pasteSeedButton}
                                            />
                                            <SeedWordsGrid
                                                words={restoreSeedWords}
                                                onChangeWord={(index, value) => {
                                                    setRestoreSeedWords((prev) => {
                                                        const next = [...prev];
                                                        next[index] = normalizeSeedWordInput(value);
                                                        return next;
                                                    });
                                                }}
                                            />

                                            <Text style={styles.hint}>
                                                Restore flow decrypts only on this device. Server never receives plaintext notes or master key.
                                            </Text>

                                            <View style={styles.actions}>
                                                <Button
                                                    title="Cancel"
                                                    variant="outline"
                                                    onPress={handleClose}
                                                    disabled={loading}
                                                    style={styles.actionButton}
                                                />
                                                <Button
                                                    title="Enable Sync"
                                                    onPress={() => {
                                                        void handleEnableWithRestoredSeed();
                                                    }}
                                                    loading={loading}
                                                    disabled={loading}
                                                    style={styles.actionButton}
                                                />
                                            </View>
                                        </>
                                    )}

                                    {error && <Text style={styles.error}>{error}</Text>}
                                </ScrollView>
                            </View>
                        </KeyboardAvoidingView>
                    </TouchableWithoutFeedback>
                </View>
            </TouchableWithoutFeedback>
            <UnlockingOverlay
                visible={loading}
                title={loadingCopy.title}
                subtitle={loadingCopy.subtitle}
            />
        </Modal>
    );
};

const styles = StyleSheet.create({
    avoider: {
        flex: 1,
        width: '100%',
        justifyContent: 'center',
    },
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.35)',
        justifyContent: 'center',
        paddingHorizontal: spacing.m,
        paddingVertical: spacing.s,
    },
    card: {
        width: '100%',
        backgroundColor: colors.surface,
        borderRadius: 22,
        padding: spacing.l,
        maxHeight: '96%',
        borderWidth: 1,
        borderColor: colors.border,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 3,
    },
    title: {
        ...typography.h3,
        marginBottom: spacing.s,
    },
    subtitle: {
        ...typography.bodySmall,
        color: colors.textSecondary,
        marginBottom: spacing.s,
    },
    headerBlock: {
        marginBottom: spacing.s,
    },
    progressRow: {
        marginTop: spacing.s,
        backgroundColor: colors.background,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        paddingHorizontal: spacing.m,
        paddingVertical: spacing.s,
    },
    progressText: {
        ...typography.captionBold,
        color: colors.primary,
    },
    progressLabel: {
        ...typography.caption,
        color: colors.textSecondary,
        marginTop: 2,
    },
    scrollArea: {
        flexGrow: 0,
    },
    scrollContent: {
        paddingBottom: spacing.l,
    },
    choiceCard: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 14,
        padding: spacing.m,
        marginBottom: spacing.s,
        backgroundColor: colors.surface,
    },
    advancedCard: {
        borderColor: '#BFE4D3',
        backgroundColor: '#F2FBF6',
    },
    choiceIcon: {
        width: 32,
        height: 32,
        borderRadius: 10,
        backgroundColor: colors.background,
        alignItems: 'center',
        justifyContent: 'center',
    },
    advancedIcon: {
        backgroundColor: '#DCF5E8',
    },
    choiceCopy: {
        flex: 1,
    },
    choiceTitle: {
        ...typography.body,
        fontWeight: '600',
    },
    choiceDescription: {
        ...typography.caption,
        color: colors.textSecondary,
        marginTop: 2,
    },
    backRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        marginBottom: spacing.m,
    },
    backText: {
        ...typography.captionBold,
        color: colors.primary,
    },
    toggleRow: {
        marginTop: -spacing.s,
        marginBottom: spacing.s,
    },
    toggleText: {
        ...typography.captionBold,
        color: colors.primary,
    },
    seedCard: {
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.background,
        borderRadius: 14,
        padding: spacing.m,
        marginBottom: spacing.s,
    },
    seedTitle: {
        ...typography.body,
        fontWeight: '600',
        marginBottom: spacing.xs,
    },
    seedSubtitle: {
        ...typography.caption,
        color: colors.textSecondary,
        marginBottom: spacing.s,
    },
    seedAction: {
        marginVertical: 0,
    },
    confirmTitle: {
        ...typography.body,
        fontWeight: '600',
        marginBottom: spacing.xs,
    },
    confirmSubtitle: {
        ...typography.caption,
        color: colors.textSecondary,
        marginBottom: spacing.s,
    },
    pasteSeedButton: {
        marginBottom: spacing.s,
    },
    hint: {
        ...typography.caption,
        color: colors.textMuted,
        marginBottom: spacing.m,
    },
    error: {
        ...typography.captionBold,
        color: colors.error,
        marginTop: spacing.s,
    },
    actions: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.s,
        marginTop: spacing.xs,
    },
    actionButton: {
        flexGrow: 1,
        minWidth: 120,
    },
});
