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
