import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, Text, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { createStyles } from '../theme/createStyles';
import { formatModelSize } from './OnDeviceModelSection';
import { getModelChoices, ModelChoice, ModelTier, OfflinePlan, planModelSwitch } from '../services/offlineMode';
import type { LocalWhisperModelKey } from '../services/LocalWhisperService';
import type { LocalLLMModelKey } from '../services/LocalLLMService';
import { modelUnderstandsRequests } from '../services/voiceAgent';

interface ModelPickerSheetProps {
    visible: boolean;
    /** "Only on this phone" is on: the cloud is offered when a model is heavy. */
    privateMode: boolean;
    /** Speech is local, but no text AI model has been downloaded. */
    privateVoiceOnly?: boolean;
    onClose: () => void;
    onApply: (plan: OfflinePlan) => void;
    onUseCloud: () => void;
    /** Bytes that can be freed: set only while local models are switched off. */
    removableBytes?: number;
    onRemove?: () => void;
}

/**
 * Any model may be picked. The one that suits the phone is marked; a heavier one
 * gets a calm note in place (no alert), and with "Only on this phone" on, the
 * cloud is offered as the faster option.
 */
export const ModelPickerSheet = ({ visible, privateMode, privateVoiceOnly = false, onClose, onApply, onUseCloud, removableBytes = 0, onRemove }: ModelPickerSheetProps) => {
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    const [choices, setChoices] = useState<{ speech: ModelChoice[]; ai: ModelChoice[] } | null>(null);
    const [speechKey, setSpeechKey] = useState<string | null>(null);
    const [aiKey, setAiKey] = useState<string | null>(null);
    const [plan, setPlan] = useState<OfflinePlan | null | undefined>(undefined);
    const [loadFailed, setLoadFailed] = useState(false);
    const [reload, setReload] = useState(0);

    useEffect(() => {
        if (!visible) return;
        let active = true;
        setChoices(null);
        setSpeechKey(null);
        setAiKey(null);
        setPlan(undefined);
        setLoadFailed(false);
        void getModelChoices().then((result) => {
            if (!active) return;
            setChoices(result);
            setSpeechKey((result.speech.find((c) => c.current) ?? result.speech.find((c) => c.recommended && c.supported))?.key ?? null);
            setAiKey((result.ai.find((c) => c.current) ?? result.ai.find((c) => c.recommended && c.supported))?.key ?? null);
        }).catch(() => { if (active) setLoadFailed(true); });
        return () => { active = false; };
    }, [visible, reload]);

    useEffect(() => {
        if (!speechKey) return;
        let active = true;
        setPlan(undefined);
        void planModelSwitch(speechKey as LocalWhisperModelKey, (aiKey as LocalLLMModelKey) ?? null)
            .then((next) => { if (active) setPlan(next); })
            .catch(() => { if (active) setPlan(null); });
        return () => { active = false; };
    }, [speechKey, aiKey]);

    const selected = useMemo(() => ({
        speech: choices?.speech.find((c) => c.key === speechKey),
        ai: choices?.ai.find((c) => c.key === aiKey),
    }), [choices, speechKey, aiKey]);
    const heavy = !!selected.speech?.heavy || !!selected.ai?.heavy;
    const unchanged = !!selected.speech?.current && (aiKey === null
        ? !choices?.ai.some((choice) => choice.current)
        : !!selected.ai?.current);

    const tierLabel = (kind: 'speech' | 'ai', tier: ModelTier) => {
        if (tier === 'fast') return t('settings.models.fast', 'Fast');
        if (tier === 'balanced') return t('settings.models.balanced', 'Balanced');
        return kind === 'speech'
            ? t('settings.models.accurate', 'Most accurate')
            : t('settings.models.smartest', 'Smartest');
    };

    const renderRow = (kind: 'speech' | 'ai', choice: ModelChoice) => {
        const isSelected = (kind === 'speech' ? speechKey : aiKey) === choice.key;
        const select = () => (kind === 'speech' ? setSpeechKey(choice.key) : setAiKey(choice.key));
        return (
            <TouchableOpacity
                key={choice.key}
                style={[styles.row, isSelected && styles.rowSelected, !choice.supported && styles.rowDisabled]}
                onPress={select}
                disabled={!choice.supported}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected, disabled: !choice.supported }}
            >
                <MaterialIcons
                    name={isSelected ? 'radio-button-checked' : 'radio-button-unchecked'}
                    size={22}
                    color={isSelected ? colors.primary : colors.textTertiary}
                />
                <View style={styles.rowText}>
                    <View style={styles.rowTop}>
                        <Text style={styles.rowTitle}>{tierLabel(kind, choice.tier)}</Text>
                        {choice.recommended && choice.supported ? (
                            <View style={styles.badge}>
                                <Text style={styles.badgeText}>{t('settings.models.recommended', 'Best for this device')}</Text>
                            </View>
                        ) : null}
                    </View>
                    <Text style={styles.rowMeta}>
                        {choice.supported
                            ? `${choice.name} · ${formatModelSize(choice.sizeBytes, t)}${choice.current ? ` · ${t('settings.models.inUse', 'in use')}` : ''}`
                            : t('settings.models.tooBig', '{{name}} · not enough memory on this device', { name: choice.name })}
                    </Text>
                </View>
            </TouchableOpacity>
        );
    };

    const applyLabel = plan === undefined
        ? '…'
        : plan === null
            ? t('settings.voice.offlineNoSpace', 'Not enough free space on this device')
            : plan.downloadBytes > 0
                ? t('settings.models.download', 'Download · {{size}}', { size: formatModelSize(plan.downloadBytes, t) })
                : t('settings.models.switch', 'Switch');

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <TouchableWithoutFeedback onPress={onClose}>
                <View style={styles.overlay}>
                    <TouchableWithoutFeedback>
                        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.m) }]}>
                            <View style={styles.header}>
                                <Text style={styles.title}>{t('settings.models.title', 'Models on this device')}</Text>
                                <TouchableOpacity onPress={onClose} style={styles.closeButton} accessibilityRole="button" accessibilityLabel={t('a11y.close', 'Close')}>
                                    <MaterialIcons name="close" size={22} color={colors.textSecondary} />
                                </TouchableOpacity>
                            </View>
                            <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: spacing.s }}>
                                <Text style={styles.subtitle}>
                                    {privateMode
                                        ? privateVoiceOnly
                                            ? t('settings.voice.privateVoiceDesc', 'Voice never leaves the device, even online')
                                            : t('settings.models.subtitlePrivate', 'Voice and AI run only on this device.')
                                        : t('settings.models.subtitle', 'Downloaded models work without internet. When you reconnect, new requests use the cloud again. Turn on “Only on this device” to always process locally.')}
                                </Text>

                                {!choices ? (
                                    loadFailed ? (
                                        <View style={styles.loadError}>
                                            <Text style={styles.hint}>{t('settings.models.loadFailed', 'Could not check the models. Please try again.')}</Text>
                                            <TouchableOpacity onPress={() => setReload((value) => value + 1)} accessibilityRole="button" style={styles.retryButton}>
                                                <Text style={styles.noteAction}>{t('voice.retry', 'Retry')}</Text>
                                            </TouchableOpacity>
                                        </View>
                                    ) : <ActivityIndicator style={{ marginVertical: spacing.xl }} color={colors.primary} />
                                ) : (
                                    <>
                                        <Text style={styles.section}>{t('settings.models.speech', 'Speech to text')}</Text>
                                        {choices.speech.map((c) => renderRow('speech', c))}
                                        {choices.ai.length > 0 && (
                                            <>
                                                <Text style={styles.section}>{t('settings.models.ai', 'AI: voice requests, editing, chat')}</Text>
                                                {!choices.ai.some((choice) => choice.current) && (
                                                    <TouchableOpacity
                                                        style={[styles.row, aiKey === null && styles.rowSelected]}
                                                        onPress={() => setAiKey(null)}
                                                        accessibilityRole="radio"
                                                        accessibilityState={{ selected: aiKey === null }}
                                                    >
                                                        <MaterialIcons name={aiKey === null ? 'radio-button-checked' : 'radio-button-unchecked'} size={22} color={aiKey === null ? colors.primary : colors.textTertiary} />
                                                        <View style={styles.rowText}>
                                                            <Text style={styles.rowTitle}>{t('settings.models.speechOnly', 'Speech only')}</Text>
                                                            <Text style={styles.rowMeta}>{t('settings.models.speechOnlyHint', 'Skip the AI download. Cloud AI is a separate choice when online.')}</Text>
                                                        </View>
                                                    </TouchableOpacity>
                                                )}
                                                {choices.ai.map((c) => renderRow('ai', c))}
                                                {!!aiKey && !modelUnderstandsRequests(aiKey) && (
                                                    <>
                                                        <Text style={styles.hint}>
                                                            {t('settings.models.fastQualityHint', 'The small AI model can miss details or get facts wrong. Check text improvements; consider the cloud for complex notes.')}
                                                        </Text>
                                                        <Text style={styles.hint}>
                                                            {t('settings.models.fastNoRequests', 'Without internet, Fast does not take voice requests: recordings stay plain text. Balanced understands them.')}
                                                        </Text>
                                                    </>
                                                )}
                                            </>
                                        )}

                                        {heavy && (
                                            <View style={styles.note}>
                                                <MaterialIcons name="speed" size={20} color={colors.warning} />
                                                <View style={{ flex: 1 }}>
                                                    <Text style={styles.noteTitle}>{t('settings.models.heavyTitle', 'Heavy for this device')}</Text>
                                                    <Text style={styles.noteText}>
                                                        {privateMode
                                                            ? t('settings.models.heavyPrivate', 'It will work, but slower and with more battery. Vaulto cloud is faster and more accurate, and your notes stay encrypted.')
                                                            : t('settings.models.heavy', 'It will work without internet, but slower and with more battery. Online, Vaulto cloud is used anyway.')}
                                                    </Text>
                                                    {privateMode && (
                                                        <TouchableOpacity onPress={() => { onClose(); onUseCloud(); }} accessibilityRole="button" hitSlop={8}>
                                                            <Text style={styles.noteAction}>{t('settings.models.useCloud', 'Use Vaulto cloud')}</Text>
                                                        </TouchableOpacity>
                                                    )}
                                                </View>
                                            </View>
                                        )}
                                    </>
                                )}
                            </ScrollView>

                            <TouchableOpacity
                                style={[styles.applyButton, (!plan || unchanged) && styles.applyButtonQuiet]}
                                disabled={!loadFailed && !unchanged && !plan}
                                onPress={() => {
                                    if (unchanged || !plan) { onClose(); return; }
                                    onClose();
                                    onApply(plan);
                                }}
                                accessibilityRole="button"
                            >
                                <Text style={[styles.applyText, (!plan || unchanged) && styles.applyTextQuiet]}>
                                    {loadFailed ? t('a11y.close', 'Close') : unchanged ? t('common.done', 'Done') : applyLabel}
                                </Text>
                            </TouchableOpacity>
                            {removableBytes > 0 && !!onRemove && (
                                <TouchableOpacity
                                    style={styles.removeButton}
                                    onPress={() => { onClose(); onRemove(); }}
                                    accessibilityRole="button"
                                >
                                    <Text style={styles.removeText}>
                                        {t('settings.models.remove', 'Remove from this device · {{size}}', { size: formatModelSize(removableBytes, t) })}
                                    </Text>
                                </TouchableOpacity>
                            )}
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
        backgroundColor: colors.overlay,
        justifyContent: 'flex-end',
    },
    sheet: {
        backgroundColor: colors.surface,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        width: '100%',
        maxWidth: 640,
        alignSelf: 'center',
        paddingTop: spacing.m,
        maxHeight: '88%',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.m,
        gap: spacing.s,
    },
    title: {
        flex: 1,
        flexShrink: 1,
        fontSize: 18,
        fontWeight: '700',
        color: colors.text,
    },
    closeButton: {
        padding: spacing.xs,
        minWidth: 48,
        minHeight: 48,
        alignItems: 'center',
        justifyContent: 'center',
    },
    subtitle: {
        fontSize: 14,
        lineHeight: 20,
        color: colors.textSecondary,
        paddingHorizontal: spacing.s,
        marginTop: spacing.xs,
        marginBottom: spacing.s,
    },
    list: {
        paddingHorizontal: spacing.s,
        flexShrink: 1,
    },
    section: {
        fontSize: 13,
        fontWeight: '500',
        color: colors.textSecondary,
        paddingHorizontal: spacing.s,
        marginTop: spacing.m,
        marginBottom: spacing.xs,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
        borderRadius: 12,
        paddingVertical: spacing.s,
        paddingHorizontal: spacing.s - 2,
        // Same selection mark as the paywall plans: a 2px outline, reserved at
        // rest so choosing a row does not shift it.
        borderWidth: 2,
        borderColor: 'transparent',
    },
    rowSelected: {
        borderColor: colors.primary,
    },
    rowDisabled: {
        opacity: 0.45,
    },
    rowText: {
        flex: 1,
        minWidth: 0,
    },
    rowTop: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: spacing.xs,
    },
    rowTitle: {
        flexShrink: 1,
        fontSize: 16,
        fontWeight: '600',
        color: colors.text,
    },
    rowMeta: {
        fontSize: 13,
        color: colors.textSecondary,
        marginTop: 2,
    },
    badge: {
        maxWidth: '100%',
        backgroundColor: colors.success + '22',
        borderRadius: 8,
        paddingHorizontal: 6,
        paddingVertical: 2,
    },
    badgeText: {
        fontSize: 11,
        fontWeight: '600',
        color: colors.success,
    },
    hint: {
        fontSize: 13,
        lineHeight: 19,
        color: colors.textSecondary,
        paddingHorizontal: spacing.s,
        marginTop: spacing.xs,
    },
    note: {
        flexDirection: 'row',
        gap: spacing.s,
        backgroundColor: colors.warning + '14',
        borderRadius: 12,
        padding: spacing.m,
        marginTop: spacing.m,
        marginHorizontal: spacing.xs,
    },
    noteTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.text,
    },
    noteText: {
        fontSize: 13,
        lineHeight: 19,
        color: colors.textSecondary,
        marginTop: 2,
    },
    noteAction: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.primary,
        marginTop: spacing.s,
    },
    applyButton: {
        marginHorizontal: spacing.m,
        marginTop: spacing.s,
        backgroundColor: colors.primary,
        borderRadius: 14,
        paddingVertical: 14,
        paddingHorizontal: spacing.m,
        alignItems: 'center',
    },
    applyButtonQuiet: {
        backgroundColor: colors.background,
    },
    applyText: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.onPrimary,
        textAlign: 'center',
    },
    applyTextQuiet: {
        color: colors.text,
    },
    removeButton: {
        minHeight: 48,
        alignItems: 'center',
        justifyContent: 'center',
    },
    removeText: {
        fontSize: 14,
        color: colors.textSecondary,
    },
    loadError: {
        paddingVertical: spacing.l,
    },
    retryButton: {
        minHeight: 48,
        paddingHorizontal: spacing.s,
        justifyContent: 'center',
    },
}));
