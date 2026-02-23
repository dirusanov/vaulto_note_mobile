import React from 'react';
import {
    Modal,
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    TouchableWithoutFeedback,
    Image,
} from 'react-native';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

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
    primaryActionLabel = 'Switch to Vaulto AI',
}) => {
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

                            <Text style={styles.title}>Vaulto AI required</Text>
                            <Text style={styles.message}>Agent Mode is available only with Vaulto AI.</Text>

                            <View style={styles.actionsRow}>
                                <TouchableOpacity style={styles.secondaryButton} onPress={onClose} activeOpacity={0.85}>
                                    <Text style={styles.secondaryText}>Close</Text>
                                </TouchableOpacity>
                                {onPrimaryAction && (
                                    <TouchableOpacity
                                        style={styles.primaryButton}
                                        onPress={() => {
                                            onPrimaryAction();
                                            onClose();
                                        }}
                                        activeOpacity={0.85}
                                    >
                                        <Text style={styles.primaryText}>{primaryActionLabel}</Text>
                                    </TouchableOpacity>
                                )}
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
        borderRadius: 20,
        padding: spacing.xl,
        width: '100%',
        maxWidth: 380,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: colors.border,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.15,
        shadowRadius: 16,
        elevation: 10,
        gap: spacing.s,
    },
    iconRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
        paddingHorizontal: spacing.m,
        paddingVertical: spacing.xs,
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
        marginTop: spacing.s,
        color: colors.text,
        textAlign: 'center',
    },
    message: {
        ...typography.body,
        color: colors.textSecondary,
        textAlign: 'center',
        marginBottom: spacing.s,
    },
    actionsRow: {
        flexDirection: 'row',
        width: '100%',
        gap: spacing.s,
        marginTop: spacing.s,
    },
    primaryButton: {
        flex: 1,
        height: 48,
        borderRadius: 12,
        backgroundColor: colors.primary,
        alignItems: 'center',
        justifyContent: 'center',
    },
    primaryText: {
        ...typography.button,
        color: colors.surface,
    },
    secondaryButton: {
        flex: 1,
        height: 48,
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
});
