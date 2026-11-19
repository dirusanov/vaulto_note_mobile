/**
 * Pure timing and exit rules for the voice recorder, kept free of React Native
 * so they can be unit-tested (tests/recordingClock.test.cjs).
 */

/**
 * Counts only the time the microphone is actually recording: paused spans
 * are left out, so 5 s speech + 30 s pause + 5 s speech is 10 s.
 */
export class ActiveClock {
    private accumulatedMs = 0;
    private runningSince: number | null = null;

    start(now: number): void {
        this.accumulatedMs = 0;
        this.runningSince = now;
    }

    pause(now: number): void {
        if (this.runningSince === null) return;
        this.accumulatedMs += Math.max(0, now - this.runningSince);
        this.runningSince = null;
    }

    resume(now: number): void {
        if (this.runningSince !== null) return;
        this.runningSince = now;
    }

    reset(): void {
        this.accumulatedMs = 0;
        this.runningSince = null;
    }

    elapsedMs(now: number): number {
        const running = this.runningSince === null ? 0 : Math.max(0, now - this.runningSince);
        return this.accumulatedMs + running;
    }
}

/**
 * Length of one recorded file. The recorder's own count (which already skips
 * pauses on Android and iOS) is preferred; our pause-aware clock is the fallback.
 * A native value well above our clock would mean pauses were counted after all,
 * so the clock wins then.
 */
export const resolveRecordedMs = (nativeMs: number | null | undefined, trackedMs: number): number => {
    const tracked = Number.isFinite(trackedMs) && trackedMs > 0 ? trackedMs : 0;
    if (typeof nativeMs === 'number' && Number.isFinite(nativeMs) && nativeMs > 0) {
        if (tracked > 0 && nativeMs > tracked + 2000) return tracked;
        return nativeMs;
    }
    return tracked;
};

/** Whole seconds shown on the card and stored as audio_duration. */
export const msToStoredSeconds = (ms: number): number =>
    Number.isFinite(ms) && ms > 0 ? Math.round(ms / 1000) : 0;

/** Longer recordings ask before they are thrown away (bin tap or system Back). */
export const DISCARD_CONFIRM_AFTER_SECONDS = 5;

export type RecorderBackAction = 'close' | 'ask' | 'ignore';

/**
 * What Android Back / the back gesture does in the recorder panel. It must not
 * silently delete anything worth keeping: a recording past the confirm
 * threshold, or a meeting with finished parts, gets a continue/save/delete choice.
 */
export const recorderBackAction = (state: {
    isRecording: boolean;
    isStopping: boolean;
    durationSeconds: number;
    meetingSegments: number;
}): RecorderBackAction => {
    if (state.isStopping) return 'ignore';
    if (state.meetingSegments > 0) return 'ask';
    if (state.isRecording && state.durationSeconds >= DISCARD_CONFIRM_AFTER_SECONDS) return 'ask';
    return 'close';
};
