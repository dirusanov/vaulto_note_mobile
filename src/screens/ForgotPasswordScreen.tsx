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
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { spacing } from '../theme/spacing';
import { MaterialIcons } from '@expo/vector-icons';
import { authApi } from '../api/auth';
import { getErrorMessage } from '../utils/errorMessage';

export const ForgotPasswordScreen = () => {
    const { t } = useTranslation();
    const navigation = useNavigation<NativeStackNavigationProp<any>>();
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    const handleSubmit = async () => {
        if (!email) {
            Alert.alert(t("common.errorTitle"), t("common.emailAddressRequired"));
            return;
        }

        setLoading(true);
        try {
            await authApi.requestPasswordReset(email);
            setSubmitted(true);
        } catch (err) {
            const message = getErrorMessage(err, t("auth.sendResetEmailFailed"));
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
                                <MaterialIcons name="warning" size={20} color="#FF9800" />
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
        backgroundColor: `${colors.surface}`,
        borderWidth: 1,
        borderColor: '#FF9800',
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
    successContainer: {
        paddingHorizontal: spacing.l,
    },
    successText: {
        ...typography.body,
        color: colors.text,
        textAlign: 'center',
        marginBottom: spacing.xl,
    },
});
