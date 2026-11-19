/**
 * Undo/Redo steps of one note version (pure, so it can be unit tested).
 *
 * The editor may report back content the app has just loaded into it (a version
 * switch, an accepted AI version, the initial load, a voice insert) as HTML that
 * differs from the stored text only in form. That echo replaces the current step
 * instead of adding one Undo would "undo" without a visible change. It is
 * expected only once, right after such a load: treating any later change as a
 * possible echo swallowed formatting-only edits (underline, highlight, indent
 * are lost in the Markdown comparison) and Undo then jumped over many edits.
 */

export interface HistoryEntry {
    title: string;
    content: string;
}

export interface VariantHistory {
    history: HistoryEntry[];
    index: number;
}

export const HISTORY_LIMIT = 50;

/** How long after a load the editor's echo of it is still expected. */
export const HISTORY_ECHO_WINDOW_MS = 3000;

export const isHistoryEchoExpected = (expectedAt: number | undefined, now: number): boolean =>
    typeof expectedAt === 'number' && now - expectedAt >= 0 && now - expectedAt <= HISTORY_ECHO_WINDOW_MS;

const emptyHistory = (): VariantHistory => ({ history: [], index: -1 });

/** Adds a step after the current one (dropping any Redo tail). */
export const pushHistoryStep = (
    current: VariantHistory | undefined,
    entry: HistoryEntry,
    limit: number = HISTORY_LIMIT
): VariantHistory => {
    const base = current ?? emptyHistory();
    const history = base.history.slice(0, base.index + 1);
    history.push({ title: entry.title, content: entry.content });
    if (history.length > limit) {
        history.splice(0, history.length - limit);
    }
    return { history, index: history.length - 1 };
};

export type HistoryChangeKind = 'unchanged' | 'echo' | 'step';

/**
 * Records a change the editor (or the title field) reported.
 * - the same title and text as the current step: nothing to record;
 * - the expected echo of a load: replaces the current step;
 * - anything else: a new step.
 */
export const recordHistoryChange = (
    current: VariantHistory | undefined,
    entry: HistoryEntry,
    options: {
        echoExpected: boolean;
        isEcho: (previousContent: string, nextContent: string) => boolean;
        limit?: number;
    }
): { history: VariantHistory; kind: HistoryChangeKind } => {
    const base = current ?? emptyHistory();
    const currentEntry = base.index >= 0 ? base.history[base.index] : undefined;

    if (currentEntry && currentEntry.title === entry.title && currentEntry.content === entry.content) {
        return { history: base, kind: 'unchanged' };
    }

    // Identical text is not an echo: that is a title edit, a step of its own.
    if (
        options.echoExpected
        && currentEntry
        && currentEntry.content !== entry.content
        && options.isEcho(currentEntry.content, entry.content)
    ) {
        const history = [...base.history];
        history[base.index] = { title: entry.title, content: entry.content };
        return { history: { history, index: base.index }, kind: 'echo' };
    }

    return { history: pushHistoryStep(base, entry, options.limit), kind: 'step' };
};

/**
 * A version renamed by the user: every step gets the new name, so Undo/Redo
 * of its text no longer brings the old name back (and saves it).
 */
export const retitleHistory = (current: VariantHistory | undefined, title: string): VariantHistory | undefined =>
    current
        ? { history: current.history.map((entry) => ({ ...entry, title })), index: current.index }
        : current;

/**
 * Undo/Redo of a version the user comes back to. Its steps are kept for as
 * long as the editor is open, so the last edit of a version can still be
 * undone after reading another one. The steps are dropped (and the history
 * starts at what is shown) only when the shown text is not the step the
 * history stands at: then the text was changed elsewhere meanwhile, or the
 * steps were recorded before the text loaded, and Undo would restore the wrong thing.
 * `isSameDocument` tells the editor's rendering of a text from a real change.
 */
export const resumeHistoryOnSwitch = (
    current: VariantHistory | undefined,
    shown: HistoryEntry,
    isSameDocument: (stepContent: string, shownContent: string) => boolean
): VariantHistory => {
    const step = current && current.index >= 0 ? current.history[current.index] : undefined;
    if (!current || !step || !(step.content === shown.content || isSameDocument(step.content, shown.content))) {
        return { history: [{ title: shown.title, content: shown.content }], index: 0 };
    }
    const history = [...current.history];
    history[current.index] = { title: shown.title, content: shown.content };
    return { history, index: current.index };
};
