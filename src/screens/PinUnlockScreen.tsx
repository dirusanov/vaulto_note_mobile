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

export const PinUnlockScreen = () => {
    const { unlock } = useEncryption();
    const [pin, setPin] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

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
        try {
            await unlock(normalizedPin);
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
                    Enter your PIN to unlock sync on this device.
                </Text>

                <PinCodeInput
                    label={`PIN (${PIN_LENGTH} digits)`}
                    value={pin}
                    onChange={setPin}
                    length={PIN_LENGTH}
                />
                <Text style={styles.hint}>
                    If you forget your PIN and lose this device, your notes cannot be recovered.
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
