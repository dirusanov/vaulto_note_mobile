import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import i18next, { type TFunction } from 'i18next';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { createStyles } from '../theme/createStyles';

export interface OnDeviceModelOption {
    key: string;
    label: string;
    sizeBytes: number;
    /** One line on what the model is good for. */
    description: string;
    recommended?: boolean;
}

export interface OnDeviceModelState {
    downloaded: boolean;
    /** False when the phone lacks the memory or free space for it. */
    available: boolean;
    unavailableReason?: string;
}

export interface OnDeviceDownload {
    key: string;
    progress: number;
    loadedBytes: number;
    totalBytes: number;
}

interface Props {
    icon: keyof typeof MaterialIcons.glyphMap;
    title: string;
    subtitle: string;
    models: OnDeviceModelOption[];
    states: Record<string, OnDeviceModelState | undefined>;
    selectedKey?: string;
    download: OnDeviceDownload | null;
    busy?: boolean;
    /** Extra controls under the header (the transcription language, for voice). */
    headerAccessory?: React.ReactNode;
    onSelect: (key: string) => void;
    onDownload: (key: string) => void;
    onCancelDownload: () => void;
    onDelete: (key: string) => void;
}

export const formatModelSize = (bytes: number, t: TFunction): string => {
    if (bytes >= 1e9) {
        // Locale-aware decimal mark: "2.7 GB", "2,7 ГБ".
        let value: string;
        try {
            value = (bytes / 1e9).toLocaleString(i18next.language || undefined, { maximumFractionDigits: 1 });
        } catch {
            value = (bytes / 1e9).toFixed(1).replace(/\.0$/, '');
        }
        return t('localModels.gb', '{{value}} GB', { value });
    }
    return t('localModels.mb', '{{value}} MB', { value: Math.max(1, Math.round(bytes / 1e6)) });
};

/**
 * Picker for models that run on the phone: what each one is, which are on the
 * device, which is in use, and a real progress bar while one downloads.
 */
export const OnDeviceModelSection = ({
    icon, title, subtitle, models, states, selectedKey, download, busy, headerAccessory,
    onSelect, onDownload, onCancelDownload, onDelete,
}: Props) => {
    const { t } = useTranslation();
    const selectedState = selectedKey ? states[selectedKey] : undefined;
    const statusLabel = download
        ? t('localModels.statusDownloading', 'Downloading · {{percent}}%', { percent: Math.round(download.progress * 100) })
        : selectedState?.downloaded
            ? t('localModels.statusReady', 'Ready · works offline')
            : t('localModels.statusNotDownloaded', 'Not downloaded');
    const statusTone = download ? 'progress' : selectedState?.downloaded ? 'ready' : 'idle';

    return (
        <View style={styles.card}>
            <View style={styles.header}>
                <View style={styles.headerIcon}>
                    <MaterialIcons name={icon} size={22} color={colors.primary} />
                </View>
                <View style={styles.headerText}>
                    <Text style={styles.title}>{title}</Text>
                    <Text style={styles.subtitle}>{subtitle}</Text>
                </View>
            </View>
            <View style={[styles.status, statusTone === 'ready' && styles.statusReady, statusTone === 'progress' && styles.statusProgress]}>
                <View style={[styles.statusDot, statusTone === 'ready' && styles.statusDotReady, statusTone === 'progress' && styles.statusDotProgress]} />
                <Text style={[styles.statusText, statusTone === 'ready' && styles.statusTextReady, statusTone === 'progress' && styles.statusTextProgress]}>
                    {statusLabel}
                </Text>
            </View>
            {headerAccessory}

            <View style={styles.list}>
                {models.map((model) => {
                    const state = states[model.key];
                    const isSelected = model.key === selectedKey;
                    const isDownloading = download?.key === model.key;
                    const unavailable = state ? !state.available && !state.downloaded : false;
                    return (
                        <View key={model.key} style={[styles.row, isSelected && styles.rowSelected, unavailable && styles.rowDisabled]}>
                            <View style={styles.rowTop}>
                            <TouchableOpacity
                                style={styles.rowMain}
                                onPress={() => onSelect(model.key)}
                                disabled={busy || unavailable}
                                accessibilityRole="radio"
                                accessibilityState={{ selected: isSelected, disabled: busy || unavailable }}
                                accessibilityLabel={`${model.label}, ${formatModelSize(model.sizeBytes, t)}, ${model.description}`}
                            >
                                <MaterialIcons
                                    name={isSelected ? 'radio-button-checked' : 'radio-button-unchecked'}
                                    size={22}
                                    color={isSelected ? colors.primary : colors.textTertiary}
                                />
                                <View style={styles.rowText}>
                                    <View style={styles.nameLine}>
                                        <Text style={[styles.name, isSelected && styles.nameSelected]}>{model.label}</Text>
                                        {model.recommended && (
                                            <View style={styles.tag}>
                                                <Text style={styles.tagText}>{t('localModels.recommended', 'Recommended')}</Text>
                                            </View>
                                        )}
                                    </View>
                                    {state?.downloaded && (
                                        <View style={styles.onPhoneLine}>
                                            <MaterialIcons name="check-circle" size={14} color={colors.success} />
                                            <Text style={styles.downloadedText}>{t('localModels.onPhone', 'On phone')}</Text>
                                        </View>
                                    )}
                                    <Text style={styles.meta}>
                                        {formatModelSize(model.sizeBytes, t)} · {unavailable ? state?.unavailableReason : model.description}
                                    </Text>
                                </View>
                            </TouchableOpacity>

                            <View style={styles.rowAction}>
                                {isDownloading ? null : state?.downloaded ? (
                                    <>
                                        <TouchableOpacity
                                            style={styles.iconButton}
                                            onPress={() => onDelete(model.key)}
                                            disabled={busy}
                                            accessibilityRole="button"
                                            accessibilityLabel={t('localModels.delete', 'Delete {{model}}', { model: model.label })}
                                        >
                                            <MaterialIcons name="delete-outline" size={22} color={colors.textSecondary} />
                                        </TouchableOpacity>
                                    </>
                                ) : unavailable ? null : (
                                    <TouchableOpacity
                                        style={styles.downloadButton}
                                        onPress={() => onDownload(model.key)}
                                        disabled={busy || !!download}
                                        accessibilityRole="button"
                                        accessibilityLabel={t('localModels.download', 'Download {{model}}', { model: model.label })}
                                    >
                                        {busy && !download && isSelected ? (
                                            <ActivityIndicator size="small" color={colors.primary} />
                                        ) : (
                                            <MaterialIcons name="file-download" size={22} color={download ? colors.textTertiary : colors.primary} />
                                        )}
                                    </TouchableOpacity>
                                )}
                            </View>
                            </View>

                            {isDownloading && download && (
                                <View style={styles.progressBlock}>
                                    <View style={styles.progressTrack}>
                                        <View style={[styles.progressFill, { width: `${Math.max(2, Math.round(download.progress * 100))}%` }]} />
                                    </View>
                                    <View style={styles.progressLine}>
                                        <Text style={styles.progressText}>
                                            {t('localModels.progress', '{{loaded}} of {{total}} · {{percent}}%', {
                                                loaded: formatModelSize(download.loadedBytes, t),
                                                total: formatModelSize(download.totalBytes || model.sizeBytes, t),
                                                percent: Math.round(download.progress * 100),
                                            })}
                                        </Text>
                                        <TouchableOpacity
                                            style={styles.cancelButton}
                                            onPress={onCancelDownload}
                                            accessibilityRole="button"
                                        >
                                            <Text style={styles.cancelText}>{t('localModels.cancel', 'Cancel')}</Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            )}
                        </View>
                    );
                })}
            </View>
        </View>
    );
};

