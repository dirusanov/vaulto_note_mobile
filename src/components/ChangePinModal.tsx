import React, { useState } from 'react';
import { Modal, StyleSheet, Text, TouchableWithoutFeedback, View } from 'react-native';
import { useEncryption } from '../context/EncryptionContext';
import { PIN_LENGTH } from '../crypto/e2ee';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { Button } from './Button';
import { PinCodeInput } from './PinCodeInput';

interface ChangePinModalProps {
    visible: boolean;
    onClose: () => void;
    onChanged?: () => void;
    onChanging?: () => void;
    onError?: (message: string) => void;
}

export const ChangePinModal = ({ visible, onClose, onChanged, onChanging, onError }: ChangePinModalProps) => {
    const { changePin } = useEncryption();
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

    const handleChange = async () => {
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
        const pinValue = pin;
        onChanging?.();
        onClose();
        setTimeout(() => {
            void (async () => {
                try {
                    await changePin(pinValue);
                    reset();
                    onChanged?.();
                } catch (e: any) {
                    const message = e?.message || 'Failed to change PIN.';
                    setError(message);
                    onError?.(message);
                } finally {
                    setLoading(false);
                }
            })();
        }, 0);
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
                            <Text style={styles.title}>Change PIN</Text>
                            <Text style={styles.subtitle}>
                                Your notes stay encrypted. The server only stores the updated key bundle.
                            </Text>
                            <PinCodeInput
                                label={`New PIN (${PIN_LENGTH} digits)`}
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
                                    title="Change PIN"
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
