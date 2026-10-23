/**
 * Notes deleted from the list leave it at once and are moved to the trash only
 * when the Undo window closes. The pending batch lives here, outside any
 * component, so nothing tied to a screen's lifecycle (a remount on a theme
 * change, an effect cleanup re-running, a re-render) can commit it early:
 * only the timer, an explicit flush (app sent to the background) or a newer
 * delete ends it, and Undo cancels it whenever it is still pending.
 */

export type CommitDelete = (ids: string[]) => Promise<unknown> | unknown;

export interface PendingDeleteSnapshot {
    /** Ids the Undo bar offers to restore; null while no bar is shown. */
    undoableIds: string[] | null;
    /** Ids the list hides: waiting for the window to close or being moved to the trash. */
    hiddenIds: string[];
}

export interface PendingDeleteStore {
    /**
     * Starts (or extends) the Undo window for these ids. Ids already pending
     * are merged into the same batch, so a second tap on Delete never commits
     * the first one behind the user's back. Returns false when nothing new
     * was added.
     */
    schedule: (ids: string[], commit: CommitDelete) => boolean;
    /** Cancels the pending batch; true when there was one to cancel. */
    undo: () => boolean;
    /** Commits the pending batch now (the app is going to the background). */
    flush: () => void;
    getSnapshot: () => PendingDeleteSnapshot;
    subscribe: (listener: () => void) => () => void;
}

interface Options {
    /** How long the Undo bar is shown. */
    windowMs: number;
    /**
     * Undo still works for this long after the bar is gone, so a tap that
     * lands just as the window closes restores the notes instead of losing
     * the race against the timer.
     */
    graceMs?: number;
    onError?: (error: unknown) => void;
}

export const createPendingDeleteStore = ({ windowMs, graceMs = 600, onError }: Options): PendingDeleteStore => {
    let pending: string[] | null = null;
    let undoVisible = false;
    let commitFn: CommitDelete | null = null;
    let committing: string[] = [];
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    let commitTimer: ReturnType<typeof setTimeout> | null = null;
    let snapshot: PendingDeleteSnapshot = { undoableIds: null, hiddenIds: [] };
    const listeners = new Set<() => void>();

    const emit = () => {
        snapshot = {
            undoableIds: pending && undoVisible ? pending : null,
            hiddenIds: [...(pending ?? []), ...committing],
        };
        listeners.forEach((listener) => listener());
    };

    const clearTimers = () => {
        if (hideTimer) clearTimeout(hideTimer);
        if (commitTimer) clearTimeout(commitTimer);
        hideTimer = null;
        commitTimer = null;
    };

    const flush = () => {
        clearTimers();
        const ids = pending;
        const commit = commitFn;
        pending = null;
        undoVisible = false;
        commitFn = null;
        if (!ids || !commit) return;
        committing = [...committing, ...ids];
        emit();
        new Promise((resolve) => resolve(commit(ids)))
            .catch((error) => onError?.(error))
            .finally(() => {
                committing = committing.filter((id) => !ids.includes(id));
                emit();
            });
    };

    const schedule = (ids: string[], commit: CommitDelete) => {
        const fresh = ids.filter((id) => !pending?.includes(id) && !committing.includes(id));
        if (fresh.length === 0) return false;
        clearTimers();
        pending = [...(pending ?? []), ...fresh];
        commitFn = commit;
        undoVisible = true;
        hideTimer = setTimeout(() => {
            hideTimer = null;
            undoVisible = false;
            emit();
        }, windowMs);
        commitTimer = setTimeout(() => {
            commitTimer = null;
            flush();
        }, windowMs + graceMs);
        emit();
        return true;
    };

    const undo = () => {
        if (!pending) return false;
        clearTimers();
        pending = null;
        undoVisible = false;
        commitFn = null;
        emit();
        return true;
    };

    return {
        schedule,
        undo,
        flush,
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
    };
};
