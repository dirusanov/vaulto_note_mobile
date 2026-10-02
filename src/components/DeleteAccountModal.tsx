import { useTranslation } from 'react-i18next';
import React, { useEffect, useMemo, useState } from 'react';
import {
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { Button } from './Button';
import { TextInput } from './TextInput';
import { createStyles } from '../theme/createStyles';

interface DeleteAccountModalProps {
    visible: boolean;
    onClose: () => void;
    /** Performs the deletion; throws on failure so the modal can show it. */
    onConfirm: (keepLocalNotes: boolean) => Promise<void>;
    onManageSubscription: () => void;
}

const REQUIRED_CONFIRM = 'DELETE';

export const DeleteAccountModal = ({ visible, onClose, onConfirm, onManageSubscription }: DeleteAccountModalProps) => {
    const { t } = useTranslation();

    const [confirmText, setConfirmText] = useState('');
    const [keepLocalNotes, setKeepLocalNotes] = useState(true);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const canConfirm = useMemo(
        () => confirmText.trim().toUpperCase() === REQUIRED_CONFIRM,
        [confirmText],
    );

    useEffect(() => {
        if (!visible) return;
        setConfirmText('');
        setKeepLocalNotes(true);
        setLoading(false);
        setError(null);
    }, [visible]);

    const handleClose = () => {
        if (loading) return;
        onClose();
    };

    const handleDelete = async () => {
        if (!canConfirm || loading) return;
        setError(null);
        setLoading(true);
        try {
            await onConfirm(keepLocalNotes);
        } catch {
            setError(t('settings.deleteAccountDialog.failed', 'Could not delete the account. Check your connection and try again.'));
        } finally {
            setLoading(false);
        }
    };

    const renderChoice = (value: boolean, title: string, description: string) => {
        const selected = keepLocalNotes === value;
        return (
            <TouchableOpacity
                style={[styles.choiceRow, selected && styles.choiceRowSelected]}
                onPress={() => setKeepLocalNotes(value)}
                disabled={loading}
                activeOpacity={0.7}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected, disabled: loading }}
            >
                <MaterialIcons
                    name={selected ? 'radio-button-checked' : 'radio-button-unchecked'}
                    size={22}
                    color={selected ? (value ? colors.primary : colors.error) : colors.textSecondary}
                />
                <View style={styles.choiceText}>
                    <Text style={styles.choiceTitle}>{title}</Text>
                    <Text style={styles.choiceDescription}>{description}</Text>
                </View>
            </TouchableOpacity>
        );
    };

    const subscriptionNote = Platform.OS === 'ios'
        ? t('settings.deleteAccountDialog.subscriptionNoteIos', 'Deleting the account does not cancel a subscription. To stop payments, cancel it in the App Store.')
        : t('settings.deleteAccountDialog.subscriptionNoteAndroid', 'Deleting the account does not cancel a subscription. To stop payments, cancel it in Google Play.');

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose} statusBarTranslucent>
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
                                <View style={styles.iconCircle}>
                                    <MaterialIcons name="person-remove" size={30} color={colors.error} />
                                </View>
                                <Text style={styles.title}>{t('settings.deleteAccountDialog.title', 'Delete account?')}</Text>
                                <Text style={styles.subtitle}>
                                    {t('settings.deleteAccountDialog.intro', 'Your account and everything stored on our servers will be deleted permanently. This cannot be undone.')}
                                </Text>

                                <View style={styles.warningBox}>
                                    <Text style={styles.warningTitle}>{t('settings.deleteAccountDialog.serverTitle', 'Deleted from the server:')}</Text>
                                    <Text style={styles.warningText}>• {t('settings.deleteAccountDialog.itemAccount', 'Your account and sign-in')}</Text>
                                    <Text style={styles.warningText}>• {t('settings.deleteAccountDialog.itemNotes', 'All synced notes and their versions')}</Text>
                                    <Text style={styles.warningText}>• {t('settings.deleteAccountDialog.itemRecordings', 'Voice recordings')}</Text>
                                    <Text style={styles.warningText}>• {t('settings.deleteAccountDialog.itemKeys', 'Encryption keys')}</Text>
                                </View>

                                <Text style={styles.sectionLabel}>{t('settings.deleteAccountDialog.localTitle', 'Notes on this phone')}</Text>
                                <View style={styles.choices} accessibilityRole="radiogroup">
                                    {renderChoice(
                                        true,
                                        t('settings.deleteAccountDialog.keepLocal', 'Keep them on this phone'),
                                        t('settings.deleteAccountDialog.keepLocalDesc', 'You can keep using them without an account.'),
                                    )}
                                    {renderChoice(
                                        false,
                                        t('settings.deleteAccountDialog.eraseLocal', 'Erase them too'),
                                        t('settings.deleteAccountDialog.eraseLocalDesc', 'All notes and recordings are removed from this phone.'),
                                    )}
                                </View>

                                <View style={styles.subscriptionBox}>
                                    <MaterialIcons name="info-outline" size={18} color={colors.textSecondary} />
                                    <View style={styles.subscriptionTextWrap}>
                                        <Text style={styles.subscriptionText}>{subscriptionNote}</Text>
                                        <TouchableOpacity
                                            onPress={onManageSubscription}
                                            disabled={loading}
                                            style={styles.manageLink}
                                            accessibilityRole="link"
                                        >
                                            <Text style={styles.manageLinkText}>
                                                {t('settings.deleteAccountDialog.manageSubscriptions', 'Manage subscriptions')}
                                            </Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>

                                <TextInput
                                    label={t('aux.typeConfirm', { confirm: REQUIRED_CONFIRM })}
                                    value={confirmText}
                                    onChangeText={setConfirmText}
                                    autoCapitalize="characters"
                                    autoCorrect={false}
                                    placeholder={REQUIRED_CONFIRM}
                                    editable={!loading}
                                />

                                {error && <Text style={styles.error}>{error}</Text>}

                                <View style={styles.actions}>
                                    <Button
                                        title={t('common.cancel')}
                                        variant="outline"
                                        onPress={handleClose}
                                        disabled={loading}
                                        style={styles.actionButton}
                                    />
                                    <Button
                                        title={t('settings.deleteAccountDialog.confirmBtn', 'Delete')}
                                        onPress={handleDelete}
                                        loading={loading}
                                        disabled={loading || !canConfirm}
                                        style={[styles.actionButton, styles.dangerButton]}
                                    />
                                </View>
                            </View>
                        </Pressable>
                    </ScrollView>
                </KeyboardAvoidingView>
            </View>
        </Modal>
    );
};

