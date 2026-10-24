/**
 * Below this much room above the keyboard (a tablet or phone in landscape) the
 * three-row Aa panel would leave about one line of the note: it collapses
 * into a single scrolling row instead. A phone in portrait keeps ~580dp.
 */
export const COMPACT_PANEL_MAX_SPACE = 480;

export const shouldUseCompactPanel = (windowHeight: number, keyboardHeight: number): boolean =>
    windowHeight - Math.max(0, keyboardHeight) < COMPACT_PANEL_MAX_SPACE;
