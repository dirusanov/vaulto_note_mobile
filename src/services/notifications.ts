import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from 'i18next';
import { handleDeepLink } from '../navigation/deepLinks';

const REMINDER_CHANNEL = 'reminders';
const DIGEST_CHANNEL = 'digest';
const DIGEST_ID_KEY = 'vaulto_digest_notification_id';
const DIGEST_ENABLED_KEY = 'vaulto_weekly_digest_enabled';
/** Reminders without a time ring at 9:00 on their day. */
const DEFAULT_REMINDER_HOUR = 9;

Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
    }),
});

let channelsReady = false;
const ensureChannels = async () => {
    if (channelsReady || Platform.OS !== 'android') return;
    await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL, {
        name: i18n.t('notify.remindersChannel', 'Task reminders'),
        importance: Notifications.AndroidImportance.HIGH,
    });
    await Notifications.setNotificationChannelAsync(DIGEST_CHANNEL, {
        name: i18n.t('notify.digestChannel', 'Weekly summary'),
        importance: Notifications.AndroidImportance.DEFAULT,
    });
    channelsReady = true;
};

/** Asks for permission only when the user turns something on. */
export const ensureNotificationPermission = async (): Promise<boolean> => {
    await ensureChannels();
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted;
};

/** When a task reminder fires: its date at its time, or 9:00 that day. */
export const reminderDateFor = (date: string, time?: string | null): Date | null => {
    const [year, month, day] = date.split('-').map(Number);
    if (!year || !month || !day) return null;
    const [hours, minutes] = (time || '').split(':').map(Number);
    const at = new Date(year, month - 1, day, Number.isFinite(hours) ? hours : DEFAULT_REMINDER_HOUR, Number.isFinite(minutes) ? minutes : 0, 0, 0);
    return Number.isNaN(at.getTime()) ? null : at;
};

export type ReminderResult = { id: string; at: Date } | { error: 'permission' | 'past' | 'invalid' };

export const scheduleTaskReminder = async (task: {
    title: string;
    date: string;
    time?: string | null;
    noteId?: string | null;
}): Promise<ReminderResult> => {
    const at = reminderDateFor(task.date, task.time);
    if (!at) return { error: 'invalid' };
    if (at.getTime() <= Date.now() + 30_000) return { error: 'past' };
    if (!(await ensureNotificationPermission())) return { error: 'permission' };
    const id = await Notifications.scheduleNotificationAsync({
        content: {
            title: task.title,
            body: i18n.t('notify.reminderBody', 'Reminder from your note'),
            data: { url: task.noteId ? `vaultonote://note/${encodeURIComponent(task.noteId)}` : 'vaultonote://home' },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: REMINDER_CHANNEL },
    });
    return { id, at };
};

export const isWeeklyDigestEnabled = async (): Promise<boolean> =>
    (await AsyncStorage.getItem(DIGEST_ENABLED_KEY).catch(() => null)) === 'true';

/**
 * Weekly summary: Sunday 18:00 a notification opens the notes chat with the
 * "what happened this week" question. Returns false if permission was refused.
 */
export const setWeeklyDigestEnabled = async (enabled: boolean): Promise<boolean> => {
    const previous = await AsyncStorage.getItem(DIGEST_ID_KEY).catch(() => null);
    if (previous) {
        await Notifications.cancelScheduledNotificationAsync(previous).catch(() => undefined);
        await AsyncStorage.removeItem(DIGEST_ID_KEY).catch(() => undefined);
    }
    if (!enabled) {
        await AsyncStorage.setItem(DIGEST_ENABLED_KEY, 'false').catch(() => undefined);
        return true;
    }
    if (!(await ensureNotificationPermission())) {
        await AsyncStorage.setItem(DIGEST_ENABLED_KEY, 'false').catch(() => undefined);
        return false;
    }
    const id = await Notifications.scheduleNotificationAsync({
        content: {
            title: i18n.t('digest.title', 'Your week in notes'),
            body: i18n.t('digest.body', 'A short summary of what you noted and what is still open.'),
            data: { url: 'vaultonote://digest' },
        },
        trigger: {
            type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
            weekday: 1, // Sunday
            hour: 18,
            minute: 0,
            channelId: DIGEST_CHANNEL,
        },
    });
    await AsyncStorage.multiSet([[DIGEST_ID_KEY, id], [DIGEST_ENABLED_KEY, 'true']]).catch(() => undefined);
    return true;
};

let lastHandledResponseId: string | null = null;
const routeResponse = (response: Notifications.NotificationResponse | null) => {
    if (!response) return;
    const id = response.notification.request.identifier + response.notification.date;
    if (id === lastHandledResponseId) return;
    lastHandledResponseId = id;
    const url = response.notification.request.content.data?.url;
    if (typeof url === 'string') handleDeepLink(url);
};

/** Opens the right screen when a reminder or the digest is tapped. */
export const useNotificationRouting = () => {
    useEffect(() => {
        void Notifications.getLastNotificationResponseAsync().then(routeResponse).catch(() => undefined);
        const subscription = Notifications.addNotificationResponseReceivedListener(routeResponse);
        return () => subscription.remove();
    }, []);
};
