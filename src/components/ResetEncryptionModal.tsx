import React, { useEffect, useMemo, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableWithoutFeedback, View } from 'react-native';
import { useEncryption } from '../context/EncryptionContext';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { Button } from './Button';
import { TextInput } from './TextInput';

interface ResetEncryptionModalProps {
    visible: boolean;
    onClose: () => void;
    onReset?: (result: 'purged' | 'partial') => void;
}

const REQUIRED_CONFIRM = 'DELETE';

export const ResetEncryptionModal = ({ visible, onClose, onReset }: ResetEncryptionModalProps) => {
    const { resetEncryption } = useEncryption();
    const [confirmText, setConfirmText] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const canConfirm = useMemo(
        () => confirmText.trim().toUpperCase() === REQUIRED_CONFIRM,
        [confirmText],
    );

    useEffect(() => {
        if (!visible) return;
        setConfirmText('');
        setLoading(false);
        setError(null);
    }, [visible]);

    const handleClose = () => {
        if (loading) return;
        onClose();
    };

    const handleReset = async () => {
        if (!canConfirm) return;
        setError(null);
        setLoading(true);
        try {
            const result = await resetEncryption();
            onReset?.(result);
            onClose();
        } catch (e: any) {
            setError(e?.message || 'Failed to reset encryption.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
            <TouchableWithoutFeedback onPress={handleClose}>
                <View style={styles.backdrop}>
                    <TouchableWithoutFeedback>
                        <View style={styles.card}>
                            <Text style={styles.title}>Reset Encryption</Text>
                            <Text style={styles.subtitle}>
                                This will permanently delete all notes stored on this device and all encrypted sync data.
                                It cannot be undone.
                            </Text>

                            <View style={styles.warningBox}>
                                <Text style={styles.warningTitle}>You will lose:</Text>
                                <Text style={styles.warningText}>Local notes in the database</Text>
                                <Text style={styles.warningText}>Encrypted synced notes on the server</Text>
                                <Text style={styles.warningText}>The current encryption key</Text>
                            </View>

                            <TextInput
                                label={`Type "${REQUIRED_CONFIRM}" to confirm`}
                                value={confirmText}
                                onChangeText={setConfirmText}
                                autoCapitalize="characters"
                                autoCorrect={false}
                                placeholder={REQUIRED_CONFIRM}
                            />

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
                                    title="Reset"
                                    onPress={handleReset}
                                    loading={loading}
                                    disabled={loading || !canConfirm}
                                    style={[styles.actionButton, styles.dangerButton]}
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
        backgroundColor: 'rgba(0,0,0,0.45)',
        justifyContent: 'center',
        padding: spacing.l,
    },
    card: {
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
});