const styles = createStyles(() => ({
    // Sits inside the settings card, so a soft panel instead of a second border.
    card: {
        backgroundColor: colors.backgroundSecondary,
        borderRadius: 16,
        padding: spacing.m,
        gap: spacing.s,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
    },
    headerIcon: {
        width: 40,
        height: 40,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.primaryLight,
    },
    headerText: {
        flex: 1,
    },
    title: {
        fontSize: 16,
        fontWeight: '700',
        color: colors.text,
    },
    subtitle: {
        fontSize: 13,
        color: colors.textSecondary,
        marginTop: 2,
    },
    status: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 12,
        backgroundColor: colors.backgroundSecondary,
    },
    statusReady: { backgroundColor: colors.success + '18' },
    statusProgress: { backgroundColor: colors.surface },
    statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.textTertiary },
    statusDotReady: { backgroundColor: colors.success },
    statusDotProgress: { backgroundColor: colors.primary },
    statusText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
    statusTextReady: { color: colors.success },
    statusTextProgress: { color: colors.primary },
    list: {
        gap: spacing.xs,
        marginTop: spacing.xs,
    },
    row: {
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'transparent',
        backgroundColor: colors.surface,
        paddingLeft: spacing.s,
        paddingRight: spacing.xs,
        minHeight: 64,
    },
    rowTop: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    rowSelected: {
        borderColor: colors.primary,
        backgroundColor: colors.primaryLight,
    },
    rowDisabled: {
        opacity: 0.5,
    },
    rowMain: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
        paddingVertical: 10,
        minHeight: 56,
    },
    rowText: {
        flex: 1,
    },
    nameLine: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 6,
    },
    name: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.text,
    },
    nameSelected: {
        color: colors.primary,
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
    meta: {
        fontSize: 13,
        color: colors.textSecondary,
        marginTop: 2,
    },
    rowAction: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    onPhoneLine: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        marginTop: 2,
    },
    downloadedText: {
        fontSize: 12,
        fontWeight: '600',
        color: colors.success,
    },
    iconButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    downloadButton: {
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
    },
    progressBlock: {
        paddingRight: spacing.s,
        paddingBottom: spacing.s,
        gap: 4,
    },
    progressTrack: {
        height: 8,
        borderRadius: 4,
        backgroundColor: colors.backgroundSecondary,
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        borderRadius: 4,
        backgroundColor: colors.primary,
    },
    progressLine: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    progressText: {
        fontSize: 13,
        color: colors.textSecondary,
    },
    cancelButton: {
        minHeight: 44,
        justifyContent: 'center',
        paddingHorizontal: spacing.s,
    },
    cancelText: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.error,
    },
}));
