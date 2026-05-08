import { useTranslation } from 'react-i18next';
import React, { useEffect, useState, useRef } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { authApi } from '../api/auth';
import { MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '../hooks/useAuth';
import { getErrorMessage } from '../utils/errorMessage';

export const EmailVerificationScreen = () => {
    const { t } = useTranslation();
    const navigation = useNavigation<any>();
    const route = useRoute<any>();
    const { signIn } = useAuth();

    const email = route.params?.email;
    const password = route.params?.password;


    const [isVerified, setIsVerified] = useState(false);
    const pollInterval = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (!email) {
            console.log('EmailVerificationScreen: No email provided in params');
            return;
        }

        const checkStatus = async () => {
            try {
                console.log(`Polling verification status for: ${email}`);
                const profile = await authApi.checkVerificationStatus(email);
                console.log('Verification status response:', profile);

                if (profile.is_verified) {
                    console.log('User is verified!');
                    stopPolling();
                    setIsVerified(true);

                    // Auto-login after a short delay to show success message
                    setTimeout(() => handleVerified(), 3000);
                }
            } catch (error) {
                // Ignore errors during polling (e.g. network issues)
                console.log('Polling error:', error);
            }
        };

        // Initial check
        checkStatus();

        // Start polling
        pollInterval.current = setInterval(checkStatus, 3000);

        return () => stopPolling();
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

                // Reset navigation stack to Main screen
                navigation.reset({
                    index: 0,
                    routes: [{ name: 'NotesList' }],
                });
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
                    We sent a verification link to{'\n'}
                    <Text style={styles.email}>{email}</Text>
                </Text>

                <View style={styles.statusContainer}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={styles.statusText}>{t("aux.waitingVerification")}</Text>
                </View>

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

const styles = StyleSheet.create({
    content: {
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
    statusText: {
        ...typography.body,
        marginLeft: spacing.s,
        color: colors.textSecondary,
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
});
