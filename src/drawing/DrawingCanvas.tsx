import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { AppState, LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import {
    Canvas,
    Circle,
    ColorMatrix,
    DashPathEffect,
    Fill,
    FilterMode,
    FractalNoise,
    Group,
    Paint,
    PaintStyle,
    Path,
    Picture,
    Skia,
    SkPaint,
    SkPath,
    SkPicture,
    Paragraph,
    Rect,
    TileMode,
} from '@shopify/react-native-skia';
import { Gesture, GestureDetector, PointerType } from 'react-native-gesture-handler';
import {
    cancelAnimation,
    runOnJS,
    runOnUI,
    useAnimatedReaction,
    useDerivedValue,
    useFrameCallback,
    useSharedValue,
    withDecay,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { ERASER_PRESSURE } from '../../modules/ink-input';
import { INK_TOOLS, InkStroke, InkText, InkTool, SMART_INVERT_MATRIX, pencilGrainMatrix, recognizeShape, strokeOutline, strokeOutlineFor } from './ink';
import { Selection, TextBox } from './drawingModel';
import { drawingBounds } from './drawingFormat';
import {
    PAGE_GAP,
    PAPER_MARGIN_COLOR,
    PAPER_MARGIN_X,
    PaperStyle,
    pageCountFor,
    pageHeight,
    pagePitch,
    paperDotRadius,
    paperLineColor,
    paperStep,
} from './paper';
import { LABEL_LAYOUT_WIDTH, paragraphFor } from './textLayout';

export type CanvasMode = 'ink' | 'erase' | 'text' | 'select';

/** Where a tap in text mode landed, in document and screen coordinates. */
export type TextTap = {
    x: number;
    y: number;
    /** Label under the finger, or -1 for empty paper. */
    index: number;
    screenX: number;
    screenY: number;
    /** Document → screen scale at the moment of the tap. */
    scale: number;
};

export type DrawingCanvasHandle = {
    /** Scrolls the page by `dy` screen pixels (negative = content up); returns the distance applied. */
    panBy: (dy: number) => number;
};

type Props = {
    /** Extra room to scroll past the content, e.g. the keyboard over a label being typed. */
    bottomInset: number;
    strokes: InkStroke[];
    texts: InkText[];
    textBoxes: TextBox[];
    paper: PaperStyle;
    /** Width of the drawing's coordinate space; 0 for a new drawing (see onMeasure). */
    docWidth: number;
    onMeasure: (canvasWidth: number) => void;
    mode: CanvasMode;
    tool: InkTool;
    color: string;
    size: number;
    /** Once a pen has touched the canvas, fingers scroll instead of drawing. */
    stylusOnly: boolean;
    /** Eraser radius in screen pixels. */
    eraserRadius: number;
    /** A stroke held still at its end becomes the clean shape it resembles. */
    snapShapes: boolean;
    /** Label being edited in the text field overlay; the canvas does not draw it. */
    editingText: number | null;
    dark: boolean;
    themePaperColor: string;
    themeLineColor: string;
    deskColor: string;
    onCommit: (stroke: InkStroke) => void;
    /** Eraser at (x, y), then along `path` [x, y, ...] (document coordinates). */
    onErase: (x: number, y: number, radius: number, path?: number[]) => void;
    /** Strokes and labels picked with the lasso: drawn on top, movable as one. */
    selection: Selection;
    /** A lasso loop was drawn: [x, y, ...] in document coordinates. */
    onLasso: (polygon: number[]) => void;
    /** The selection was dragged by (dx, dy) document units. */
    onSelectionMove: (dx: number, dy: number) => void;
    onEraseEnd: () => void;
    onTextTap: (tap: TextTap) => void;
    onTextMove: (index: number, dx: number, dy: number) => void;
    onStylus: () => void;
    onUndo: () => void;
    onRedo: () => void;
};

/** Zoom range relative to the fitted width: pages zoom out to an overview, a canvas much further. */
const PAGES_ZOOM = [0.5, 5];
const CANVAS_ZOOM = [0.15, 8];
/** Desk visible above the first page and below the last, in screen pixels. */
const PAGE_MARGIN = 12;
/** How far a canvas extends; far beyond anything drawn by hand. */
const CANVAS_EXTENT = 1e6;
/** Screen distance the eraser moves between two erase passes: well under its smallest radius. */
const ERASE_STEP = 3;
/** Shortest interval over which finger speed (and so ink width) is measured. */
const SPEED_WINDOW_MS = 8;
/** How long the pen rests at the end of a stroke before it becomes a shape. */
const SHAPE_HOLD_MS = 550;
/** Screen distance the pen may wander while resting. */
const SHAPE_STILL_PX = 6;
/** Screen distance a text-mode touch must travel before it drags the label. */
const DRAG_SLOP = 6;

const outlineToSkPath = (outline: number[]): SkPath => {
    'worklet';
    const n = outline.length / 2;
    if (n < 3) {
        return Skia.Path.Make();
    }
    const path = Skia.PathBuilder.Make();
    const mx = (i: number) => (outline[(i % n) * 2] + outline[((i + 1) % n) * 2]) / 2;
    const my = (i: number) => (outline[(i % n) * 2 + 1] + outline[((i + 1) % n) * 2 + 1]) / 2;
    path.moveTo(mx(0), my(0));
    for (let i = 1; i <= n; i++) {
        path.quadTo(outline[(i % n) * 2], outline[(i % n) * 2 + 1], mx(i), my(i));
    }
    path.close();
    return path.build();
};

const pictureBounds = Skia.XYWHRect(-CANVAS_EXTENT, -CANVAS_EXTENT, CANVAS_EXTENT * 2, CANVAS_EXTENT * 2);

/** One cell of the paper pattern, repeated by a shader: any number of pages costs the same. */
const buildPatternTile = (paper: PaperStyle, lineColor: string, lineWidth: number): SkPicture | null => {
    const step = paperStep(paper.pattern);
    if (!step) {
        return null;
    }
    const recorder = Skia.PictureRecorder();
    const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, step, step));
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    paint.setColor(Skia.Color(lineColor));
    const half = step / 2;
    if (paper.pattern === 'dots') {
        canvas.drawCircle(half, half, paperDotRadius, paint);
    } else {
        paint.setStrokeWidth(lineWidth);
        canvas.drawLine(0, half, step, half, paint);
        if (paper.pattern === 'grid' || paper.pattern === 'smallGrid') {
            canvas.drawLine(half, 0, half, step, paint);
        }
    }
    return recorder.finishRecordingAsPicture();
};

