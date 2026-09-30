import { useTranslation } from 'react-i18next';
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

interface SuccessModalProps {
    visible: boolean;
    title?: string;
    message: string;
    iconName?: keyof typeof MaterialIcons.glyphMap;
    iconColor?: string;
    onClose: () => void;
}

export const SuccessModal: React.FC<SuccessModalProps> = ({
    visible,
    title,
    message,
    iconName = 'check-circle-outline',
    iconColor = colors.success,
    onClose,
}) => {
    const { t } = useTranslation();

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
                            <View style={[styles.iconContainer, { backgroundColor: `${iconColor}15` }]}>
                                <MaterialIcons
                                    name={iconName}
                                    size={32}
                                    color={iconColor}
                                />
                            </View>

                            <Text style={styles.title}>{title ?? t('common.successTitle', 'Success')}</Text>

                            <Text style={styles.message}>
                                {message}
                            </Text>

                            <TouchableOpacity
                                style={styles.button}
                                onPress={onClose}
                                activeOpacity={0.8}
                            >
                                <Text style={styles.buttonText}>{t("aux.okay", "Okay")}</Text>
                            </TouchableOpacity>
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
        backgroundColor: `${colors.success}15`,
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
    button: {
        backgroundColor: colors.primary,
        paddingVertical: spacing.m,
        paddingHorizontal: spacing.xl,
        borderRadius: 12,
        width: '100%',
        alignItems: 'center',
    },
    buttonText: {
        ...typography.button,
        color: colors.surface,
        fontSize: 16,
    },
});
