import * as Haptics from 'expo-haptics';

// Short, consistent feedback for the moments that matter. Failures (no
// vibrator, haptics disabled in system settings) are ignored.
const run = (effect: () => Promise<void>) => {
    effect().catch(() => undefined);
};

export const haptics = {
    /** Picking an option: segmented controls, toggles, chips. */
    selection: () => run(() => Haptics.selectionAsync()),
    /** A light tap: opening a sheet, sending a message. */
    light: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
    /** A firm tap: recording starts or stops, long-press enters selection. */
    medium: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
    /** Something finished well: saved, copied, transcribed. */
    success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
    /** Destructive or failed: delete, error. */
    warning: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
};
