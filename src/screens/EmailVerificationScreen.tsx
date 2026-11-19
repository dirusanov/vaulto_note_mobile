import { useTranslation } from 'react-i18next';
import React, { useEffect, useState, useRef } from 'react';
import { Text, TouchableOpacity, View, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { authApi } from '../api/auth';
import { MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '../hooks/useAuth';
import { getErrorMessage } from '../utils/errorMessage';
import { createStyles } from '../theme/createStyles';
import { finishSignIn } from '../navigation/finishSignIn';

export const EmailVerificationScreen = () => {
    const { t } = useTranslation();
    const navigation = useNavigation<any>();
    const route = useRoute<any>();
    const { signIn } = useAuth();

    const email = route.params?.email;
    const password = route.params?.password;


    const [isVerified, setIsVerified] = useState(false);
    // Why the last automatic check failed (offline, server down); null while checks work.
    const [checkError, setCheckError] = useState<string | null>(null);
    const [checking, setChecking] = useState(false);
    const pollInterval = useRef<NodeJS.Timeout | null>(null);
    const checkNowRef = useRef<(() => Promise<void>) | null>(null);

    useEffect(() => {
        if (!email) {
            console.log('EmailVerificationScreen: No email provided in params');
            return;
        }

        let active = true;
        const checkStatus = async () => {
            try {
                const profile = await authApi.checkVerificationStatus(email);
                if (!active) return;
                setCheckError(null);

                if (profile.is_verified) {
                    console.log('User is verified!');
                    stopPolling();
                    setIsVerified(true);

                    // Auto-login after a short delay to show success message
                    setTimeout(() => handleVerified(), 3000);
                }
            } catch (error) {
                // Say so instead of "waiting" forever: offline, or the server is down.
                // Polling goes on, so the screen recovers by itself once it is back.
                console.warn('[EmailVerification] Status check failed:', getErrorMessage(error, 'unknown'));
                if (active) {
                    setCheckError(getErrorMessage(error, t('aux.verificationCheckFailed', 'Could not check whether your email is verified. Check your connection and try again.')));
                }
            }
        };
        checkNowRef.current = async () => {
            setChecking(true);
            try {
                await checkStatus();
            } finally {
                if (active) setChecking(false);
            }
        };

        // Initial check
        void checkStatus();

        // Start polling
        pollInterval.current = setInterval(checkStatus, 3000);

        return () => {
            active = false;
            checkNowRef.current = null;
            stopPolling();
        };
    }, [email]);

    const stopPolling = () => {
        if (pollInterval.current) {
            clearInterval(pollInterval.current);
            pollInterval.current = null;
        }
    };

    const handleVerified = async () => {
        if (password) {
            try {
                console.log('Attempting auto-login...');
                const loginResult = await authApi.login(email, password);
                if (loginResult.needs_legal_acceptance) {
                    if (!loginResult.legal_token) {
                        throw new Error('Missing legal acceptance token');
                    }
                    navigation.reset({
                        index: 0,
                        routes: [{
                            name: 'LegalAcceptance',
                            params: { legalToken: loginResult.legal_token, provider: 'email' },
                        }],
                    });
                    return;
                }
                if (!loginResult.access_token || !loginResult.refresh_token) {
                    throw new Error('Invalid login response');
                }
                await signIn(loginResult.access_token, loginResult.refresh_token);
                console.log('Auto-login successful');

                // Back to where the sign-in started (e.g. Ask your notes), else the library.
                finishSignIn(navigation, () => navigation.reset({
                    index: 0,
                    routes: [{ name: 'NotesList' }],
                }));
            } catch (e) {
                // Fallback if auto-login fails
                console.log('Auto-login failed:', e);
                const message = getErrorMessage(e, t("common.pleaseSignInAgain"));
                console.warn('[EmailVerification] Auto-login failed:', message);
                navigation.navigate('SignIn', { email });
            }
        } else {
            navigation.navigate('SignIn', { email });
        }
    };

    if (isVerified) {
        return (
            <ScreenContainer>
                <View style={styles.content}>
                    <View style={[styles.iconContainer, { borderColor: colors.success }]}>
                        <MaterialIcons name="check-circle" size={64} color={colors.success} />
                    </View>
                    <Text style={styles.title}>{t("aux.emailVerified")}</Text>
                    <Text style={styles.subtitle}>
                        {t("aux.accountVerified")}
                    </Text>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={[styles.statusText, { marginTop: spacing.m }]}>
                        {t("aux.loggingIn")}
                    </Text>
                </View>
            </ScreenContainer>
        );
    }

    return (
        <ScreenContainer>
            <View style={styles.content}>
                <View style={styles.iconContainer}>
                    <MaterialIcons name="mark-email-unread" size={64} color={colors.primary} />
                </View>

                <Text style={styles.title}>{t("aux.checkInbox")}</Text>

                <Text style={styles.subtitle}>
                    {t('aux.verificationSentTo', 'We sent a verification link to')}{'\n'}
                    <Text style={styles.email}>{email}</Text>
                </Text>

                {checkError ? (
                    <View style={[styles.statusContainer, styles.statusError]} accessibilityRole="alert">
                        <View style={styles.statusRow}>
                            <MaterialIcons name="cloud-off" size={20} color={colors.error} />
                            <Text style={[styles.statusText, styles.statusErrorText]}>{checkError}</Text>
                        </View>
                        <TouchableOpacity
                            onPress={() => { void checkNowRef.current?.(); }}
                            disabled={checking}
                            style={styles.retryButton}
                            accessibilityRole="button"
                        >
                            {checking
                                ? <ActivityIndicator size="small" color={colors.primary} />
                                : <Text style={styles.retryButtonText}>{t('aux.paywallRetry', 'Try again')}</Text>}
                        </TouchableOpacity>
                    </View>
                ) : (
                    <View style={styles.statusContainer}>
                        <View style={styles.statusRow}>
                            <ActivityIndicator size="small" color={colors.primary} />
                            <Text style={styles.statusText}>{t("aux.waitingVerification")}</Text>
                        </View>
                    </View>
                )}

                <View style={styles.infoBox}>
                    <Text style={styles.infoText}>
                        {t("aux.tapLinkVerify")}
                    </Text>
                </View>

                <TouchableOpacity
                    onPress={() => navigation.navigate('SignIn', { email })}
                    style={styles.backButton}
                    activeOpacity={0.8}
                >
                    <Text style={styles.backButtonText}>{t("aux.backToSignIn")}</Text>
                </TouchableOpacity>
            </View>
        </ScreenContainer>
    );
};

const styles = createStyles(() => ({
    content: {
        width: '100%',
        maxWidth: 520,
        alignSelf: 'center',
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.l,
    },
    iconContainer: {
        marginBottom: spacing.l,
        backgroundColor: colors.surface,
        padding: spacing.l,
        borderRadius: 32,
        borderWidth: 1,
        borderColor: colors.border,
    },
    title: {
        ...typography.h1,
        textAlign: 'center',
        marginBottom: spacing.m,
    },
    subtitle: {
        ...typography.body,
        textAlign: 'center',
        color: colors.textSecondary,
        marginBottom: spacing.xl,
    },
    email: {
        color: colors.text,
        fontWeight: '600',
    },
    statusContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: spacing.xl,
        padding: spacing.m,
        backgroundColor: colors.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    statusText: {
        ...typography.body,
        marginLeft: spacing.s,
        color: colors.textSecondary,
        flexShrink: 1,
    },
    statusError: {
        flexDirection: 'column',
        alignItems: 'stretch',
        borderColor: colors.error,
        gap: spacing.s,
    },
    statusErrorText: {
        color: colors.text,
    },
    retryButton: {
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    retryButtonText: {
        ...typography.button,
        color: colors.primary,
    },
    infoBox: {
        backgroundColor: colors.backgroundSecondary,
        padding: spacing.m,
        borderRadius: 12,
        marginBottom: spacing.xl,
    },
    infoText: {
        ...typography.caption,
        textAlign: 'center',
        color: colors.textSecondary,
        lineHeight: 20,
    },
    backButton: {
        padding: spacing.m,
    },
    backButtonText: {
        ...typography.button,
        color: colors.primary,
    },
}));
