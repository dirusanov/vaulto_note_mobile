/**
 * A note none of this phone's keys can decrypt (for example, one sealed with a
 * device key that was wiped) is stored in the list with this placeholder in its
 * title and text. Sync recognises it and never uploads it. The screens show a
 * lock and "Locked note" instead of the raw word. Pure, so tests can load it.
 */
export const UNREADABLE_PLACEHOLDER = '[Encrypted]';

type NoteLike = {
    title?: string | null;
    content?: string | null;
    deleted?: boolean;
    pending_delete?: boolean;
    locked?: boolean;
};

export const isUnreadableNote = (note: NoteLike | null | undefined): boolean =>
    !!note && (note.title === UNREADABLE_PLACEHOLDER || note.content === UNREADABLE_PLACEHOLDER);

export type UnlockSummary = {
    /** Notes that can be read now. */
    readable: number;
    /** Notes that still cannot be opened with the keys on this phone. */
    unreadable: number;
};

/** What an unlock achieved, counted over the notes in the list. */
export const summarizeUnlock = (notes: NoteLike[]): UnlockSummary => {
    let readable = 0;
    let unreadable = 0;
    for (const note of notes) {
        if (note.deleted || note.pending_delete) continue;
        if (note.locked || isUnreadableNote(note)) unreadable += 1;
        else readable += 1;
    }
    return { readable, unreadable };
};
