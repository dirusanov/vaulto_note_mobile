/**
 * Time left of a long task from how fast its progress has moved so far.
 * Pure, so tests can load it.
 */
export type ProgressSample = { at: number; progress: number };

/** Seconds left, or null while there is not enough to go on. Progress is 0..100. */
export const estimateSecondsLeft = (
    first: ProgressSample | null,
    latest: ProgressSample | null,
    { minElapsedMs = 2500, minProgress = 1 }: { minElapsedMs?: number; minProgress?: number } = {},
): number | null => {
    if (!first || !latest) return null;
    const elapsed = latest.at - first.at;
    const moved = latest.progress - first.progress;
    if (elapsed < minElapsedMs || moved < minProgress) return null;
    const left = Math.max(0, 100 - latest.progress);
    return Math.ceil((elapsed / moved) * left / 1000);
};

export type TimeLeft =
    | { unit: 'almost' }
    | { unit: 'seconds'; value: number }
    | { unit: 'minutes'; value: number };

/** A calm, rounded figure: "a few seconds", "about 40 s", "about 3 min". */
export const roundTimeLeft = (seconds: number): TimeLeft => {
    if (seconds <= 5) return { unit: 'almost' };
    if (seconds < 60) return { unit: 'seconds', value: Math.max(10, Math.ceil(seconds / 10) * 10) };
    return { unit: 'minutes', value: Math.ceil(seconds / 60) };
};
