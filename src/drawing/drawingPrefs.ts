import AsyncStorage from '@react-native-async-storage/async-storage';

// The drawing tools a person last used (pens, colours, sizes, paper, eraser),
// kept on the device so a new drawing starts with them, like a pen case that
// stays packed between sessions. Only preferences: no drawing content.
const PREFS_KEY = 'vaulto_drawing_prefs_v1';

export type StoredDrawingPrefs = Record<string, unknown>;

export const loadDrawingPrefs = async (): Promise<StoredDrawingPrefs | null> => {
    try {
        const raw = await AsyncStorage.getItem(PREFS_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
};

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Saves shortly after the last change, so a run of taps is one write. */
export const saveDrawingPrefs = (prefs: StoredDrawingPrefs): void => {
    if (saveTimer) {
        clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(() => {
        saveTimer = null;
        AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs)).catch(() => {});
    }, 400);
};
