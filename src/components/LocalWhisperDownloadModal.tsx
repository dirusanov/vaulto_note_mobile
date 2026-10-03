import React, { useState, useEffect } from 'react';
import { View, Text, Modal, TouchableOpacity, Alert } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import {
    downloadLocalWhisperModel,
    cancelLocalWhisperDownload,
    getAvailableLocalWhisperModels,
    getLocalWhisperModelStatus,
    LocalWhisperModelKey,
    setSelectedLocalWhisperModel,
} from '../services/LocalWhisperService';
import { planOfflineModels } from '../services/offlineMode';
import { formatModelSize } from './OnDeviceModelSection';
import { createStyles } from '../theme/createStyles';

interface Props {
    visible: boolean;
    onClose: () => void;
    onDownloadComplete: () => void;
}

/**
 * Speech on the phone, one button: the best speech model this phone can run
 * (the same pick as Settings → Offline mode). The on-device AI half of offline
 * mode is added from Settings; speech is what is needed right now.
 */
export const LocalWhisperDownloadModal: React.FC<Props> = ({ visible, onClose, onDownloadComplete }) => {
    const { t } = useTranslation();
    const [modelKey, setModelKey] = useState<LocalWhisperModelKey | null>(null);
    const [sizeBytes, setSizeBytes] = useState(0);
    const [alreadyOnPhone, setAlreadyOnPhone] = useState(false);
    const [noSpace, setNoSpace] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [bytesLoaded, setBytesLoaded] = useState(0);
    const [bytesTotal, setBytesTotal] = useState(0);

    useEffect(() => {
        if (!visible) return;
        let cancelled = false;
        void (async () => {
            const plan = await planOfflineModels().catch(() => null);
            if (cancelled) return;
            if (!plan) {
                setNoSpace(true);
                setModelKey(null);
                return;
            }
            setNoSpace(false);
            setModelKey(plan.whisperKey);
            setSizeBytes(getAvailableLocalWhisperModels().find((m) => m.key === plan.whisperKey)?.sizeBytes ?? 0);
            setAlreadyOnPhone(!!(await getLocalWhisperModelStatus(plan.whisperKey).catch(() => null))?.isDownloaded);
        })();
        return () => { cancelled = true; };
    }, [visible]);

    const handleDownload = async () => {
        if (!modelKey) return;
        if (alreadyOnPhone) {
            await setSelectedLocalWhisperModel(modelKey);
            onDownloadComplete();
            return;
        }
        setIsDownloading(true);
        setProgress(0);
        setBytesLoaded(0);
        setBytesTotal(0);
        try {
            await downloadLocalWhisperModel(modelKey, (p, loaded, total) => {
                setProgress(p);
                setBytesLoaded(loaded);
                setBytesTotal(total);
            });
            setIsDownloading(false);
            onDownloadComplete();
        } catch (e: any) {
            setIsDownloading(false);
            if (e?.message !== 'Download cancelled') {
                Alert.alert(t('edit.dictation.downloadFailed', 'Download failed'), e?.message || '');
            }
        }
    };

    const handleCancel = async () => {
        if (isDownloading) {
            await cancelLocalWhisperDownload();
            setIsDownloading(false);
        } else {
            onClose();
        }
    };

    if (!visible) return null;

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
            <View style={styles.overlay}>
                <View style={styles.container}>
                    <View style={styles.header}>
                        <MaterialIcons name="cloud-off" size={32} color={colors.primary} />
                        <Text style={styles.title}>{t('edit.dictation.offlineTitle', 'Speech without internet')}</Text>
                    </View>

                    {!isDownloading ? (
                        <>
                            <Text style={styles.description}>
                                {noSpace
                                    ? t('settings.voice.offlineNoSpace', 'Not enough free space on this phone')
                                    : t('edit.dictation.offlineDesc', 'Download once and recordings and dictation turn into text even without internet. The best model for this phone, {{size}}.', {
                                        size: formatModelSize(sizeBytes, t),
                                    })}
                            </Text>

                            <View style={styles.actions}>
                                <TouchableOpacity style={styles.buttonCancel} onPress={handleCancel} accessibilityRole="button">
                                    <Text style={styles.buttonCancelText}>{t('edit.onDeviceOffer.later', 'Not now')}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.buttonDownload, (!modelKey || noSpace) && styles.buttonDownloadDisabled]}
                                    onPress={handleDownload}
                                    disabled={!modelKey || noSpace}
                                    accessibilityRole="button"
                                >
                                    <Text style={styles.buttonDownloadText} numberOfLines={1}>
                                        {alreadyOnPhone ? t('localModels.useModel', 'Use this model') : t('localAI.download', 'Download')}
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        </>
                    ) : (
                        <View style={styles.downloadingContainer}>
                            <View style={styles.progressBarContainer}>
                                <View style={[styles.progressBarFill, { width: `${progress * 100}%` }]} />
                            </View>
                            <View style={styles.progressStats}>
                                <Text style={styles.progressStatText}>
                                    {t('localModels.progressShort', '{{loaded}} of {{total}}', {
                                        loaded: formatModelSize(bytesLoaded, t),
                                        total: formatModelSize(bytesTotal || sizeBytes, t),
                                    })}
                                </Text>
                                <Text style={styles.progressStatText}>{Math.round(progress * 100)}%</Text>
                            </View>
                            <TouchableOpacity style={styles.buttonCancelDownload} onPress={handleCancel} accessibilityRole="button">
                                <Text style={styles.buttonCancelText}>{t('common.cancel', 'Cancel')}</Text>
                            </TouchableOpacity>
                        </View>
                    )}
                </View>
            </View>
        </Modal>
    );
};

