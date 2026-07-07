import React from 'react';
import { View, Text, StyleSheet, Modal } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { useTranslation } from 'react-i18next';
import { Button } from './Button';

interface DisableSyncModalProps {
    visible: boolean;
    onClose: () => void;
    onConfirm: () => void;
}

export const DisableSyncModal: React.FC<DisableSyncModalProps> = ({
    visible,
    onClose,
    onConfirm,
}) => {
    const { t } = useTranslation();

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
        >
            <View style={styles.overlay}>
                <View style={styles.card}>
                    <View style={styles.iconContainer}>
                        <MaterialIcons name="cloud-off" size={32} color={colors.warning} />
                    </View>
                    <Text style={styles.title}>
                        {t("settings.ui.disableSyncTitle", "Disable Synchronization")}
                    </Text>
                    <Text style={styles.subtitle}>
                        {t("settings.ui.disableSyncConfirm", "When disabling synchronization, new notes will not be saved to the server. Are you sure you want to disable synchronization?")}
                    </Text>

                    <View style={styles.actions}>
                        <Button
                            title={t("settings.ui.cancelBtn", "Cancel")}
                            variant="outline"
                            onPress={onClose}
                            style={styles.actionButton}
                        />
                        <Button
                            title={t("settings.ui.yesDisable", "Yes, disable")}
                            variant="destructive"
                            onPress={() => {
                                onConfirm();
                                onClose();
                            }}
                            style={styles.actionButton}
                        />
                    </View>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: colors.overlay,
        justifyContent: 'center',
        alignItems: 'center',
        padding: spacing.l,
    },
    card: {
        backgroundColor: colors.surface,
        borderRadius: 24,
        padding: spacing.xl,
        width: '100%',
        maxWidth: 400,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.15,
        shadowRadius: 24,
        elevation: 10,
    },
    iconContainer: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: colors.warning + '15',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: spacing.m,
    },
    title: {
        ...typography.h3,
        color: colors.text,
        textAlign: 'center',
        marginBottom: spacing.s,
    },
    subtitle: {
        ...typography.body,
        color: colors.textSecondary,
        textAlign: 'center',
        marginBottom: spacing.l,
        lineHeight: 22,
    },
    actions: {
        flexDirection: 'column',
        gap: spacing.s,
        width: '100%',
        marginTop: spacing.s,
    },
    actionButton: {
        width: '100%',
    },
});
