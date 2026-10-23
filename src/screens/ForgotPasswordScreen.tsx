import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import {
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
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { spacing } from '../theme/spacing';
import { MaterialIcons } from '@expo/vector-icons';
import { authApi } from '../api/auth';
import { getErrorMessage } from '../utils/errorMessage';
import { createStyles } from '../theme/createStyles';
import { rtlFlip } from '../i18n/direction';
import { appAlert } from '../components/AppAlert';

export const ForgotPasswordScreen = () => {
    const { t } = useTranslation();
    const navigation = useNavigation<NativeStackNavigationProp<any>>();
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    const handleSubmit = async () => {
        if (!email) {
            appAlert(t("common.errorTitle"), t("common.emailAddressRequired"));
            return;
        }

        setLoading(true);
        try {
            await authApi.requestPasswordReset(email);
            setSubmitted(true);
        } catch (err) {
            const message = getErrorMessage(err, t("auth.sendResetEmailFailed"));
            appAlert(t("common.errorTitle"), message);
        } finally {
            setLoading(false);
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
                        <MaterialIcons name="arrow-back" size={24} color={colors.text} style={rtlFlip} />
                    </TouchableOpacity>

                    <View style={styles.header}>
                        <Text style={styles.title}>{t("aux.forgotPassword", "Forgot Password?")}</Text>
                        <Text style={styles.subtitle}>
                            {submitted
                                ? t("auth.checkEmail")
                                : t("auth.enterEmailToReset")}
                        </Text>
                    </View>

                    {submitted ? (
                        <View style={styles.successContainer}>
                            <Text style={styles.successText}>
                                {t("auth.resetEmailSuccess", { email })}
                            </Text>
                            <TouchableOpacity
                                style={styles.button}
                                onPress={() => navigation.navigate('SignIn')}
                            >
                                <Text style={styles.buttonText}>{t("aux.backToSignIn", "Back to Sign In")}</Text>
                            </TouchableOpacity>
                        </View>
                    ) : (
                        <View style={styles.form}>
                            <View style={styles.warningBox}>
                                <MaterialIcons name="info-outline" size={20} color={colors.textSecondary} />
                                <Text style={styles.warningText}>
                                    {t("aux.noteResetWontAffect", "Note: Resetting your password will not affect your locally stored notes.")}
                                </Text>
                            </View>

                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>{t("aux.emailLabel", "Email")}</Text>
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

                            <TouchableOpacity
                                style={[styles.button, loading && styles.buttonDisabled]}
                                onPress={handleSubmit}
                                disabled={loading}
                            >
                                <Text style={styles.buttonText}>
                                    {loading ? t("auth.sending") : t("auth.sendResetLink")}
                                </Text>
                            </TouchableOpacity>
                        </View>
                    )}
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
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: spacing.s,
        marginStart: spacing.s,
        alignSelf: 'flex-start',
    },
    header: {
        marginTop: spacing.xl,
        paddingHorizontal: spacing.m,
        marginBottom: spacing.xl,
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
    },
    form: {
        paddingHorizontal: spacing.m,
    },
    warningBox: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.backgroundSecondary,
        borderRadius: 14,
        padding: spacing.m,
        marginBottom: spacing.l,
        gap: spacing.s,
    },
    warningText: {
        fontSize: 14,
        lineHeight: 20,
        color: colors.textSecondary,
        flex: 1,
    },
    inputGroup: {
        marginBottom: spacing.l,
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
    button: {
        backgroundColor: colors.primary,
        borderRadius: 26,
        minHeight: 52,
        paddingHorizontal: spacing.l,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: spacing.m,
    },
    buttonDisabled: {
        opacity: 0.7,
    },
    buttonText: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.onPrimary,
    },
    successContainer: {
        paddingHorizontal: spacing.l,
    },
    successText: {
        ...typography.body,
        color: colors.text,
        textAlign: 'center',
        marginBottom: spacing.xl,
    },
}));
