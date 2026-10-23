import { InkStroke, InkText, eraseStroke, strokeHit } from './ink';
import { DEFAULT_PAPER, PaperStyle } from './paper';

// The editable content of a drawing and its undo history, as a pure reducer.
// The canvas and the editor only dispatch actions; every rule about what an
// edit does (and what one undo step is) lives here and is unit-tested.

export type DrawingContent = {
    strokes: InkStroke[];
    texts: InkText[];
    paper: PaperStyle;
};

export type DrawingState = {
    content: DrawingContent;
    undo: DrawingContent[];
    redo: DrawingContent[];
    /** Content before the eraser drag in progress, so one drag is one undo step. */
    eraseStart: DrawingContent | null;
};

/** Measured size of a label, needed to erase it (text width depends on the font). */
export type TextBox = { width: number; height: number };

/** The eraser rubs out the ink under it, or takes whole strokes it touches. */
export type EraseMode = 'partial' | 'stroke';

/** Strokes and labels picked with the lasso, by index. */
export type Selection = { strokes: number[]; texts: number[] };

export const EMPTY_SELECTION: Selection = { strokes: [], texts: [] };

const pointInPolygon = (x: number, y: number, polygon: number[]): boolean => {
    let inside = false;
    for (let i = 0, j = polygon.length - 2; i < polygon.length; j = i, i += 2) {
        const [xi, yi, xj, yj] = [polygon[i], polygon[i + 1], polygon[j], polygon[j + 1]];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
            inside = !inside;
        }
    }
    return inside;
};

/**
 * What a lasso loop [x, y, ...] encloses: strokes with most of their samples
 * inside (a stroke only grazed by the loop stays out) and labels whose centre is.
 */
export const selectInLasso = (content: DrawingContent, boxes: TextBox[], polygon: number[]): Selection => {
    if (polygon.length < 6) {
        return EMPTY_SELECTION;
    }
    const strokes: number[] = [];
    content.strokes.forEach((stroke, index) => {
        const pts = stroke.points;
        let inside = 0;
        let total = 0;
        for (let i = 0; i + 1 < pts.length; i += 3) {
            total += 1;
            if (pointInPolygon(pts[i], pts[i + 1], polygon)) {
                inside += 1;
            }
        }
        if (total > 0 && inside / total > 0.5) {
            strokes.push(index);
        }
    });
    const texts: number[] = [];
    content.texts.forEach((item, index) => {
        const box = boxes[index] || { width: 0, height: 0 };
        if (pointInPolygon(item.x + box.width / 2, item.y + box.height / 2, polygon)) {
            texts.push(index);
        }
    });
    return { strokes, texts };
};

export type DrawingAction =
    | { type: 'load'; content: DrawingContent }
    /** Brings back a whole editing session, history included (after the app's tree is remounted). */
    | { type: 'restore'; state: DrawingState }
    | { type: 'addStroke'; stroke: InkStroke }
        /** `path`: further eraser centres [x, y, ...] of the same pass, so a fast move leaves no gaps. */
    | { type: 'eraseAt'; x: number; y: number; path?: number[]; radius: number; boxes: TextBox[]; mode?: EraseMode }
    | { type: 'eraseEnd' }
    | { type: 'addText'; text: InkText }
    | { type: 'updateText'; index: number; patch: Partial<InkText> }
    | { type: 'removeText'; index: number }
    | { type: 'setPaper'; paper: PaperStyle }
    /** Moves the selected strokes and labels by (dx, dy). */
    | { type: 'moveSelection'; selection: Selection; dx: number; dy: number }
    | { type: 'deleteSelection'; selection: Selection }
    /** Copies the selection, offset by (dx, dy), to the top; the copies are the last items. */
    | { type: 'duplicateSelection'; selection: Selection; dx: number; dy: number }
    | { type: 'recolorSelection'; selection: Selection; color: string }
    | { type: 'undo' }
    | { type: 'redo' };

const HISTORY_LIMIT = 100;

export const emptyContent = (paper: PaperStyle = DEFAULT_PAPER): DrawingContent => ({ strokes: [], texts: [], paper });

export const initialDrawingState = (content: DrawingContent = emptyContent()): DrawingState => ({
    content,
    undo: [],
    redo: [],
    eraseStart: null,
});

const commit = (state: DrawingState, content: DrawingContent): DrawingState => ({
    content,
    undo: [...state.undo.slice(-(HISTORY_LIMIT - 1)), state.content],
    redo: [],
    eraseStart: null,
});

const textHit = (item: InkText, box: TextBox | undefined, x: number, y: number, radius: number): boolean => {
    if (!box) {
        return false;
    }
    return x >= item.x - radius && x <= item.x + box.width + radius
        && y >= item.y - radius && y <= item.y + box.height + radius;
};

const shiftStroke = (stroke: InkStroke, dx: number, dy: number): InkStroke => {
    const points = stroke.points.slice();
    for (let i = 0; i + 1 < points.length; i += 3) {
        points[i] += dx;
        points[i + 1] += dy;
    }
    return { ...stroke, points };
};

