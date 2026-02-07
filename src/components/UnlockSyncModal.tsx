import React, { useState } from 'react';
import { Modal, StyleSheet, Text, TouchableWithoutFeedback, View } from 'react-native';
import { useEncryption } from '../context/EncryptionContext';
import { PIN_LENGTH } from '../crypto/e2ee';
import { Button } from './Button';
import { PinCodeInput } from './PinCodeInput';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

interface UnlockSyncModalProps {
    visible: boolean;
    onClose: () => void;
    onUnlocked?: () => void;
    onUnlocking?: () => void;
    onError?: (message: string) => void;
}

export const UnlockSyncModal = ({ visible, onClose, onUnlocked, onUnlocking, onError }: UnlockSyncModalProps) => {
    const { unlock } = useEncryption();
    const [pin, setPin] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const reset = () => {
        setPin('');
        setError(null);
    };

    const handleClose = () => {
        if (loading) return;
        reset();
        onClose();
    };

    const handleUnlock = async () => {
        setError(null);
        const normalizedPin = pin.trim();
        if (normalizedPin && !/^\d{8}$/.test(normalizedPin)) {
            setError(`PIN must be exactly ${PIN_LENGTH} digits.`);
            return;
        }
        if (!normalizedPin) {
            setError('PIN is required.');
            return;
        }

        setLoading(true);
        const pinValue = normalizedPin;
        onUnlocking?.();
        onClose();
        setTimeout(() => {
            void (async () => {
                try {
                    await unlock(pinValue);
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
                                Enter your PIN to unlock the sync key. This does not affect local access.
                            </Text>
                            <PinCodeInput
                                label={`PIN (${PIN_LENGTH} digits)`}
                                value={pin}
                                onChange={setPin}
                                length={PIN_LENGTH}
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
