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
import { useEncryption } from '../context/EncryptionContext';
import { getSecretValidationError } from '../crypto/e2ee';
import { Button } from './Button';
import { colors, isDarkScheme } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { TextInput } from './TextInput';
import { ResetEncryptionModal } from './ResetEncryptionModal';
import { UseRecoveryCodeModal } from './UseRecoveryCodeModal';
import { createStyles } from '../theme/createStyles';
import { appAlert } from './AppAlert';
import { useAuth } from '../hooks/useAuth';
import { getNotesLocal } from '../services/DatabaseService';
import { summarizeUnlock, type UnlockSummary } from '../utils/unreadableNote';
import { getErrorMessage, isNetworkError } from '../utils/errorMessage';

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

type Translate = ReturnType<typeof useTranslation>['t'];

/** "12 notes are readable again", plus the ones this phone still cannot open. */
const describeUnlockResult = (summary: UnlockSummary | null, t: Translate): string => {
    if (!summary) return t('aux.unlockedText', 'Your notes are readable on this phone again.');
    const parts = [
        summary.readable > 0
            ? t('aux.unlockedCount', { count: summary.readable, defaultValue: '{{count}} notes are readable on this phone again.' })
            : t('aux.unlockedText', 'Your notes are readable on this phone again.'),
    ];
    if (summary.unreadable > 0) {
        parts.push(t('aux.unlockedSomeLocked', {
            count: summary.unreadable,
            defaultValue: '{{count}} notes still can’t be opened: they were locked with a key that is no longer on this phone.',
        }));
    }
    return parts.join('\n\n');
};

/** A failed unlock in plain words, never the raw error. */
const describeUnlockError = (error: unknown, t: Translate): string => {
    const message = String((error as any)?.message || '');
    if (/incorrect passphrase|invalid access key/i.test(message)) {
        return t('aux.passphraseMismatch', 'That passphrase didn’t match. Check it and try again.');
    }
    if (isNetworkError(error)) return getErrorMessage(error);
    return t('aux.unlockFailedRetry', 'Couldn’t unlock right now. Please try again.');
};

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
    const { userId } = useAuth();
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

    // Every unlock ends in a sentence: what is readable now, and what still is
    // not (notes sealed with a key this phone no longer has).
    const announceUnlocked = async () => {
        const summary = userId
            ? summarizeUnlock(await getNotesLocal(userId).catch(() => []))
            : null;
        appAlert(t('aux.unlockedTitle', 'Notes unlocked'), describeUnlockResult(summary, t));
    };

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
                // Too short to be any passphrase this app accepts: it cannot match.
                setError(t('aux.passphraseMismatch', 'That passphrase didn’t match. Check it and try again.'));
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
                    await announceUnlocked();
                } catch (e: any) {
                    const message = describeUnlockError(e, t);
                    setError(message);
                    onError?.(message);
                } finally {
                    setLoading(false);
                }
            })();
        }, 0);
    };

    // Before anything destructive: what forgetting the passphrase means, and the
    // way back that keeps the notes (the recovery code) first.
    const handleForgot = () => {
        appAlert(
            t('aux.forgotTitle', 'Forgot the passphrase?'),
            t('aux.forgotText', 'Your notes are encrypted with it, so nobody can read them without it, not even Vaulto. If you saved the recovery code, use it instead: the notes stay. If you have neither, you can reset encryption: the encrypted notes on the server are deleted and you start over.'),
            [
                { text: t('common.cancel', 'Cancel'), style: 'cancel' },
                { text: t('aux.forgotReset', 'Reset encryption…'), style: 'destructive', onPress: () => setShowReset(true) },
                { text: t('settings.recovery.useBtn', 'Use Recovery Code'), onPress: () => setShowUseRecoveryCode(true) },
            ],
            { cancelable: true },
        );
    };

    // Accounts encrypted with a recovery key (no passphrase) unlock with that key
    // straight away: typed, pasted or scanned from the QR on the old phone.
    if (bundle?.secret_mode === 'recovery_code') {
        return (
            <UseRecoveryCodeModal
                visible={visible}
                onClose={handleClose}
                onSuccess={() => {
                    handleClose();
                    onUnlocked?.();
                    void announceUnlocked();
                }}
            />
        );
    }

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
                                    <Text style={styles.hint}>
                                        {isLegacyNumericPassphrase
                                            ? t("settings.ui.legacyPassphraseHint", "Legacy mode: enter your 8-digit code.")
                                            : t("settings.ui.unlockLocalHint", "Your passphrase is checked on this device.")}
                                    </Text>
                                </View>

                                {error && <Text style={styles.error}>{error}</Text>}

                                {/* The app's dialog pattern: the main action as a pill, Cancel quiet under it. */}
                                <View style={styles.actions}>
                                    <Button
                                        title={t("settings.ui.unlock", "Unlock")}
                                        onPress={handleUnlock}
                                        loading={loading}
                                        disabled={loading || !secret.trim()}
                                    />
                                    <TouchableOpacity
                                        style={styles.cancelButton}
                                        onPress={handleClose}
                                        disabled={loading}
                                        activeOpacity={0.6}
                                        accessibilityRole="button"
                                    >
                                        <Text style={styles.cancelText}>{t("common.cancel", "Cancel")}</Text>
                                    </TouchableOpacity>
                                </View>

                                <View style={styles.recoveryOptions}>
                                    <TouchableOpacity
                                        onPress={() => setShowUseRecoveryCode(true)}
                                        style={styles.recoveryButton}
                                        disabled={loading}
                                    >
                                        <Text style={styles.recoveryButtonText}>{t("settings.recovery.useBtn", "Use Recovery Code")}</Text>
                                    </TouchableOpacity>

                                    <TouchableOpacity
                                        onPress={handleForgot}
                                        style={styles.resetButton}
                                        disabled={loading}
                                        accessibilityRole="button"
                                    >
                                        <Text style={styles.resetButtonText}>{t("aux.forgotPassphrase", "Forgot the passphrase?")}</Text>
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
                    void announceUnlocked();
                }}
            />
        </Modal>
    );
};

