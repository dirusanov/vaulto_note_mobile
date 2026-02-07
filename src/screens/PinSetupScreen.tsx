import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ScreenContainer } from '../components/ScreenContainer';
import { PinCodeInput } from '../components/PinCodeInput';
import { Button } from '../components/Button';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { useEncryption } from '../context/EncryptionContext';
import { PIN_LENGTH } from '../crypto/e2ee';

export const PinSetupScreen = () => {
    const { enableE2EE } = useEncryption();
    const [pin, setPinState] = useState('');
    const [confirmPin, setConfirmPin] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSetup = async () => {
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
        } catch (e: any) {
            setError(e?.message || 'Failed to set PIN.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <ScreenContainer>
            <View style={styles.container}>
                <Text style={styles.title}>Enable Sync</Text>
                <Text style={styles.subtitle}>
                    Set an 8-digit PIN to protect your notes before they sync.
                </Text>

                <PinCodeInput
                    label={`PIN (${PIN_LENGTH} digits)`}
                    value={pin}
                    onChange={setPinState}
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
                <Button
                    title="Enable Sync"
                    onPress={handleSetup}
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
