import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import {
    downloadLocalWhisperModel,
    cancelLocalWhisperDownload,
    LocalWhisperModelDescriptor,
    LocalWhisperModelKey,
    getAvailableLocalWhisperModels,
} from '../services/LocalWhisperService';
import { getLocalWhisperModelKey, setLocalWhisperModelKey } from '../utils/storage';

interface Props {
    visible: boolean;
    onClose: () => void;
    onDownloadComplete: () => void;
}

export const LocalWhisperDownloadModal: React.FC<Props> = ({ visible, onClose, onDownloadComplete }) => {
    const [models, setModels] = useState<LocalWhisperModelDescriptor[]>([]);
    const [selectedModelKey, setSelectedModelKey] = useState<LocalWhisperModelKey>('turbo');
    const [isDownloading, setIsDownloading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [bytesLoaded, setBytesLoaded] = useState(0);
    const [bytesTotal, setBytesTotal] = useState(0);

    useEffect(() => {
        if (visible) {
            setModels(getAvailableLocalWhisperModels());
            getLocalWhisperModelKey().then(key => {
                if (key) setSelectedModelKey(key as LocalWhisperModelKey);
            });
        }
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
            if (e.message !== 'Download cancelled') {
                alert('Download failed: ' + e.message);
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

    return (
        <Modal visible={visible} transparent animationType="fade">
            <View style={styles.overlay}>
                <View style={styles.container}>
                    <View style={styles.header}>
                        <MaterialIcons name="cloud-download" size={32} color={colors.primary} />
                        <Text style={styles.title}>Offline Dictation Model</Text>
                    </View>
                    
                    {!isDownloading ? (
                        <>
                            <Text style={styles.description}>
                                To use real-time dictation offline without an internet connection, you need to download a speech recognition model.
                            </Text>

                            <View style={styles.modelList}>
                                {models.map(model => (
                                    <TouchableOpacity
                                        key={model.key}
                                        style={[styles.modelOption, selectedModelKey === model.key && styles.modelOptionSelected]}
                                        onPress={() => setSelectedModelKey(model.key)}
                                    >
                                        <View style={styles.modelOptionContent}>
                                            <Text style={[styles.modelName, selectedModelKey === model.key && styles.modelNameSelected]}>
                                                {model.label}
                                                {model.recommended && ' (Recommended)'}
                                            </Text>
                                            <Text style={styles.modelSize}>{model.sizeLabel}</Text>
                                        </View>
                                        {selectedModelKey === model.key && (
                                            <MaterialIcons name="check-circle" size={24} color={colors.primary} />
                                        )}
                                    </TouchableOpacity>
                                ))}
                            </View>

                            <View style={styles.actions}>
                                <TouchableOpacity style={styles.buttonCancel} onPress={handleCancel}>
                                    <Text style={styles.buttonCancelText}>Cancel</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={styles.buttonDownload} onPress={handleDownload}>
                                    <Text style={styles.buttonDownloadText}>Download</Text>
                                </TouchableOpacity>
                            </View>
                        </>
                    ) : (
                        <View style={styles.downloadingContainer}>
                            <Text style={styles.downloadingText}>Downloading {selectedModel?.label} Model...</Text>
                            
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
                                <Text style={styles.buttonCancelText}>Cancel Download</Text>
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
