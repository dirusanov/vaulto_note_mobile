import React, { useState, useEffect } from 'react';
import { View, Text, Modal, TouchableOpacity, Alert } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import {
    downloadLocalWhisperModel,
    cancelLocalWhisperDownload,
    LocalWhisperModelDescriptor,
    LocalWhisperModelKey,
    getAvailableLocalWhisperModels,
    getLocalWhisperModelStatus,
    canFitLocalWhisperModel,
    isLocalWhisperModelSupportedByDevice,
} from '../services/LocalWhisperService';
import { getLocalWhisperModelKey, setLocalWhisperModelKey } from '../utils/storage';
import { formatModelSize } from './OnDeviceModelSection';
import { createStyles } from '../theme/createStyles';

/** Why a model cannot be downloaded on this device, if it cannot. */
type ModelBlocker = 'memory' | 'space' | null;

interface Props {
    visible: boolean;
    onClose: () => void;
    onDownloadComplete: () => void;
}

export const LocalWhisperDownloadModal: React.FC<Props> = ({ visible, onClose, onDownloadComplete }) => {
    const { t } = useTranslation();
    const [models, setModels] = useState<LocalWhisperModelDescriptor[]>([]);
    const [selectedModelKey, setSelectedModelKey] = useState<LocalWhisperModelKey>('turbo');
    const [blockers, setBlockers] = useState<Partial<Record<LocalWhisperModelKey, ModelBlocker>>>({});
    const [isDownloading, setIsDownloading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [bytesLoaded, setBytesLoaded] = useState(0);
    const [bytesTotal, setBytesTotal] = useState(0);
    const [downloaded, setDownloaded] = useState<Partial<Record<LocalWhisperModelKey, boolean>>>({});

    useEffect(() => {
        if (!visible) return;

        // Large is left out: Turbo is as accurate at a fifth of the size.
        const available = getAvailableLocalWhisperModels()
            .filter((model) => model.key !== 'large')
            .sort((a, b) => a.sizeBytes - b.sizeBytes);
        setModels(available);
        const storedKeyPromise = getLocalWhisperModelKey();

        // A model the device cannot hold must not start a multi-gigabyte download.
        let cancelled = false;
        void (async () => {
            const entries = await Promise.all(available.map(async (model) => {
                if (!(await isLocalWhisperModelSupportedByDevice(model.key))) {
                    return [model.key, 'memory'] as const;
                }
                if (!(await canFitLocalWhisperModel(model.key))) {
                    return [model.key, 'space'] as const;
                }
                return [model.key, null] as const;
            }));
            const onPhone = await Promise.all(available.map(async (model) =>
                [model.key, (await getLocalWhisperModelStatus(model.key)).isDownloaded] as const));
            if (cancelled) return;
            const blockerMap = Object.fromEntries(entries) as Partial<Record<LocalWhisperModelKey, ModelBlocker>>;
            setBlockers(blockerMap);
            setDownloaded(Object.fromEntries(onPhone));
            // Start on the stored model if it suits this phone, else the best one that does.
            const stored = (await storedKeyPromise) as LocalWhisperModelKey | '';
            const usable = (key: LocalWhisperModelKey) => available.some((m) => m.key === key) && !blockerMap[key];
            const preferred = (['turbo', 'base', 'tiny'] as LocalWhisperModelKey[]).find(usable);
            setSelectedModelKey(stored && usable(stored) ? stored : (preferred ?? 'tiny'));
        })();

        return () => { cancelled = true; };
    }, [visible]);

    const handleDownload = async () => {
        if (downloaded[selectedModelKey]) {
            // Already on the phone: just use it.
            await setLocalWhisperModelKey(selectedModelKey);
            onDownloadComplete();
            return;
        }
        setIsDownloading(true);
        setProgress(0);
        setBytesLoaded(0);
        setBytesTotal(0);

        try {
            await setLocalWhisperModelKey(selectedModelKey);
            await downloadLocalWhisperModel(
                selectedModelKey,
                (p, loaded, total) => {
                    setProgress(p);
                    setBytesLoaded(loaded);
                    setBytesTotal(total);
                }
            );
            setIsDownloading(false);
            onDownloadComplete();
        } catch (e: any) {
            setIsDownloading(false);
            if (e?.message !== 'Download cancelled') {
                Alert.alert(
                    t('edit.dictation.downloadFailed', 'Download failed'),
                    e?.message || '',
                );
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

    const selectedModel = models.find(m => m.key === selectedModelKey);
    const selectedBlocker = blockers[selectedModelKey] ?? null;

    const describeBlocker = (blocker: ModelBlocker): string | null => {
        if (blocker === 'memory') return t('edit.dictation.unsupportedDevice', 'Not supported on this device');
        if (blocker === 'space') return t('edit.dictation.notEnoughSpace', 'Not enough free space');
        return null;
    };

    return (
        <Modal visible={visible} transparent animationType="fade">
            <View style={styles.overlay}>
                <View style={styles.container}>
                    <View style={styles.header}>
                        <MaterialIcons name="cloud-download" size={32} color={colors.primary} />
                        <Text style={styles.title}>{t('edit.dictation.modelTitle', 'Speech model on your phone')}</Text>
                    </View>
                    
                    {!isDownloading ? (
                        <>
                            <Text style={styles.description}>
                                {t('edit.dictation.modelDescription', 'Download once to turn recordings and live dictation into text right on the phone — free, offline, and the audio never leaves it. Larger models are more accurate.')}
                            </Text>

                            <View style={styles.modelList}>
                                {models.map(model => {
                                    const blocker = blockers[model.key] ?? null;
                                    const blockerLabel = describeBlocker(blocker);
                                    return (
                                        <TouchableOpacity
                                            key={model.key}
                                            style={[
                                                styles.modelOption,
                                                selectedModelKey === model.key && styles.modelOptionSelected,
                                                blocker !== null && styles.modelOptionDisabled,
                                            ]}
                                            onPress={() => setSelectedModelKey(model.key)}
                                            disabled={blocker !== null}
                                        >
                                            <MaterialIcons
                                                name={selectedModelKey === model.key ? 'radio-button-checked' : 'radio-button-unchecked'}
                                                size={22}
                                                color={selectedModelKey === model.key ? colors.primary : colors.textTertiary}
                                            />
                                            <View style={styles.modelOptionContent}>
                                                <View style={styles.modelNameLine}>
                                                    <Text style={[styles.modelName, selectedModelKey === model.key && styles.modelNameSelected]}>
                                                        {model.label}
                                                    </Text>
                                                    {model.key === 'turbo' && blocker === null && (
                                                        <View style={styles.tag}>
                                                            <Text style={styles.tagText}>{t('localModels.recommended', 'Recommended')}</Text>
                                                        </View>
                                                    )}
                                                </View>
                                                <Text style={styles.modelSize}>
                                                    {formatModelSize(model.sizeBytes, t)} · {blockerLabel ?? ({
                                                        tiny: t('localModels.whisperTiny', 'Fastest, basic accuracy'),
                                                        base: t('localModels.whisperBase', 'Fast, more accurate than Tiny'),
                                                        turbo: t('localModels.whisperTurbo', 'Most accurate, a bit slower'),
                                                    } as Record<string, string>)[model.key] ?? ''}
                                                </Text>
                                            </View>
                                            {downloaded[model.key] && (
                                                <View style={styles.onPhone}>
                                                    <MaterialIcons name="check-circle" size={18} color={colors.success} />
                                                    <Text style={styles.onPhoneText}>{t('localModels.onPhone', 'On phone')}</Text>
                                                </View>
                                            )}
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>

                            <View style={styles.actions}>
                                <TouchableOpacity style={styles.buttonCancel} onPress={handleCancel}>
                                    <Text style={styles.buttonCancelText}>{t('common.cancel', 'Cancel')}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.buttonDownload, selectedBlocker !== null && styles.buttonDownloadDisabled]}
                                    onPress={handleDownload}
                                    disabled={selectedBlocker !== null}
                                >
                                    <Text style={styles.buttonDownloadText}>
                                        {describeBlocker(selectedBlocker)
                                            || (downloaded[selectedModelKey]
                                                ? t('localModels.useModel', 'Use this model')
                                                : t('localModels.downloadSize', 'Download · {{size}}', { size: formatModelSize(selectedModel?.sizeBytes ?? 0, t) }))}
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        </>
                    ) : (
                        <View style={styles.downloadingContainer}>
                            <Text style={styles.downloadingText}>
                                {t('edit.dictation.downloading', 'Downloading the {{model}} model...', { model: selectedModel?.label ?? '' })}
                            </Text>
                            
                            <View style={styles.progressBarContainer}>
                                <View style={[styles.progressBarFill, { width: `${progress * 100}%` }]} />
                            </View>

                            <View style={styles.progressStats}>
                                <Text style={styles.progressStatText}>
                                    {t('localModels.progressShort', '{{loaded}} of {{total}}', {
                                        loaded: formatModelSize(bytesLoaded, t),
                                        total: formatModelSize(bytesTotal || selectedModel?.sizeBytes || 0, t),
                                    })}
                                </Text>
                                <Text style={styles.progressStatText}>{Math.round(progress * 100)}%</Text>
                            </View>

                            <TouchableOpacity style={styles.buttonCancelDownload} onPress={handleCancel}>
                                <Text style={styles.buttonCancelText}>{t('edit.dictation.cancelDownload', 'Cancel Download')}</Text>
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
