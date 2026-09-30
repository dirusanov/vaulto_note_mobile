import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import {
    Modal,
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
} from 'react-native';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { setPrivacyWarningDismissed } from '../utils/storage';

interface PrivacyWarningModalProps {
    visible: boolean;
    onAccept: () => void;
    onCancel: () => void;
}

export const PrivacyWarningModal: React.FC<PrivacyWarningModalProps> = ({
    visible,
    onAccept,
    onCancel,
}) => {
    const { t } = useTranslation();

    const [dontShowAgain, setDontShowAgain] = useState(false);

    const handleAccept = async () => {
        if (dontShowAgain) {
            await setPrivacyWarningDismissed(true);
        }
        onAccept();
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onCancel}
        >
            <View style={styles.overlay}>
                <View style={styles.modal}>
                    <Text style={styles.title}>🔒 {t('aux.privacyTitle', 'Privacy')}</Text>

                    <Text style={styles.message}>
                        {t('aux.privacyWarning', 'Audio recording will be sent to OpenAI server for transcription to text.')}
                    </Text>

                    <Text style={styles.message}>
                        {t('aux.privacyWarning2', "Please don't record confidential information if you don't trust OpenAI.")}
                    </Text>

                    <TouchableOpacity
                        style={styles.checkbox}
                        onPress={() => setDontShowAgain(!dontShowAgain)}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: dontShowAgain }}
                    >
                        <View style={[
                            styles.checkboxBox,
                            dontShowAgain && styles.checkboxBoxActive
                        ]}>
                            {dontShowAgain && <Text style={styles.checkmark}>✓</Text>}
                        </View>
                        <Text style={styles.checkboxLabel}>
                            {t('aux.dontShowAgain', "Don't show again")}
                        </Text>
                    </TouchableOpacity>

                    <View style={styles.buttons}>
                        <TouchableOpacity
                            style={[styles.button, styles.cancelButton]}
                            onPress={onCancel}
                        >
                            <Text style={styles.cancelButtonText}>{t("settings.ui.cancelBtn", "Cancel")}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.button, styles.acceptButton]}
                            onPress={handleAccept}
                        >
                            <Text style={styles.acceptButtonText}>{t("aux.gotIt", "Got it")}</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: spacing.l,
    },
    modal: {
        backgroundColor: colors.surface,
        borderRadius: 16,
        padding: spacing.l,
        width: '100%',
        maxWidth: 400,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 8,
    },
    title: {
        ...typography.h2,
        fontSize: 24,
        marginBottom: spacing.m,
        textAlign: 'center',
    },
    message: {
        ...typography.body,
        color: colors.textMuted,
        marginBottom: spacing.m,
        lineHeight: 22,
    },
    checkbox: {
        flexDirection: 'row',
        alignItems: 'center',
        marginVertical: spacing.m,
    },
    checkboxBox: {
        width: 24,
        height: 24,
        borderWidth: 2,
        borderColor: colors.border,
        borderRadius: 4,
        marginRight: spacing.s,
        justifyContent: 'center',
        alignItems: 'center',
    },
    checkboxBoxActive: {
        backgroundColor: colors.primary,
        borderColor: colors.primary,
    },
    checkmark: {
        color: colors.background,
        fontSize: 16,
        fontWeight: 'bold',
    },
    checkboxLabel: {
        ...typography.body,
        color: colors.text,
    },
    buttons: {
        flexDirection: 'row',
        gap: spacing.m,
        marginTop: spacing.l,
    },
    button: {
        flex: 1,
        paddingVertical: spacing.m,
        borderRadius: 8,
        alignItems: 'center',
    },
    cancelButton: {
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: colors.border,
    },
    cancelButtonText: {
        ...typography.button,
        color: colors.textMuted,
    },
    acceptButton: {
        backgroundColor: colors.primary,
    },
    acceptButtonText: {
        ...typography.button,
        color: colors.background,
    },
});
