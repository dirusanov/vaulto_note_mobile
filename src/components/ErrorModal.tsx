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

interface ErrorModalProps {
    visible: boolean;
    title?: string;
    message: string;
    onClose: () => void;
    secondaryActionLabel?: string;
    onSecondaryAction?: () => void;
}

export const ErrorModal: React.FC<ErrorModalProps> = ({
    visible,
    title = 'Error',
    message,
    onClose,
    secondaryActionLabel,
    onSecondaryAction,
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
                                    name="error-outline"
                                    size={32}
                                    color={colors.error}
                                />
                            </View>

                            <Text style={styles.title}>{title}</Text>

                            <Text style={styles.message}>
                                {message}
                            </Text>

                            <View style={styles.actionsRow}>
                                {!!secondaryActionLabel && onSecondaryAction && (
                                    <TouchableOpacity
                                        style={styles.secondaryButton}
                                        onPress={onSecondaryAction}
                                        activeOpacity={0.8}
                                    >
                                        <Text style={styles.secondaryButtonText}>{secondaryActionLabel}</Text>
                                    </TouchableOpacity>
                                )}
                                <TouchableOpacity
                                    style={styles.button}
                                    onPress={onClose}
                                    activeOpacity={0.8}
                                >
                                    <Text style={styles.buttonText}>Okay</Text>
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
        backgroundColor: 'rgba(0, 0, 0, 0.4)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: spacing.l,
    },
    modal: {
        backgroundColor: colors.surface,
        borderRadius: 24,
        padding: spacing.xl,
        width: '100%',
        maxWidth: 340,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.1,
        shadowRadius: 20,
        elevation: 10,
    },
    iconContainer: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: `${colors.error}15`, // Keep opacity as hex if possible, or use rgba
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: spacing.m,
    },
    title: {
        ...typography.h3,
        textAlign: 'center',
        marginBottom: spacing.s,
        color: colors.text,
    },
    message: {
        ...typography.body,
        textAlign: 'center',
        color: colors.textSecondary,
        marginBottom: spacing.xl,
        lineHeight: 22,
    },
    actionsRow: {
        width: '100%',
        flexDirection: 'row',
        gap: spacing.s,
    },
    button: {
        backgroundColor: colors.primary,
        paddingVertical: spacing.m,
        borderRadius: 12,
        flex: 1,
        alignItems: 'center',
    },
    buttonText: {
        ...typography.button,
        color: colors.surface,
        fontSize: 16,
    },
    secondaryButton: {
        backgroundColor: colors.backgroundSecondary,
        borderWidth: 1,
        borderColor: colors.border,
        paddingVertical: spacing.m,
        borderRadius: 12,
        flex: 1,
        alignItems: 'center',
    },
    secondaryButtonText: {
        ...typography.button,
        color: colors.textSecondary,
        fontSize: 16,
    },
});
