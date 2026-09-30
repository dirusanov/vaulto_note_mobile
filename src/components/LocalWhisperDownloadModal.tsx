import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, Alert } from 'react-native';
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
    canFitLocalWhisperModel,
    isLocalWhisperModelSupportedByDevice,
} from '../services/LocalWhisperService';
import { getLocalWhisperModelKey, setLocalWhisperModelKey } from '../utils/storage';

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

    useEffect(() => {
        if (!visible) return;

        const available = getAvailableLocalWhisperModels();
        setModels(available);
        getLocalWhisperModelKey().then(key => {
            if (key) setSelectedModelKey(key as LocalWhisperModelKey);
        });

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
            if (!cancelled) {
                setBlockers(Object.fromEntries(entries) as Partial<Record<LocalWhisperModelKey, ModelBlocker>>);
            }
        })();

        return () => { cancelled = true; };
    }, [visible]);

    const handleDownload = async () => {
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
                                            <View style={styles.modelOptionContent}>
                                                <Text style={[styles.modelName, selectedModelKey === model.key && styles.modelNameSelected]}>
                                                    {model.label}
                                                    {model.recommended && ` (${t('edit.dictation.recommended', 'Recommended')})`}
                                                </Text>
                                                <Text style={styles.modelSize}>
                                                    {blockerLabel ? `${model.sizeLabel} - ${blockerLabel}` : model.sizeLabel}
                                                </Text>
                                            </View>
                                            {selectedModelKey === model.key && blocker === null && (
                                                <MaterialIcons name="check-circle" size={24} color={colors.primary} />
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
                                        {describeBlocker(selectedBlocker) || t('edit.dictation.download', 'Download')}
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
                                    {Math.round(bytesLoaded / 1024 / 1024)} MB / {Math.round((bytesTotal || selectedModel?.sizeBytes || 0) / 1024 / 1024)} MB
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

const styles = StyleSheet.create({
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
        justifyContent: 'space-between',
        padding: 16,
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
    modelName: {
        ...typography.subtitle,
        color: colors.text,
        marginBottom: 4,
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
});
