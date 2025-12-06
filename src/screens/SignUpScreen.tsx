import React, { useState } from 'react';
import {
    Alert,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ScreenContainer } from '../components/ScreenContainer';
import { TextInput } from '../components/TextInput';
import { Button } from '../components/Button';
import { AuthProviderButton } from '../components/AuthProviderButton';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { spacing } from '../theme/spacing';
import { authApi } from '../api/auth';
import { getErrorMessage } from '../utils/errorMessage';
import { useGoogleOAuth } from '../hooks/useGoogleOAuth';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';

export const SignUpScreen = () => {
    const navigation = useNavigation<any>();
    const { signInWithGoogle, loading: googleLoading } = useGoogleOAuth();

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const validate = () => {
        if (!email.trim() || !password || !confirmPassword) {
            setError('All fields are required.');
            return false;
        }
        if (!/\S+@\S+\.\S+/.test(email.trim())) {
            setError('Enter a valid email address.');
            return false;
        }
        if (password.length < 8) {
            setError('Password must be at least 8 characters.');
            return false;
        }
        if (password !== confirmPassword) {
            setError('Passwords do not match.');
            return false;
        }
        return true;
    };

    const isFormFilled = email.trim().length > 0 && password.length > 0 && confirmPassword.length > 0;

    const handleSignUp = async () => {
        if (!validate()) return;
        setLoading(true);
        setError(null);

        try {
            await authApi.register({
                email: email.trim().toLowerCase(),
                password,
            });
            navigation.navigate('EmailVerification', {
                email: email.trim().toLowerCase(),
                password,
                justRegistered: true,
            });
        } catch (err) {
            const message = getErrorMessage(err, 'Could not create account.');
            setError(message);
        } finally {
            setLoading(false);
        }
    };

    const handleGoogleSignUp = async () => {
        try {
            await signInWithGoogle();
            navigation.goBack();
        } catch (err) {
            const message = getErrorMessage(err, 'Google sign-in was cancelled.');
            Alert.alert('Google Sign-In', message);
        }
    };

    return (
        <ScreenContainer>
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                style={styles.keyboard}
            >
                <ScrollView
                    contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                >
                    <TouchableOpacity
                        style={styles.backButton}
                        onPress={() => navigation.goBack()}
                        activeOpacity={0.8}
                    >
                        <MaterialIcons name="arrow-back" size={22} color={colors.text} />
                    </TouchableOpacity>

                    <View style={styles.header}>
                        <Text style={styles.title}>Create account</Text>
                        <Text style={styles.subtitle}>Only verified emails can sync encrypted data.</Text>
                    </View>

                    <View style={styles.form}>
                        <TextInput
                            label="Email"
                            placeholder="name@example.com"
                            value={email}
                            onChangeText={setEmail}
                            autoCapitalize="none"
                            keyboardType="email-address"
                        />
                        <TextInput
                            label="Password"
                            placeholder="Use at least 8 characters"
                            value={password}
                            onChangeText={setPassword}
                            secureTextEntry
                        />
                        <TextInput
                            label="Confirm password"
                            placeholder="Re-enter password"
                            value={confirmPassword}
                            onChangeText={setConfirmPassword}
                            secureTextEntry
                        />

                        {error && <Text style={styles.errorText}>{error}</Text>}

                        <Button
                            title="Create account"
                            onPress={handleSignUp}
                            loading={loading}
                            disabled={!isFormFilled || loading}
                            style={{ height: 58 }}
                        />

                        <View style={styles.dividerRow}>
                            <View style={styles.divider} />
                            <Text style={styles.dividerLabel}>or</Text>
                            <View style={styles.divider} />
                        </View>

                        <AuthProviderButton
                            title="Sign up with Google"
                            icon={<MaterialCommunityIcons name="google" size={20} color={colors.text} />}
                            onPress={handleGoogleSignUp}
                            loading={googleLoading}
                        />
                    </View>

                    <View style={styles.infoCard}>
                        <MaterialIcons name="verified-user" size={22} color={colors.primary} />
                        <View style={styles.infoTextWrapper}>
                            <Text style={styles.infoTitle}>Verify to activate</Text>
                            <Text style={styles.infoText}>
                                We send a one-time token to your inbox. Finish verification before signing in.
                            </Text>
                        </View>
                    </View>

                    <View style={styles.footer}>
                        <Text style={styles.footerText}>Already have an account?</Text>
                        <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.8}>
                            <Text style={styles.link}>Sign in</Text>
                        </TouchableOpacity>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        </ScreenContainer>
    );
};

const styles = StyleSheet.create({
    keyboard: {
        flex: 1,
    },
    scrollContent: {
        flexGrow: 1,
        paddingBottom: spacing.l,
    },
    backButton: {
        width: 42,
        height: 42,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.surface,
        marginTop: spacing.l,
        marginBottom: spacing.m,
        alignSelf: 'flex-start',
    },
    header: {
        marginTop: spacing.s,
        marginBottom: spacing.l,
    },
    title: {
        ...typography.h1,
        marginBottom: spacing.xs,
    },
    subtitle: {
        ...typography.body,
        color: colors.textMuted,
    },
    form: {
        marginBottom: spacing.l,
    },
    errorText: {
        ...typography.caption,
        color: colors.error,
        marginBottom: spacing.s,
    },
    dividerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginVertical: spacing.m,
    },
    divider: {
        flex: 1,
        height: StyleSheet.hairlineWidth,
        backgroundColor: colors.border,
    },
    dividerLabel: {
        ...typography.caption,
        color: colors.textSecondary,
        textTransform: 'uppercase',
        letterSpacing: 1,
        marginHorizontal: spacing.s,
    },
    infoCard: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        padding: spacing.m,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        marginBottom: spacing.l,
    },
    infoTextWrapper: {
        flex: 1,
        marginLeft: spacing.m,
    },
    infoTitle: {
        ...typography.button,
        color: colors.text,
    },
    infoText: {
        ...typography.caption,
        color: colors.textSecondary,
        marginTop: spacing.xs,
    },
    footer: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: spacing.l,
    },
    footerText: {
        ...typography.body,
        color: colors.textSecondary,
        marginRight: spacing.xs,
    },
    link: {
        ...typography.button,
        color: colors.primary,
    },
});
