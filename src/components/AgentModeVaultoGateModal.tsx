import React from 'react';
import { useTranslation } from 'react-i18next';
import {
    Modal,
    View,
    Text,
    TouchableOpacity,
    TouchableWithoutFeedback,
    Image,
} from 'react-native';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { createStyles } from '../theme/createStyles';

interface AgentModeVaultoGateModalProps {
    visible: boolean;
    onClose: () => void;
    onPrimaryAction?: () => void;
    primaryActionLabel?: string;
}

export const AgentModeVaultoGateModal: React.FC<AgentModeVaultoGateModalProps> = ({
    visible,
    onClose,
    onPrimaryAction,
    primaryActionLabel,
}) => {
    const { t } = useTranslation();
    const resolvedPrimaryLabel = primaryActionLabel
        ?? t('aux.switchToVaultoAI', 'Switch to Vaulto AI');

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <TouchableWithoutFeedback onPress={onClose}>
                <View style={styles.overlay}>
                    <TouchableWithoutFeedback>
                        <View style={styles.modal}>
                            <View style={styles.iconRow}>
                                <Image source={require('../../assets/icon.png')} style={styles.icon} resizeMode="contain" />
                                <Text style={styles.pillText}>Vaulto AI</Text>
                            </View>

                            <Text style={styles.title}>{t('aux.vaultoAIReq', 'Vaulto AI required')}</Text>
                            <Text style={styles.message}>{t('aux.agentModeVaultoAIAvail', 'Agent Mode is available only with Vaulto AI.')}</Text>

                            <View style={styles.actionsRow}>
                                {onPrimaryAction && (
                                    <TouchableOpacity
                                        style={styles.primaryButton}
                                        onPress={() => {
                                            onPrimaryAction();
                                            onClose();
                                        }}
                                        activeOpacity={0.85}
                                    >
                                        <Text style={styles.primaryText}>{resolvedPrimaryLabel}</Text>
                                    </TouchableOpacity>
                                )}
                                <TouchableOpacity style={styles.secondaryButton} onPress={onClose} activeOpacity={0.85}>
                                    <Text style={styles.secondaryText}>{t('common.close', 'Close')}</Text>
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
        backgroundColor: 'rgba(0, 0, 0, 0.4)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 0, // Removed padding
    },
    modal: {
        backgroundColor: colors.surface,
        borderRadius: 20,
        padding: 12, // Ultra compact padding
        width: '90%',
        maxWidth: 320,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: colors.border,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.15,
        shadowRadius: 16,
        elevation: 10,
        gap: 6, // Reduced gap
    },
    iconRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        paddingHorizontal: spacing.s,
        paddingVertical: spacing.xxs, // Reduced from xs
        borderRadius: 14,
        backgroundColor: `${colors.primary}12`,
    },
    icon: {
        width: 28,
        height: 28,
        borderRadius: 6,
    },
    pillText: {
        ...typography.button,
        color: colors.primary,
    },
    title: {
        ...typography.h3,
        marginTop: 0, // Reduced from xs
        color: colors.text,
        textAlign: 'center',
    },
    message: {
        ...typography.body,
        color: colors.textSecondary,
        textAlign: 'center',
        marginBottom: spacing.xs, // Reduced from s
    },
    actionsRow: {
        flexDirection: 'column',
        width: '100%',
        gap: 4,
        marginTop: 6,
    },
    primaryButton: {
        width: '100%',
        height: 44,
        borderRadius: 12,
        backgroundColor: colors.primary,
        alignItems: 'center',
        justifyContent: 'center',
    },
    primaryText: {
        ...typography.button,
        color: colors.onPrimary,
        fontSize: 14,
    },
    secondaryButton: {
        width: '100%',
        height: 44,
        borderRadius: 12,
        backgroundColor: colors.backgroundSecondary,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: 'center',
        justifyContent: 'center',
    },
    secondaryText: {
        ...typography.button,
        color: colors.textSecondary,
    },
}));
