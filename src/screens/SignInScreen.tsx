import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import {
    Alert,
    Text,
    TextInput,
    TouchableOpacity,
    View,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
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
import { authApi, LoginResult } from '../api/auth';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { createStyles } from '../theme/createStyles';
import { rtlFlip } from '../i18n/direction';

export const SignInScreen = () => {
    const { t } = useTranslation();
    const navigation = useNavigation<NativeStackNavigationProp<any>>();
    const { signIn } = useAuth();
    const { signInWithGoogle, loading: googleLoading } = useGoogleOAuth();

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);

    const handlePostLogin = async (result: LoginResult, provider: 'google' | 'email') => {
        if (result.needs_legal_acceptance) {
            if (!result.legal_token) {
                throw new Error('Missing legal acceptance token');
            }
            navigation.navigate('LegalAcceptance', {
                legalToken: result.legal_token,
                provider,
            });
            return;
        }
        if (!result.access_token || !result.refresh_token) {
            throw new Error('Invalid login response');
        }
        await signIn(result.access_token, result.refresh_token);
        navigation.navigate('NotesList');
    };

    const handleEmailSignIn = async () => {
        if (!email || !password) {
            Alert.alert(t("common.errorTitle"), t("common.fillFields"));
            return;
        }

        setLoading(true);
        try {
            const result = await authApi.login(email, password);
            await handlePostLogin(result, 'email');
        } catch (err) {
            const message = getErrorMessage(err, t("auth.signInFailed"));
            Alert.alert(t("auth.signInFailed"), message);
        } finally {
            setLoading(false);
        }
    };

    const handleGoogleSignIn = async () => {
        try {
            const result = await signInWithGoogle();
            if (result) {
                await handlePostLogin(result, 'google');
            }
        } catch (err) {
            const message = getErrorMessage(err, t("auth.googleSignInFailed"));
            Alert.alert(t("auth.googleSignInFailed"), message);
        }
    };

    return (
        <ScreenContainer>
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                style={styles.container}
            >
                <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
                    <TouchableOpacity
                        style={styles.backButton}
                        onPress={() => navigation.goBack()}
                        activeOpacity={0.8}
                    >
                        <MaterialIcons name="arrow-back" size={22} color={colors.text} style={rtlFlip} />
                    </TouchableOpacity>

                    <View style={styles.content}>
                        <Text style={styles.title}>{t("auth.welcomeBack", "Welcome Back")}</Text>
                        <Text style={styles.subtitle}>{t("auth.signInToContinue", "Sign in to continue")}</Text>

                        <View style={styles.buttonContainer}>
                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>{t("auth.email")}</Text>
                                <TextInput
                                    style={styles.input}
                                    placeholder={t("auth.emailPlaceholder", "name@example.com")}
                                    placeholderTextColor={colors.textSecondary}
                                    autoCapitalize="none"
                                    keyboardType="email-address"
                                    value={email}
                                    onChangeText={setEmail}
                                />
                            </View>

                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>{t("auth.password")}</Text>
                                <View style={styles.passwordInputWrapper}>
                                    <TextInput
                                        style={[styles.input, styles.passwordInput]}
                                        placeholder={t("auth.passwordPlaceholder", "Enter your password")}
                                        placeholderTextColor={colors.textSecondary}
                                        secureTextEntry={!showPassword}
                                        value={password}
                                        onChangeText={setPassword}
                                    />
                                    <TouchableOpacity
                                        style={styles.eyeButton}
                                        onPress={() => setShowPassword(prev => !prev)}
                                        activeOpacity={0.8}
                                    >
                                        <MaterialIcons
                                            name={showPassword ? 'visibility-off' : 'visibility'}
                                            size={20}
                                            color={colors.textSecondary}
                                        />
                                    </TouchableOpacity>
                                </View>
                            </View>

                            <TouchableOpacity
                                onPress={() => navigation.navigate('ForgotPassword')}
                                style={styles.forgotPasswordButton}
                            >
                                <Text style={styles.forgotPasswordText}>{t("auth.forgotPassword", "Forgot Password?")}</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[styles.button, loading && styles.buttonDisabled]}
                                onPress={handleEmailSignIn}
                                disabled={loading}
                            >
                                <Text style={styles.buttonText}>
                                    {loading ? t("auth.signingIn", "Signing in...") : t("auth.signIn", "Sign In")}
                                </Text>
                            </TouchableOpacity>

                            <View style={styles.separator}>
                                <View style={styles.separatorLine} />
                                <Text style={styles.separatorText}>{t("auth.orContinueWith", "or continue with")}</Text>
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
                                    {t("auth.dontHaveAccount", "Don't have an account?")} <Text style={styles.signUpLink}>{t("auth.signUp", "Sign Up")}</Text>
                                </Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        </ScreenContainer>
    );
};

const styles = createStyles(() => ({
    container: {
        flex: 1,
    },
    backButton: {
        width: 48,
        height: 48,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.surface,
        marginTop: spacing.m,
        marginLeft: spacing.m,
        alignSelf: 'flex-start',
    },
    content: {
        flex: 1,
        paddingHorizontal: spacing.m,
        paddingTop: spacing.m,
        paddingBottom: spacing.xxl,
    },
    scrollContent: {
        flexGrow: 1,
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
        marginBottom: spacing.l,
    },
    buttonContainer: {
        gap: spacing.s,
    },
    inputGroup: {
        marginBottom: spacing.xs,
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
        minHeight: 48,
        paddingHorizontal: spacing.m,
        paddingVertical: spacing.s,
        color: colors.text,
        fontSize: 16,
    },
    passwordInputWrapper: {
        position: 'relative',
    },
    passwordInput: {
        paddingRight: spacing.xxl + spacing.s,
    },
    eyeButton: {
        position: 'absolute',
        right: 0,
        top: '50%',
        marginTop: -24,
        width: 48,
        height: 48,
        alignItems: 'center',
        justifyContent: 'center',
    },
    forgotPasswordButton: {
        alignSelf: 'flex-end',
        minHeight: 44,
        justifyContent: 'center',
        paddingHorizontal: spacing.xs,
        marginBottom: spacing.xs,
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
        marginVertical: spacing.m,
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
        marginTop: spacing.xs,
        minHeight: 48,
        justifyContent: 'center',
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
}));
