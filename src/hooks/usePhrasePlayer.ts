import { useCallback, useEffect, useRef, useState } from 'react';
import { Sound, type PlaybackStatus } from '../services/audioPlayback';
import { AudioService } from '../services/AudioService';
import { playbackStartFor } from '../utils/phraseTiming';

/** A recording that phrases can point into. */
export interface PhraseAudio {
    id: string;
    /** Stored (usually encrypted) file; decrypted into a temporary copy to play. */
    path: string;
    duration?: number;
}

export interface PhrasePlayerState {
    recordingId: string | null;
    position: number;
    duration: number;
    isPlaying: boolean;
    isLoading: boolean;
    failed: boolean;
}

const IDLE: PhrasePlayerState = { recordingId: null, position: 0, duration: 0, isPlaying: false, isLoading: false, failed: false };
/** A phrase played on its own ends a moment after its last word. */
const PHRASE_TAIL_SECONDS = 0.45;

/**
 * Plays phrases of a note's recordings: start at a phrase, keep going (the
 * transcript follows along) or stop after it. One recording is loaded at a
 * time; its decrypted copy is deleted when another loads or `active` ends.
 */
export const usePhrasePlayer = (sources: PhraseAudio[], active: boolean) => {
    const [state, setState] = useState<PhrasePlayerState>(IDLE);
    const soundRef = useRef<Sound | null>(null);
    const loadedIdRef = useRef<string | null>(null);
    const ownedUriRef = useRef<string | null>(null);
    const stopAtRef = useRef<number | null>(null);
    const tokenRef = useRef(0);
    const sourcesRef = useRef(sources);
    sourcesRef.current = sources;

    const release = useCallback(async () => {
        const sound = soundRef.current;
        const owned = ownedUriRef.current;
        soundRef.current = null;
        loadedIdRef.current = null;
        ownedUriRef.current = null;
        stopAtRef.current = null;
        await sound?.unloadAsync().catch(() => undefined);
        if (owned) await AudioService.deleteAudioFile(owned).catch(() => undefined);
    }, []);

    const stop = useCallback(async () => {
        tokenRef.current += 1;
        setState(IDLE);
        await release();
    }, [release]);

    useEffect(() => {
        if (!active) void stop();
    }, [active, stop]);
    useEffect(() => () => { tokenRef.current += 1; void release(); }, [release]);

    const onStatus = useCallback((token: number) => (status: PlaybackStatus) => {
        if (token !== tokenRef.current || !status.isLoaded) return;
        const position = status.positionMillis / 1000;
        const stopAt = stopAtRef.current;
        if (stopAt !== null && status.isPlaying && position >= stopAt) {
            stopAtRef.current = null;
            void soundRef.current?.pauseAsync();
            setState((prev) => ({ ...prev, position, isPlaying: false }));
            return;
        }
        setState((prev) => ({
            ...prev,
            position: status.didJustFinish ? (status.durationMillis ?? status.positionMillis) / 1000 : position,
            duration: status.durationMillis ? status.durationMillis / 1000 : prev.duration,
            isPlaying: status.isPlaying && !status.didJustFinish,
        }));
    }, []);

    /**
     * Plays `recordingId` from just before `start`. With `phraseEnd` it stops
     * after that phrase (a task's source); without, it plays on.
     */
    const playFrom = useCallback(async (recordingId: string, start: number, phraseEnd?: number) => {
        const source = sourcesRef.current.find((item) => item.id === recordingId);
        if (!source) return;
        const from = playbackStartFor({ start });
        stopAtRef.current = typeof phraseEnd === 'number' ? phraseEnd + PHRASE_TAIL_SECONDS : null;
        if (loadedIdRef.current === recordingId && soundRef.current) {
            const sound = soundRef.current;
            setState((prev) => ({ ...prev, position: from, failed: false }));
            await sound.setPositionAsync(from * 1000);
            await sound.playAsync();
            return;
        }
        const token = ++tokenRef.current;
        const stopAt = stopAtRef.current;
        await release();
        stopAtRef.current = stopAt;
        setState({ ...IDLE, recordingId, position: from, duration: source.duration || 0, isLoading: true });
        try {
            const uri = await AudioService.readAudioFile(source.path, 'phrase');
            if (token !== tokenRef.current) {
                if (uri !== source.path) await AudioService.deleteAudioFile(uri).catch(() => undefined);
                return;
            }
            if (uri !== source.path) ownedUriRef.current = uri;
            const { sound, status } = await Sound.createAsync({ uri }, { progressUpdateIntervalMillis: 120 }, onStatus(token));
            if (token !== tokenRef.current) {
                await sound.unloadAsync();
                return;
            }
            soundRef.current = sound;
            loadedIdRef.current = recordingId;
            await sound.setPositionAsync(from * 1000);
            await sound.playAsync();
            setState((prev) => ({
                ...prev,
                isLoading: false,
                isPlaying: true,
                duration: status.durationMillis ? status.durationMillis / 1000 : prev.duration,
            }));
        } catch (error) {
            console.warn('[usePhrasePlayer] Could not play phrase', error);
            if (token === tokenRef.current) setState({ ...IDLE, recordingId, failed: true });
            await release();
        }
    }, [onStatus, release]);

    /** Pause, or resume where it stopped (from the start after the end). */
    const toggle = useCallback(async () => {
        const sound = soundRef.current;
        if (!sound) return;
        if (state.isPlaying) {
            await sound.pauseAsync();
            setState((prev) => ({ ...prev, isPlaying: false }));
            return;
        }
        stopAtRef.current = null;
        if (state.duration > 0 && state.position >= state.duration - 0.25) await sound.setPositionAsync(0);
        await sound.playAsync();
    }, [state.duration, state.isPlaying, state.position]);

    return { state, playFrom, toggle, stop };
};
