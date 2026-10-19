import AsyncStorage from '@react-native-async-storage/async-storage';

export type PendingTranscription = { noteId: string; recordingId: string; variantId: string; micMode?: 'agent' | 'force_text'; segments?: string[]; segmentsEncrypted?: boolean };
const PREFIX = 'vaulto_pending_transcriptions_v1:';
// A reconnect and a new recording can update the same queue concurrently.
let writes: Promise<unknown> = Promise.resolve();
const serialized = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = writes.then(operation, operation);
    writes = result.catch(() => undefined);
    return result;
};
const read = async (userId: string): Promise<PendingTranscription[]> => {
    const raw = await AsyncStorage.getItem(PREFIX + userId);
    if (!raw) return [];
    const items: unknown = JSON.parse(raw);
    if (!Array.isArray(items)) throw new Error('Invalid pending transcription queue');
    return items.filter((item): item is PendingTranscription => !!item
        && typeof item.noteId === 'string' && typeof item.recordingId === 'string'
        && typeof item.variantId === 'string');
};

// Only identifiers are stored here; audio and transcript stay in encrypted storage.
export const enqueuePendingTranscription = (userId: string, job: PendingTranscription): Promise<void> => serialized(async () => {
    const items = await read(userId);
    const next = items.filter((item) => item.recordingId !== job.recordingId || item.noteId !== job.noteId);
    await AsyncStorage.setItem(PREFIX + userId, JSON.stringify([...next, job]));
});

export const getPendingTranscriptions = (userId: string, noteId?: string): Promise<PendingTranscription[]> =>
    serialized(async () => (await read(userId)).filter((item) => noteId === undefined || item.noteId === noteId));

export const removePendingTranscription = (userId: string, noteId: string, recordingId: string): Promise<void> => serialized(async () => {
    const items = (await read(userId)).filter((item) => item.noteId !== noteId || item.recordingId !== recordingId);
    if (items.length) await AsyncStorage.setItem(PREFIX + userId, JSON.stringify(items));
    else await AsyncStorage.removeItem(PREFIX + userId);
});

export const clearPendingTranscriptions = (userId?: string): Promise<string[]> => serialized(async () => {
    const keys = userId ? [PREFIX + userId] : (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(PREFIX));
    const paths: string[] = [];
    for (const key of keys) {
        for (const job of await read(key.slice(PREFIX.length))) {
            if (job.segmentsEncrypted) paths.push(...(job.segments ?? []));
        }
        await AsyncStorage.removeItem(key);
    }
    return paths;
});

/** Called only alongside the explicit guest-note migration on sign-in. */
export const movePendingTranscriptions = (fromUserId: string, toUserId: string): Promise<void> => serialized(async () => {
    if (fromUserId === toUserId) return;
    const source = await read(fromUserId);
    if (!source.length) return;
    const target = await read(toUserId);
    const ids = new Set(target.map((item) => JSON.stringify([item.noteId, item.recordingId])));
    await AsyncStorage.setItem(PREFIX + toUserId, JSON.stringify([...target, ...source.filter((item) => !ids.has(JSON.stringify([item.noteId, item.recordingId])))]));
    await AsyncStorage.removeItem(PREFIX + fromUserId);
});