const patternPaint = (tile: SkPicture, step: number, originY: number): SkPaint => {
    const paint = Skia.Paint();
    const matrix = Skia.Matrix();
    matrix.translate(0, originY);
    paint.setShader(tile.makeShader(TileMode.Repeat, TileMode.Repeat, FilterMode.Linear, matrix, Skia.XYWHRect(0, 0, step, step)));
    return paint;
};

type Sheet = { x: number; y: number; width: number; height: number };

/**
 * The paper as two pictures: the sheets (colour, page edges) and the pattern on
 * them, which fades out when zoomed so far out that it would only shimmer.
 */
const buildPaper = (
    paper: PaperStyle,
    sheets: Sheet[],
    sheetColor: string,
    lineColor: string,
    lineWidth: number,
): { sheet: SkPicture; pattern: SkPicture | null } => {
    const sheetRecorder = Skia.PictureRecorder();
    const sheetCanvas = sheetRecorder.beginRecording(pictureBounds);
    const fill = Skia.Paint();
    fill.setColor(Skia.Color(sheetColor));
    const edge = Skia.Paint();
    edge.setAntiAlias(true);
    edge.setColor(Skia.Color('rgba(0,0,0,0.10)'));
    edge.setStyle(PaintStyle.Stroke);
    edge.setStrokeWidth(lineWidth);
    sheets.forEach((rect) => {
        sheetCanvas.drawRect(Skia.XYWHRect(rect.x, rect.y, rect.width, rect.height), fill);
        if (sheets.length > 1 || rect.width < CANVAS_EXTENT) {
            sheetCanvas.drawRect(Skia.XYWHRect(rect.x, rect.y, rect.width, rect.height), edge);
        }
    });
    const sheet = sheetRecorder.finishRecordingAsPicture();

    const tile = buildPatternTile(paper, lineColor, lineWidth);
    if (!tile) {
        return { sheet, pattern: null };
    }
    const step = paperStep(paper.pattern);
    const patternRecorder = Skia.PictureRecorder();
    const patternCanvas = patternRecorder.beginRecording(pictureBounds);
    const margin = Skia.Paint();
    margin.setColor(Skia.Color(PAPER_MARGIN_COLOR));
    sheets.forEach((rect) => {
        // Each page starts its pattern at its own top edge, as printed paper does.
        patternCanvas.drawRect(Skia.XYWHRect(rect.x, rect.y, rect.width, rect.height), patternPaint(tile, step, rect.y));
        if (paper.pattern === 'margin') {
            patternCanvas.drawRect(Skia.XYWHRect(PAPER_MARGIN_X - lineWidth / 2, rect.y, lineWidth, rect.height), margin);
        }
    });
    return { sheet, pattern: patternRecorder.finishRecordingAsPicture() };
};

// Graphite texture: fractal noise mapped to the ink colour's alpha. The noise is
// in document space, so the grain stays put while you scroll or zoom.
const PencilGrain: React.FC<{ color: string }> = ({ color }) => (
    <>
        <FractalNoise freqX={0.9} freqY={0.9} octaves={2} seed={3} />
        <ColorMatrix matrix={pencilGrainMatrix(color)} />
    </>
);

const pathCache = new WeakMap<InkStroke, SkPath>();
const pathFor = (stroke: InkStroke): SkPath => {
    let path = pathCache.get(stroke);
    if (!path) {
        path = outlineToSkPath(strokeOutlineFor(stroke));
        pathCache.set(stroke, path);
    }
    return path;
};

/** Paint of a finished stroke; built on either thread (see the pending strokes). */
const makeInkPaint = (stroke: InkStroke): SkPaint => {
    'worklet';
    const spec = INK_TOOLS[stroke.tool] || INK_TOOLS.fountain;
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    paint.setColor(Skia.Color(stroke.color));
    if (spec.grain) {
        // Same graphite as the live stroke (PencilGrain), opacity folded into the alpha row.
        const matrix = pencilGrainMatrix(stroke.color);
        for (let i = 15; i < 20; i++) {
            matrix[i] *= spec.opacity;
        }
        paint.setShader(Skia.Shader.MakeFractalNoise(0.9, 0.9, 2, 3, 0, 0));
        paint.setColorFilter(Skia.ColorFilter.MakeMatrix(matrix));
    } else {
        paint.setAlphaf(spec.opacity);
    }
    return paint;
};

const paintCache = new Map<string, SkPaint>();
const paintFor = (stroke: InkStroke): SkPaint => {
    const key = `${stroke.tool}|${stroke.color}`;
    let paint = paintCache.get(key);
    if (!paint) {
        paint = makeInkPaint(stroke);
        paintCache.set(key, paint);
    }
    return paint;
};

/** A finished stroke the UI thread draws until the committed picture has it. */
type PendingStroke = { id: number; stroke: InkStroke };

type InkCache = { strokes: InkStroke[]; picture: SkPicture | null; depth: number };
/** Pictures nested by appending before the chain is flattened again. */
const MAX_PICTURE_DEPTH = 24;

/**
 * Finished strokes as one picture: one node for Skia to draw instead of a node
 * per stroke for React to diff. A new stroke on top of the previous ones (the
 * usual case) just draws the previous picture and the new path.
 */
const buildInkPicture = (cache: InkCache, strokes: InkStroke[]): InkCache => {
    const recorder = Skia.PictureRecorder();
    const canvas = recorder.beginRecording(pictureBounds);
    const previous = cache.strokes;
    let start = 0;
    let depth = 0;
    if (cache.picture && previous.length > 0 && strokes.length > previous.length && cache.depth < MAX_PICTURE_DEPTH
        && previous.every((stroke, index) => strokes[index] === stroke)) {
        canvas.drawPicture(cache.picture);
        start = previous.length;
        depth = cache.depth + 1;
    }
    for (let i = start; i < strokes.length; i++) {
        canvas.drawPath(pathFor(strokes[i]), paintFor(strokes[i]));
    }
    return { strokes, picture: recorder.finishRecordingAsPicture(), depth };
};

