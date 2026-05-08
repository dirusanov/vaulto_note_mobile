import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import {
    Alert,
    StyleSheet,
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
            Alert.alert(t("common.errorTitle"), t("auth.resetTokenPlaceholder"));
            return;
        }

        if (!newPassword || !confirmPassword) {
            Alert.alert(t("common.errorTitle"), t("common.fillFields"));
            return;
        }

        if (newPassword.length < 8) {
            Alert.alert(t("common.errorTitle"), t("common.passwordLengthError"));
            return;
        }

        if (newPassword !== confirmPassword) {
            Alert.alert(t("common.errorTitle"), t("common.passwordsMatchError"));
            return;
        }

        setLoading(true);
        try {
            await authApi.confirmPasswordReset(token, newPassword);
            Alert.alert(
                t("common.successTitle"),
                t("auth.passwordResetSuccess"),
                [{ text: t("common.ok"), onPress: () => navigation.navigate('SignIn') }]
            );
        } catch (err) {
            const message = getErrorMessage(err, t("auth.resetPasswordFailed"));
            Alert.alert(t("common.errorTitle"), message);
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
                        <MaterialIcons name="arrow-back" size={22} color={colors.text} />
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

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    scrollContent: {
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
    warningBox: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: '#2196F3',
        borderRadius: 12,
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
    button: {
        backgroundColor: colors.primary,
        borderRadius: 12,
        padding: spacing.m,
        alignItems: 'center',
        marginTop: spacing.m,
    },
    buttonDisabled: {
        opacity: 0.7,
    },
    buttonText: {
        ...typography.button,
        color: '#FFFFFF',
        fontWeight: '600',
    },
});
