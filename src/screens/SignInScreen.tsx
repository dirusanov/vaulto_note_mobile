import React, { useState } from 'react';
import {
    Alert,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';

import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScreenContainer } from '../components/ScreenContainer';

import { AuthProviderButton } from '../components/AuthProviderButton';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { spacing } from '../theme/spacing';

import { useAuth } from '../hooks/useAuth';
import { getErrorMessage } from '../utils/errorMessage';
import { useGoogleOAuth } from '../hooks/useGoogleOAuth';
import { authApi } from '../api/auth';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';

export const SignInScreen = () => {
    const navigation = useNavigation<NativeStackNavigationProp<any>>();
    const { signIn } = useAuth();
    const { signInWithGoogle, loading: googleLoading } = useGoogleOAuth();

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);

    const handleEmailSignIn = async () => {
        if (!email || !password) {
            Alert.alert('Error', 'Please fill in all fields');
            return;
        }

        setLoading(true);
        try {
            const tokens = await authApi.login(email, password);
            await signIn(tokens.access_token, tokens.refresh_token);
            navigation.navigate('NotesList');
        } catch (err) {
            const message = getErrorMessage(err, 'Sign-in failed');
            Alert.alert('Sign-In Failed', message);
        } finally {
            setLoading(false);
        }
    };

    const handleGoogleSignIn = async () => {
        try {
            await signInWithGoogle();
            navigation.navigate('NotesList');
        } catch (err) {
            const message = getErrorMessage(err, 'Google sign-in was cancelled.');
            Alert.alert('Google Sign-In', message);
        }
    };

    return (
        <ScreenContainer>
            <View style={styles.container}>
                <TouchableOpacity
                    style={styles.backButton}
                    onPress={() => navigation.goBack()}
                    activeOpacity={0.8}
                >
                    <MaterialIcons name="arrow-back" size={22} color={colors.text} />
                </TouchableOpacity>

                <View style={styles.content}>
                    <Text style={styles.title}>Welcome Back</Text>
                    <Text style={styles.subtitle}>Sign in to continue</Text>

                    <View style={styles.buttonContainer}>
                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Email</Text>
                            <TextInput
                                style={styles.input}
                                placeholder="name@example.com"
                                placeholderTextColor={colors.textSecondary}
                                autoCapitalize="none"
                                keyboardType="email-address"
                                value={email}
                                onChangeText={setEmail}
                            />
                        </View>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Password</Text>
                            <TextInput
                                style={styles.input}
                                placeholder="Enter your password"
                                placeholderTextColor={colors.textSecondary}
                                secureTextEntry
                                value={password}
                                onChangeText={setPassword}
                            />
                        </View>

                        <TouchableOpacity
                            onPress={() => navigation.navigate('ForgotPassword')}
                            style={styles.forgotPasswordButton}
                        >
                            <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.button, loading && styles.buttonDisabled]}
                            onPress={handleEmailSignIn}
                            disabled={loading}
                        >
                            <Text style={styles.buttonText}>
                                {loading ? 'Signing in...' : 'Sign In'}
                            </Text>
                        </TouchableOpacity>

                        <View style={styles.separator}>
                            <View style={styles.separatorLine} />
                            <Text style={styles.separatorText}>or continue with</Text>
                            <View style={styles.separatorLine} />
                        </View>

                        <AuthProviderButton
                            title="Google"
                            icon={<MaterialCommunityIcons name="google" size={20} color={colors.text} />}
                            onPress={handleGoogleSignIn}
                            loading={googleLoading}
                        />

                        <TouchableOpacity
                            style={styles.signUpButton}
                            onPress={() => navigation.navigate('SignUp')}
                        >
                            <Text style={styles.signUpText}>
                                Don't have an account? <Text style={styles.signUpLink}>Sign Up</Text>
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </ScreenContainer>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
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
        marginLeft: spacing.l,
        alignSelf: 'flex-start',
    },
    content: {
        flex: 1,
        justifyContent: 'center',
        paddingHorizontal: spacing.l,
        paddingBottom: spacing.xxl,
    },
    title: {
        ...typography.h1,
        textAlign: 'center',
        marginBottom: spacing.xs,
    },
    subtitle: {
        ...typography.body,
        color: colors.textSecondary,
        textAlign: 'center',
        marginBottom: spacing.xxl,
    },
    buttonContainer: {
        gap: spacing.m,
    },
    inputGroup: {
        marginBottom: spacing.s,
    },
    label: {
        ...typography.caption,
        color: colors.text,
        marginBottom: spacing.s,
        fontWeight: '600',
    },
    input: {
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        padding: spacing.m,
        color: colors.text,
        fontSize: 16,
    },
    forgotPasswordButton: {
        alignSelf: 'flex-end',
        marginBottom: spacing.m,
    },
    forgotPasswordText: {
        ...typography.caption,
        color: colors.primary,
        fontWeight: '600',
    },
    button: {
        backgroundColor: colors.primary,
        borderRadius: 12,
        padding: spacing.m,
        alignItems: 'center',
    },
    buttonDisabled: {
        opacity: 0.7,
    },
    buttonText: {
        ...typography.button,
        color: '#FFFFFF',
        fontWeight: '600',
    },
    separator: {
        flexDirection: 'row',
        alignItems: 'center',
        marginVertical: spacing.l,
    },
    separatorLine: {
        flex: 1,
        height: 1,
        backgroundColor: colors.border,
    },
    separatorText: {
        ...typography.caption,
        color: colors.textSecondary,
        paddingHorizontal: spacing.m,
    },
    signUpButton: {
        marginTop: spacing.m,
        alignItems: 'center',
    },
    signUpText: {
        ...typography.body,
        color: colors.textSecondary,
    },
    signUpLink: {
        color: colors.primary,
        fontWeight: '600',
    },
});

