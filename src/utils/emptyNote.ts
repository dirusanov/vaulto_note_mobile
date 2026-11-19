import { hasMeaningfulRichContent } from './richContent';

/**
 * Whether leaving the editor may delete the note as an empty draft. Only a note
 * with nothing in it at all: no title, no text in the Original, no recording,
 * and no text in any of its versions. An Original that is empty while a version
 * holds text (the user cleared the Original after an AI version, or the
 * version came from a recording since removed) is a real note; deleting it on
 * Back sent the version to the trash (UX audit 2026-11-19, P1).
 */
export const shouldAutoCleanEmptyNote = (note: {
    title: string;
    originalContent: string;
    hasAudio: boolean;
    /** Text of every version: the unsaved draft where there is one, else the stored text. */
    variantContents: ReadonlyArray<string | null | undefined>;
}): boolean => {
    if (note.hasAudio) return false;
    if ((note.title || '').trim()) return false;
    if (hasMeaningfulRichContent(note.originalContent || '')) return false;
    return !note.variantContents.some((content) => hasMeaningfulRichContent(content || ''));
};
