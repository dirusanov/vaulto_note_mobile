import React, { useRef } from 'react';
import {
    Modal,
    Text,
    View,
    TouchableOpacity,
    ScrollView,
    Share,
    Platform,
    Linking,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { Button } from './Button';
import QRCode from 'react-native-qrcode-svg';
import ViewShot from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { createStyles } from '../theme/createStyles';
import { appAlert } from './AppAlert';

interface RecoveryCodeModalProps {
    visible: boolean;
    onClose: () => void;
    recoveryCode: string | null;
    /** Shown right after encryption was set up: the user confirms the key is saved. */
    firstTime?: boolean;
    /**
     * The platform store's answer: the key is saved on this device, and cloud =
     * Google / iCloud backup was requested. The app cannot confirm that backup
     * is on or has synced, so the personal copy is always asked for.
     */
    backup?: { cloud: boolean } | null;
}

export const RecoveryCodeModal: React.FC<RecoveryCodeModalProps> = ({
    visible,
    onClose,
    recoveryCode,
    firstTime = false,
    backup = null,
}) => {
    const { t } = useTranslation();
    const viewShotRef = useRef<any>(null);

    const handleCopy = async () => {
        if (!recoveryCode) return;
        await Clipboard.setStringAsync(recoveryCode);
        appAlert(
            t('common.copied', 'Copied'),
            t('settings.recovery.copiedMsg', 'Recovery code copied to clipboard. Save it in a safe place!')
        );
    };

    const handleShare = async () => {
        if (!recoveryCode) return;
        try {
            await Share.share({ message: recoveryCode });
        } catch {
            // dismissed
        }
    };

    const handleSaveQR = async () => {
        try {
            if (!viewShotRef.current) return;
            const uri = await viewShotRef.current.capture();
            if (await Sharing.isAvailableAsync()) {
                await Sharing.shareAsync(uri);
            } else {
                appAlert(t('common.error', 'Error'), t('settings.recovery.sharingNotAvailable', 'Sharing is not available on this device.'));
            }
        } catch (err: any) {
            appAlert(t('common.error', 'Error'), err.message || t('settings.recovery.failedToSaveQr', 'Failed to save QR code.'));
        }
    };

    if (!recoveryCode) return null;

    const words = recoveryCode.split(' ');

    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            // Right after setup the key must be acknowledged with the button, not Back.
            onRequestClose={firstTime ? () => undefined : onClose}
        >
            <View style={styles.backdrop}>
                <View style={styles.card}>
                    <View style={styles.header}>
                        <View style={styles.iconContainer}>
                            <MaterialCommunityIcons name={firstTime ? 'shield-check' : 'shield-key'} size={24} color={colors.primary} />
                        </View>
                        <Text style={styles.title}>
                            {firstTime
                                ? t('settings.recovery.readyTitle', 'Your notes are encrypted')
                                : t('settings.recovery.keyTitle', 'Recovery key')}
                        </Text>
                    </View>

                    {/* Only what the app knows: saved here, and a system backup was requested.
                        Whether iCloud Keychain / Google backup is on and synced is not visible
                        to apps, so a new phone opening the notes by itself is never promised. */}
                    {backup ? (
                        <View style={styles.backupStatus}>
                            <MaterialCommunityIcons name="cellphone-key" size={20} color={colors.textSecondary} />
                            <Text style={styles.backupStatusText}>
                                {backup.cloud
                                    ? (Platform.OS === 'ios'
                                        ? t('settings.recovery.requestedIcloud', 'Saved on this device. A copy was requested in iCloud Keychain; Vaulto cannot check that it is turned on and synced.')
                                        : t('settings.recovery.requestedGoogle', 'Saved on this device. A copy was requested in your Google backup; Vaulto cannot check that backup is on and complete.'))
                                    : t('settings.recovery.onDeviceOnly', 'Saved on this device only.')}
                            </Text>
                        </View>
                    ) : null}
                    <Text style={styles.warning}>
                        {backup?.cloud
                            ? t('settings.recovery.explainRequested', 'To be sure you can open your notes on a new phone, save this key yourself too, for example in a password manager. Nobody, including Vaulto, can restore it.')
                            : t('settings.recovery.explain', 'Only this key opens your notes on a new device. Keep it somewhere safe, like a password manager. Nobody, including Vaulto, can restore it.')}
                    </Text>
                    {!backup?.cloud && Platform.OS === 'android' ? (
                        <TouchableOpacity
                            style={styles.backupTip}
                            accessibilityRole="button"
                            onPress={() => {
                                void Linking.sendIntent('android.settings.SECURITY_SETTINGS').catch(() => Linking.openSettings());
                            }}
                        >
                            <MaterialCommunityIcons name="shield-lock-outline" size={18} color={colors.primary} />
                            <Text style={styles.backupTipText}>
                                {t('settings.recovery.backupTip', 'Turn on a screen lock and Google backup so a copy of this key can also be kept there')}
                            </Text>
                        </TouchableOpacity>
                    ) : null}

                    <ScrollView style={styles.codeContainer} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                        <View style={styles.wordsGrid}>
                            {words.map((word, index) => (
                                <View key={index} style={styles.wordBox}>
                                    <Text style={styles.wordIndex}>{index + 1}</Text>
                                    <Text style={styles.wordText}>{word}</Text>
                                </View>
                            ))}
                        </View>

                        <View style={styles.qrSection}>
                            <Text style={styles.qrTitle}>{t('settings.recovery.qrTitle', 'Recovery QR Code')}</Text>
                            <View style={styles.qrWrapper}>
                                <ViewShot
                                    ref={viewShotRef}
                                    options={{ format: 'jpg', quality: 1.0 }} /* the key import reads JPEG */
                                    style={styles.qrBg}
                                >
                                    <QRCode
                                        value={recoveryCode}
                                        size={180}
                                        backgroundColor={colors.surface}
                                        color={colors.text}
                                    />
                                </ViewShot>
                            </View>
                            <TouchableOpacity style={styles.qrSaveButton} onPress={handleSaveQR}>
                                <MaterialCommunityIcons name="image-plus" size={18} color={colors.primary} />
                                <Text style={styles.qrSaveButtonText}>{t('settings.recovery.saveQr', 'Save/Share QR Code')}</Text>
                            </TouchableOpacity>
                        </View>
                    </ScrollView>

                    <View style={styles.actions}>
                        <View style={styles.secondaryRow}>
                            <TouchableOpacity style={styles.copyButton} onPress={handleCopy} accessibilityRole="button">
                                <MaterialCommunityIcons name="content-copy" size={20} color={colors.primary} />
                                <Text style={styles.copyButtonText}>{t('common.copy', 'Copy')}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.copyButton} onPress={handleShare} accessibilityRole="button">
                                <MaterialCommunityIcons name="share-variant" size={20} color={colors.primary} />
                                <Text style={styles.copyButtonText}>{t('settings.recovery.share', 'Share')}</Text>
                            </TouchableOpacity>
                        </View>

                        <Button
                            // After setup the button confirms the user's own copy, never the system backup.
                            title={firstTime ? t('settings.recovery.savedIt', 'I saved the key') : t('common.close', 'Close')}
                            onPress={onClose}
                            style={styles.doneButton}
                        />
                    </View>
                </View>
            </View>
        </Modal>
    );
};