const styles = createStyles(() => ({
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
        maxWidth: 380,
        backgroundColor: colors.surface,
        borderRadius: 20,
        paddingHorizontal: spacing.l,
        paddingTop: spacing.l,
        paddingBottom: spacing.s,
        borderWidth: isDarkScheme() ? StyleSheet.hairlineWidth : 0,
        borderColor: colors.border,
        alignItems: 'stretch',
    },
    title: {
        fontSize: 20,
        lineHeight: 26,
        fontWeight: '700',
        letterSpacing: -0.3,
        color: colors.text,
        marginBottom: spacing.s,
    },
    subtitle: {
        fontSize: 15,
        lineHeight: 21,
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
        marginBottom: spacing.s,
    },
    hint: {
        fontSize: 13,
        lineHeight: 18,
        color: colors.textTertiary,
    },
    error: {
        ...typography.captionBold,
        color: colors.error,
        marginTop: spacing.xs,
        marginBottom: spacing.s,
    },
    actions: {
        gap: spacing.xs,
        marginTop: spacing.m,
    },
    cancelButton: {
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    cancelText: {
        fontSize: 15,
        fontWeight: '500',
        color: colors.textSecondary,
    },
    // Other ways in, as plain text links under a hairline.
    recoveryOptions: {
        marginTop: spacing.s,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: colors.border,
        paddingTop: spacing.xs,
    },
    recoveryButton: {
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    recoveryButtonText: {
        fontSize: 15,
        fontWeight: '500',
        color: colors.primary,
        textAlign: 'center',
    },
    resetButton: {
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    resetButtonText: {
        fontSize: 14,
        color: colors.textSecondary,
        textAlign: 'center',
    },
}));
