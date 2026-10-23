/**
 * Enter in the note title moves the caret on to the text, but the editor
 * WebView takes focus asynchronously and the title keeps it until then. What is
 * typed into the title in that window belongs to the text.
 */

/** How long after Enter title typing still counts as typing into the text. */
export const TITLE_HANDOFF_WINDOW_MS = 2000;

/** A repeated submit this soon after Enter is the same key press reported twice. */
export const TITLE_HANDOFF_DUPLICATE_SUBMIT_MS = 250;

/**
 * Splits a title change made during the handoff into the characters that move
 * to the text. The title input keeps showing what was typed into it until it
 * re-renders, so a later change may still contain characters already moved:
 * only the new ones move (else "ab" typed after Enter arrived as "aab").
 * - `{ moved: '' }`: nothing new (the input reverting to the title);
 * - `null`: a real title edit (a deletion, an edit in the middle) that ends the handoff.
 */
export const splitTitleHandoffText = (
    titleAtEnter: string,
    alreadyMoved: string,
    nextTitle: string
): { moved: string } | null => {
    const shown = titleAtEnter + alreadyMoved;
    if (nextTitle === titleAtEnter || nextTitle === shown) {
        return { moved: '' };
    }
    if (alreadyMoved && nextTitle.length > shown.length && nextTitle.startsWith(shown)) {
        return { moved: nextTitle.slice(shown.length) };
    }
    // The input was reset to the title in between: all after it is new.
    if (nextTitle.length > titleAtEnter.length && nextTitle.startsWith(titleAtEnter)) {
        return { moved: nextTitle.slice(titleAtEnter.length) };
    }
    return null;
};