const styles = createStyles(() => ({
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: spacing.m,
    },
    card: {
        width: '100%',
        maxWidth: 400,
        backgroundColor: colors.surface,
        borderRadius: 24,
        padding: spacing.l,
        maxHeight: '90%',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.2,
        shadowRadius: 20,
        elevation: 10,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.m,
        marginBottom: spacing.m,
    },
    iconContainer: {
        width: 48,
        height: 48,
        borderRadius: 14,
        backgroundColor: colors.primary + '15',
        alignItems: 'center',
        justifyContent: 'center',
    },
    title: {
        ...typography.h3,
        flex: 1,
    },
    warning: {
        ...typography.bodySmall,
        color: colors.textSecondary,
        marginBottom: spacing.m,
        lineHeight: 20,
    },
    codeContainer: {
        backgroundColor: colors.backgroundSecondary,
        borderRadius: 16,
        padding: spacing.m,
        marginBottom: spacing.m,
        maxHeight: 380,
    },
    scrollContent: {
        alignItems: 'center',
    },
    wordsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.s,
        justifyContent: 'center',
        marginBottom: spacing.l,
    },
    wordBox: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderRadius: 8,
        paddingHorizontal: spacing.s,
        paddingVertical: spacing.xs,
        borderWidth: 1,
        borderColor: colors.border,
        minWidth: '45%',
    },
    wordIndex: {
        ...typography.caption,
        color: colors.textMuted,
        width: 20,
    },
    wordText: {
        ...typography.bodyBold,
        color: colors.text,
    },
    qrSection: {
        alignItems: 'center',
        marginTop: spacing.s,
        marginBottom: spacing.s,
    },
    qrTitle: {
        ...typography.bodyBold,
        color: colors.text,
        marginBottom: spacing.s,
    },
    qrWrapper: {
        padding: spacing.m,
        backgroundColor: colors.surface,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        marginBottom: spacing.s,
    },
    qrBg: {
        backgroundColor: colors.surface,
        padding: spacing.s,
    },
    qrSaveButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        paddingVertical: spacing.s,
        paddingHorizontal: spacing.m,
    },
    qrSaveButtonText: {
        ...typography.bodyBold,
        color: colors.primary,
    },
    actions: {
        gap: spacing.s,
        marginTop: spacing.xs,
    },
    backupStatus: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
        padding: spacing.m,
        borderRadius: 12,
        backgroundColor: colors.backgroundSecondary,
        marginBottom: spacing.m,
    },
    backupStatusText: {
        ...typography.bodySmall,
        flex: 1,
        color: colors.text,
        lineHeight: 20,
    },
    backupTip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
        minHeight: 44,
        marginBottom: spacing.m,
    },
    backupTipText: {
        ...typography.bodySmall,
        flex: 1,
        color: colors.primary,
        lineHeight: 20,
    },
    secondaryRow: {
        flexDirection: 'row',
        justifyContent: 'space-around',
    },
    copyButton: {
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.s,
        paddingVertical: spacing.s,
    },
    copyButtonText: {
        ...typography.bodyBold,
        color: colors.primary,
    },
    doneButton: {
        width: '100%',
    },
}));