const styles = createStyles(() => ({
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.45)',
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
        borderRadius: 22,
        padding: spacing.l,
        borderWidth: 1,
        borderColor: colors.border,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.12,
        shadowRadius: 12,
        elevation: 3,
        alignItems: 'stretch',
    },
    iconCircle: {
        alignSelf: 'center',
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: colors.error + '10',
        borderWidth: 1,
        borderColor: colors.error + '20',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: spacing.m,
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
    warningBox: {
        borderWidth: 1,
        borderColor: colors.error + '55',
        backgroundColor: colors.error + '10',
        borderRadius: 14,
        padding: spacing.m,
        marginBottom: spacing.m,
    },
    warningTitle: {
        ...typography.captionBold,
        color: colors.error,
        marginBottom: spacing.xs,
    },
    warningText: {
        ...typography.caption,
        color: colors.text,
        marginTop: 2,
    },
    sectionLabel: {
        ...typography.captionBold,
        color: colors.textSecondary,
        marginBottom: spacing.xs,
    },
    choices: {
        gap: spacing.xs,
        marginBottom: spacing.m,
    },
    choiceRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
        minHeight: 48,
        paddingVertical: spacing.s,
        paddingHorizontal: spacing.m,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
    },
    choiceRowSelected: {
        borderColor: colors.primary + '66',
        backgroundColor: colors.primary + '0D',
    },
    choiceText: {
        flex: 1,
    },
    choiceTitle: {
        ...typography.body,
        color: colors.text,
        fontWeight: '600',
    },
    choiceDescription: {
        ...typography.caption,
        color: colors.textSecondary,
        marginTop: 2,
    },
    subscriptionBox: {
        flexDirection: 'row',
        gap: spacing.s,
        padding: spacing.m,
        borderRadius: 14,
        backgroundColor: colors.backgroundSecondary,
        marginBottom: spacing.m,
    },
    subscriptionTextWrap: {
        flex: 1,
    },
    subscriptionText: {
        ...typography.caption,
        color: colors.text,
    },
    manageLink: {
        minHeight: 48,
        justifyContent: 'center',
        alignSelf: 'flex-start',
    },
    manageLinkText: {
        ...typography.captionBold,
        color: colors.primary,
    },
    error: {
        ...typography.captionBold,
        color: colors.error,
        marginTop: spacing.s,
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
    dangerButton: {
        backgroundColor: colors.error,
        borderColor: colors.error,
    },
}));
