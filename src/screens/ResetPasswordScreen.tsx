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
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
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

type RouteParams = {
    ResetPassword: {
        token?: string;
    };
};

export const ResetPasswordScreen = () => {
    const { t } = useTranslation();
    const navigation = useNavigation<NativeStackNavigationProp<any>>();
    const route = useRoute<RouteProp<RouteParams, 'ResetPassword'>>();

    const [token, setToken] = useState(route.params?.token || '');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async () => {
        if (!token) {
            appAlert(t("common.errorTitle"), t("auth.resetTokenPlaceholder"));
            return;
        }

        if (!newPassword || !confirmPassword) {
            appAlert(t("common.errorTitle"), t("common.fillFields"));
            return;
        }

        if (newPassword.length < 8) {
            appAlert(t("common.errorTitle"), t("common.passwordLengthError"));
            return;
        }

        if (newPassword !== confirmPassword) {
            appAlert(t("common.errorTitle"), t("common.passwordsMatchError"));
            return;
        }

        setLoading(true);
        try {
            await authApi.confirmPasswordReset(token, newPassword);
            appAlert(
                t("common.successTitle"),
                t("auth.passwordResetSuccess"),
                [{ text: t("common.ok"), onPress: () => navigation.navigate('SignIn') }]
            );
        } catch (err) {
            const message = getErrorMessage(err, t("auth.resetPasswordFailed"));
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
                        <Text style={styles.title}>{t("aux.resetPassword", "Reset Password")}</Text>
                        <Text style={styles.subtitle}>{t("aux.enterNewPassword", "Enter your new password")}</Text>
                    </View>

                    <View style={styles.form}>
                        <View style={styles.warningBox}>
                            <MaterialIcons name="info" size={20} color="#2196F3" />
                            <Text style={styles.warningText}>
                                {t("auth.locallyStoredUnaffected", "Your locally stored notes remain unaffected and fully accessible.")}
                            </Text>
                        </View>

                        {!route.params?.token && (
                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>{t("aux.resetToken", "Reset Token")}</Text>
                                <TextInput
                                    style={styles.input}
                                    placeholder={t("auth.resetTokenPlaceholder")}
                                    placeholderTextColor={colors.textSecondary}
                                    autoCapitalize="none"
                                    value={token}
                                    onChangeText={setToken}
                                />
                            </View>
                        )}

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>{t("aux.newPassword", "New Password")}</Text>
                            <TextInput
                                style={styles.input}
                                placeholder={t("auth.passwordAtLeast8")}
                                placeholderTextColor={colors.textSecondary}
                                secureTextEntry
                                value={newPassword}
                                onChangeText={setNewPassword}
                            />
                        </View>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>{t("aux.confirmPassword", "Confirm Password")}</Text>
                            <TextInput
                                style={styles.input}
                                placeholder={t("auth.confirmPasswordPlaceholder")}
                                placeholderTextColor={colors.textSecondary}
                                secureTextEntry
                                value={confirmPassword}
                                onChangeText={setConfirmPassword}
                            />
                        </View>

                        <TouchableOpacity
                            style={[styles.button, loading && styles.buttonDisabled]}
                            onPress={handleSubmit}
                            disabled={loading}
                        >
                            <Text style={styles.buttonText}>
                                {loading ? t("auth.resetting") : t("aux.resetPassword")}
                            </Text>
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
        backgroundColor: colors.warningLight,
        borderRadius: 14,
        padding: spacing.m,
        marginBottom: spacing.l,
        gap: spacing.s,
    },
    warningText: {
        ...typography.caption,
        color: colors.text,
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
}));
