import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, Text, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import type { ExtractedTask } from '../utils/taskExtraction';
import { createStyles } from '../theme/createStyles';

export interface TaskSheetItem extends ExtractedTask {
    /** Already a checklist item in the note. */
    inNote: boolean;
}

interface TasksSheetProps {
    visible: boolean;
    loading: boolean;
    error: string | null;
    tasks: TaskSheetItem[];
    formatDue: (task: ExtractedTask) => string;
    onClose: () => void;
    onRetry: () => void;
    onAddToNote: (tasks: ExtractedTask[]) => void;
    onAddToCalendar: (task: ExtractedTask) => Promise<boolean>;
    /** Schedules a local notification; only offered for tasks with a date. */
    onRemind?: (task: ExtractedTask) => Promise<{ ok: boolean; message?: string }>;
}

/** Action items the AI found in the note: add them as a checklist or to the calendar. */
export const TasksSheet = ({
    visible, loading, error, tasks, formatDue, onClose, onRetry, onAddToNote, onAddToCalendar, onRemind,
}: TasksSheetProps) => {
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [scheduled, setScheduled] = useState<Set<string>>(new Set());
    const [reminded, setReminded] = useState<Set<string>>(new Set());
    // Feedback shown inside the sheet: the editor's toast is hidden behind it.
    const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

    useEffect(() => {
        setSelected(new Set(tasks.filter((task) => !task.inNote).map((task) => task.id)));
        setScheduled(new Set());
        setReminded(new Set());
        setNotice(null);
    }, [tasks]);

    useEffect(() => {
        if (!notice) return;
        const timer = setTimeout(() => setNotice(null), 3500);
        return () => clearTimeout(timer);
    }, [notice]);

    const remind = async (task: ExtractedTask) => {
        if (!onRemind) return;
        const result = await onRemind(task);
        if (result.ok) setReminded((prev) => new Set(prev).add(task.id));
        if (result.message) setNotice({ text: result.message, ok: result.ok });
    };

    const toggle = (id: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const addToCalendar = async (task: ExtractedTask) => {
        if (await onAddToCalendar(task)) {
            setScheduled((prev) => new Set(prev).add(task.id));
        }
    };

    const chosen = tasks.filter((task) => selected.has(task.id));

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <TouchableWithoutFeedback onPress={onClose}>
                <View style={styles.overlay}>
                    <TouchableWithoutFeedback>
                        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.m) }]}>
                            <View style={styles.header}>
                                <Text style={styles.title}>{t('edit.tasks.title', 'Tasks in this note')}</Text>
                                <TouchableOpacity
                                    onPress={onClose}
                                    style={styles.closeButton}
                                    accessibilityRole="button"
                                    accessibilityLabel={t('a11y.close', 'Close')}
                                >
                                    <MaterialIcons name="close" size={22} color={colors.textSecondary} />
                                </TouchableOpacity>
                            </View>

                            {loading ? (
                                <View style={styles.center}>
                                    <ActivityIndicator color={colors.primary} />
                                    <Text style={styles.centerText}>{t('edit.tasks.finding', 'Looking for tasks…')}</Text>
                                </View>
                            ) : error ? (
                                <View style={styles.center}>
                                    <Text style={styles.centerText}>{error}</Text>
                                    <TouchableOpacity style={styles.secondaryButton} onPress={onRetry} accessibilityRole="button">
                                        <Text style={styles.secondaryButtonText}>{t('edit.tasks.retry', 'Try again')}</Text>
                                    </TouchableOpacity>
                                </View>
                            ) : tasks.length === 0 ? (
                                <View style={styles.center}>
                                    <MaterialIcons name="task-alt" size={32} color={colors.textTertiary} />
                                    <Text style={styles.centerText}>{t('edit.tasks.none', 'No tasks found in this note.')}</Text>
                                </View>
                            ) : (
                                <>
                                    <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: spacing.s }}>
                                        {tasks.map((task) => {
                                            const isSelected = selected.has(task.id);
                                            const isScheduled = scheduled.has(task.id);
                                            const due = task.date ? formatDue(task) : '';
                                            return (
                                                <View key={task.id} style={styles.row}>
                                                    <TouchableOpacity
                                                        style={styles.rowMain}
                                                        onPress={() => toggle(task.id)}
                                                        accessibilityRole="checkbox"
                                                        accessibilityState={{ checked: isSelected }}
                                                        accessibilityLabel={[task.title, due].filter(Boolean).join(', ')}
                                                    >
                                                        <MaterialIcons
                                                            name={isSelected ? 'check-box' : 'check-box-outline-blank'}
                                                            size={22}
                                                            color={isSelected ? colors.primary : colors.textTertiary}
                                                        />
                                                        <View style={styles.rowText}>
                                                            <Text style={styles.taskTitle}>{task.title}</Text>
                                                            {(due || task.inNote) ? (
                                                                <Text style={styles.taskMeta}>
                                                                    {[due, task.inNote ? t('edit.tasks.inNote', 'Already in the note') : '']
                                                                        .filter(Boolean)
                                                                        .join(' · ')}
                                                                </Text>
                                                            ) : null}
                                                        </View>
                                                    </TouchableOpacity>
                                                    {onRemind && task.date ? (
                                                        <TouchableOpacity
                                                            style={styles.calendarButton}
                                                            onPress={() => { void remind(task); }}
                                                            disabled={reminded.has(task.id)}
                                                            accessibilityRole="button"
                                                            accessibilityLabel={t('edit.tasks.remind', 'Remind me')}
                                                        >
                                                            <MaterialIcons
                                                                name={reminded.has(task.id) ? 'notifications-active' : 'notifications-none'}
                                                                size={22}
                                                                color={reminded.has(task.id) ? colors.success : colors.primary}
                                                            />
                                                        </TouchableOpacity>
                                                    ) : null}
                                                    <TouchableOpacity
                                                        style={styles.calendarButton}
                                                        onPress={() => { void addToCalendar(task); }}
                                                        accessibilityRole="button"
                                                        accessibilityLabel={t('edit.tasks.addToCalendar', 'Add to calendar')}
                                                    >
                                                        <MaterialIcons
                                                            name={isScheduled ? 'event-available' : 'event'}
                                                            size={22}
                                                            color={isScheduled ? colors.success : colors.primary}
                                                        />
                                                    </TouchableOpacity>
                                                </View>
                                            );
                                        })}
                                    </ScrollView>
                                    <TouchableOpacity
                                        style={[styles.primaryButton, chosen.length === 0 && styles.primaryButtonDisabled]}
                                        disabled={chosen.length === 0}
                                        onPress={() => onAddToNote(chosen)}
                                        accessibilityRole="button"
                                    >
                                        <MaterialIcons name="playlist-add-check" size={20} color={colors.onPrimary} />
                                        <Text style={styles.primaryButtonText}>
                                            {t('edit.tasks.addToNote', 'Add to note as checklist ({{count}})', { count: chosen.length })}
                                        </Text>
                                    </TouchableOpacity>
                                    {notice ? (
                                        <View style={styles.noticeRow} accessibilityLiveRegion="polite">
                                            <MaterialIcons
                                                name={notice.ok ? 'notifications-active' : 'info-outline'}
                                                size={16}
                                                color={notice.ok ? colors.success : colors.warning}
                                            />
                                            <Text style={[styles.noticeText, { color: notice.ok ? colors.success : colors.warning }]}>
                                                {notice.text}
                                            </Text>
                                        </View>
                                    ) : (
                                    <Text style={styles.hint}>
                                        {onRemind
                                            ? t('edit.tasks.remindHint', 'The bell sets a reminder on this phone; the calendar button adds the task to your calendar.')
                                            : t('edit.tasks.calendarHint', 'The calendar button opens your calendar app, where you can set a reminder.')}
                                    </Text>
                                    )}
                                </>
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
        width: '100%',
        maxWidth: 640,
        alignSelf: 'center',
        borderTopRightRadius: 20,
        paddingTop: spacing.m,
        maxHeight: '80%',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.m,
        marginBottom: spacing.s,
    },
    title: {
        fontSize: 18,
        fontWeight: '700',
        color: colors.text,
    },
    center: {
        alignItems: 'center',
        paddingVertical: spacing.xl,
        paddingHorizontal: spacing.m,
        gap: spacing.s,
    },
    centerText: {
        fontSize: 15,
        color: colors.textSecondary,
        textAlign: 'center',
    },
    list: {
        paddingHorizontal: spacing.s,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 12,
        minHeight: 56,
        paddingVertical: spacing.xs,
        paddingHorizontal: spacing.s,
    },
    rowMain: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.s,
    },
    rowText: {
        flex: 1,
    },
    taskTitle: {
        fontSize: 16,
        color: colors.text,
    },
    taskMeta: {
        marginTop: 2,
        fontSize: 13,
        color: colors.textSecondary,
    },
    noticeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        marginTop: spacing.s,
        minHeight: 34,
    },
    noticeText: {
        fontSize: 13,
        fontWeight: '600',
        textAlign: 'center',
        flexShrink: 1,
    },
    calendarButton: {
        width: 48,
        height: 48,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: -spacing.s,
    },
    closeButton: {
        width: 48,
        height: 48,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: -12,
    },
    primaryButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        marginHorizontal: spacing.m,
        marginTop: spacing.s,
        paddingVertical: 14,
        borderRadius: 14,
        backgroundColor: colors.primary,
    },
    primaryButtonDisabled: {
        opacity: 0.4,
    },
    primaryButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.onPrimary,
    },
    secondaryButton: {
        paddingVertical: 10,
        paddingHorizontal: spacing.l,
        borderRadius: 12,
        backgroundColor: colors.primaryLight,
    },
    secondaryButtonText: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.primary,
    },
    hint: {
        marginTop: spacing.s,
        marginHorizontal: spacing.m,
        fontSize: 12,
        color: colors.textTertiary,
        textAlign: 'center',
    },
}));
