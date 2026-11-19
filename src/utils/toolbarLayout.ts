/**
 * Below this much room above the keyboard (a tablet or phone in landscape) the
 * three-row Aa panel would leave about one line of the note: it collapses
 * into a single scrolling row instead. A phone in portrait keeps ~580dp.
 */
export const COMPACT_PANEL_MAX_SPACE = 480;

export const shouldUseCompactPanel = (windowHeight: number, keyboardHeight: number): boolean =>
    windowHeight - Math.max(0, keyboardHeight) < COMPACT_PANEL_MAX_SPACE;

/** Editor header: 48dp icon targets, 16dp screen gutters the edge icons overhang by 12dp. */
const HEADER_ICON = 48;
const HEADER_GUTTER = 16;
const HEADER_OVERHANG = 12;
/** Phones narrower than this move the occasional header actions into the ⋮ menu. */
export const HEADER_COMPACT_MAX_WIDTH = 480;
/** The Improve label stops growing here so the header stays one row at 200% text. */
export const IMPROVE_LABEL_MAX_FONT_SCALE = 1.3;
const IMPROVE_LABEL_FONT = 14;
/** Pill padding (12 + 12), icon (18) and gap (6). */
const IMPROVE_PILL_CHROME = 48;

/** Rough rendered width of a short label: wide for CJK, narrower for Latin/Cyrillic. */
export const estimateLabelWidth = (label: string, fontSize: number): number => {
    let width = 0;
    for (const char of label) {
        if (/[⺀-鿿가-힯豈-﫿぀-ヿ]/.test(char)) width += fontSize;
        else if (/\s/.test(char)) width += fontSize * 0.3;
        else width += fontSize * 0.62;
    }
    return Math.ceil(width);
};

export interface EditorHeaderLayout {
    /** Recordings list and Draw live in the ⋮ menu instead of the header. */
    secondaryInMenu: boolean;
    /** Improve shows its word next to the sparkle, not the sparkle alone. */
    labelImprove: boolean;
}

/**
 * Header actions keep fixed places: Back on the left; from the right edge ⋮
 * (or ✓ while typing), Improve, Aa, then Undo/Redo when there is history. The
 * layout depends only on the window and text size, never on state, so nothing
 * jumps when Undo appears or a recording is added. The Improve label is shown
 * only if it fits next to every icon that can appear at that width.
 */
export const editorHeaderLayout = (
    windowWidth: number,
    fontScale: number,
    improveLabel: string,
): EditorHeaderLayout => {
    const secondaryInMenu = windowWidth < HEADER_COMPACT_MAX_WIDTH;
    // Back, Undo, Redo, Aa, ⋮ — plus Recordings and Draw on wide screens.
    const icons = secondaryInMenu ? 5 : 7;
    const available = windowWidth - 2 * HEADER_GUTTER + 2 * HEADER_OVERHANG;
    const scale = Math.min(Math.max(fontScale || 1, 1), IMPROVE_LABEL_MAX_FONT_SCALE);
    const pill = IMPROVE_PILL_CHROME + estimateLabelWidth(improveLabel.trim(), IMPROVE_LABEL_FONT * scale);
    const labelImprove = improveLabel.trim().length > 0 && icons * HEADER_ICON + pill <= available;
    return { secondaryInMenu, labelImprove };
};
