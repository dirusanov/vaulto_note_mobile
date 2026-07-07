import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
    KeyboardAvoidingView,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useEncryption } from '../context/EncryptionContext';
import {
    getSecretValidationError,
    normalizeSecretInput,
} from '../crypto/e2ee';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { Button } from './Button';
import { TextInput } from './TextInput';
import { MaterialCommunityIcons } from '@expo/vector-icons';
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

const waitForCompletionFrame = () => new Promise<void>((resolve) => {
    setTimeout(resolve, 350);
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
    const { t } = useTranslation();
    const { enableE2EE, changePin } = useEncryption();
    const isChangeFlow = flow === 'change';

    const [secret, setSecret] = useState('');
    const [confirmSecret, setConfirmSecret] = useState('');
    const [showSecret, setShowSecret] = useState(false);
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);

    const reset = () => {
        setSecret('');
        setConfirmSecret('');
        setShowSecret(false);
        setProgress(null);
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
        if (secret !== confirmSecret) {
            setError(t('settings.ui.passphraseMismatch', 'Passphrases do not match.'));
            return;
        }

        const normalizedSecret = normalizeSecretInput(secret, 'passphrase');
        const validationError = getSecretValidationError(secret, 'passphrase');

        if (validationError) {
            setError(validationError);
            return;
        }

        setLoading(true);
        setProgress(5);
        if (isChangeFlow) {
            onChanging?.();
        }

        try {
            await waitForUiFrame();
            if (isChangeFlow) {
                await changePin(normalizedSecret, setProgress);
            } else {
                await enableE2EE(normalizedSecret, 'passphrase', setProgress);
            }
            setProgress(100);
            await waitForCompletionFrame();

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
            setProgress(null);
        }
    };

    const loadingCopy = useMemo(() => {
        const actionVerb = isChangeFlow ? t("settings.ui.updatingVerb", "Updating") : t("settings.ui.enablingVerb", "Enabling");
        const object = isChangeFlow ? t("settings.ui.passphraseObject", "Passphrase") : t("settings.ui.encryptedSyncObject", "Encrypted Sync");
        return {
            title: `${actionVerb} ${object}`,
            subtitle: t("settings.ui.derivingKeysSubtitle", "Creating the key and encrypting your notes."),
        };
    }, [isChangeFlow, t]);

    return (
        <>
            <Modal
                visible={visible}
                transparent
                animationType="fade"
                onRequestClose={handleClose}
            >
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
                                    <View style={styles.header}>
                                        <Text style={styles.title}>
                                            {isChangeFlow ? t('settings.ui.changePassphrase', 'Change Passphrase') : t('settings.ui.enableSyncTitle', 'Enable Encrypted Sync')}
                                        </Text>
                                    </View>

                                    <View style={styles.warningBanner}>
                                        <MaterialCommunityIcons name="shield-check-outline" size={16} color={colors.primary} style={styles.warningIcon} />
                                        <Text style={styles.warningBannerText}>
                                            {t("settings.ui.encryptionWarning", "We do not store your passphrase. If you forget it, your notes cannot be recovered.")}
                                        </Text>
                                    </View>

                                    <TextInput
                                        label={t("settings.ui.passphraseLabel", "Passphrase")}
                                        value={secret}
                                        onChangeText={setSecret}
                                        secureTextEntry={!showSecret}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        placeholder={t("settings.ui.passphrasePlaceholder", "e.g. orbit drift amber sunrise")}
                                    />
                                    <TextInput
                                        label={t("settings.ui.confirmPassphraseLabel", "Confirm passphrase")}
                                        value={confirmSecret}
                                        onChangeText={setConfirmSecret}
                                        secureTextEntry={!showSecret}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        placeholder={t("settings.ui.confirmPassphrasePlaceholder", "Repeat your passphrase")}
                                    />
                                    
                                    <Pressable
                                        onPress={() => setShowSecret((prev) => !prev)}
                                        style={styles.toggleRow}
                                    >
                                        <Text style={styles.toggleText}>
                                            {showSecret ? t("settings.ui.hidePassphrase", "Hide passphrase") : t("settings.ui.showPassphrase", "Show passphrase")}
                                        </Text>
                                    </Pressable>

                                    {error && <Text style={styles.error}>{error}</Text>}

                                    <View style={styles.actions}>
                                        <Button
                                            title={t("settings.ui.cancelBtn", "Cancel")}
                                            variant="outline"
                                            onPress={handleClose}
                                            disabled={loading}
                                            style={styles.actionButton}
                                        />
                                        <Button
                                            title={isChangeFlow ? t("settings.ui.updateBtn", "Update") : t("settings.ui.enableBtn", "Enable")}
                                            onPress={handleEnable}
                                            loading={loading}
                                            disabled={loading || !secret || !confirmSecret}
                                            style={styles.actionButton}
                                        />
                                    </View>
                                </View>
                            </Pressable>
                        </ScrollView>
                    </KeyboardAvoidingView>
                </View>
            </Modal>

            <UnlockingOverlay
                visible={loading}
                title={loadingCopy.title}
                subtitle={loadingCopy.subtitle}
                progress={progress ?? undefined}
                progressLabel={t("common.progress", "Progress")}
            />
        </>
    );
};

const styles = StyleSheet.create({
    avoider: {
        flex: 1,
    },
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.45)',
    },
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        flexGrow: 1,
        justifyContent: 'center',
        paddingHorizontal: spacing.l,
        paddingVertical: spacing.xl,
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
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 5,
        alignItems: 'stretch',
    },
    header: {
        alignItems: 'center',
        marginBottom: spacing.m,
    },
    title: {
        ...typography.h4,
        textAlign: 'center',
        marginBottom: 4,
        color: colors.text,
    },
    subtitle: {
        ...typography.caption,
        textAlign: 'center',
        color: colors.textSecondary,
        paddingHorizontal: spacing.m,
    },
    warningBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.primary + '08',
        borderRadius: 12,
        padding: spacing.m,
        marginBottom: spacing.l,
        gap: spacing.s,
    },
    warningIcon: {
        marginTop: 1,
    },
    warningBannerText: {
        ...typography.caption,
        color: colors.textSecondary,
        flex: 1,
        lineHeight: 16,
    },
    toggleRow: {
        alignItems: 'flex-end',
        marginBottom: spacing.l,
        marginTop: -spacing.s,
        width: '100%',
    },
    toggleText: {
        ...typography.captionBold,
        color: colors.primary,
    },
    error: {
        ...typography.captionBold,
        color: colors.error,
        textAlign: 'center',
        marginBottom: spacing.m,
    },
    actions: {
        flexDirection: 'row',
        gap: spacing.m,
        width: '100%',
    },
    actionButton: {
        flex: 1,
    },
});
