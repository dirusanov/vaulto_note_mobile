import { useTranslation } from 'react-i18next';
import React, { useMemo, useState } from 'react';
import {
    Alert,
    Linking,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialIcons } from '@expo/vector-icons';

import { ScreenContainer } from '../components/ScreenContainer';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { authApi } from '../api/auth';
import { useAuth } from '../hooks/useAuth';
import { getErrorMessage } from '../utils/errorMessage';
import { createStyles } from '../theme/createStyles';

type LegalParams = {
    legalToken?: string;
    provider?: 'google' | 'email' | string;
};

export const LegalAcceptanceScreen = () => {
    const { t } = useTranslation();
    const navigation = useNavigation<NativeStackNavigationProp<any>>();
    const route = useRoute();
    const { signIn } = useAuth();

    const params = (route.params || {}) as LegalParams;
    const legalToken = params.legalToken || '';
    const provider = params.provider || 'email';

    const [accepted, setAccepted] = useState(false);
    const [loading, setLoading] = useState(false);

    const providerLabel = useMemo(() => {
        if (provider === 'google') return 'Google';
        if (provider === 'email') return 'Email';
        return t("common.thisMethod", "this method");
    }, [provider, t]);

    const openLink = async (url: string) => {
        try {
            const supported = await Linking.canOpenURL(url);
            if (supported) {
                await Linking.openURL(url);
                return;
            }
            Alert.alert(t("common.errorTitle"), `Cannot open URL: ${url}`);
        } catch (_) {
            Alert.alert(t("common.errorTitle"), t("common.failedOpenLink", "Failed to open link."));
        }
    };

    const handleContinue = async () => {
        if (!accepted) {
            Alert.alert(t("auth.agreementRequired"), t("common.agreeToTerms"));
            return;
        }
        if (!legalToken) {
            Alert.alert(t("common.sessionExpired"), t("common.pleaseSignInAgain"));
            navigation.navigate('SignIn');
            return;
        }

        setLoading(true);
        try {
            const tokens = await authApi.acceptLegal(legalToken);
            if (!tokens.access_token || !tokens.refresh_token) {
                throw new Error('Invalid auth response');
            }
            await signIn(tokens.access_token, tokens.refresh_token);
            navigation.reset({
                index: 0,
                routes: [{ name: 'NotesList' }],
            });
        } catch (error) {
            Alert.alert(t("common.failedTitle"), getErrorMessage(error, t("common.pleaseSignInAgain")));
            navigation.navigate('SignIn');
        } finally {
            setLoading(false);
        }
    };

    return (
        <ScreenContainer>
            <View style={styles.container}>
                <TouchableOpacity
                    style={styles.backButton}
                    onPress={() => navigation.navigate('SignIn')}
                    activeOpacity={0.8}
                >
                    <MaterialIcons name="arrow-back" size={22} color={colors.text} />
                </TouchableOpacity>

                <View style={styles.content}>
                    <Text style={styles.title}>{t("aux.oneLastStep", "One Last Step")}</Text>
                    <Text style={styles.subtitle}>
                        {t("auth.legalAcceptanceSubtitle", { provider: providerLabel })}
                    </Text>

                    <View style={styles.card}>
                        <TouchableOpacity
                            style={styles.termsRow}
                            onPress={() => setAccepted((prev) => !prev)}
                            activeOpacity={0.85}
                        >
                            <MaterialIcons
                                name={accepted ? 'check-box' : 'check-box-outline-blank'}
                                size={24}
                                color={accepted ? colors.primary : colors.textSecondary}
                            />
                            <Text style={styles.termsText}>
                                {t("auth.iAcceptThe")}{' '}
                                <Text style={styles.linkText} onPress={() => void openLink('https://vaultonote.com/terms')}>
                                    {t("auth.termsOfService")}
                                </Text>
                                {' '}{t("auth.andThe")}{' '}
                                <Text style={styles.linkText} onPress={() => void openLink('https://vaultonote.com/privacy')}>
                                    {t("auth.privacyPolicy")}
                                </Text>
                            </Text>
                        </TouchableOpacity>
                    </View>

                    <TouchableOpacity
                        style={[styles.button, (!accepted || loading) && styles.buttonDisabled]}
                        disabled={!accepted || loading}
                        onPress={() => {
                            void handleContinue();
                        }}
                    >
                        <Text style={styles.buttonText}>{loading ? t("auth.pleaseWait") : t("auth.continue")}</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </ScreenContainer>
    );
};

const styles = createStyles(() => ({
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
        marginTop: spacing.m,
        marginLeft: spacing.m,
        alignSelf: 'flex-start',
    },
    content: {
        flex: 1,
        justifyContent: 'center',
        paddingHorizontal: spacing.m,
        paddingBottom: spacing.l,
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
    card: {
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 14,
        padding: spacing.m,
    },
    termsRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.s,
    },
    termsText: {
        ...typography.caption,
        color: colors.textSecondary,
        lineHeight: 20,
        flex: 1,
    },
    linkText: {
        color: colors.primary,
        fontWeight: '600',
    },
    button: {
        marginTop: spacing.l,
        backgroundColor: colors.primary,
        borderRadius: 12,
        padding: spacing.m,
        alignItems: 'center',
    },
    buttonDisabled: {
        opacity: 0.6,
    },
    buttonText: {
        ...typography.button,
        color: colors.onPrimary,
    },
}));
