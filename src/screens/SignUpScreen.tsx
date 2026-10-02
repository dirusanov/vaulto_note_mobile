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
    Linking,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { spacing } from '../theme/spacing';
import { MaterialIcons } from '@expo/vector-icons';
import { authApi, LoginResult } from '../api/auth';
import { useAuth } from '../hooks/useAuth';
import { useGoogleOAuth } from '../hooks/useGoogleOAuth';
import { AuthProviderButton } from '../components/AuthProviderButton';
import { GoogleLogo } from '../components/GoogleLogo';
import { getErrorMessage } from '../utils/errorMessage';
import { createStyles } from '../theme/createStyles';
import { rtlFlip } from '../i18n/direction';

export const SignUpScreen = () => {
    const { t } = useTranslation();
    const navigation = useNavigation<NativeStackNavigationProp<any>>();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [termsAccepted, setTermsAccepted] = useState(false);
    const { signIn } = useAuth();
    const { signInWithGoogle, loading: googleLoading } = useGoogleOAuth();

    // Google creates the account on first sign-in; new users accept the terms
    // on the LegalAcceptance screen, so the checkbox below is not needed here.
    const handleGoogle = async () => {
        try {
            const result: LoginResult | null | undefined = await signInWithGoogle();
            if (!result) return;
            if (result.needs_legal_acceptance && result.legal_token) {
                navigation.navigate('LegalAcceptance', { legalToken: result.legal_token, provider: 'google' });
                return;
            }
            if (!result.access_token || !result.refresh_token) {
                throw new Error('Invalid login response');
            }
            await signIn(result.access_token, result.refresh_token);
            navigation.navigate('NotesList');
        } catch (err) {
            Alert.alert(t("auth.googleSignInFailed"), getErrorMessage(err, t("auth.googleSignInFailed")));
        }
    };

    const handleSignUp = async () => {
        if (!email || !password || !confirmPassword) {
            Alert.alert(t("common.errorTitle"), t("common.fillFields"));
            return;
        }

        if (password !== confirmPassword) {
            Alert.alert(t("common.errorTitle"), t("common.passwordsMatchError"));
            return;
        }

        if (!termsAccepted) {
            Alert.alert(t("common.errorTitle"), t("common.agreeToTerms"));
            return;
        }

        setLoading(true);
        try {
            await authApi.register({ email, password, termsAccepted: true });
            navigation.navigate('EmailVerification', { email, password });
        } catch (err: any) {
            const message = getErrorMessage(err, 'Registration failed');
            Alert.alert(t("auth.registrationFailed", "Registration Failed"), message);
        } finally {
            setLoading(false);
        }
    };

    const openLink = async (url: string) => {
        try {
            const supported = await Linking.canOpenURL(url);
            if (supported) {
                await Linking.openURL(url);
            } else {
                Alert.alert(t("common.errorTitle"), `Don't know how to open this URL: ${url}`);
            }
        } catch (error) {
            Alert.alert(t("common.errorTitle"), t("common.failedOpenLink", "An error occurred while trying to open the link."));
        }
    };

    return (
        <ScreenContainer>
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                style={styles.container}
            >
                <ScrollView contentContainerStyle={styles.scrollContent}>
                    <TouchableOpacity
                        style={styles.backButton}
                        onPress={() => navigation.goBack()}
                        activeOpacity={0.8}
                    >
                        <MaterialIcons name="arrow-back" size={22} color={colors.text} style={rtlFlip} />
                    </TouchableOpacity>

                    <View style={styles.header}>
                        <Text style={styles.title}>{t("auth.createAccount", "Create Account")}</Text>
                        <Text style={styles.subtitle}>{t("auth.signUpPerk", "30 minutes of transcription free")}</Text>
                    </View>

                    <View style={styles.form}>
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
                                    placeholder={t("auth.createPasswordPlaceholder", "Create a password")}
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

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>{t("auth.confirmPassword", "Confirm Password")}</Text>
                            <View style={styles.passwordInputWrapper}>
                                <TextInput
                                    style={[styles.input, styles.passwordInput]}
                                    placeholder={t("auth.repeatPasswordPlaceholder", "Repeat your password")}
                                    placeholderTextColor={colors.textSecondary}
                                    secureTextEntry={!showConfirmPassword}
                                    value={confirmPassword}
                                    onChangeText={setConfirmPassword}
                                />
                                <TouchableOpacity
                                    style={styles.eyeButton}
                                    onPress={() => setShowConfirmPassword(prev => !prev)}
                                    activeOpacity={0.8}
                                >
                                    <MaterialIcons
                                        name={showConfirmPassword ? 'visibility-off' : 'visibility'}
                                        size={20}
                                        color={colors.textSecondary}
                                    />
                                </TouchableOpacity>
                            </View>
                        </View>

                        <View style={styles.termsContainer}>
                            <TouchableOpacity
                                style={styles.checkbox}
                                onPress={() => setTermsAccepted(!termsAccepted)}
                                activeOpacity={0.8}
                            >
                                <MaterialIcons
                                    name={termsAccepted ? 'check-box' : 'check-box-outline-blank'}
                                    size={24}
                                    color={termsAccepted ? colors.primary : colors.textSecondary}
                                />
                            </TouchableOpacity>
                            <View style={styles.termsTextContainer}>
                                <Text style={styles.termsText}>
                                    {t("auth.iAgreeToThe", "I agree to the")}{' '}
                                    <Text
                                        style={styles.linkText}
                                        onPress={() => openLink('https://vaultonote.com/terms')}
                                    >
                                        {t("auth.termsOfService", "Terms of Service")}
                                    </Text>
                                    {' '}{t("auth.and", "and")}{' '}
                                    <Text
                                        style={styles.linkText}
                                        onPress={() => openLink('https://vaultonote.com/privacy')}
                                    >
                                        {t("auth.privacyPolicy", "Privacy Policy")}
                                    </Text>
                                </Text>
                            </View>
                        </View>

                        <TouchableOpacity
                            style={[styles.button, loading && styles.buttonDisabled]}
                            onPress={handleSignUp}
                            disabled={loading}
                        >
                            <Text style={styles.buttonText}>
                                {loading ? t("auth.creatingAccount", "Creating account...") : t("auth.signUp", "Sign Up")}
                            </Text>
                        </TouchableOpacity>

                        <View style={styles.separator}>
                            <View style={styles.separatorLine} />
                            <Text style={styles.separatorText}>{t("auth.orContinueWith", "or continue with")}</Text>
                            <View style={styles.separatorLine} />
                        </View>

                        <AuthProviderButton
                            title="Google"
                            icon={<GoogleLogo size={20} />}
                            onPress={handleGoogle}
                            loading={googleLoading}
                        />
                    </View>

                    <View style={styles.footer}>
                        <Text style={styles.footerText}>{t("auth.alreadyHaveAccount", "Already have an account?")} </Text>
                        <TouchableOpacity onPress={() => navigation.navigate('SignIn')}>
                            <Text style={styles.footerLink}>{t("auth.signIn", "Sign In")}</Text>
                        </TouchableOpacity>
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
    scrollContent: {
        width: '100%',
        maxWidth: 520,
        alignSelf: 'center',
        flexGrow: 1,
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
    header: {
        marginTop: spacing.xl,
        paddingHorizontal: spacing.l,
        marginBottom: spacing.xl,
    },
    title: {
        ...typography.h1,
        marginBottom: spacing.xs,
    },
    subtitle: {
        ...typography.body,
        color: colors.textSecondary,
    },
    form: {
        paddingHorizontal: spacing.l,
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
    inputGroup: {
        marginBottom: spacing.l,
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
        right: spacing.s,
        top: '50%',
        marginTop: -12,
        width: 24,
        height: 24,
        alignItems: 'center',
        justifyContent: 'center',
    },
    termsContainer: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: spacing.l,
    },
    checkbox: {
        marginRight: spacing.s,
        marginTop: 0,
    },
    termsTextContainer: {
        flex: 1,
        justifyContent: 'center',
    },
    termsText: {
        ...typography.caption,
        color: colors.textSecondary,
        lineHeight: 20,
    },
    linkText: {
        color: colors.primary,
        fontWeight: '600',
    },
    button: {
        backgroundColor: colors.primary,
        borderRadius: 12,
        padding: spacing.m,
        alignItems: 'center',
        marginTop: spacing.s,
    },
    buttonDisabled: {
        opacity: 0.7,
    },
    buttonText: {
        ...typography.button,
        color: '#FFFFFF',
        fontWeight: '600',
    },
    footer: {
        flexDirection: 'row',
        justifyContent: 'center',
        padding: spacing.xl,
        marginTop: 'auto',
    },
    footerText: {
        ...typography.body,
        color: colors.textSecondary,
    },
    footerLink: {
        ...typography.body,
        color: colors.primary,
        fontWeight: '600',
    },
}));