const styles = createStyles(() => ({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    container: {
        backgroundColor: colors.surface,
        borderRadius: 24,
        padding: 24,
        width: '100%',
        maxWidth: 400,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 8,
    },
    header: {
        alignItems: 'center',
        marginBottom: 16,
    },
    title: {
        ...typography.h2,
        color: colors.text,
        marginTop: 12,
        textAlign: 'center',
    },
    description: {
        ...typography.body,
        color: colors.textSecondary,
        textAlign: 'center',
        marginBottom: 24,
        lineHeight: 22,
    },
    modelList: {
        marginBottom: 24,
        gap: 12,
    },
    modelOption: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 64,
        paddingVertical: 12,
        paddingHorizontal: 14,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.background,
    },
    modelOptionDisabled: {
        opacity: 0.45,
    },
    modelOptionSelected: {
        borderColor: colors.primary,
        backgroundColor: `${colors.primary}10`,
    },
    modelOptionContent: {
        flex: 1,
    },
    modelNameLine: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 6,
        marginBottom: 2,
    },
    tag: {
        paddingHorizontal: 7,
        paddingVertical: 2,
        borderRadius: 8,
        backgroundColor: colors.primary,
    },
    tagText: {
        fontSize: 11,
        fontWeight: '700',
        color: colors.onPrimary,
    },
    onPhone: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    onPhoneText: {
        fontSize: 12,
        fontWeight: '600',
        color: colors.success,
    },
    modelName: {
        ...typography.subtitle,
        color: colors.text,
    },
    modelNameSelected: {
        color: colors.primary,
        fontWeight: '600',
    },
    modelSize: {
        ...typography.caption,
        color: colors.textSecondary,
    },
    actions: {
        flexDirection: 'row',
        gap: 12,
    },
    buttonCancel: {
        flex: 1,
        padding: 16,
        borderRadius: 16,
        backgroundColor: colors.surfaceElevated,
        alignItems: 'center',
    },
    buttonCancelText: {
        ...typography.button,
        color: colors.text,
    },
    buttonDownload: {
        flex: 1,
        padding: 16,
        borderRadius: 16,
        backgroundColor: colors.primary,
        alignItems: 'center',
    },
    buttonDownloadDisabled: {
        backgroundColor: colors.textTertiary,
    },
    buttonDownloadText: {
        ...typography.button,
        color: 'white',
    },
    downloadingContainer: {
        alignItems: 'center',
        paddingVertical: 12,
    },
    downloadingText: {
        ...typography.subtitle,
        color: colors.text,
        marginBottom: 24,
    },
    progressBarContainer: {
        width: '100%',
        height: 12,
        backgroundColor: colors.border,
        borderRadius: 6,
        overflow: 'hidden',
        marginBottom: 12,
    },
    progressBarFill: {
        height: '100%',
        backgroundColor: colors.primary,
        borderRadius: 6,
    },
    progressStats: {
        width: '100%',
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 32,
    },
    progressStatText: {
        ...typography.caption,
        color: colors.textSecondary,
        fontWeight: '600',
    },
    buttonCancelDownload: {
        paddingVertical: 12,
        paddingHorizontal: 24,
        borderRadius: 16,
        backgroundColor: colors.surfaceElevated,
    },
}));