export const drawingReducer = (state: DrawingState, action: DrawingAction): DrawingState => {
    switch (action.type) {
        case 'load':
            return initialDrawingState(action.content);
        case 'restore':
            return { ...action.state, eraseStart: null };
        case 'addStroke':
            return commit(state, { ...state.content, strokes: [...state.content.strokes, action.stroke] });
        case 'eraseAt': {
            const { strokes, texts } = state.content;
            const centres = [action.x, action.y, ...(action.path || [])];
            let strokesChanged = false;
            let keptStrokes = strokes;
            for (let c = 0; c + 1 < centres.length; c += 2) {
                const [x, y] = [centres[c], centres[c + 1]];
                keptStrokes = action.mode === 'stroke'
                    ? keptStrokes.filter((stroke) => !strokeHit(stroke, x, y, action.radius))
                    : keptStrokes.flatMap((stroke) => {
                        // Untouched strokes stay the same objects: their cached paths are reused.
                        const pieces = eraseStroke(stroke, x, y, action.radius);
                        if (!pieces) {
                            return [stroke];
                        }
                        strokesChanged = true;
                        return pieces;
                    });
            }
            strokesChanged = strokesChanged || keptStrokes.length !== strokes.length;
            // A label is one piece: rubbing out part of it takes the eraser over it,
            // not just its edge brushing the box.
            const textReach = action.mode === 'stroke' ? action.radius : 0;
            const keptTexts = texts.filter((item, index) => {
                for (let c = 0; c + 1 < centres.length; c += 2) {
                    if (textHit(item, action.boxes[index], centres[c], centres[c + 1], textReach)) {
                        return false;
                    }
                }
                return true;
            });
            if (!strokesChanged && keptTexts.length === texts.length) {
                return state;
            }
            const content = { ...state.content, strokes: strokesChanged ? keptStrokes : strokes, texts: keptTexts.length === texts.length ? texts : keptTexts };
            if (state.eraseStart) {
                // Same drag: extend the step that is already on the undo stack.
                return { ...state, content };
            }
            return { ...commit(state, content), eraseStart: state.content };
        }
        case 'eraseEnd':
            return state.eraseStart ? { ...state, eraseStart: null } : state;
        case 'addText':
            if (!action.text.text.trim()) {
                return state;
            }
            return commit(state, { ...state.content, texts: [...state.content.texts, action.text] });
        case 'updateText': {
            const current = state.content.texts[action.index];
            if (!current) {
                return state;
            }
            const next = { ...current, ...action.patch };
            if (!next.text.trim()) {
                return drawingReducer(state, { type: 'removeText', index: action.index });
            }
            if (Object.keys(action.patch).every((key) => (current as any)[key] === (next as any)[key])) {
                return state;
            }
            const texts = state.content.texts.slice();
            texts[action.index] = next;
            return commit(state, { ...state.content, texts });
        }
        case 'removeText':
            if (!state.content.texts[action.index]) {
                return state;
            }
            return commit(state, {
                ...state.content,
                texts: state.content.texts.filter((_item, index) => index !== action.index),
            });
        case 'setPaper':
            const { pattern, color, layout } = state.content.paper;
            if (pattern === action.paper.pattern && color === action.paper.color && layout === action.paper.layout) {
                return state;
            }
            return commit(state, { ...state.content, paper: action.paper });
        case 'moveSelection': {
            const { selection, dx, dy } = action;
            if ((!dx && !dy) || (!selection.strokes.length && !selection.texts.length)) {
                return state;
            }
            const pickedStrokes = new Set(selection.strokes);
            const pickedTexts = new Set(selection.texts);
            return commit(state, {
                ...state.content,
                strokes: state.content.strokes.map((stroke, index) => (pickedStrokes.has(index) ? shiftStroke(stroke, dx, dy) : stroke)),
                texts: state.content.texts.map((item, index) => (pickedTexts.has(index) ? { ...item, x: item.x + dx, y: item.y + dy } : item)),
            });
        }
        case 'deleteSelection': {
            const pickedStrokes = new Set(action.selection.strokes);
            const pickedTexts = new Set(action.selection.texts);
            if (!pickedStrokes.size && !pickedTexts.size) {
                return state;
            }
            return commit(state, {
                ...state.content,
                strokes: state.content.strokes.filter((_stroke, index) => !pickedStrokes.has(index)),
                texts: state.content.texts.filter((_item, index) => !pickedTexts.has(index)),
            });
        }
        case 'duplicateSelection': {
            const { selection, dx, dy } = action;
            if (!selection.strokes.length && !selection.texts.length) {
                return state;
            }
            const { strokes, texts } = state.content;
            return commit(state, {
                ...state.content,
                strokes: [...strokes, ...selection.strokes.filter((index) => strokes[index]).map((index) => shiftStroke(strokes[index], dx, dy))],
                texts: [...texts, ...selection.texts.filter((index) => texts[index]).map((index) => ({ ...texts[index], x: texts[index].x + dx, y: texts[index].y + dy }))],
            });
        }
        case 'recolorSelection': {
            const pickedStrokes = new Set(action.selection.strokes);
            const pickedTexts = new Set(action.selection.texts);
            const { strokes, texts } = state.content;
            if (![...pickedStrokes].some((index) => strokes[index] && strokes[index].color !== action.color)
                && ![...pickedTexts].some((index) => texts[index] && texts[index].color !== action.color)) {
                return state;
            }
            return commit(state, {
                ...state.content,
                strokes: strokes.map((stroke, index) => (pickedStrokes.has(index) ? { ...stroke, color: action.color } : stroke)),
                texts: texts.map((item, index) => (pickedTexts.has(index) ? { ...item, color: action.color } : item)),
            });
        }
        case 'undo': {
            const previous = state.undo[state.undo.length - 1];
            if (!previous) {
                return state;
            }
            return { content: previous, undo: state.undo.slice(0, -1), redo: [...state.redo, state.content], eraseStart: null };
        }
        case 'redo': {
            const next = state.redo[state.redo.length - 1];
            if (!next) {
                return state;
            }
            return { content: next, undo: [...state.undo, state.content], redo: state.redo.slice(0, -1), eraseStart: null };
        }
        default:
            return state;
    }
};
