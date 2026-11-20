import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Recordings the microphone heard (almost) only silence in, kept anyway by
 * the user. Only the phone that recorded knows (from the live level meter),
 * so this is a local list of file names, not note data: the note shows "No
 * speech in this recording" and a flat waveform instead of a page that looks
 * as if text were still coming.
 */
const KEY = 'vaulto_silent_recordings_v1';
/** Old entries fall off; a deleted recording's name is never reused. */
const MAX_ENTRIES = 200;

const fileName = (path: string | null | undefined): string => (path || '').split('/').pop() || '';

const read = async (): Promise<string[]> => {
    try {
        const raw = await AsyncStorage.getItem(KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
        return [];
    }
};

export const markRecordingSilent = async (path: string): Promise<void> => {
    const name = fileName(path);
    if (!name) return;
    const names = await read();
    if (names.includes(name)) return;
    try {
        await AsyncStorage.setItem(KEY, JSON.stringify([...names, name].slice(-MAX_ENTRIES)));
    } catch {
        // Only an explanation is lost; the recording itself is saved.
    }
};

export const forgetSilentRecording = async (path: string): Promise<void> => {
    const name = fileName(path);
    const names = await read();
    if (!names.includes(name)) return;
    try {
        await AsyncStorage.setItem(KEY, JSON.stringify(names.filter((item) => item !== name)));
    } catch {
        // Harmless: the name is not reused.
    }
};

/** Which of `paths` were kept although nothing was heard. */
export const silentRecordingPaths = async (paths: string[]): Promise<Set<string>> => {
    if (paths.length === 0) return new Set();
    const names = new Set(await read());
    return new Set(paths.filter((path) => names.has(fileName(path))));
};
