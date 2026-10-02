import { useEffect, useRef } from 'react';
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { navigationRef } from '../navigation/deepLinks';
import { Sound } from './audioPlayback';
import { haptics } from '../utils/haptics';

type SharedPayload =
    | { kind: 'text'; text: string; subject?: string | null }
    | { kind: 'audio'; path: string; mimeType?: string | null; name?: string | null };

const native = NativeModules.VaultoShareIntent as
    | { takePendingShare: () => Promise<SharedPayload | null> }
    | undefined;

/** Length of a shared audio file in seconds (0 when it cannot be read). */
const readDuration = async (uri: string): Promise<number> => {
    try {
        const { sound, status } = await Sound.createAsync({ uri });
        await sound.unloadAsync();
        return status.durationMillis ? Math.round(status.durationMillis / 1000) : 0;
    } catch {
        return 0;
    }
};

const SUBJECT_MAX = 100;

/**
 * "Share -> Vaulto": text from another app becomes a new note (its subject, if
 * any, the title); an audio file goes through the normal recording flow, so it
 * is transcribed and kept as a playable card.
 */
export const useShareIntake = (
    createNote: (data: { title?: string; content: string }) => Promise<{ id: string }>,
) => {
    const busyRef = useRef(false);

    useEffect(() => {
        if (Platform.OS !== 'android' || !native?.takePendingShare) return;

        const consume = async () => {
            if (busyRef.current) return;
            busyRef.current = true;
            try {
                const payload = await native.takePendingShare();
                if (!payload) return;
                // The navigator mounts a moment after the providers.
                for (let attempt = 0; attempt < 30 && !navigationRef.isReady(); attempt += 1) {
                    await new Promise((resolve) => setTimeout(resolve, 100));
                }
                if (payload.kind === 'text') {
                    const text = payload.text.trim();
                    const subject = (payload.subject || '').trim();
                    const title = subject && !text.startsWith(subject) ? subject.slice(0, SUBJECT_MAX) : undefined;
                    const note = await createNote({ title, content: text });
                    haptics.success();
                    (navigationRef.navigate as any)('NoteEdit', { noteId: note.id });
                } else if (payload.kind === 'audio') {
                    const duration = await readDuration(payload.path);
                    (navigationRef.navigate as any)('NoteEdit', {
                        initialRecording: { uri: payload.path, duration, mimeType: payload.mimeType || 'audio/m4a' },
                        initialTranscribe: true,
                    });
                }
            } catch (error) {
                console.warn('[ShareIntake] Could not import shared content', error);
            } finally {
                busyRef.current = false;
            }
        };

        void consume();
        const emitter = new NativeEventEmitter(NativeModules.VaultoShareIntent);
        const subscription = emitter.addListener('VaultoShareReceived', () => { void consume(); });
        return () => subscription.remove();
    }, [createNote]);
};