const Label: React.FC<{ item: InkText }> = ({ item }) => (
    <Paragraph paragraph={paragraphFor(item)} x={item.x} y={item.y} width={LABEL_LAYOUT_WIDTH} />
);

export const DrawingCanvas = forwardRef<DrawingCanvasHandle, Props>(({
    bottomInset, strokes, texts, textBoxes, paper, docWidth: docWidthProp, onMeasure, mode: canvasMode, tool, color, size, stylusOnly, eraserRadius, snapShapes,
    editingText, dark, themePaperColor, themeLineColor, deskColor,
    onCommit, onErase, onEraseEnd, onTextTap, onTextMove, onStylus, onUndo, onRedo,
    selection, onLasso, onSelectionMove,
}, ref) => {
    const [view, setView] = useState({ width: 0, height: 0 });
    // Android drops the GPU surface while the app is in the background and Skia
    // does not repaint an unchanged scene, so the sheet came back blank. A fresh
    // Canvas on return repaints it.
    const [surfaceKey, setSurfaceKey] = useState(0);
    useEffect(() => {
        const subscription = AppState.addEventListener('change', (next) => {
            if (next === 'active') {
                setSurfaceKey((key) => key + 1);
            }
        });
        return () => subscription.remove();
    }, []);
    const docWidth = docWidthProp || view.width || 1;
    useEffect(() => {
        if (!docWidthProp && view.width > 0) {
            onMeasure(view.width);
        }
    }, [docWidthProp, view.width, onMeasure]);
    // A drawing is shown at its own width, fitted to the screen when it is wider
    // (one started on a tablet, opened on a phone) and centred when narrower.
    const baseScale = view.width > 0 ? Math.min(1, view.width / docWidth) : 1;
    const isPages = paper.layout !== 'canvas';

    const bounds = useMemo(() => drawingBounds(strokes, texts), [strokes, texts]);
    const pageCount = isPages ? pageCountFor(docWidth, bounds ? bounds.maxY : null) : 0;
    const pitch = pagePitch(docWidth);
    const sheets = useMemo<Sheet[]>(() => {
        if (!isPages) {
            return [{ x: -CANVAS_EXTENT, y: -CANVAS_EXTENT, width: CANVAS_EXTENT * 2, height: CANVAS_EXTENT * 2 }];
        }
        return Array.from({ length: pageCount }, (_, index) => ({
            x: 0,
            y: index * pitch,
            width: docWidth,
            height: pageHeight(docWidth),
        }));
    }, [isPages, pageCount, pitch, docWidth]);

    const zoom = useSharedValue(1);
    const tx = useSharedValue(0);
    const ty = useSharedValue(PAGE_MARGIN);
    const scaleSV = useSharedValue(baseScale);
    const docW = useSharedValue(docWidth);
    const viewW = useSharedValue(0);
    const viewH = useSharedValue(0);
    /** Height of all pages in document units; 0 for a canvas, which has no edges. */
    const pagesHeight = useSharedValue(0);
    const pitchSV = useSharedValue(pitch);
    const bottomInsetSV = useSharedValue(0);
    // The JS thread does not see a shared value it wrote in the same tick, so
    // panBy (JS) reads the inset from a ref; worklets read the shared value.
    const bottomInsetRef = useRef(bottomInset);
    bottomInsetRef.current = bottomInset;

    const live = useSharedValue<number[]>([]);
    const liveId = useSharedValue(0);
    // A lifted stroke moves from `live` to `pending` in the same UI frame and is
    // drawn from there until React has rendered it into the ink picture. With
    // the stroke only in `live`, the next stroke replaced it on screen before
    // the JS thread caught up, and fast handwriting flickered.
    const pending = useSharedValue<PendingStroke[]>([]);
    /** Where and since when the pen has rested; whether the stroke became a shape. */
    const still = useSharedValue({ x: 0, y: 0, t: 0 });
    const snapped = useSharedValue(false);
    const lastSample = useSharedValue({ x: 0, y: 0, t: 0, p: 0.5 });
    const gestureMode = useSharedValue<'draw' | 'erase' | 'scroll' | 'text' | 'lasso' | 'move' | 'none'>('none');
    /** The lasso loop being drawn, in document coordinates. */
    const lasso = useSharedValue<number[]>([]);
    /** Box around the selection (document units), or null; and how far it is being dragged. */
    const selectionBox = useSharedValue<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null);
    const selectionDrag = useSharedValue({ dx: 0, dy: 0, startX: 0, startY: 0 });
    const eraser = useSharedValue({ x: -100, y: -100, visible: false });
    /** Screen point of the last erase pass in the current drag. */
    const lastErase = useSharedValue({ x: 0, y: 0 });
    const hover = useSharedValue({ x: -100, y: -100, visible: false });
    const textBoxesSV = useSharedValue<number[]>([]);
    const textGesture = useSharedValue({ index: -1, startX: 0, startY: 0, screenX: 0, screenY: 0, moved: false });
    const dragOffset = useSharedValue({ dx: 0, dy: 0 });
    /** A second finger joined (pinch/scroll): the one-finger action it interrupted is void. */
    const multiTouch = useSharedValue(false);
    const stylusSeen = useSharedValue(false);
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const [currentPage, setCurrentPage] = useState(0);

    const toolSV = useSharedValue({ mode: canvasMode, tool, color, size, stylusOnly, eraserRadius, snapShapes });
    useEffect(() => {
        toolSV.value = { mode: canvasMode, tool, color, size, stylusOnly, eraserRadius, snapShapes };
    }, [canvasMode, tool, color, size, stylusOnly, eraserRadius, snapShapes, toolSV]);

    useEffect(() => {
        textBoxesSV.value = texts.flatMap((item, index) => {
            const box = textBoxes[index] || { width: 0, height: 0 };
            return [item.x, item.y, box.width, box.height];
        });
    }, [texts, textBoxes, textBoxesSV]);

    /** Where the view may scroll to: pages stop at the first and last sheet, a canvas never does. */
    const scrollLimits = (z: number, inset: number) => {
        'worklet';
        if (pagesHeight.value <= 0) {
            return { minX: -CANVAS_EXTENT, maxX: CANVAS_EXTENT, minY: -CANVAS_EXTENT, maxY: CANVAS_EXTENT };
        }
        const s = scaleSV.value * z;
        const pageWidth = docW.value * s;
        const centred = (viewW.value - pageWidth) / 2;
        const minX = pageWidth <= viewW.value ? centred : viewW.value - pageWidth;
        const maxX = pageWidth <= viewW.value ? centred : 0;
        const minY = Math.min(PAGE_MARGIN, viewH.value - inset - pagesHeight.value * s - PAGE_MARGIN);
        return { minX, maxX, minY, maxY: PAGE_MARGIN };
    };

    const zoomLimits = () => {
        'worklet';
        return pagesHeight.value > 0 ? PAGES_ZOOM : CANVAS_ZOOM;
    };

    const clampPan = () => {
        'worklet';
        const limits = scrollLimits(zoom.value, bottomInsetSV.value);
        tx.value = Math.min(limits.maxX, Math.max(limits.minX, tx.value));
        ty.value = Math.min(limits.maxY, Math.max(limits.minY, ty.value));
    };

    useEffect(() => {
        scaleSV.value = baseScale;
        viewW.value = view.width;
        viewH.value = view.height;
        docW.value = docWidth;
        pagesHeight.value = isPages ? pageCount * pitch - PAGE_GAP : 0;
        pitchSV.value = pitch;
        // On the UI thread, where the values written above are already visible.
        runOnUI(() => {
            'worklet';
            const [minZoom, maxZoom] = zoomLimits();
            zoom.value = Math.min(maxZoom, Math.max(minZoom, zoom.value));
            clampPan();
        })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [baseScale, view, docWidth, isPages, pageCount, pitch]);

    useEffect(() => {
        bottomInsetSV.value = bottomInset;
        runOnUI(clampPan)();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bottomInset]);

    useImperativeHandle(ref, () => ({
        panBy: (dy: number) => {
            // Applied on the JS thread so the caller gets the clamped distance back
            // at once; the shared values carry it to the UI thread.
            const before = ty.value;
            const limits = scrollLimits(zoom.value, bottomInsetRef.current);
            const next = Math.min(limits.maxY, Math.max(limits.minY, before + dy));
            ty.value = next;
            return next - before;
        },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), []);

    // Page number for the indicator, reported to JS only when it changes.
    useAnimatedReaction(
        () => {
            if (pagesHeight.value <= 0) {
                return 0;
            }
            const s = scaleSV.value * zoom.value;
            const middle = (viewH.value / 2 - ty.value) / s;
            return Math.max(0, Math.floor(middle / pitchSV.value));
        },
        (page, previous) => {
            if (page !== previous) {
                runOnJS(setCurrentPage)(page);
            }
        }
    );

    /** Pending stroke of each stroke committed from here, and those not yet seen rendered. */
    const pendingIds = useRef(new WeakMap<InkStroke, number>());
    const awaiting = useRef<{ id: number; checked: boolean }[]>([]);
    const commitLive = useCallback((stroke: InkStroke, id: number) => {
        pendingIds.current.set(stroke, id);
        awaiting.current.push({ id, checked: false });
        onCommit(stroke);
    }, [onCommit]);
    // After each render: strokes now in the ink picture stop being drawn as
    // pending. Skia sent the new picture to the UI thread in the layout effect
    // of this commit, so this removal lands after it: never a frame without
    // the stroke, and no frame with it twice (a highlighter would darken).
    // A stroke that never shows up (undone at once) is dropped one render later.
    useEffect(() => {
        if (!awaiting.current.length) {
            return;
        }
        const rendered = new Set<number>();
        for (let i = strokes.length - 1; i >= 0 && rendered.size < awaiting.current.length; i--) {
            const id = pendingIds.current.get(strokes[i]);
            if (id !== undefined) {
                rendered.add(id);
            }
        }
        const done: number[] = [];
        awaiting.current = awaiting.current.filter((entry) => {
            if (rendered.has(entry.id) || entry.checked) {
                done.push(entry.id);
                return false;
            }
            entry.checked = true;
            return true;
        });
        if (done.length) {
            runOnUI((ids: number[]) => {
                'worklet';
                pending.value = pending.value.filter((entry) => !ids.includes(entry.id));
            })(done);
        }
    });

    // The dragged selection keeps its offset until the moved strokes are rendered.
    const movePending = useRef(false);
    const finishMove = useCallback((dx: number, dy: number) => {
        movePending.current = true;
        onSelectionMove(dx, dy);
    }, [onSelectionMove]);
    useEffect(() => {
        if (movePending.current) {
            movePending.current = false;
            runOnUI(() => {
                'worklet';
                selectionDrag.value = { dx: 0, dy: 0, startX: 0, startY: 0 };
            })();
        }
    }, [strokes, texts, selectionDrag]);

    const finishTextDrag = useCallback((index: number, dx: number, dy: number) => {
        onTextMove(index, dx, dy);
        requestAnimationFrame(() => {
            setDragIndex(null);
            dragOffset.value = { dx: 0, dy: 0 };
        });
    }, [onTextMove, dragOffset]);

    // Watches a stroke for the pen coming to rest, only while one is drawn.
    const shapeWatch = useFrameCallback(() => {
        if (gestureMode.value !== 'draw' || snapped.value || Date.now() - still.value.t < SHAPE_HOLD_MS) {
            return;
        }
        const shape = recognizeShape(live.value);
        if (shape) {
            snapped.value = true;
            live.value = shape;
            runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Light);
        } else {
            // Not a shape: try again only after the pen moves and rests anew.
            still.value = { ...still.value, t: Number.MAX_SAFE_INTEGER };
        }
    }, false);
    const watchShapes = useCallback((active: boolean) => shapeWatch.setActive(active), [shapeWatch]);

    // Gestures are built once (below): rebuilding them on every render made
    // RNGH re-attach handlers after each committed stroke, and a stroke that
    // began during that re-attach was dropped. Worklets call back into JS
    // through one stable function that reads the latest handlers.
    const jsHandlers = {
        onStylus, onErase, onEraseEnd, onTextTap, onUndo, onRedo, commitLive, finishTextDrag, setDragIndex, watchShapes,
        onLasso, finishMove,
    };
    const jsHandlersRef = useRef(jsHandlers);
    jsHandlersRef.current = jsHandlers;
    const callJs = useCallback(<K extends keyof typeof jsHandlers>(name: K, ...args: Parameters<typeof jsHandlers[K]>) => {
        (jsHandlersRef.current[name] as (...a: unknown[]) => void)(...args);
    }, []);

    const toDoc = (x: number, y: number) => {
        'worklet';
        const s = scaleSV.value * zoom.value;
        return { x: (x - tx.value) / s, y: (y - ty.value) / s };
    };

    const hitTextAt = (x: number, y: number, slop: number) => {
        'worklet';
        const boxes = textBoxesSV.value;
        for (let i = boxes.length / 4 - 1; i >= 0; i--) {
            const bx = boxes[i * 4];
            const by = boxes[i * 4 + 1];
            if (x >= bx - slop && x <= bx + boxes[i * 4 + 2] + slop && y >= by - slop && y <= by + boxes[i * 4 + 3] + slop) {
                return i;
            }
        }
        return -1;
    };

    const stopFling = () => {
        'worklet';
        cancelAnimation(tx);
        cancelAnimation(ty);
    };

    /** Lets the page glide on after a scroll, as scroll views do. */
    const fling = (velocityX: number, velocityY: number) => {
        'worklet';
        const limits = scrollLimits(zoom.value, bottomInsetSV.value);
        if (limits.maxX > limits.minX) {
            tx.value = withDecay({ velocity: velocityX, clamp: [limits.minX, limits.maxX], deceleration: 0.997 });
        }
        if (limits.maxY > limits.minY) {
            ty.value = withDecay({ velocity: velocityY, clamp: [limits.minY, limits.maxY], deceleration: 0.997 });
        }
    };

    const pinchStart = useSharedValue({ zoom: 1, tx: 0, ty: 0 });
    // Shared values and callJs are stable, so the gestures never need rebuilding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const gesture = useMemo(() => {
        const draw = Gesture.Pan()
            .maxPointers(1)
            .minDistance(0)
            .averageTouches(false)
            .onBegin((e) => {
                // A touch stops a gliding page, wherever it lands.
                stopFling();
                const isStylus = e.pointerType === PointerType.STYLUS;
                if (isStylus && !stylusSeen.value) {
                    // Only the first contact matters to the editor; later ones would
                    // just add a JS call to the start of every stroke.
                    stylusSeen.value = true;
                    runOnJS(callJs)('onStylus');
                }
                const cfg = toolSV.value;
                // The pen's eraser end or side button (see InkInputView) erases with any tool.
                const penErases = isStylus && !!e.stylusData && e.stylusData.pressure <= ERASER_PRESSURE / 2;
                // Typing a label is fine with a finger; drawing obeys pen-only mode.
                if (cfg.stylusOnly && !isStylus && cfg.mode !== 'text') {
                    gestureMode.value = 'scroll';
                    return;
                }
                hover.value = { x: -100, y: -100, visible: false };
                multiTouch.value = false;
                const pt = toDoc(e.x, e.y);
                const scale = scaleSV.value * zoom.value;
                if (cfg.mode === 'text' && !penErases) {
                    gestureMode.value = 'text';
                    textGesture.value = {
                        index: hitTextAt(pt.x, pt.y, 8 / scale),
                        startX: pt.x,
                        startY: pt.y,
                        screenX: e.x,
                        screenY: e.y,
                        moved: false,
                    };
                    return;
                }
                if (cfg.mode === 'select' && !penErases) {
                    const box = selectionBox.value;
                    const pad = 12 / scale;
                    if (box && pt.x >= box.minX - pad && pt.x <= box.maxX + pad && pt.y >= box.minY - pad && pt.y <= box.maxY + pad) {
                        gestureMode.value = 'move';
                        selectionDrag.value = { dx: 0, dy: 0, startX: pt.x, startY: pt.y };
                    } else {
                        gestureMode.value = 'lasso';
                        lasso.value = [pt.x, pt.y];
                    }
                    return;
                }
                if (cfg.mode === 'erase' || penErases) {
                    gestureMode.value = 'erase';
                    eraser.value = { x: e.x, y: e.y, visible: true };
                    lastErase.value = { x: e.x, y: e.y };
                    runOnJS(callJs)('onErase', pt.x, pt.y, cfg.eraserRadius / scale);
                    return;
                }
                gestureMode.value = 'draw';
                const pressure = isStylus && e.stylusData && e.stylusData.pressure >= 0 ? e.stylusData.pressure : 0.55;
                lastSample.value = { x: e.x, y: e.y, t: Date.now(), p: pressure };
                liveId.value += 1;
                live.value = [pt.x, pt.y, pressure];
                snapped.value = false;
                still.value = { x: e.x, y: e.y, t: Date.now() };
                if (cfg.snapShapes) {
                    runOnJS(callJs)('watchShapes', true);
                }
            })
            .onChange((e) => {
                if (gestureMode.value === 'scroll') {
                    tx.value += e.changeX;
                    ty.value += e.changeY;
                    clampPan();
                }
            })
            .onUpdate((e) => {
                const current = gestureMode.value;
                if (current === 'scroll' || current === 'none') {
                    return;
                }
                const pt = toDoc(e.x, e.y);
                if (current === 'text') {
                    const g = textGesture.value;
                    if (g.index < 0) {
                        return;
                    }
                    if (!g.moved && Math.hypot(e.x - g.screenX, e.y - g.screenY) < DRAG_SLOP) {
                        return;
                    }
                    if (!g.moved) {
                        textGesture.value = { ...g, moved: true };
                        runOnJS(callJs)('setDragIndex', g.index);
                    }
                    dragOffset.value = { dx: pt.x - g.startX, dy: pt.y - g.startY };
                    return;
                }
                if (current === 'lasso') {
                    const points = lasso.value;
                    const n = points.length;
                    if (Math.hypot(pt.x - points[n - 2], pt.y - points[n - 1]) * scaleSV.value * zoom.value >= 3) {
                        lasso.modify((loop) => {
                            'worklet';
                            loop.push(pt.x, pt.y);
                            return loop;
                        });
                    }
                    return;
                }
                if (current === 'move') {
                    const drag = selectionDrag.value;
                    selectionDrag.value = { ...drag, dx: pt.x - drag.startX, dy: pt.y - drag.startY };
                    return;
                }
                if (current === 'erase') {
                    eraser.value = { x: e.x, y: e.y, visible: true };
                    const at = lastErase.value;
                    // Erasing runs on the JS thread over all strokes, so it waits until
                    // the eraser has moved a little. A long jump between two samples is
                    // filled in, so the ink between them is erased too.
                    const distance = Math.hypot(e.x - at.x, e.y - at.y);
                    if (distance >= ERASE_STEP) {
                        const radius = toolSV.value.eraserRadius;
                        const steps = Math.ceil(distance / Math.max(ERASE_STEP, radius / 2));
                        const path: number[] = [];
                        for (let i = 1; i < steps; i++) {
                            const between = toDoc(at.x + ((e.x - at.x) * i) / steps, at.y + ((e.y - at.y) * i) / steps);
                            path.push(between.x, between.y);
                        }
                        path.push(pt.x, pt.y);
                        lastErase.value = { x: e.x, y: e.y };
                        runOnJS(callJs)('onErase', path[0], path[1], radius / (scaleSV.value * zoom.value), path.slice(2));
                    }
                    return;
                }
                if (snapped.value) {
                    // The shape stays as it snapped until the pen lifts.
                    return;
                }
                const rest = still.value;
                if (Math.hypot(e.x - rest.x, e.y - rest.y) > SHAPE_STILL_PX) {
                    still.value = { x: e.x, y: e.y, t: Date.now() };
                }
                let pressure: number;
                if (e.pointerType === PointerType.STYLUS && e.stylusData && e.stylusData.pressure >= 0) {
                    pressure = e.stylusData.pressure;
                } else {
                    // A finger has no pressure: faster movement draws thinner, like ink.
                    // Samples come a few ms apart and the clock counts whole ms, so
                    // the speed is measured over at least SPEED_WINDOW_MS.
                    const now = Date.now();
                    const prev = lastSample.value;
                    const dt = now - prev.t;
                    if (dt >= SPEED_WINDOW_MS) {
                        const speed = Math.hypot(e.x - prev.x, e.y - prev.y) / dt;
                        const target = Math.min(0.9, Math.max(0.2, 0.85 - speed * 0.22));
                        pressure = prev.p + (target - prev.p) * 0.3;
                        lastSample.value = { x: e.x, y: e.y, t: now, p: pressure };
                    } else {
                        pressure = prev.p;
                    }
                }
                live.modify((points) => {
                    'worklet';
                    points.push(pt.x, pt.y, pressure);
                    return points;
                });
            })
            .onEnd((e, success) => {
                if (gestureMode.value === 'scroll') {
                    fling(e.velocityX, e.velocityY);
                }
                // The lift-off point ends the line, even when no move reported it.
                // Only on a real lift: a stroke cut short by a second finger ends
                // where it was, not at that finger.
                if (gestureMode.value === 'draw' && success && !snapped.value) {
                    const end = toDoc(e.x, e.y);
                    live.modify((points) => {
                        'worklet';
                        const n = points.length;
                        if (n >= 3 && Math.hypot(end.x - points[n - 3], end.y - points[n - 2]) > 0.5) {
                            points.push(end.x, end.y, points[n - 1]);
                        }
                        return points;
                    });
                }
            })
            // `success` is not used: a touch that never moves (a tap, the dot over an
            // "i") ends without the pan activating, yet it is a real tap or dot.
            .onFinalize(() => {
                const current = gestureMode.value;
                gestureMode.value = 'none';
                if (current === 'text') {
                    const g = textGesture.value;
                    if (g.moved) {
                        const offset = dragOffset.value;
                        runOnJS(callJs)('finishTextDrag', g.index, offset.dx, offset.dy);
                    } else if (!multiTouch.value) {
                        runOnJS(callJs)('onTextTap', {
                            x: g.startX,
                            y: g.startY,
                            index: g.index,
                            screenX: g.screenX,
                            screenY: g.screenY,
                            scale: scaleSV.value * zoom.value,
                        });
                    }
                    return;
                }
                if (current === 'erase') {
                    eraser.value = { x: -100, y: -100, visible: false };
                    runOnJS(callJs)('onEraseEnd');
                    return;
                }
                if (current === 'lasso') {
                    const loop = lasso.value.slice();
                    lasso.value = [];
                    if (!multiTouch.value) {
                        runOnJS(callJs)('onLasso', loop);
                    }
                    return;
                }
                if (current === 'move') {
                    const drag = selectionDrag.value;
                    if (multiTouch.value || (!drag.dx && !drag.dy)) {
                        selectionDrag.value = { dx: 0, dy: 0, startX: 0, startY: 0 };
                        return;
                    }
                    runOnJS(callJs)('finishMove', drag.dx, drag.dy);
                    return;
                }
                if (current !== 'draw') {
                    return;
                }
                if (toolSV.value.snapShapes) {
                    runOnJS(callJs)('watchShapes', false);
                }
                // A second finger landing (pinch) cancels the stroke it interrupted.
                if (multiTouch.value) {
                    live.value = [];
                    return;
                }
                const points = live.value.slice();
                const cfg = toolSV.value;
                const id = liveId.value;
                const stroke: InkStroke = snapped.value
                    ? { tool: cfg.tool, color: cfg.color, size: cfg.size, points, cut: true }
                    : { tool: cfg.tool, color: cfg.color, size: cfg.size, points };
                pending.value = [...pending.value, { id, stroke }];
                live.value = [];
                runOnJS(callJs)('commitLive', stroke, id);
            });

        const pinch = Gesture.Pinch()
            .onStart(() => {
                // Active only once two fingers are down (onBegin fires on the first).
                multiTouch.value = true;
                stopFling();
                pinchStart.value = { zoom: zoom.value, tx: tx.value, ty: ty.value };
            })
            .onUpdate((e) => {
                const start = pinchStart.value;
                const [minZoom, maxZoom] = zoomLimits();
                const next = Math.min(maxZoom, Math.max(minZoom, start.zoom * e.scale));
                const ratio = next / start.zoom;
                zoom.value = next;
                tx.value = e.focalX - (e.focalX - start.tx) * ratio;
                ty.value = e.focalY - (e.focalY - start.ty) * ratio;
                clampPan();
            });

        const scroll = Gesture.Pan()
            .minPointers(2)
            .onStart(() => {
                multiTouch.value = true;
                stopFling();
            })
            .onChange((e) => {
                pinchStart.value = {
                    zoom: pinchStart.value.zoom,
                    tx: pinchStart.value.tx + e.changeX,
                    ty: pinchStart.value.ty + e.changeY,
                };
                tx.value += e.changeX;
                ty.value += e.changeY;
                clampPan();
            })
            .onEnd((e) => {
                fling(e.velocityX, e.velocityY);
            });

        const undoTap = Gesture.Tap().minPointers(2).maxDuration(250).onEnd((e, success) => {
            if (success && e.numberOfPointers === 2) {
                runOnJS(callJs)('onUndo');
            }
        });
        const redoTap = Gesture.Tap().minPointers(3).maxDuration(250).onEnd((e, success) => {
            if (success && e.numberOfPointers >= 3) {
                runOnJS(callJs)('onRedo');
            }
        });

        const hoverGesture = Gesture.Hover()
            .onUpdate((e) => {
                hover.value = { x: e.x, y: e.y, visible: true };
            })
            .onEnd(() => {
                hover.value = { x: -100, y: -100, visible: false };
            });

        return Gesture.Simultaneous(draw, pinch, scroll, undoTap, redoTap, hoverGesture);
    }, []);

    const transform = useDerivedValue(() => [
        { translateX: tx.value },
        { translateY: ty.value },
        { scale: scaleSV.value * zoom.value },
    ]);
    const dragTransform = useDerivedValue(() => [
        { translateX: dragOffset.value.dx },
        { translateY: dragOffset.value.dy },
    ]);

    const livePath = useDerivedValue(() => {
        const cfg = toolSV.value;
        const spec = INK_TOOLS[cfg.tool];
        return outlineToSkPath(strokeOutline(live.value, cfg.size, spec.thinning, spec.streamline, spec.taper && !snapped.value, spec.nib));
    });

    // Strokes are pending only for a frame or two, so rebuilding this on each
    // change costs little; with none pending it is an empty picture.
    const pendingPicture = useDerivedValue(() => {
        const recorder = Skia.PictureRecorder();
        const canvas = recorder.beginRecording(Skia.XYWHRect(-CANVAS_EXTENT, -CANVAS_EXTENT, CANVAS_EXTENT * 2, CANVAS_EXTENT * 2));
        pending.value.forEach(({ stroke }) => {
            canvas.drawPath(outlineToSkPath(strokeOutlineFor(stroke)), makeInkPaint(stroke));
        });
        return recorder.finishRecordingAsPicture();
    });

    const eraserX = useDerivedValue(() => eraser.value.x);
    const eraserY = useDerivedValue(() => eraser.value.y);
    const eraserOpacity = useDerivedValue(() => (eraser.value.visible ? 1 : 0));
    const eraserR = useDerivedValue(() => toolSV.value.eraserRadius);
    const hoverX = useDerivedValue(() => hover.value.x);
    const hoverY = useDerivedValue(() => hover.value.y);
    const hoverRadius = useDerivedValue(() => {
        const cfg = toolSV.value;
        if (cfg.mode === 'erase') {
            return cfg.eraserRadius;
        }
        return Math.max(1.5, (cfg.mode === 'text' ? 2 : cfg.size / 2) * scaleSV.value * zoom.value);
    });
    // Just a hint of where the nib will land: faint, the size of the line it draws.
    const hoverOpacity = useDerivedValue(() => (hover.value.visible ? 0.18 : 0));

    const sheetColor = paper.color || themePaperColor;
    const lineColor = paperLineColor(paper.color, themeLineColor);
    // The theme's own paper flips with dark mode, and so does the ink on it; a
    // sheet with its own colour keeps true colours, as it will in the note.
    const invertInk = dark && !paper.color;

    const paperPictures = useMemo(
        () => buildPaper(paper, sheets, sheetColor, lineColor, 1 / baseScale),
        [paper, sheets, sheetColor, lineColor, baseScale]
    );
    // The pattern fades out once its cells are only a few pixels on screen.
    const step = paperStep(paper.pattern);
    const patternOpacity = useDerivedValue(() => {
        const cell = step * scaleSV.value * zoom.value;
        return Math.min(1, Math.max(0, (cell - 5) / 5));
    });
    // Pages clip the ink at their edges, like paper; a canvas has none.
    const pageClip = useMemo(() => {
        if (!isPages) {
            return undefined;
        }
        const builder = Skia.PathBuilder.Make();
        sheets.forEach((rect) => builder.addRect(Skia.XYWHRect(rect.x, rect.y, rect.width, rect.height)));
        return builder.build();
    }, [isPages, sheets]);

    // Selected strokes are drawn apart from the rest, on top, so they can move together.
    const selectedStrokes = useMemo(() => new Set(selection.strokes.filter((index) => index < strokes.length)), [selection.strokes, strokes.length]);
    const selectedTexts = useMemo(() => new Set(selection.texts.filter((index) => index < texts.length)), [selection.texts, texts.length]);
    const baseStrokes = useMemo(
        () => (selectedStrokes.size ? strokes.filter((_stroke, index) => !selectedStrokes.has(index)) : strokes),
        [strokes, selectedStrokes]
    );
    const inkCache = useRef<InkCache>({ strokes: [], picture: null, depth: 0 });
    const inkPicture = useMemo(() => {
        inkCache.current = buildInkPicture(inkCache.current, baseStrokes);
        return inkCache.current.picture as SkPicture;
    }, [baseStrokes]);
    const selectionPicture = useMemo(() => {
        if (!selectedStrokes.size) {
            return null;
        }
        return buildInkPicture({ strokes: [], picture: null, depth: 0 }, strokes.filter((_stroke, index) => selectedStrokes.has(index))).picture;
    }, [strokes, selectedStrokes]);
    useEffect(() => {
        const picked = strokes.filter((_stroke, index) => selectedStrokes.has(index));
        const box = picked.length || selectedTexts.size
            ? drawingBounds(picked, texts.filter((_item, index) => selectedTexts.has(index)))
            : null;
        // Labels are measured: their real box, not the estimate drawingBounds makes.
        if (box) {
            selectedTexts.forEach((index) => {
                const item = texts[index];
                const measured = textBoxes[index];
                if (item && measured) {
                    box.maxX = Math.max(box.maxX, item.x + measured.width);
                    box.maxY = Math.max(box.maxY, item.y + measured.height);
                }
            });
        }
        selectionBox.value = box;
    }, [strokes, texts, textBoxes, selectedStrokes, selectedTexts, selectionBox]);

    const labels = texts.map((item, index) => (
        index === editingText || index === dragIndex || selectedTexts.has(index) ? null : <Label key={index} item={item} />
    ));
    const selectedLabels = [...selectedTexts].map((index) => <Label key={index} item={texts[index]} />);
    const selectionTransform = useDerivedValue(() => [
        { translateX: selectionDrag.value.dx },
        { translateY: selectionDrag.value.dy },
    ]);
    const selectionRect = useDerivedValue(() => {
        const box = selectionBox.value;
        const pad = 6 / (scaleSV.value * zoom.value);
        return box
            ? Skia.XYWHRect(box.minX - pad, box.minY - pad, box.maxX - box.minX + pad * 2, box.maxY - box.minY + pad * 2)
            : Skia.XYWHRect(0, 0, 0, 0);
    });
    const selectionStroke = useDerivedValue(() => 1.5 / (scaleSV.value * zoom.value));
    const dash = useDerivedValue(() => {
        const unit = 6 / (scaleSV.value * zoom.value);
        return [unit, unit];
    });
    const lassoPath = useDerivedValue(() => {
        const loop = lasso.value;
        const builder = Skia.PathBuilder.Make();
        if (loop.length >= 4) {
            builder.moveTo(loop[0], loop[1]);
            for (let i = 2; i + 1 < loop.length; i += 2) {
                builder.lineTo(loop[i], loop[i + 1]);
            }
            builder.close();
        }
        return builder.build();
    });

    const liveOpacity = INK_TOOLS[tool]?.opacity ?? 1;
    const liveGrain = canvasMode === 'ink' && INK_TOOLS[tool]?.grain;
    const inkLayer = invertInk ? (
        <Paint>
            <ColorMatrix matrix={SMART_INVERT_MATRIX} />
        </Paint>
    ) : undefined;

    const handleLayout = (event: LayoutChangeEvent) => {
        const { width, height } = event.nativeEvent.layout;
        setView({ width, height });
    };

    return (
        <GestureDetector gesture={gesture}>
            <View style={[styles.fill, { backgroundColor: deskColor }]} onLayout={handleLayout} collapsable={false}>
                {view.width > 0 && (
                    // Opaque puts the canvas on a SurfaceView on Android, which reaches the
                    // screen a composition step sooner than the default TextureView; it
                    // then paints the desk itself.
                    <Canvas key={surfaceKey} style={styles.fill} opaque>
                        <Fill color={deskColor} />
                        <Group transform={transform}>
                            <Picture picture={paperPictures.sheet} />
                            {paperPictures.pattern && <Picture picture={paperPictures.pattern} opacity={patternOpacity} />}
                            <Group layer={inkLayer} clip={pageClip}>
                                <Picture picture={inkPicture} />
                                <Picture picture={pendingPicture} />
                                <Path path={livePath} color={color} opacity={liveOpacity}>
                                    {liveGrain && <PencilGrain color={color} />}
                                </Path>
                                {labels}
                                {dragIndex !== null && texts[dragIndex] && (
                                    <Group transform={dragTransform}>
                                        <Label item={texts[dragIndex]} />
                                    </Group>
                                )}
                                {(selectionPicture || selectedLabels.length > 0) && (
                                    <Group transform={selectionTransform}>
                                        {selectionPicture && <Picture picture={selectionPicture} />}
                                        {selectedLabels}
                                    </Group>
                                )}
                            </Group>
                            {(selectionPicture || selectedLabels.length > 0) && (
                                <Group transform={selectionTransform}>
                                    <Rect rect={selectionRect} color="rgba(30,136,229,0.06)" />
                                    <Rect rect={selectionRect} color="#1E88E5" style="stroke" strokeWidth={selectionStroke}>
                                        <DashPathEffect intervals={dash} />
                                    </Rect>
                                </Group>
                            )}
                            <Path path={lassoPath} color="rgba(30,136,229,0.08)" />
                            <Path path={lassoPath} color="#1E88E5" style="stroke" strokeWidth={selectionStroke}>
                                <DashPathEffect intervals={dash} />
                            </Path>
                        </Group>
                        <Circle cx={eraserX} cy={eraserY} r={eraserR} color={lineColor} style="stroke" strokeWidth={1.5} opacity={eraserOpacity} />
                        <Circle cx={hoverX} cy={hoverY} r={hoverRadius} color={invertInk ? '#FFFFFF' : color} opacity={hoverOpacity} />
                    </Canvas>
                )}
                {isPages && pageCount > 1 && (
                    <View pointerEvents="none" style={styles.pageBadge}>
                        <Text style={styles.pageBadgeText}>{`${Math.min(currentPage, pageCount - 1) + 1} / ${pageCount}`}</Text>
                    </View>
                )}
            </View>
        </GestureDetector>
    );
});
DrawingCanvas.displayName = 'DrawingCanvas';

const styles = StyleSheet.create({
    fill: { flex: 1 },
    pageBadge: {
        position: 'absolute',
        right: 12,
        bottom: 12,
        paddingHorizontal: 10,
        height: 26,
        borderRadius: 13,
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.45)',
    },
    pageBadgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
