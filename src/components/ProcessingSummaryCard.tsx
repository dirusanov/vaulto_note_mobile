import React, { useEffect, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { createStyles } from '../theme/createStyles';
import { readProcessingSummary } from '../services/micRouteState';
import type { AISummary, LeavesPhone, ProcessingSummary, SpeechSummary, StorageSummary } from '../utils/micRoute';

export const answerText = (t: TFunction, s: ProcessingSummary): string => {
    const answers: Record<LeavesPhone, string> = {
        no: t('settings.privacySummary.answerNo', 'No. Recordings stay on this phone.'),
        sync_only: s.storage === 'sync_e2ee'
            ? t('settings.privacySummary.answerSyncE2ee', 'Only as your sync copy, end-to-end encrypted.')
            : t('settings.privacySummary.answerSync', 'Only as your sync copy.'),
        for_text: s.speech === 'cloud_device_offline'
            ? t('settings.privacySummary.answerTextOnline', 'Yes, when online: the cloud turns speech into text.')
            : t('settings.privacySummary.answerText', 'Yes: the cloud turns speech into text.'),
    };
    return answers[s.audioLeaves];
};

const storageText = (t: TFunction, v: StorageSummary): string => ({
    device: t('settings.privacySummary.storageDevice', 'On this phone only'),
    sync_e2ee: t('settings.privacySummary.storageSyncE2ee', 'Synced, end-to-end encrypted'),
    sync: t('settings.privacySummary.storageSync', 'Synced to Vaulto cloud'),
}[v]);

const speechText = (t: TFunction, v: SpeechSummary): string => ({
    device_always: t('settings.privacySummary.speechDeviceAlways', 'On this phone, even online'),
    device_model_missing: t('settings.privacySummary.speechModelMissing', 'On this phone · speech model not downloaded, recordings wait'),
    device: t('settings.privacySummary.speechDevice', 'On this phone'),
    cloud_device_offline: t('settings.privacySummary.speechCloudFallback', 'Vaulto cloud · this phone when offline'),
    cloud: t('settings.privacySummary.speechCloud', 'Vaulto cloud · offline recordings wait for internet'),
    custom: t('settings.privacySummary.custom', 'Your AI service'),
}[v]);

const aiText = (t: TFunction, v: AISummary): string => ({
    device: t('settings.privacySummary.aiDevice', 'On this phone'),
    cloud_device_offline: t('settings.privacySummary.aiCloudFallback', 'Vaulto cloud, text only · this phone when offline'),
    cloud: t('settings.privacySummary.aiCloud', 'Vaulto cloud, text only'),
    device_needs_model: t('settings.privacySummary.aiNeedsModel', 'On this phone · AI model not downloaded'),
    sign_in: t('settings.privacySummary.aiSignIn', 'Off · sign in for cloud AI, or use AI on this phone'),
    custom: t('settings.privacySummary.custom', 'Your AI service'),
    none: t('settings.privacySummary.aiNone', 'Off'),
}[v]);

/**
 * The top of Voice & AI: one answer to "does my recording leave the phone?",
 * then where notes are stored, where speech becomes text and where AI runs.
 * Read from the same state the recording flow uses; refreshed on every change.
 */
export const ProcessingSummaryCard = ({
    signedIn,
    syncEnabled,
    e2ee,
    refreshKey,
    onChangeStorage,
}: {
    signedIn: boolean;
    syncEnabled: boolean;
    e2ee: boolean;
    /** Changes whenever a setting below changes. */
    refreshKey: string;
    /** Opens the sync controls; absent when there is nothing to change (guests). */
    onChangeStorage?: () => void;
}) => {
    const { t } = useTranslation();
    const focused = useIsFocused();
    const [summary, setSummary] = useState<ProcessingSummary | null>(null);

    useEffect(() => {
        if (!focused) return;
        let active = true;
        readProcessingSummary({ signedIn, syncEnabled, e2ee })
            .then((next) => { if (active) setSummary(next); })
            .catch(() => undefined);
        return () => { active = false; };
    }, [focused, signedIn, syncEnabled, e2ee, refreshKey]);

    // Labels show at once; values fill in without moving anything.
    const lines: { key: string; label: string; value: string; onPress?: () => void }[] = [
        {
            key: 'storage',
            label: t('settings.privacySummary.storage', 'Notes and recordings'),
            value: summary ? storageText(t, summary.storage) : ' ',
            onPress: onChangeStorage,
        },
        { key: 'speech', label: t('settings.privacySummary.speech', 'Speech to text'), value: summary ? speechText(t, summary.speech) : ' ' },
        { key: 'ai', label: t('settings.privacySummary.ai', 'AI actions and voice edits'), value: summary ? aiText(t, summary.ai) : ' ' },
    ];

    return (
        <View style={styles.card}>
            <View accessible accessibilityRole="header">
                <Text style={styles.question}>
                    {t('settings.privacySummary.title', 'Does my recording leave the phone?')}
                </Text>
            </View>
            {/* Same height while loading: the rows below never jump. */}
            <Text style={[styles.answer, !summary && styles.hidden]} accessibilityLiveRegion="polite">
                {summary ? answerText(t, summary) : ' '}
            </Text>
            <View style={styles.lines}>
                {lines.map((line) => {
                    const body = (
                        <>
                            <View style={styles.lineText}>
                                <Text style={styles.lineLabel}>{line.label}</Text>
                                <Text style={styles.lineValue}>{line.value}</Text>
                            </View>
                            {line.onPress && (
                                <Text style={styles.change}>{t('settings.privacySummary.change', 'Change')}</Text>
                            )}
                        </>
                    );
                    return line.onPress ? (
                        <TouchableOpacity
                            key={line.key}
                            style={styles.line}
                            onPress={line.onPress}
                            activeOpacity={0.6}
                            accessibilityRole="button"
                            accessibilityLabel={`${line.label}: ${line.value}`}
                            accessibilityHint={t('settings.privacySummary.changeStorageHint', 'Opens sync settings')}
                        >
                            {body}
                        </TouchableOpacity>
                    ) : (
                        <View key={line.key} style={styles.line} accessible accessibilityLabel={`${line.label}: ${line.value}`}>
                            {body}
                        </View>
                    );
                })}
            </View>
        </View>
    );
};

const styles = createStyles(() => ({
    card: {
        paddingHorizontal: spacing.m,
        paddingTop: 14,
        paddingBottom: spacing.s,
    },
    question: {
        fontSize: 16,
        lineHeight: 22,
        fontWeight: '600',
        color: colors.text,
    },
    answer: {
        marginTop: 2,
        fontSize: 15,
        lineHeight: 21,
        color: colors.text,
    },
    hidden: {
        opacity: 0,
    },
    lines: {
        marginTop: spacing.s,
    },
    line: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.m,
        minHeight: 44,
        paddingVertical: 6,
    },
    lineText: {
        flex: 1,
    },
    lineLabel: {
        fontSize: 13,
        lineHeight: 18,
        color: colors.textSecondary,
    },
    lineValue: {
        fontSize: 15,
        lineHeight: 21,
        color: colors.text,
    },
    change: {
        fontSize: 15,
        fontWeight: '500',
        color: colors.primary,
    },
}));
