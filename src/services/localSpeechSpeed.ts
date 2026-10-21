import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * How on-device transcription keeps up on this phone. A run is slow when the
 * wait is long and longer than the recording itself (the server answers in a
 * couple of seconds). One slow run can be a hot or busy phone, so the hint to
 * use the server needs two of the last three runs, and repeats at most every
 * two weeks.
 */

const SPEED_KEY = 'vaulto_local_speech_speed_v1';
const MIN_SLOW_WAIT_MS = 15000;
const SLOW_REALTIME_FACTOR = 1;
const RUN_WINDOW = 3;
const SLOW_RUNS_FOR_HINT = 2;
const HINT_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

export type SpeedHistory = { runs: boolean[]; hintShownAt: number };

const EMPTY: SpeedHistory = { runs: [], hintShownAt: 0 };

export const isSlowRun = (elapsedMs: number, audioMs: number): boolean =>
    elapsedMs >= MIN_SLOW_WAIT_MS && elapsedMs >= audioMs * SLOW_REALTIME_FACTOR;

export const addRun = (history: SpeedHistory, slow: boolean): SpeedHistory => ({
    ...history,
    runs: [...history.runs, slow].slice(-RUN_WINDOW),
});

export const isHintDue = (history: SpeedHistory, now: number): boolean =>
    history.runs.filter(Boolean).length >= SLOW_RUNS_FOR_HINT && now - history.hintShownAt >= HINT_COOLDOWN_MS;

const read = async (): Promise<SpeedHistory> => {
    try {
        const parsed = JSON.parse((await AsyncStorage.getItem(SPEED_KEY)) || 'null');
        return Array.isArray(parsed?.runs)
            ? { runs: parsed.runs.map(Boolean).slice(-RUN_WINDOW), hintShownAt: Number(parsed.hintShownAt) || 0 }
            : EMPTY;
    } catch {
        return EMPTY;
    }
};

const write = async (history: SpeedHistory): Promise<void> => {
    await AsyncStorage.setItem(SPEED_KEY, JSON.stringify(history)).catch(() => undefined);
};

/** Called after every on-device transcription with a known recording length. */
export const recordLocalTranscription = async (elapsedMs: number, audioMs: number): Promise<void> => {
    if (!(audioMs > 0)) return;
    await write(addRun(await read(), isSlowRun(elapsedMs, audioMs)));
};

/**
 * True once when on-device transcription has been slow; the hint is then
 * marked as shown and the history starts over.
 */
export const takeSlowTranscriptionHint = async (now = Date.now()): Promise<boolean> => {
    const history = await read();
    if (!isHintDue(history, now)) return false;
    await write({ runs: [], hintShownAt: now });
    return true;
};
