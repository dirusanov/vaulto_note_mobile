import React, { useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ScreenContainer } from '../components/ScreenContainer';
import { TextInput } from '../components/TextInput';
import { Button } from '../components/Button';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { authApi } from '../api/auth';
import { getErrorMessage } from '../utils/errorMessage';
import { MaterialIcons } from '@expo/vector-icons';

const extractToken = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) return '';

    try {
        const url = new URL(trimmed);
        const fromQuery = url.searchParams.get('token');
        if (fromQuery) return fromQuery;
    } catch {
        // Not a valid URL
    }

    const tokenMatch = trimmed.match(/token=([^&]+)/);
    if (tokenMatch?.[1]) {
        return tokenMatch[1];
    }
    return trimmed;
};

export const EmailVerificationScreen = () => {
    const navigation = useNavigation<any>();
    const route = useRoute<any>();
    const prefilledEmail = route.params?.email;
    const hasJustRegistered = route.params?.justRegistered;

    const [token, setToken] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const headline = useMemo(() => {
        if (hasJustRegistered) {
            return 'Confirm your email';
        }
        return 'Enter confirmation token';
    }, [hasJustRegistered]);

    const handleVerify = async () => {
        if (!token.trim()) {
            setError('Paste the confirmation token from your email.');
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            const profile = await authApi.confirmEmail(token.trim());
            Alert.alert('Email confirmed', 'You can now sign in with your password.');
            navigation.navigate('SignIn', { email: profile.email });
        } catch (err) {
            const message = getErrorMessage(err, 'Unable to verify email.');
            setError(message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <ScreenContainer>
            <View style={styles.header}>
                <MaterialIcons name="mark-email-read" size={32} color={colors.primary} />
                <Text style={styles.title}>{headline}</Text>
                <Text style={styles.subtitle}>
                    {prefilledEmail
                        ? `We sent a secure link to ${prefilledEmail}. Paste the token or the full link below.`
                        : 'Paste the token or the full link you received via email.'}
                </Text>
            </View>

            <View style={styles.card}>
                <TextInput
                    label="Confirmation token"
                    placeholder="e.g. 4f8c2f3e-aa07..."
                    value={token}
                    onChangeText={(value) => setToken(extractToken(value))}
                    autoCapitalize="none"
                    autoCorrect={false}
                    multiline
                    numberOfLines={3}
                    error={error || undefined}
                />
                <Button title="Activate account" onPress={handleVerify} loading={submitting} />
            </View>

            <View style={styles.hintBox}>
                <MaterialIcons name="info" size={18} color={colors.primary} />
                <Text style={styles.hintText}>
                    Tap the link in your inbox from any device — the token parameter at the end of the URL is all you
                    need. Tokens expire after 30 minutes for security.
                </Text>
            </View>

            <TouchableOpacity
                onPress={() => navigation.navigate('SignIn', { email: prefilledEmail })}
                style={styles.secondaryAction}
                activeOpacity={0.8}
            >
                <Text style={styles.secondaryActionText}>Back to sign in</Text>
            </TouchableOpacity>
        </ScreenContainer>
    );
};

const styles = StyleSheet.create({
    header: {
        marginTop: spacing.xl,
        marginBottom: spacing.l,
        alignItems: 'flex-start',
    },
    title: {
        ...typography.h1,
        marginTop: spacing.s,
    },
    subtitle: {
        ...typography.body,
        color: colors.textMuted,
        marginTop: spacing.xs,
    },
    card: {
        backgroundColor: colors.surface,
        borderRadius: 16,
        padding: spacing.l,
        borderWidth: 1,
        borderColor: colors.border,
    },
    hintBox: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        padding: spacing.m,
        borderRadius: 12,
        backgroundColor: colors.backgroundSecondary,
        marginTop: spacing.l,
    },
    hintText: {
        ...typography.caption,
        color: colors.textSecondary,
        flex: 1,
        marginLeft: spacing.s,
    },
    secondaryAction: {
        marginTop: spacing.xl,
        alignItems: 'center',
    },
    secondaryActionText: {
        ...typography.button,
        color: colors.primary,
    },
});
