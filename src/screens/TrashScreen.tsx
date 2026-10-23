import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, isDarkScheme } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { createStyles } from '../theme/createStyles';
import { useNotesContext } from '../contexts/NotesContext';
import { TRASH_RETENTION_DAYS, type TrashEntry } from '../services/DatabaseService';
import { richContentToPlainText } from '../utils/richContent';
import { stripStoredTitleMarkdown } from '../utils/markdownUtils';
import { haptics } from '../utils/haptics';
import { rtlFlip, textAlignFor } from '../i18n/direction';
import { UndoSnackbar } from '../components/UndoSnackbar';
import { appAlert } from '../components/AppAlert';

const DAY_MS = 24 * 60 * 60 * 1000;

const daysLeft = (deletedAt: string): number =>
    Math.max(0, TRASH_RETENTION_DAYS - Math.floor((Date.now() - new Date(deletedAt).getTime()) / DAY_MS));

const formatDuration = (seconds?: number | null): string => {
    if (!seconds || seconds <= 0) return '';
    const total = Math.round(seconds);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

export const TrashScreen = () => {
    const { t, i18n } = useTranslation();
    const navigation = useNavigation<NativeStackNavigationProp<any>>();
    const { listTrash, restoreFromTrash, deleteFromTrash } = useNotesContext();
    const [entries, setEntries] = useState<TrashEntry[] | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [restored, setRestored] = useState<{ id: string } | null>(null);

    const reload = useCallback(async () => {
        setEntries(await listTrash().catch(() => []));
    }, [listTrash]);

    useEffect(() => { void reload(); }, [reload]);

    useEffect(() => {
        if (!restored) return;
        const timer = setTimeout(() => setRestored(null), 5000);
        return () => clearTimeout(timer);
    }, [restored]);

    const handleRestore = async (entry: TrashEntry) => {
        setBusyId(entry.id);
        try {
            const id = await restoreFromTrash(entry.id);
            haptics.success();
            if (id) setRestored({ id });
            await reload();
        } finally {
            setBusyId(null);
        }
    };

    const handleDeleteForever = (entry: TrashEntry) => {
        appAlert(
            t('trash.deleteForeverTitle', 'Delete for good?'),
            t('trash.deleteForeverText', 'The note and its recordings will be erased. This cannot be undone.'),
            [
                { text: t('common.cancel', 'Cancel'), style: 'cancel' },
                {
                    text: t('common.delete', 'Delete'),
                    style: 'destructive',
                    onPress: async () => {
                        haptics.warning();
                        await deleteFromTrash([entry.id]);
                        await reload();
                    },
                },
            ],
        );
    };

    const handleEmpty = () => {
        appAlert(
            t('trash.emptyConfirmTitle', 'Empty the trash?'),
            t('trash.emptyConfirmText', 'All notes in the trash and their recordings will be erased. This cannot be undone.'),
            [
                { text: t('common.cancel', 'Cancel'), style: 'cancel' },
                {
                    text: t('trash.emptyAll', 'Empty trash'),
                    style: 'destructive',
                    onPress: async () => {
                        haptics.warning();
                        await deleteFromTrash();
                        await reload();
                    },
                },
            ],
        );
    };

    const renderEntry = (entry: TrashEntry) => {
        const title = stripStoredTitleMarkdown(entry.title || '').trim();
        const text = richContentToPlainText(entry.content || '').replace(/\s+/g, ' ').trim();
        const voice = !title && !text && (entry.recordings.length > 0 || !!entry.audio_file_path);
        const duration = formatDuration(entry.recordings[0]?.duration ?? entry.audio_duration);
        const deletedOn = new Date(entry.deleted_at).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' });
        const left = daysLeft(entry.deleted_at);
        return (
            <View key={entry.id} style={styles.card}>
                {voice ? (
                    <View style={styles.voiceRow}>
                        <MaterialIcons name="mic-none" size={18} color={colors.textSecondary} />
                        <Text style={styles.voiceLabel}>
                            {[t('notes.voiceRecording', 'Voice note'), duration].filter(Boolean).join(' · ')}
                        </Text>
                    </View>
                ) : (
                    <>
                        {!!title && <Text style={[styles.title, textAlignFor(title)]} numberOfLines={2}>{title}</Text>}
                        {!!text && <Text style={[styles.preview, textAlignFor(text)]} numberOfLines={3}>{text}</Text>}
                    </>
                )}
                <Text style={styles.meta}>
                    {t('trash.deletedOn', 'Deleted {{date}}', { date: deletedOn })}
                    {'  ·  '}
                    {t('trash.daysLeft', '{{count}} days left', { count: left })}
                </Text>
                <View style={styles.actions}>
                    <TouchableOpacity
                        style={styles.restoreButton}
                        onPress={() => { void handleRestore(entry); }}
                        disabled={busyId === entry.id}
                        accessibilityRole="button"
                    >
                        {busyId === entry.id ? (
                            <ActivityIndicator size="small" color={colors.textSecondary} />
                        ) : (
                            <>
                                <MaterialIcons name="restore" size={18} color={colors.text} />
                                <Text style={styles.restoreText}>{t('trash.restore', 'Restore')}</Text>
                            </>
                        )}
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={styles.deleteButton}
                        onPress={() => handleDeleteForever(entry)}
                        accessibilityRole="button"
                        accessibilityLabel={t('trash.deleteForever', 'Delete for good')}
                    >
                        <MaterialIcons name="delete-outline" size={22} color={colors.textTertiary} />
                    </TouchableOpacity>
                </View>
            </View>
        );
    };

    return (
        <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
            <View style={styles.topBar}>
                <TouchableOpacity
                    onPress={() => navigation.goBack()}
                    style={styles.backButton}
                    activeOpacity={0.6}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={t('a11y.back', 'Back')}
                >
                    <MaterialIcons name="arrow-back" size={24} color={colors.text} style={rtlFlip} />
                </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
                <View style={styles.heading}>
                    <Text style={styles.headerTitle} accessibilityRole="header">{t('trash.title', 'Trash')}</Text>
                    <Text style={styles.headerSubtitle}>
                        {t('trash.subtitle', 'Deleted notes are kept for {{days}} days, then erased.', { days: TRASH_RETENTION_DAYS })}
                    </Text>
                </View>
                {entries === null ? (
                    <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.textSecondary} />
                ) : entries.length === 0 ? (
                    <Text style={styles.emptyText}>{t('trash.empty', 'The trash is empty')}</Text>
                ) : (
                    <>
                        {entries.map(renderEntry)}
                        <TouchableOpacity style={styles.emptyAllButton} onPress={handleEmpty} accessibilityRole="button" activeOpacity={0.6}>
                            <Text style={styles.emptyAllText}>{t('trash.emptyAll', 'Empty trash')}</Text>
                        </TouchableOpacity>
                    </>
                )}
            </ScrollView>

            <UndoSnackbar
                message={restored ? t('trash.restored', 'Note restored') : null}
                actionLabel={t('trash.open', 'Open')}
                onUndo={() => {
                    const id = restored?.id;
                    setRestored(null);
                    if (id) navigation.navigate('NoteEdit', { noteId: id });
                }}
            />
        </SafeAreaView>
    );
};

