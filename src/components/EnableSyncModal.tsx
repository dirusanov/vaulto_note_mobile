import React, { useEffect, useMemo, useState } from 'react';
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
} from '../crypto/e2ee';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { Button } from './Button';
import { TextInput } from './TextInput';
import { syncService } from '../services/SyncService';
import { UnlockingOverlay } from './UnlockingOverlay';

interface EnableSyncModalProps {
    visible: boolean;
    onClose: () => void;
    onEnabled?: () => void;
    flow?: 'enable' | 'change';
    onChanged?: () => void;
    onChanging?: () => void;
    onError?: (message: string) => void;
}

const waitForUiFrame = () => new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
});

export const EnableSyncModal = ({
    visible,
    onClose,
    onEnabled,
    flow = 'enable',
    onChanged,
    onChanging,
    onError,
}: EnableSyncModalProps) => {
    const { enableE2EE, changePin } = useEncryption();
    const isChangeFlow = flow === 'change';

    const [secret, setSecret] = useState('');
    const [confirmSecret, setConfirmSecret] = useState('');
    const [showSecret, setShowSecret] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const reset = () => {
        setSecret('');
        setConfirmSecret('');
        setShowSecret(false);
        setError(null);
    };

    useEffect(() => {
        if (!visible) return;
        reset();
    }, [visible]);

    const handleClose = () => {
        if (loading) return;
        reset();
        onClose();
    };

    const handleEnable = async () => {
        setError(null);

        const validationError = getSecretValidationError(secret, 'passphrase');
        if (validationError) {
            setError(validationError);
            return;
        }

        const normalizedSecret = normalizeSecretInput(secret, 'passphrase');
        const normalizedConfirm = normalizeSecretInput(confirmSecret, 'passphrase');
        if (normalizedSecret !== normalizedConfirm) {
            setError('Passphrases do not match.');
            return;
        }

        setLoading(true);
        if (isChangeFlow) {
            onChanging?.();
        }

        try {
            await waitForUiFrame();
            if (isChangeFlow) {
                await changePin(normalizedSecret, 'passphrase');
            } else {
                await enableE2EE(normalizedSecret, 'passphrase');
            }

            setTimeout(() => {
                void syncService.syncNow('manual');
            }, 0);

            reset();
            if (isChangeFlow) {
                onChanged?.();
            } else {
                onEnabled?.();
            }
        } catch (e: any) {
            const message = e?.message || (isChangeFlow ? 'Failed to change access key.' : 'Failed to enable sync.');
            setError(message);
            onError?.(message);
        } finally {
            setLoading(false);
        }
    };

    const loadingCopy = useMemo(() => {
        const actionVerb = isChangeFlow ? 'Updating' : 'Enabling';
        return {
            title: `${actionVerb} ${isChangeFlow ? 'Passphrase' : 'Encrypted Sync'}`,
            subtitle: 'Deriving encryption keys from your passphrase. Please wait a few seconds.',
        };
    }, [isChangeFlow]);

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
                                    <Text style={styles.title}>
                                        {isChangeFlow ? 'Change Passphrase' : 'Enable Encrypted Sync'}
                                    </Text>
                                    <Text style={styles.subtitle}>
                                        Choose a strong passphrase. If you forget it, we cannot recover your encrypted notes.
                                    </Text>
                                </View>

                                <ScrollView
                                    style={styles.scrollArea}
                                    contentContainerStyle={styles.scrollContent}
                                    showsVerticalScrollIndicator={false}
                                    keyboardShouldPersistTaps="handled"
                                    keyboardDismissMode="on-drag"
                                >
                                    <TextInput
                                        label="Passphrase"
                                        value={secret}
                                        onChangeText={setSecret}
                                        secureTextEntry={!showSecret}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        placeholder="e.g. orbit drift amber sunrise"
                                    />
                                    <TextInput
                                        label="Confirm passphrase"
                                        value={confirmSecret}
                                        onChangeText={setConfirmSecret}
                                        secureTextEntry={!showSecret}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        placeholder="Repeat your passphrase"
                                    />
                                    <Pressable
                                        onPress={() => setShowSecret((prev) => !prev)}
                                        style={styles.toggleRow}
                                    >
                                        <Text style={styles.toggleText}>
                                            {showSecret ? 'Hide passphrase' : 'Show passphrase'}
                                        </Text>
                                    </Pressable>
                                    <Text style={styles.hint}>
                                        Use {PASSPHRASE_MIN_WORDS}+ words or {PASSPHRASE_MIN_LENGTH}+ characters.
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
                                            title={isChangeFlow ? 'Update Passphrase' : 'Enable Sync'}
                                            onPress={() => {
                                                void handleEnable();
                                            }}
                                            loading={loading}
                                            disabled={loading}
                                            style={styles.actionButton}
                                        />
                                    </View>

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
    headerBlock: {
        marginBottom: spacing.s,
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
    choiceIcon: {
        width: 32,
        height: 32,
        borderRadius: 10,
        backgroundColor: colors.background,
        alignItems: 'center',
        justifyContent: 'center',
    },
    choiceCopy: {
        flex: 1,
    },
    choiceTitle: {
        ...typography.body,
        fontWeight: '700',
    },
    choiceDescription: {
        ...typography.caption,
        color: colors.textSecondary,
        marginTop: 2,
    },
    toggleRow: {
        marginTop: -spacing.s,
        marginBottom: spacing.s,
    },
    toggleText: {
        ...typography.captionBold,
        color: colors.primary,
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
