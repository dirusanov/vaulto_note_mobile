import React from 'react';
import { useTranslation } from 'react-i18next';
import {
    Modal,
    View,
    Text,
    TouchableOpacity,
    TouchableWithoutFeedback,
    StyleSheet,
} from 'react-native';
import { colors, isDarkScheme } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { createStyles } from '../theme/createStyles';

interface SignInRequiredModalProps {
    visible: boolean;
    title?: string;
    message: string;
    onClose: () => void;
    onSignIn: () => void;
    signInLabel?: string;
    cancelLabel?: string;
    /** Optional way forward without an account, shown under Sign in. */
    secondaryLabel?: string;
    onSecondary?: () => void;
}

export const SignInRequiredModal: React.FC<SignInRequiredModalProps> = ({
    visible,
    title,
    message,
    onClose,
    onSignIn,
    signInLabel,
    cancelLabel,
    secondaryLabel,
    onSecondary,
}) => {
    const { t } = useTranslation();
    const displayTitle = title || t("voice.signInRequired", "Sign in required");
    const displaySignInLabel = signInLabel || t("auth.signIn", "Sign In");
    const displayCancelLabel = cancelLabel || t("common.notNow", "Not now");
    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
        >
            <TouchableWithoutFeedback onPress={onClose}>
                <View style={styles.overlay}>
                    <TouchableWithoutFeedback>
                        <View style={styles.modal}>
                            <Text style={styles.title}>{displayTitle}</Text>
                            <Text style={styles.message}>{message}</Text>

                            <View style={styles.actionsRow}>
                                <TouchableOpacity onPress={onSignIn} activeOpacity={0.85} style={styles.primaryButton} accessibilityRole="button">
                                    <Text style={styles.primaryText}>{displaySignInLabel}</Text>
                                </TouchableOpacity>
                                {secondaryLabel && onSecondary ? (
                                    <TouchableOpacity onPress={onSecondary} activeOpacity={0.6} style={styles.secondaryButton} accessibilityRole="button">
                                        <Text style={styles.secondaryText}>{secondaryLabel}</Text>
                                    </TouchableOpacity>
                                ) : null}
                                <TouchableOpacity onPress={onClose} activeOpacity={0.6} style={styles.cancelButton} accessibilityRole="button">
                                    <Text style={styles.cancelText}>{displayCancelLabel}</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </TouchableWithoutFeedback>
                </View>
            </TouchableWithoutFeedback>
        </Modal>
    );
};

const styles = createStyles(() => ({
    overlay: {
        flex: 1,
        backgroundColor: colors.overlay,
        justifyContent: 'center',
        alignItems: 'center',
        padding: spacing.l,
    },
    modal: {
        backgroundColor: colors.surface,
        borderRadius: 20,
        paddingHorizontal: spacing.l,
        paddingTop: spacing.l,
        paddingBottom: spacing.s,
        width: '100%',
        maxWidth: 340,
        borderWidth: isDarkScheme() ? StyleSheet.hairlineWidth : 0,
        borderColor: colors.border,
    },
    title: {
        fontSize: 20,
        lineHeight: 26,
        fontWeight: '700',
        letterSpacing: -0.3,
        color: colors.text,
        marginBottom: spacing.s,
    },
    message: {
        fontSize: 15,
        lineHeight: 21,
        color: colors.textSecondary,
        marginBottom: spacing.l,
    },
    actionsRow: {
        width: '100%',
        gap: spacing.xs,
    },
    primaryButton: {
        minHeight: 48,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.primary,
    },
    primaryText: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.onPrimary,
    },
    secondaryButton: {
        minHeight: 48,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.m,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.borderHover,
    },
    secondaryText: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.text,
        textAlign: 'center',
    },
    cancelButton: {
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    cancelText: {
        fontSize: 15,
        fontWeight: '500',
        color: colors.textSecondary,
    },
}));