const styles = createStyles(() => ({
    container: {
        flex: 1,
        backgroundColor: colors.background,
    },
    topBar: {
        width: '100%',
        maxWidth: 760,
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.xs,
        paddingTop: spacing.s,
        height: 52,
    },
    backButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    list: {
        width: '100%',
        maxWidth: 760,
        alignSelf: 'center',
        paddingHorizontal: spacing.m,
        paddingTop: spacing.xs,
        gap: spacing.s,
        paddingBottom: spacing.xxl * 2,
    },
    heading: {
        gap: spacing.xs,
        marginBottom: spacing.m,
    },
    headerTitle: {
        fontSize: 32,
        lineHeight: 38,
        fontWeight: '700',
        letterSpacing: -0.8,
        color: colors.text,
    },
    headerSubtitle: {
        fontSize: 15,
        lineHeight: 21,
        color: colors.textSecondary,
    },
    card: {
        paddingHorizontal: spacing.m,
        paddingTop: 14,
        paddingBottom: spacing.s,
        borderRadius: 14,
        backgroundColor: colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: isDarkScheme() ? colors.surface : colors.border,
        gap: 4,
    },
    title: {
        fontSize: 16,
        lineHeight: 21,
        fontWeight: '600',
        letterSpacing: -0.2,
        color: colors.text,
    },
    preview: {
        fontSize: 14,
        lineHeight: 20,
        color: colors.textSecondary,
    },
    voiceRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
    },
    voiceLabel: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.text,
        fontVariant: ['tabular-nums'],
    },
    meta: {
        fontSize: 12,
        color: colors.textTertiary,
        marginTop: 2,
    },
    actions: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: spacing.s,
    },
    restoreButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        minHeight: 36,
        paddingHorizontal: 14,
        borderRadius: 18,
        backgroundColor: colors.backgroundSecondary,
    },
    restoreText: {
        fontSize: 14,
        fontWeight: '500',
        color: colors.text,
    },
    deleteButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    emptyText: {
        fontSize: 16,
        lineHeight: 22,
        color: colors.textSecondary,
    },
    emptyAllButton: {
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 48,
        marginTop: spacing.s,
    },
    emptyAllText: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.error,
    },
}));
