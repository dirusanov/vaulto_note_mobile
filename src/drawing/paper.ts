// Paper of a drawing: the pattern and the sheet colour. The same geometry is
// drawn by the canvas (Skia) and by the SVG preview in the note, so the lines
// you wrote on are exactly where the note shows them.

export type PaperPattern = 'blank' | 'dots' | 'grid' | 'smallGrid' | 'lines' | 'wideLines' | 'margin';

export const PAPER_PATTERNS: PaperPattern[] = ['blank', 'dots', 'grid', 'smallGrid', 'lines', 'wideLines', 'margin'];

/** `null` is the app's own paper: it follows the theme and inverts with it. */
export const PAPER_COLORS: (string | null)[] = [null, '#FFFFFF', '#FFF8E7', '#F1F3F5', '#EAF6EC', '#E8F1FB', '#2B2F36'];

/**
 * `pages`: sheets of a fixed size one under another, like a notebook; a blank
 * page always follows the last one written on. `canvas`: an unbounded sheet
 * that pans in every direction, for sketches and diagrams.
 */
export type PaperLayout = 'pages' | 'canvas';

export const PAPER_LAYOUTS: PaperLayout[] = ['pages', 'canvas'];

export type PaperStyle = {
    pattern: PaperPattern;
    color: string | null;
    layout: PaperLayout;
};

export const DEFAULT_PAPER: PaperStyle = { pattern: 'blank', color: null, layout: 'pages' };

/** Drawings saved before pages existed were one endless sheet: they open as a canvas. */
export const LEGACY_PAPER: PaperStyle = { pattern: 'blank', color: null, layout: 'canvas' };

/** A page has the proportions of A4 at the width the drawing was started on. */
export const PAGE_RATIO = Math.SQRT2;
export const PAGE_GAP = 24;

export const pageHeight = (width: number): number => Math.round(width * PAGE_RATIO);
/** Distance from the top of one page to the top of the next. */
export const pagePitch = (width: number): number => pageHeight(width) + PAGE_GAP;

/** Pages up to the last one with content, plus a blank one to go on writing. */
export const pageCountFor = (width: number, contentBottom: number | null): number => {
    if (contentBottom === null || contentBottom <= 0) {
        return 1;
    }
    return Math.floor(contentBottom / pagePitch(width)) + 2;
};

export const PAPER_MARGIN_X = 72;
export const PAPER_MARGIN_COLOR = '#E57373';

const STEP: Record<PaperPattern, number> = {
    blank: 0,
    dots: 24,
    grid: 32,
    smallGrid: 16,
    lines: 32,
    wideLines: 44,
    margin: 32,
};

export const paperStep = (pattern: PaperPattern): number => STEP[pattern] ?? 0;

export const isDarkPaper = (color: string | null): boolean => {
    if (!color) {
        return false;
    }
    const value = parseInt(color.replace('#', ''), 16) || 0;
    const luminance = 0.299 * ((value >> 16) & 255) + 0.587 * ((value >> 8) & 255) + 0.114 * (value & 255);
    return luminance < 110;
};

/** Pattern line colour on a sheet of the given colour (theme paper uses the theme's border colour). */
export const paperLineColor = (color: string | null, themeLineColor: string): string => {
    if (!color) {
        return themeLineColor;
    }
    return isDarkPaper(color) ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.12)';
};

export const paperDotRadius = 1.3;

/**
 * Line segments [x1, y1, x2, y2, ...] and dot centres [x, y, ...] of a pattern
 * in document coordinates. Lines sit in the middle of each step so the SVG
 * pattern tile (which clips at its edges) draws them at full width too.
 */
export const paperGeometry = (
    pattern: PaperPattern,
    width: number,
    height: number,
): { lines: number[]; dots: number[] } => {
    const step = paperStep(pattern);
    const lines: number[] = [];
    const dots: number[] = [];
    if (!step) {
        return { lines, dots };
    }
    if (pattern === 'dots') {
        for (let y = step / 2; y < height; y += step) {
            for (let x = step / 2; x < width; x += step) {
                dots.push(x, y);
            }
        }
        return { lines, dots };
    }
    for (let y = step / 2; y < height; y += step) {
        lines.push(0, y, width, y);
    }
    if (pattern === 'grid' || pattern === 'smallGrid') {
        for (let x = step / 2; x < width; x += step) {
            lines.push(x, 0, x, height);
        }
    }
    return { lines, dots };
};
