import React, { useEffect, useState } from 'react';
import {
    Alert,
    KeyboardAvoidingView,
    Platform,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScreenContainer } from '../components/ScreenContainer';
import { TextInput } from '../components/TextInput';
import { Button } from '../components/Button';
import { AuthProviderButton } from '../components/AuthProviderButton';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { spacing } from '../theme/spacing';
import { authApi } from '../api/auth';
import { useAuth } from '../hooks/useAuth';
import { getErrorMessage } from '../utils/errorMessage';
import { useGoogleOAuth } from '../hooks/useGoogleOAuth';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export const SignInScreen = () => {
    const navigation = useNavigation<NativeStackNavigationProp<any>>();
    const route = useRoute<any>();
    const { signIn } = useAuth();
    const { signInWithGoogle, loading: googleLoading } = useGoogleOAuth();

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showVerificationHint, setShowVerificationHint] = useState(false);

    useEffect(() => {
        if (route.params?.email) {
            setEmail(route.params.email);
        }
    }, [route.params?.email]);

    const handleSignIn = async () => {
        if (!email || !password) {
            setError('Please enter both email and password.');
            return;
        }

        setLoading(true);
        setError(null);
        setShowVerificationHint(false);
        try {
            const tokens = await authApi.login(email.trim().toLowerCase(), password);
            await signIn(tokens.access_token);
            navigation.goBack();
        } catch (err) {
            const message = getErrorMessage(err, 'Unable to sign in.');
            setError(message);
            if (message.toLowerCase().includes('verify')) {
                setShowVerificationHint(true);
            }
        } finally {
            setLoading(false);
        }
    };

    const handleGoogleSignIn = async () => {
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
                <View style={styles.header}>
                    <Text style={styles.title}>Welcome back</Text>
                    <Text style={styles.subtitle}>Sign in to sync encrypted notes across devices.</Text>
                </View>

                <View style={styles.form}>
                    <TextInput
                        label="Email"
                        placeholder="name@example.com"
                        value={email}
                        onChangeText={setEmail}
                        autoCapitalize="none"
                        keyboardType="email-address"
                        autoCorrect={false}
                    />
                    <TextInput
                        label="Password"
                        placeholder="Enter your password"
                        value={password}
                        onChangeText={setPassword}
                        secureTextEntry
                    />

                    {error && <Text style={styles.errorText}>{error}</Text>}

                    <Button title="Sign In" onPress={handleSignIn} loading={loading} />

                    <View style={styles.dividerRow}>
                        <View style={styles.divider} />
                        <Text style={styles.dividerLabel}>or</Text>
                        <View style={styles.divider} />
                    </View>

                    <AuthProviderButton
                        title="Continue with Google"
                        icon={<MaterialCommunityIcons name="google" size={20} color={colors.text} />}
                        onPress={handleGoogleSignIn}
                        loading={googleLoading}
                    />

                    {showVerificationHint && (
                        <TouchableOpacity
                            style={styles.verifyHint}
                            onPress={() => navigation.navigate('EmailVerification', { email })}
                        >
                            <Text style={styles.verifyHintText}>Verify email to activate account</Text>
                        </TouchableOpacity>
                    )}
                </View>

                <View style={styles.footer}>
                    <Text style={styles.footerText}>New here?</Text>
                    <TouchableOpacity onPress={() => navigation.navigate('SignUp')} activeOpacity={0.8}>
                        <Text style={styles.link}>Create account</Text>
                    </TouchableOpacity>
                </View>
                <TouchableOpacity
                    style={styles.verifyLink}
                    onPress={() => navigation.navigate('EmailVerification', { email })}
                    activeOpacity={0.8}
                >
                    <Text style={styles.link}>Need to confirm your email?</Text>
                </TouchableOpacity>
            </KeyboardAvoidingView>
        </ScreenContainer>
    );
};

const styles = StyleSheet.create({
    keyboard: {
        flex: 1,
    },
    header: {
        marginTop: spacing.xl,
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
        flex: 1,
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
    footer: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: spacing.l,
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
    errorText: {
        ...typography.caption,
        color: colors.error,
        marginBottom: spacing.s,
    },
    verifyHint: {
        marginTop: spacing.s,
        backgroundColor: colors.backgroundSecondary,
        padding: spacing.m,
        borderRadius: 12,
    },
    verifyHintText: {
        ...typography.caption,
        color: colors.primary,
        textAlign: 'center',
    },
    verifyLink: {
        marginTop: spacing.s,
        alignItems: 'center',
    },
});
