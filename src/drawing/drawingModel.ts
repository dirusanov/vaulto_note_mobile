import { InkStroke, InkText, strokeHit } from './ink';
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

export type DrawingAction =
    | { type: 'load'; content: DrawingContent }
    | { type: 'addStroke'; stroke: InkStroke }
    | { type: 'eraseAt'; x: number; y: number; radius: number; boxes: TextBox[] }
    | { type: 'eraseEnd' }
    | { type: 'addText'; text: InkText }
    | { type: 'updateText'; index: number; patch: Partial<InkText> }
    | { type: 'removeText'; index: number }
    | { type: 'setPaper'; paper: PaperStyle }
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

export const drawingReducer = (state: DrawingState, action: DrawingAction): DrawingState => {
    switch (action.type) {
        case 'load':
            return initialDrawingState(action.content);
        case 'addStroke':
            return commit(state, { ...state.content, strokes: [...state.content.strokes, action.stroke] });
        case 'eraseAt': {
            const { strokes, texts } = state.content;
            const keptStrokes = strokes.filter((stroke) => !strokeHit(stroke, action.x, action.y, action.radius));
            const keptTexts = texts.filter((item, index) => !textHit(item, action.boxes[index], action.x, action.y, action.radius));
            if (keptStrokes.length === strokes.length && keptTexts.length === texts.length) {
                return state;
            }
            const content = { ...state.content, strokes: keptStrokes, texts: keptTexts };
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
