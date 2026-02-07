import React, { useState } from 'react';
import { Modal, StyleSheet, Text, TouchableWithoutFeedback, View } from 'react-native';
import { useEncryption } from '../context/EncryptionContext';
import { PIN_LENGTH } from '../crypto/e2ee';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { Button } from './Button';
import { PinCodeInput } from './PinCodeInput';
import { syncService } from '../services/SyncService';

interface EnableSyncModalProps {
    visible: boolean;
    onClose: () => void;
    onEnabled?: () => void;
}

export const EnableSyncModal = ({ visible, onClose, onEnabled }: EnableSyncModalProps) => {
    const { enableE2EE } = useEncryption();
    const [pin, setPin] = useState('');
    const [confirmPin, setConfirmPin] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const reset = () => {
        setPin('');
        setConfirmPin('');
        setError(null);
    };

    const handleClose = () => {
        if (loading) return;
        reset();
        onClose();
    };

    const handleEnable = async () => {
        setError(null);
        if (!/^\d{8}$/.test(pin)) {
            setError(`PIN must be exactly ${PIN_LENGTH} digits.`);
            return;
        }
        if (pin !== confirmPin) {
            setError('PINs do not match.');
            return;
        }
        setLoading(true);
        try {
            await enableE2EE(pin);
            setTimeout(() => {
                void syncService.syncNow('manual');
            }, 0);
            reset();
            onEnabled?.();
        } catch (e: any) {
            setError(e?.message || 'Failed to enable sync.');
        } finally {
            setLoading(false);
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
                            <Text style={styles.title}>Enable Sync</Text>
                            <Text style={styles.subtitle}>
                                Set an 8-digit PIN to unlock sync. Local notes stay accessible without it.
                            </Text>
                            <PinCodeInput
                                label={`PIN (${PIN_LENGTH} digits)`}
                                value={pin}
                                onChange={setPin}
                                length={PIN_LENGTH}
                            />
                            <PinCodeInput
                                label="Confirm PIN"
                                value={confirmPin}
                                onChange={setConfirmPin}
                                length={PIN_LENGTH}
                            />
                            <Text style={styles.hint}>
                                PIN is required only to enable sync or restore on a new device.
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
                                    title="Enable Sync"
                                    onPress={handleEnable}
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
