import { useTranslation } from 'react-i18next';
import React, { useEffect, useState } from 'react';
import {
    Text,
    TextInput,
    TouchableOpacity,
    View,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
} from 'react-native';

import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScreenContainer } from '../components/ScreenContainer';

import { AuthProviderButton } from '../components/AuthProviderButton';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';

import { useAuth } from '../hooks/useAuth';
import { getErrorMessage } from '../utils/errorMessage';
import { useGoogleOAuth } from '../hooks/useGoogleOAuth';
import { authApi, LoginResult } from '../api/auth';
import { MaterialIcons } from '@expo/vector-icons';
import { createStyles } from '../theme/createStyles';
import { rtlFlip } from '../i18n/direction';
import { GoogleLogo } from '../components/GoogleLogo';
import { appAlert } from '../components/AppAlert';
import { storage } from '../utils/storage';

// Trial minutes a new account gets: the registration plan on the gateway
// (subscription_plans.apply_on_registration, 30 on prod; see also auth.signUpPerk).
const NEW_ACCOUNT_MINUTES = 30;

export const SignInScreen = () => {
    const { t } = useTranslation();
    const navigation = useNavigation<NativeStackNavigationProp<any>>();
    const route = useRoute<any>();
    const { signIn } = useAuth();
    const { signInWithGoogle, loading: googleLoading } = useGoogleOAuth();

    // Coming from email verification, or signed out with notes kept on the device:
    // that person has an account, so "welcome back" fits. Everyone else is most
    // likely a guest deciding whether an account is worth it.
    const verifiedEmail: string | undefined = route.params?.email;
    const [keptAfterSignOut, setKeptAfterSignOut] = useState(false);
    useEffect(() => {
        void storage.getKeepLocalNotes().then(setKeptAfterSignOut).catch(() => setKeptAfterSignOut(false));
    }, []);
    const returning = !!verifiedEmail || keptAfterSignOut;

    const [email, setEmail] = useState(verifiedEmail ?? '');
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
            appAlert(t("common.errorTitle"), t("common.fillFields"));
            return;
        }

        setLoading(true);
        try {
            const result = await authApi.login(email, password);
            await handlePostLogin(result, 'email');
        } catch (err) {
            const message = getErrorMessage(err, t("auth.signInFailed"));
            appAlert(t("auth.signInFailed"), message);
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
            appAlert(t("auth.googleSignInFailed"), message);
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
                        accessibilityRole="button"
                        accessibilityLabel={t('a11y.back', 'Back')}
                    >
                        <MaterialIcons name="arrow-back" size={24} color={colors.text} style={rtlFlip} />
                    </TouchableOpacity>

                    <View style={styles.content}>
                        {returning ? (
                            <>
                                <Text style={styles.title}>{t("auth.welcomeBack", "Welcome Back")}</Text>
                                <Text style={styles.subtitle}>{t("auth.signInToContinue", "Sign in to continue")}</Text>
                            </>
                        ) : (
                            <>
                                <Text style={styles.title}>
                                    {t("auth.newUserTitle", "Keep your notes and get {{minutes}} free minutes", { minutes: NEW_ACCOUNT_MINUTES })}
                                </Text>
                                <Text style={styles.subtitleTight}>
                                    {t("auth.newUserSubtitle", "A free account. The minutes come with a new one.")}
                                </Text>
                                <View style={styles.benefits}>
                                    <Benefit icon="auto-awesome" text={t("auth.benefitAI", "AI tidies up text, finds tasks and answers questions about your notes")} />
                                    <Benefit icon="lock-outline" text={t("auth.benefitSync", "Sync across your devices with end-to-end encryption")} />
                                    <Benefit icon="move-to-inbox" text={t("auth.benefitKeepNotes", "Notes you made without an account come with you")} />
                                </View>
                            </>
                        )}

                        <View style={styles.buttonContainer}>
                            {/* One tap beats typing a password: Google first. */}
                            <AuthProviderButton
                                title="Google"
                                icon={<GoogleLogo size={20} />}
                                onPress={handleGoogleSignIn}
                                loading={googleLoading}
                            />

                            <View style={styles.separator}>
                                <View style={styles.separatorLine} />
                                <Text style={styles.separatorText}>{t("auth.orWithEmail", "or with email")}</Text>
                                <View style={styles.separatorLine} />
                            </View>

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

                            <TouchableOpacity
                                style={styles.signUpButton}
                                onPress={() => navigation.navigate('SignUp')}
                            >
                                <Text style={styles.signUpText}>
                                    {t("auth.dontHaveAccount", "Don't have an account?")} <Text style={styles.signUpLink}>{t("auth.signUp", "Sign Up")}</Text>
                                </Text>
                            </TouchableOpacity>

                            {/* Without an account the app keeps working: say so plainly. */}
                            <TouchableOpacity
                                style={styles.notNowButton}
                                onPress={() => navigation.goBack()}
                                accessibilityRole="button"
                            >
                                <Text style={styles.notNowText}>{t("common.notNow", "Not now")}</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        </ScreenContainer>
    );
};

