import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ScreenContainer } from '../components/ScreenContainer';
import { PinCodeInput } from '../components/PinCodeInput';
import { Button } from '../components/Button';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { useEncryption } from '../context/EncryptionContext';
import { getSecretValidationError, PIN_LENGTH, SEED_PHRASE_WORDS, SecretMode } from '../crypto/e2ee';
import { TextInput } from '../components/TextInput';
import { SeedWordsGrid } from '../components/SeedWordsGrid';

const createEmptySeedWords = (): string[] => Array.from({ length: SEED_PHRASE_WORDS }, () => '');
const normalizeSeedWordInput = (value: string): string => value.toLowerCase().replace(/\s+/g, '');

export const PinUnlockScreen = () => {
    const { unlock, custodyMode } = useEncryption();
    const [mode, setMode] = useState<SecretMode>('seed_phrase');
    const [secret, setSecret] = useState('');
    const [seedWords, setSeedWords] = useState<string[]>(createEmptySeedWords);
    const [showSecret, setShowSecret] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

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
        try {
            await unlock(rawSecret);
        } catch (e: any) {
            setError(e?.message || 'Failed to unlock.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <ScreenContainer>
            <View style={styles.container}>
                <Text style={styles.title}>Unlock Vault</Text>
                <Text style={styles.subtitle}>
                    Enter your sync access key on this device.
                </Text>
                {custodyMode !== 'strict_seed' && (
                    <View style={styles.modeRow}>
                        <Pressable
                            style={[styles.modeButton, mode === 'seed_phrase' && styles.modeButtonActive]}
                            onPress={() => setMode('seed_phrase')}
                        >
                            <Text style={[styles.modeTitle, mode === 'seed_phrase' && styles.modeTitleActive]}>
                                Seed Phrase
                            </Text>
                        </Pressable>
                        <Pressable
                            style={[styles.modeButton, mode === 'passphrase' && styles.modeButtonActive]}
                            onPress={() => setMode('passphrase')}
                        >
                            <Text style={[styles.modeTitle, mode === 'passphrase' && styles.modeTitleActive]}>
                                Code Phrase
                            </Text>
                        </Pressable>
                        <Pressable
                            style={[styles.modeButton, mode === 'pin' && styles.modeButtonActive]}
                            onPress={() => setMode('pin')}
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
                    If you forget your access key and lose this device, synced notes cannot be recovered.
                </Text>
                {error && <Text style={styles.error}>{error}</Text>}
                <Button
                    title="Unlock"
                    onPress={handleUnlock}
                    loading={loading}
                    disabled={loading}
                />
            </View>
        </ScreenContainer>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        paddingTop: spacing.xl,
    },
    title: {
        ...typography.title,
        color: colors.text,
        marginBottom: spacing.s,
    },
    subtitle: {
        ...typography.body,
        color: colors.textSecondary,
        marginBottom: spacing.l,
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
        marginBottom: spacing.m,
    },
    error: {
        ...typography.caption,
        color: colors.error,
        marginBottom: spacing.s,
    },
});
