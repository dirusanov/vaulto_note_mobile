import React from 'react';
import {
    Modal,
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    TouchableWithoutFeedback,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

interface SignInRequiredModalProps {
    visible: boolean;
    title?: string;
    message: string;
    onClose: () => void;
    onSignIn: () => void;
    signInLabel?: string;
    cancelLabel?: string;
}

export const SignInRequiredModal: React.FC<SignInRequiredModalProps> = ({
    visible,
    title = 'Sign in required',
    message,
    onClose,
    onSignIn,
    signInLabel = 'Sign In',
    cancelLabel = 'Not now',
}) => {
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
                            <View style={styles.iconContainer}>
                                <MaterialIcons
                                    name="lock-outline"
                                    size={28}
                                    color={colors.primary}
                                />
                            </View>

                            <Text style={styles.title}>{title}</Text>
                            <Text style={styles.message}>{message}</Text>

                            <View style={styles.actionsRow}>
                                <TouchableOpacity onPress={onClose} activeOpacity={0.8} style={styles.cancelButton}>
                                    <Text style={styles.cancelText}>{cancelLabel}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity onPress={onSignIn} activeOpacity={0.85} style={styles.primaryButton}>
                                    <Text style={styles.primaryText}>{signInLabel}</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </TouchableWithoutFeedback>
                </View>
            </TouchableWithoutFeedback>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.38)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: spacing.l,
    },
    modal: {
        backgroundColor: colors.surface,
        borderRadius: 24,
        padding: spacing.xl,
        width: '100%',
        maxWidth: 360,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.12,
        shadowRadius: 22,
        elevation: 10,
        borderWidth: 1,
        borderColor: colors.border,
    },
    iconContainer: {
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: `${colors.primary}12`,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: spacing.m,
    },
    title: {
        ...typography.h3,
        textAlign: 'center',
        marginBottom: spacing.xs,
        color: colors.text,
    },
    message: {
        ...typography.body,
        textAlign: 'center',
        color: colors.textSecondary,
        marginBottom: spacing.l,
        lineHeight: 22,
    },
    actionsRow: {
        flexDirection: 'row',
        width: '100%',
        gap: spacing.s,
    },
    cancelButton: {
        flex: 1,
        height: 46,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.backgroundSecondary,
        borderWidth: 1,
        borderColor: colors.border,
    },
    cancelText: {
        ...typography.button,
        color: colors.textSecondary,
    },
    primaryButton: {
        flex: 1,
        height: 46,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.primary,
    },
    primaryText: {
        ...typography.button,
        color: colors.surface,
    },
});

