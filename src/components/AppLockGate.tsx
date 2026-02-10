import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ScreenContainer } from './ScreenContainer';
import { PinCodeInput } from './PinCodeInput';
import { Button } from './Button';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { useAppLock } from '../context/AppLockContext';

export const AppLockGate = ({ children }: { children: React.ReactNode }) => {
    const {
        status,
        pinLength,
        biometricAvailable,
        biometricEnabled,
        unlock,
        unlockWithBiometrics,
    } = useAppLock();
    const [pin, setPin] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const canUnlockWithBiometrics = useMemo(
        () => biometricAvailable && biometricEnabled,
        [biometricAvailable, biometricEnabled],
    );

    const handleUnlock = async () => {
        setError(null);
        if (pin.length !== pinLength) {
            setError(`PIN must be ${pinLength} digits.`);
            return;
        }
        setLoading(true);
        try {
            await unlock(pin);
            setPin('');
        } catch (e: any) {
            setError(e?.message || 'Failed to unlock app.');
        } finally {
            setLoading(false);
        }
    };

    const handleBiometricUnlock = async () => {
        setError(null);
        setLoading(true);
        try {
            await unlockWithBiometrics();
            setPin('');
        } catch (e: any) {
            setError(e?.message || 'Biometric unlock failed.');
        } finally {
            setLoading(false);
        }
    };

    if (status !== 'locked') {
        return <>{children}</>;
    }

    return (
        <ScreenContainer>
            <View style={styles.card}>
                <Text style={styles.title}>App Locked</Text>
                <Text style={styles.subtitle}>
                    Enter your PIN to continue.
                </Text>
                <PinCodeInput
                    label={`PIN (${pinLength} digits)`}
                    value={pin}
                    onChange={setPin}
                    length={pinLength}
                />
                {error && <Text style={styles.error}>{error}</Text>}
                <Button
                    title="Unlock"
                    onPress={handleUnlock}
                    loading={loading}
                    disabled={loading}
                />
                {canUnlockWithBiometrics && (
                    <View style={{ marginTop: spacing.s }}>
                        <Button
                            title="Unlock with Biometrics"
                            onPress={handleBiometricUnlock}
                            loading={loading}
                            disabled={loading}
                            variant="outline"
                        />
                    </View>
                )}
            </View>
        </ScreenContainer>
    );
};

const styles = StyleSheet.create({
    card: {
        marginTop: spacing.xl,
        backgroundColor: colors.surface,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: colors.border,
        padding: spacing.l,
    },
    title: {
        ...typography.h2,
        color: colors.text,
        marginBottom: spacing.xs,
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
});
