/**
 * Screen-reader seeking for the audio player (VoiceOver/TalkBack swipe up/down
 * on an "adjustable" control). Pure, so it is unit-tested in tests/audioSeek.test.cjs.
 */

/** 10 s on longer recordings, 5 % (at least 1 s) on short ones. */
export const accessibleSeekStepSeconds = (durationSeconds: number): number => {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0;
    return Math.min(10, Math.max(1, durationSeconds * 0.05));
};

/** Where an increment (+1) or decrement (-1) lands, kept inside the recording. */
export const accessibleSeekTarget = (
    positionSeconds: number,
    durationSeconds: number,
    direction: 1 | -1,
): number => {
    const step = accessibleSeekStepSeconds(durationSeconds);
    if (step === 0) return 0;
    const from = Number.isFinite(positionSeconds) ? positionSeconds : 0;
    return Math.max(0, Math.min(durationSeconds, from + direction * step));
};

/** m:ss, the same clock the player shows. */
export const formatClock = (seconds: number): string => {
    const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
};
