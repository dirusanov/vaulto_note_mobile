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
    onClose: () => void;
    onApply: (plan: OfflinePlan) => void;
    onUseCloud: () => void;
}

/**
 * Any model may be picked. The one that suits the phone is marked; a heavier one
 * gets a calm note in place (no alert), and with "Only on this phone" on, the
 * cloud is offered as the faster option.
 */
export const ModelPickerSheet = ({ visible, privateMode, onClose, onApply, onUseCloud }: ModelPickerSheetProps) => {
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    const [choices, setChoices] = useState<{ speech: ModelChoice[]; ai: ModelChoice[] } | null>(null);
    const [speechKey, setSpeechKey] = useState<string | null>(null);
    const [aiKey, setAiKey] = useState<string | null>(null);
    const [plan, setPlan] = useState<OfflinePlan | null | undefined>(undefined);

    useEffect(() => {
        if (!visible) return;
        let active = true;
        setChoices(null);
        void getModelChoices().then((result) => {
            if (!active) return;
            setChoices(result);
            setSpeechKey((result.speech.find((c) => c.current) ?? result.speech.find((c) => c.recommended))?.key ?? null);
            setAiKey((result.ai.find((c) => c.current) ?? result.ai.find((c) => c.recommended))?.key ?? null);
        });
        return () => { active = false; };
    }, [visible]);

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
    const unchanged = !!selected.speech?.current && (!choices?.ai.length || !!selected.ai?.current);

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
                                <Text style={styles.badgeText}>{t('settings.models.recommended', 'Best for this phone')}</Text>
                            </View>
                        ) : null}
                    </View>
                    <Text style={styles.rowMeta}>
                        {choice.supported
                            ? `${choice.name} · ${formatModelSize(choice.sizeBytes, t)}${choice.current ? ` · ${t('settings.models.inUse', 'in use')}` : ''}`
                            : t('settings.models.tooBig', '{{name}} · not enough memory on this phone', { name: choice.name })}
                    </Text>
                </View>
            </TouchableOpacity>
        );
    };

    const applyLabel = plan === undefined
        ? '…'
        : plan === null
            ? t('settings.voice.offlineNoSpace', 'Not enough free space on this phone')
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
                                <Text style={styles.title}>{t('settings.models.title', 'Models on this phone')}</Text>
                                <TouchableOpacity onPress={onClose} style={styles.closeButton} accessibilityRole="button" accessibilityLabel={t('a11y.close', 'Close')}>
                                    <MaterialIcons name="close" size={22} color={colors.textSecondary} />
                                </TouchableOpacity>
                            </View>
                            <Text style={styles.subtitle}>
                                {privateMode
                                    ? t('settings.models.subtitlePrivate', 'Voice and AI run only on this phone.')
                                    : t('settings.models.subtitle', 'Used without internet. Online, Vaulto cloud is used: it is faster and more accurate.')}
                            </Text>

                            {!choices ? (
                                <ActivityIndicator style={{ marginVertical: spacing.xl }} color={colors.primary} />
                            ) : (
                                <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: spacing.s }}>
                                    <Text style={styles.section}>{t('settings.models.speech', 'Speech to text')}</Text>
                                    {choices.speech.map((c) => renderRow('speech', c))}
                                    {choices.ai.length > 0 && (
                                        <>
                                            <Text style={styles.section}>{t('settings.models.ai', 'AI: voice requests, editing, chat')}</Text>
                                            {choices.ai.map((c) => renderRow('ai', c))}
                                            {!!aiKey && !modelUnderstandsRequests(aiKey) && (
                                                <Text style={styles.hint}>
                                                    {t('settings.models.fastNoRequests', 'Without internet, Fast does not take voice requests: recordings stay plain text. Balanced understands them.')}
                                                </Text>
                                            )}
                                        </>
                                    )}

                                    {heavy && (
                                        <View style={styles.note}>
                                            <MaterialIcons name="speed" size={20} color={colors.warning} />
                                            <View style={{ flex: 1 }}>
                                                <Text style={styles.noteTitle}>{t('settings.models.heavyTitle', 'Heavy for this phone')}</Text>
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
                                </ScrollView>
                            )}

                            <TouchableOpacity
                                style={[styles.applyButton, (!plan || unchanged) && styles.applyButtonQuiet]}
                                disabled={!unchanged && !plan}
                                onPress={() => {
                                    if (unchanged || !plan) { onClose(); return; }
                                    onClose();
                                    onApply(plan);
                                }}
                                accessibilityRole="button"
                            >
                                <Text style={[styles.applyText, (!plan || unchanged) && styles.applyTextQuiet]}>
                                    {unchanged ? t('common.done', 'Done') : applyLabel}
                                </Text>
                            </TouchableOpacity>
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
    },
    title: {
        fontSize: 18,
        fontWeight: '700',
        color: colors.text,
    },
    closeButton: {
        padding: spacing.xs,
    },
    subtitle: {
        fontSize: 14,
        lineHeight: 20,
        color: colors.textSecondary,
        paddingHorizontal: spacing.m,
        marginTop: spacing.xs,
        marginBottom: spacing.s,
    },
    list: {
        paddingHorizontal: spacing.s,
    },
    section: {
        fontSize: 13,
        fontWeight: '600',
        color: colors.textSecondary,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
        paddingHorizontal: spacing.s,
        marginTop: spacing.m,
        marginBottom: spacing.xs,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
        borderRadius: 12,
        paddingVertical: spacing.s + 2,
        paddingHorizontal: spacing.s,
    },
    rowSelected: {
        backgroundColor: colors.primaryLight,
    },
    rowDisabled: {
        opacity: 0.45,
    },
    rowText: {
        flex: 1,
    },
    rowTop: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: spacing.xs,
    },
    rowTitle: {
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
        alignItems: 'center',
    },
    applyButtonQuiet: {
        backgroundColor: colors.background,
    },
    applyText: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.onPrimary,
    },
    applyTextQuiet: {
        color: colors.text,
    },
}));
