import React, { useState } from 'react';
import { Alert, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialIcons } from '@expo/vector-icons';
import { ScreenContainer } from '../components/ScreenContainer';
import { PinCodeInput } from '../components/PinCodeInput';
import { Button } from '../components/Button';
import { Loader } from '../components/Loader';
import { RootStackParamList } from '../navigation/types';
import { useAppLock } from '../context/AppLockContext';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export const AppLockScreen = () => {
    const navigation = useNavigation<Nav>();
    const {
        status,
        isAvailable,
        isUnlocked,
        pinLength,
        biometricAvailable,
        biometricEnabled,
        autoLockTimeout,
        hideAppSwitcherContent,
        setupPin,
        unlock,
        unlockWithBiometrics,
        lock,
        changePin,
        disable,
        setBiometricEnabled,
        setAutoLockTimeout,
        setHideInAppSwitcher,
    } = useAppLock();

    const [pin, setPin] = useState('');
    const [confirmPin, setConfirmPin] = useState('');
    const [currentPin, setCurrentPin] = useState('');
    const [newPin, setNewPin] = useState('');
    const [confirmNewPin, setConfirmNewPin] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const handleSetup = async () => {
        setError(null);
        if (pin.length !== pinLength) {
            setError(`PIN must be ${pinLength} digits.`);
            return;
        }
        if (pin !== confirmPin) {
            setError('PINs do not match.');
            return;
        }
        setLoading(true);
        try {
            await setupPin(pin);
            setPin('');
            setConfirmPin('');
        } catch (e: any) {
            setError(e?.message || 'Failed to set App Lock PIN.');
        } finally {
            setLoading(false);
        }
    };

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

    const handleChangePin = async () => {
        setError(null);
        if (newPin.length !== pinLength) {
            setError(`New PIN must be ${pinLength} digits.`);
            return;
        }
        if (newPin !== confirmNewPin) {
            setError('New PINs do not match.');
            return;
        }
        setLoading(true);
        try {
            await changePin(currentPin, newPin);
            setCurrentPin('');
            setNewPin('');
            setConfirmNewPin('');
        } catch (e: any) {
            setError(e?.message || 'Failed to change PIN.');
        } finally {
            setLoading(false);
        }
    };

    const handleDisable = () => {
        Alert.alert(
            'Disable App Lock',
            'This will remove PIN/biometric lock for app access on this device.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Disable',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await disable();
                        } catch (e: any) {
                            Alert.alert('Error', e?.message || 'Failed to disable App Lock.');
                        }
                    },
                },
            ]
        );
    };

    if (status === 'loading') {
        return (
            <ScreenContainer>
                <Loader />
            </ScreenContainer>
        );
    }

    if (!isAvailable) {
        return (
            <ScreenContainer>
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconButton}>
                        <MaterialIcons name="arrow-back" size={24} color={colors.text} />
                    </TouchableOpacity>
                    <Text style={styles.title}>App Lock</Text>
                    <View style={styles.iconPlaceholder} />
                </View>
                <View style={styles.card}>
                    <Text style={styles.cardTitle}>App Lock unavailable</Text>
                    <Text style={styles.copy}>
                        App Lock works only in iOS/Android app builds.
                    </Text>
                </View>
            </ScreenContainer>
        );
    }

    return (
        <ScreenContainer>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconButton}>
                    <MaterialIcons name="arrow-back" size={24} color={colors.text} />
                </TouchableOpacity>
                <Text style={styles.title}>App Lock</Text>
                {isUnlocked ? (
                    <TouchableOpacity onPress={lock} style={styles.iconButton}>
                        <MaterialIcons name="lock-open" size={22} color={colors.primary} />
                    </TouchableOpacity>
                ) : (
                    <View style={styles.iconPlaceholder} />
                )}
            </View>

            {status === 'not_configured' && (
                <View style={styles.card}>
                    <Text style={styles.cardTitle}>Set App Lock PIN</Text>
                    <Text style={styles.copy}>
                        Protect app access with PIN and optional biometrics.
                    </Text>
                    <PinCodeInput
                        label={`New PIN (${pinLength} digits)`}
                        value={pin}
                        onChange={setPin}
                        length={pinLength}
                    />
                    <PinCodeInput
                        label="Confirm PIN"
                        value={confirmPin}
                        onChange={setConfirmPin}
                        length={pinLength}
                    />
                    {error && <Text style={styles.error}>{error}</Text>}
                    <Button
                        title="Create PIN"
                        onPress={handleSetup}
                        loading={loading}
                        disabled={loading}
                    />
                </View>
            )}

            {status === 'locked' && (
                <View style={styles.card}>
                    <Text style={styles.cardTitle}>Unlock App</Text>
                    <Text style={styles.copy}>Enter PIN to access the app.</Text>
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
                    {biometricAvailable && biometricEnabled && (
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
            )}

            {status === 'unlocked' && (
                <>
                    <View style={styles.card}>
                        <Text style={styles.cardTitle}>Preferences</Text>
                        <View style={styles.preferenceRow}>
                            <View style={{ flex: 1, marginRight: spacing.s }}>
                                <Text style={styles.preferenceTitle}>Use biometrics</Text>
                                <Text style={styles.preferenceDescription}>
                                    Fast unlock after PIN setup.
                                </Text>
                            </View>
                            <Switch
                                value={biometricEnabled}
                                onValueChange={(value) => {
                                    void setBiometricEnabled(value).catch((e: any) => {
                                        Alert.alert('Error', e?.message || 'Failed to update biometrics.');
                                    });
                                }}
                                disabled={!biometricAvailable}
                                trackColor={{ false: colors.border, true: colors.primary }}
                                thumbColor={colors.surface}
                                ios_backgroundColor={colors.border}
                            />
                        </View>
                        <View style={styles.preferenceRow}>
                            <View style={{ flex: 1, marginRight: spacing.s }}>
                                <Text style={styles.preferenceTitle}>Hide app switcher preview</Text>
                                <Text style={styles.preferenceDescription}>
                                    Obscure UI when app goes background.
                                </Text>
                            </View>
                            <Switch
                                value={hideAppSwitcherContent}
                                onValueChange={(value) => {
                                    void setHideInAppSwitcher(value);
                                }}
                                trackColor={{ false: colors.border, true: colors.primary }}
                                thumbColor={colors.surface}
                                ios_backgroundColor={colors.border}
                            />
                        </View>
                        <View style={styles.timeoutRow}>
                            {(['immediate', '30s', '1m', '5m', '15m'] as const).map((item) => (
                                <TouchableOpacity
                                    key={item}
                                    style={[
                                        styles.timeoutChip,
                                        autoLockTimeout === item && styles.timeoutChipActive,
                                    ]}
                                    onPress={() => {
                                        void setAutoLockTimeout(item);
                                    }}
                                >
                                    <Text
                                        style={[
                                            styles.timeoutChipText,
                                            autoLockTimeout === item && styles.timeoutChipTextActive,
                                        ]}
                                    >
                                        {item}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    </View>

                    <View style={styles.card}>
                        <Text style={styles.cardTitle}>Change PIN</Text>
                        <PinCodeInput
                            label={`Current PIN (${pinLength} digits)`}
                            value={currentPin}
                            onChange={setCurrentPin}
                            length={pinLength}
                        />
                        <PinCodeInput
                            label={`New PIN (${pinLength} digits)`}
                            value={newPin}
                            onChange={setNewPin}
                            length={pinLength}
                        />
                        <PinCodeInput
                            label="Confirm new PIN"
                            value={confirmNewPin}
                            onChange={setConfirmNewPin}
                            length={pinLength}
                        />
                        {error && <Text style={styles.error}>{error}</Text>}
                        <Button
                            title="Update PIN"
                            onPress={handleChangePin}
                            loading={loading}
                            disabled={loading}
                        />
                        <View style={{ marginTop: spacing.s }}>
                            <Button
                                title="Disable App Lock"
                                variant="outline"
                                onPress={handleDisable}
                            />
                        </View>
                    </View>
                </>
            )}
        </ScreenContainer>
    );
};

const styles = StyleSheet.create({
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: spacing.xl,
        marginBottom: spacing.m,
    },
    title: {
        ...typography.h1,
        flex: 1,
        textAlign: 'center',
    },
    iconButton: {
        width: 40,
        height: 40,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    iconPlaceholder: {
        width: 40,
        height: 40,
    },
    card: {
        backgroundColor: colors.surface,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: colors.border,
        padding: spacing.l,
        marginTop: spacing.s,
    },
    cardTitle: {
        ...typography.h2,
        marginBottom: spacing.xs,
    },
    copy: {
        ...typography.body,
        color: colors.textSecondary,
        marginBottom: spacing.m,
    },
    error: {
        ...typography.caption,
        color: colors.error,
        marginBottom: spacing.s,
    },
    preferenceRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: spacing.m,
    },
    preferenceTitle: {
        ...typography.captionBold,
        color: colors.text,
    },
    preferenceDescription: {
        ...typography.caption,
        color: colors.textSecondary,
        marginTop: 2,
    },
    timeoutRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.s,
    },
    timeoutChip: {
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 999,
        paddingHorizontal: spacing.m,
        paddingVertical: spacing.xs,
        backgroundColor: colors.backgroundSecondary,
    },
    timeoutChipActive: {
        borderColor: colors.primary,
        backgroundColor: colors.surface,
    },
    timeoutChipText: {
        ...typography.caption,
        color: colors.textSecondary,
    },
    timeoutChipTextActive: {
        color: colors.primary,
        fontWeight: '600',
    },
});