const Benefit = ({ icon, text }: { icon: keyof typeof MaterialIcons.glyphMap; text: string }) => (
    <View style={styles.benefitRow}>
        <View style={styles.benefitIcon}>
            <MaterialIcons name={icon} size={18} color={colors.primary} />
        </View>
        <Text style={styles.benefitText}>{text}</Text>
    </View>
);

const styles = createStyles(() => ({
    container: {
        flex: 1,
    },
    backButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: spacing.s,
        marginStart: spacing.s,
        alignSelf: 'flex-start',
    },
    content: {
        flex: 1,
        paddingHorizontal: spacing.m,
        paddingTop: spacing.l,
        paddingBottom: spacing.xxl,
    },
    scrollContent: {
        width: '100%',
        maxWidth: 520,
        alignSelf: 'center',
        flexGrow: 1,
    },
    title: {
        fontSize: 30,
        lineHeight: 36,
        fontWeight: '700',
        letterSpacing: -0.7,
        color: colors.text,
        marginBottom: 6,
    },
    subtitle: {
        fontSize: 16,
        lineHeight: 22,
        color: colors.textSecondary,
        marginBottom: spacing.xl,
    },
    subtitleTight: {
        fontSize: 15,
        lineHeight: 21,
        color: colors.textSecondary,
        marginBottom: spacing.l,
    },
    benefits: {
        gap: spacing.s,
        marginBottom: spacing.xl,
    },
    benefitRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
    },
    benefitIcon: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.primaryLight,
    },
    benefitText: {
        flex: 1,
        fontSize: 15,
        lineHeight: 21,
        color: colors.text,
    },
    buttonContainer: {
        gap: spacing.s,
    },
    inputGroup: {
        marginBottom: spacing.xs,
    },
    label: {
        fontSize: 13,
        lineHeight: 18,
        fontWeight: '500',
        color: colors.textSecondary,
        marginBottom: 6,
    },
    input: {
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 14,
        minHeight: 52,
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
        fontSize: 14,
        fontWeight: '500',
        color: colors.primary,
    },
    button: {
        backgroundColor: colors.primary,
        borderRadius: 26,
        minHeight: 52,
        paddingHorizontal: spacing.l,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 0,
    },
    buttonDisabled: {
        opacity: 0.7,
    },
    buttonText: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.onPrimary,
    },
    separator: {
        flexDirection: 'row',
        alignItems: 'center',
        marginVertical: spacing.m,
    },
    separatorLine: {
        flex: 1,
        height: StyleSheet.hairlineWidth,
        backgroundColor: colors.border,
    },
    separatorText: {
        fontSize: 13,
        color: colors.textTertiary,
        paddingHorizontal: spacing.m,
    },
    signUpButton: {
        marginTop: spacing.xs,
        minHeight: 48,
        justifyContent: 'center',
        alignItems: 'center',
    },
    signUpText: {
        fontSize: 15,
        color: colors.textSecondary,
    },
    signUpLink: {
        color: colors.primary,
        fontWeight: '600',
    },
    notNowButton: {
        minHeight: 48,
        justifyContent: 'center',
        alignItems: 'center',
    },
    notNowText: {
        fontSize: 15,
        fontWeight: '500',
        color: colors.textSecondary,
    },
}));
