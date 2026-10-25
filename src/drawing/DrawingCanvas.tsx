import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState, LayoutChangeEvent, NativeSyntheticEvent, PixelRatio, Platform, StyleSheet, Text, View } from 'react-native';
import {
    BlendMode,
    Canvas,
    Circle,
    ClipOp,
    ColorMatrix,
    DashPathEffect,
    Fill,
    FilterMode,
    FractalNoise,
    Group,
    Image,
    Paint,
    PaintStyle,
    Path,
    Picture,
    Skia,
    SkImage,
    SkPaint,
    SkPath,
    SkPathBuilder,
    SkPicture,
    SkSurface,
    Paragraph,
    Rect,
    StrokeCap,
    StrokeJoin,
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
    SharedValue,
    useSharedValue,
    withDecay,
} from 'react-native-reanimated';
import { Synchronizable, createSynchronizable, runOnUISync } from 'react-native-worklets';
import * as Haptics from 'expo-haptics';
import { ERASER_PRESSURE, InkLiveHandle, InkLiveView, InkStrokeEvent, NATIVE_INK, takeUnfinishedInk } from '../../modules/ink-input';
import {
    INK_TOOLS,
    InkStroke,
    InkText,
    InkTool,
    InkTrace,
    SMART_INVERT_MATRIX,
    createTrace,
    liveTailStart,
    nextFrozenPiece,
    pencilGrainMatrix,
    recognizeShape,
    shapeIsClosed,
    shapeWidth,
    strokeBounds,
    strokeOutlineFor,
    traceAppend,
    traceOutline,
    traceTail,
} from './ink';
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

type ToolConfig = {
    mode: CanvasMode;
    tool: InkTool;
    color: string;
    size: number;
    stylusOnly: boolean;
    eraserRadius: number;
    snapShapes: boolean;
    /** A backdrop over the canvas takes touches (it closes a popover): nothing draws. */
    blocked: boolean;
};

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
    /**
     * Takes a newly picked tool at once, from the button's handler, so a touch
     * that follows quickly uses it even while the editor is still re-rendering.
     */
    applyTool: (next: { mode: CanvasMode; tool: InkTool; color: string; size: number }) => void;
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
    /** Something is open over the canvas (a popover): touches go the usual way, not to the native ink layer. */
    inkBlocked?: boolean;
    /** A popover is open over the canvas: a touch on the canvas only closes it (onBlockedTouch), it draws nothing. */
    touchesBlocked?: boolean;
    onBlockedTouch?: () => void;
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
/** Shortest time between two erase passes; the path between them is filled in. */
const ERASE_INTERVAL_MS = 24;
/**
 * Shortest time between two redraws of the stroke being drawn. A pen reports
 * 240-500 samples a second; rebuilding the stroke for each of them cost more
 * than the time between them, and the ink fell seconds behind the pen.
 */
const LIVE_FRAME_MS = 7;
/** Shortest interval over which finger speed (and so ink width) is measured. */
const SPEED_WINDOW_MS = 8;
/** How long the pen rests at the end of a stroke before it becomes a shape. */
const SHAPE_HOLD_MS = 700;
/** Screen distance the pen may wander while resting. */
const SHAPE_STILL_PX = 6;
/** Screen distance a text-mode touch must travel before it drags the label. */
const DRAG_SLOP = 6;
/**
 * Desk, paper and finished ink are drawn into an offscreen image (see
 * sceneImage). Android only for now: it is where it was measured.
 */
const SCENE_CACHE = Platform.OS === 'android';
/** Changes to the scene remembered for the UI thread; one it missed redraws everything. */
const SCENE_CHANGES_KEPT = 16;

/** What the scene cache draws, and its recent changes as [version, minX, minY, maxX, maxY] ([version] for none). */
type SceneSource = {
    version: number;
    changes: number[][];
    sheet: SkPicture;
    pattern: SkPicture | null;
    ink: SkPicture;
    clip: SkPath | null;
    invert: boolean;
    desk: string;
    /** Changes when the canvas surface was rebuilt (back from the background): the offscreen one is made anew too. */
    generation: number;
};
/** The offscreen scene on the UI thread, mutated in place there. */
type SceneCache = {
    surface: SkSurface | null;
    image: SkImage | null;
    width: number;
    height: number;
    tx: number;
    ty: number;
    s: number;
    fade: number;
    version: number;
    generation: number;
};

/** Box (document units) around the strokes in one list and not the other: what an edit changed on the page. */
const changedBounds = (before: InkStroke[], after: InkStroke[]) => {
    const kept = new Set(after);
    const old = new Set(before);
    const changed = [...before.filter((stroke) => !kept.has(stroke)), ...after.filter((stroke) => !old.has(stroke))];
    return changed.length ? strokeBounds(changed) : null;
};

/** Ids of strokes drawn by the native ink layer start here, apart from the canvas's own. */
const NATIVE_ID_BASE = 1 << 24;

/** Adds an outline polygon as one closed contour of quadratic segments through the midpoints of its points. */
const addOutline = (path: SkPathBuilder, outline: number[]): void => {
    'worklet';
    const n = outline.length / 2;
    if (n < 3) {
        return;
    }
    const mx = (i: number) => (outline[(i % n) * 2] + outline[((i + 1) % n) * 2]) / 2;
    const my = (i: number) => (outline[(i % n) * 2 + 1] + outline[((i + 1) % n) * 2 + 1]) / 2;
    path.moveTo(mx(0), my(0));
    for (let i = 1; i <= n; i++) {
        path.quadTo(outline[(i % n) * 2], outline[(i % n) * 2 + 1], mx(i), my(i));
    }
    path.close();
};

const outlineToSkPath = (outline: number[]): SkPath => {
    'worklet';
    if (outline.length < 6) {
        return Skia.Path.Make();
    }
    const path = Skia.PathBuilder.Make();
    addOutline(path, outline);
    return path.build();
};

/**
 * The stroke being drawn, built up as it grows (see InkTrace): the finished
 * part of the line is frozen into `frozen` piece by piece, and each frame only
 * rebuilds the last few dozen points on top of it, however long the stroke.
 */
type LiveInk = { id: number; trace: InkTrace; frozen: SkPath | null; frozenTo: number };

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
const PencilGrain: React.FC<{ matrix: SharedValue<number[]> }> = ({ matrix }) => (
    <>
        <FractalNoise freqX={0.9} freqY={0.9} octaves={2} seed={3} />
        <ColorMatrix matrix={matrix} />
    </>
);

const pathCache = new WeakMap<InkStroke, SkPath>();
/** A straightened shape: its line stroked at an even width with round joins, as a fill path. */
const shapeSkPath = (points: number[], width: number): SkPath => {
    'worklet';
    if (points.length < 6) {
        return Skia.Path.Make();
    }
    const line = Skia.PathBuilder.Make();
    line.moveTo(points[0], points[1]);
    for (let i = 3; i + 1 < points.length; i += 3) {
        line.lineTo(points[i], points[i + 1]);
    }
    if (shapeIsClosed(points)) {
        line.close();
    }
    return Skia.Path.Stroke(line.build(), { width, join: StrokeJoin.Round, cap: StrokeCap.Round }) || Skia.Path.Make();
};

/** Fill path of a finished stroke: pen ink, or a shape's even line. */
const inkSkPath = (stroke: InkStroke): SkPath => {
    'worklet';
    return stroke.shape ? shapeSkPath(stroke.points, shapeWidth(stroke)) : outlineToSkPath(strokeOutlineFor(stroke));
};

const pathFor = (stroke: InkStroke): SkPath => {
    let path = pathCache.get(stroke);
    if (!path) {
        path = inkSkPath(stroke);
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
    if (stroke.tool === 'marker') {
        // A highlighter darkens what is under it, as on paper, instead of washing
        // the ink out: black text stays black under yellow.
        paint.setBlendMode(BlendMode.Multiply);
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
    editingText, inkBlocked = false, touchesBlocked = false, onBlockedTouch, dark, themePaperColor, themeLineColor, deskColor,
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
    const liveInk = useSharedValue<{ ink: LiveInk | null }>({ ink: null });
    const liveId = useSharedValue(0);
    // A lifted stroke moves from `live` to `pending` in the same UI frame and is
    // drawn from there until React has rendered it into the ink picture. With
    // the stroke only in `live`, the next stroke replaced it on screen before
    // the JS thread caught up, and fast handwriting flickered.
    const pending = useSharedValue<PendingStroke[]>([]);
    const sceneSource = useSharedValue<SceneSource | null>(null);
    /** The scene version the cached image last drew: what frames on screen now show. */
    const sceneShown = useSharedValue(0);
    const sceneCache = useSharedValue<SceneCache>({ surface: null, image: null, width: 0, height: 0, tx: 0, ty: 0, s: 0, fade: 0, version: -1, generation: -1 });
    /** Where and since when the pen has rested; whether the stroke became a shape. */
    const still = useSharedValue({ x: 0, y: 0, t: 0 });
    const snapped = useSharedValue(false);
    /** The frame callback that watches for a resting pen is running. */
    const watching = useSharedValue(false);
    const lastSample = useSharedValue({ x: 0, y: 0, t: 0, p: 0.5 });
    const gestureMode = useSharedValue<'draw' | 'erase' | 'scroll' | 'text' | 'lasso' | 'move' | 'none'>('none');
    /** The lasso loop being drawn, in document coordinates. */
    const lasso = useSharedValue<number[]>([]);
    /** Box around the selection (document units), or null; and how far it is being dragged. */
    const selectionBox = useSharedValue<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null);
    const selectionDrag = useSharedValue({ dx: 0, dy: 0, startX: 0, startY: 0 });
    const eraser = useSharedValue({ x: -100, y: -100, visible: false });
    /** Screen point of the last erase pass in the current drag. */
    const lastErase = useSharedValue({ x: 0, y: 0, t: 0 });
    /** When the live stroke was last redrawn, and how many samples it had then. */
    const liveShown = useSharedValue({ t: 0, length: 0 });
    /** How long the last rebuild of the live stroke took (ms): a long stroke is redrawn less often. */
    const liveCost = useSharedValue(0);
    const hover = useSharedValue({ x: -100, y: -100, visible: false });
    const textBoxesSV = useSharedValue<number[]>([]);
    const textGesture = useSharedValue({ index: -1, startX: 0, startY: 0, screenX: 0, screenY: 0, moved: false });
    const dragOffset = useSharedValue({ dx: 0, dy: 0 });
    /** A second finger joined (pinch/scroll) or the touch was cancelled: the one-finger action it interrupted is void. */
    const multiTouch = useSharedValue(false);
    const stylusSeen = useSharedValue(false);
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const [currentPage, setCurrentPage] = useState(0);

    // The tool for the next touch. A touch that lands right after a tool is
    // picked must already see it (a lasso started quickly was drawn as ink),
    // but a shared value written from JS reaches the UI thread only after the
    // JS task ends, i.e. after the re-render the same tap starts, and a
    // synchronous call to the UI thread would block JS behind a busy frame.
    // A synchronizable is written from JS at once, under a short lock, and
    // read by the gesture when a touch begins.
    const toolSyncRef = useRef<Synchronizable<ToolConfig> | null>(null);
    const toolNow = useRef<ToolConfig>({ mode: canvasMode, tool, color, size, stylusOnly, eraserRadius, snapShapes, blocked: touchesBlocked });
    if (!toolSyncRef.current) {
        toolSyncRef.current = createSynchronizable<ToolConfig>(toolNow.current);
    }
    const toolSync = toolSyncRef.current;
    /** The same, for what is drawn (eraser ring, hover dot); may trail by a frame. */
    const toolSV = useSharedValue<ToolConfig>(toolNow.current);

    // On Android the stroke under the pen is drawn by a native layer over the
    // canvas (InkLiveView): touches meant for ink go there directly and never
    // reach the gesture handler or this canvas until the pen lifts. It is told
    // the tool, the paper and the view's pan and zoom.
    const nativeInk = useRef<InkLiveHandle>(null);
    const nativeExtras = useRef<{ blocked: boolean; invert: boolean; pages: number[] | null }>({ blocked: false, invert: false, pages: null });
    const pushNativeConfig = useCallback(() => {
        if (!NATIVE_INK) {
            return;
        }
        const cfg = toolNow.current;
        const extras = nativeExtras.current;
        const spec = INK_TOOLS[cfg.tool] || INK_TOOLS.fountain;
        nativeInk.current?.setConfig({
            enabled: cfg.mode === 'ink' && !extras.blocked,
            fingers: !cfg.stylusOnly,
            tool: cfg.tool,
            color: cfg.color,
            size: cfg.size,
            thinning: spec.thinning,
            streamline: spec.streamline,
            taper: spec.taper,
            nib: spec.nib,
            opacity: spec.opacity,
            grain: spec.grain,
            snapShapes: cfg.snapShapes,
            invert: extras.invert,
            hoverColor: extras.invert ? '#FFFFFF' : cfg.color,
            pages: extras.pages,
        }).catch(() => undefined);
    }, []);
    const setTool = useCallback((next: ToolConfig) => {
        toolNow.current = next;
        toolSync.setBlocking(next);
        toolSV.value = next;
        pushNativeConfig();
    }, [toolSync, toolSV, pushNativeConfig]);
    useLayoutEffect(() => {
        setTool({ mode: canvasMode, tool, color, size, stylusOnly, eraserRadius, snapShapes, blocked: touchesBlocked });
    }, [canvasMode, tool, color, size, stylusOnly, eraserRadius, snapShapes, touchesBlocked, setTool]);
    /** The tool a touch started with: it keeps it to the end, whatever is picked meanwhile. */
    const strokeCfg = useSharedValue({ tool, color, size, eraserRadius, snapShapes });

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
        applyTool: (next) => setTool({ ...toolNow.current, ...next }),
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
    /** Ids of the strokes handed to onCommit (only the most recent matter). */
    const committedIds = useRef(new Set<number>());
    const unmounted = useRef(false);
    const commitLive = useCallback((stroke: InkStroke, id: number) => {
        // Anything still on its way when the canvas went was handed over then (see below).
        if (unmounted.current || committedIds.current.has(id)) {
            return;
        }
        committedIds.current.add(id);
        if (committedIds.current.size > 64) {
            committedIds.current.delete(committedIds.current.values().next().value as number);
        }
        pendingIds.current.set(stroke, id);
        awaiting.current.push({ id, checked: false });
        onCommit(stroke);
    }, [onCommit]);
    const onCommitRef = useRef(onCommit);
    onCommitRef.current = onCommit;
    // The canvas can go while a stroke is being drawn or just lifted: a theme
    // switch remounts the whole app, the editor included. The stroke under the
    // pen and the lifted strokes whose commit has not reached JS yet are handed
    // to onCommit right here, before anything else of this canvas is gone, so
    // the editor holds them when it parks the drawing. Read synchronously from
    // the UI thread, once: the stroke lives only there.
    useLayoutEffect(() => {
        unmounted.current = false;
        return () => {
            unmounted.current = true;
            let unfinished: { id: number; stroke: InkStroke }[] = [];
            try {
                unfinished = runOnUISync(() => {
                    'worklet';
                    const out = pending.value.map((entry) => ({ id: entry.id, stroke: entry.stroke }));
                    const points = live.value;
                    if (gestureMode.value === 'draw' && points.length >= 3 && !multiTouch.value) {
                        const cfg = strokeCfg.value;
                        out.push({
                            id: liveId.value,
                            stroke: snapped.value
                                ? { tool: cfg.tool, color: cfg.color, size: cfg.size, points: points.slice(), cut: true, shape: true }
                                : { tool: cfg.tool, color: cfg.color, size: cfg.size, points: points.slice() },
                        });
                    }
                    // The gesture may still end on the UI thread: it finds nothing to commit.
                    gestureMode.value = 'none';
                    live.value = [];
                    return out;
                });
            } catch {
                // The UI runtime is already gone: nothing can be read from it.
            }
            // Strokes the native layer drew (Android) that have not reached here yet.
            takeUnfinishedInk().forEach((event) => {
                unfinished.push({ id: NATIVE_ID_BASE + event.id, stroke: nativeStroke(event) });
            });
            unfinished.forEach(({ id, stroke }) => {
                if (!committedIds.current.has(id)) {
                    committedIds.current.add(id);
                    onCommitRef.current(stroke);
                }
            });
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
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
        const native = done.filter((id) => id >= NATIVE_ID_BASE);
        const own = done.filter((id) => id < NATIVE_ID_BASE);
        if (native.length) {
            // Shown natively until the frame that draws them here is on screen
            // (see sceneShown): let go at once, a fast hand's last strokes blinked out.
            nativeWaiting.current.push({ ids: native.map((id) => id - NATIVE_ID_BASE), version: sceneVersion.current });
            releaseNative(SCENE_CACHE ? sceneShownJs.current : Number.MAX_SAFE_INTEGER);
        }
        if (own.length) {
            runOnUI((ids: number[]) => {
                'worklet';
                pending.value = pending.value.filter((entry) => !ids.includes(entry.id));
            })(own);
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

    // A stroke from the native layer, in this drawing's coordinates. The layer
    // maps the pen with the pan and zoom it last heard of, which trails the
    // page while it still glides or right after a pan: the samples are mapped
    // back to the screen with that transform and into the drawing with the one
    // the page has now, so the stroke stays where it was written on the page.
    const nativeStroke = (e: InkStrokeEvent): InkStroke => {
        let points = e.points;
        const used = e.transform;
        const [x1, y1, s1] = lastTransform.current;
        if (used && used.length === 3 && s1 > 0 && (used[0] !== x1 || used[1] !== y1 || used[2] !== s1)) {
            const [x0, y0, s0] = used;
            points = points.slice();
            for (let i = 0; i + 1 < points.length; i += 3) {
                points[i] = (points[i] * s0 + x0 - x1) / s1;
                points[i + 1] = (points[i + 1] * s0 + y0 - y1) / s1;
            }
        }
        return e.shape
            ? { tool: e.tool as InkTool, color: e.color, size: e.size, points, cut: true, shape: true }
            : { tool: e.tool as InkTool, color: e.color, size: e.size, points };
    };

    // The native layer drew a stroke: the canvas takes it over, and tells the
    // layer to stop showing it once it is rendered here (see above).
    const handleInkBegin = useCallback((event: NativeSyntheticEvent<{ stylus: boolean }>) => {
        if (event.nativeEvent.stylus && !stylusSeen.value) {
            stylusSeen.value = true;
            jsHandlersRef.current.onStylus();
        }
        // A touch stops a gliding page.
        runOnUI(() => {
            'worklet';
            cancelAnimation(tx);
            cancelAnimation(ty);
        })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const handleInkStroke = useCallback((event: NativeSyntheticEvent<InkStrokeEvent>) => {
        jsHandlersRef.current.commitLive(nativeStroke(event.nativeEvent), NATIVE_ID_BASE + event.nativeEvent.id);
    }, []);
    /** Native strokes the canvas has rendered, waiting for a frame to show them. */
    const nativeWaiting = useRef<{ ids: number[]; version: number }[]>([]);
    const sceneShownJs = useRef(0);
    const releaseNative = useCallback((shown: number) => {
        sceneShownJs.current = shown;
        const ready = nativeWaiting.current.filter((entry) => entry.version <= shown);
        if (!ready.length) {
            return;
        }
        nativeWaiting.current = nativeWaiting.current.filter((entry) => entry.version > shown);
        nativeInk.current?.release(ready.flatMap((entry) => entry.ids)).catch(() => undefined);
    }, []);
    useAnimatedReaction(
        () => sceneShown.value,
        (shown, previous) => {
            if (shown !== previous) {
                runOnJS(releaseNative)(shown);
            }
        }
    );

    // The view's pan and zoom, for the native layer to map the pen into the drawing.
    const lastTransform = useRef<[number, number, number]>([0, PAGE_MARGIN, baseScale]);
    const sendTransform = useCallback((x: number, y: number, s: number) => {
        lastTransform.current = [x, y, s];
        nativeInk.current?.setTransform(x, y, s).catch(() => undefined);
    }, []);
    useAnimatedReaction(
        () => (NATIVE_INK ? [tx.value, ty.value, scaleSV.value * zoom.value] : null),
        (next, previous) => {
            if (next && (!previous || next[0] !== previous[0] || next[1] !== previous[1] || next[2] !== previous[2])) {
                runOnJS(sendTransform)(next[0], next[1], next[2]);
            }
        }
    );
    const attachNativeInk = useCallback((handle: InkLiveHandle | null) => {
        nativeInk.current = handle;
        if (handle) {
            pushNativeConfig();
            const [x, y, s] = lastTransform.current;
            handle.setTransform(x, y, s).catch(() => undefined);
        }
    }, [pushNativeConfig]);

    // Runs each frame while a stroke is drawn: shows samples that arrived after
    // the last redraw (the pen slowed or stopped), and watches for the pen
    // coming to rest to straighten the stroke into a shape.
    const strokeFrame = useFrameCallback(() => {
        if (gestureMode.value !== 'draw') {
            return;
        }
        if (live.value.length !== liveShown.value.length) {
            liveShown.value = { t: Date.now(), length: live.value.length };
            live.modify(undefined, true);
        }
        if (snapped.value || !strokeCfg.value.snapShapes || Date.now() - still.value.t < SHAPE_HOLD_MS) {
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
    const watchStroke = useCallback((active: boolean) => strokeFrame.setActive(active), [strokeFrame]);

    // Gestures are built once (below): rebuilding them on every render made
    // RNGH re-attach handlers after each committed stroke, and a stroke that
    // began during that re-attach was dropped. Worklets call back into JS
    // through one stable function that reads the latest handlers.
    const jsHandlers = {
        onStylus, onErase, onEraseEnd, onTextTap, onUndo, onRedo, commitLive, finishTextDrag, setDragIndex, watchStroke,
        onLasso, finishMove, onBlockedTouch: () => onBlockedTouch?.(),
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
                const cfg = toolSync.getBlocking();
                if (cfg.blocked) {
                    gestureMode.value = 'none';
                    runOnJS(callJs)('onBlockedTouch');
                    return;
                }
                strokeCfg.value = { tool: cfg.tool, color: cfg.color, size: cfg.size, eraserRadius: cfg.eraserRadius, snapShapes: cfg.snapShapes };
                // The pen's eraser end or side button (see InkInputView) erases with any tool.
                const penErases = isStylus && !!e.stylusData && e.stylusData.pressure <= ERASER_PRESSURE / 2;
                // Typing a label is fine with a finger; drawing obeys pen-only mode.
                if (cfg.stylusOnly && !isStylus && cfg.mode !== 'text') {
                    gestureMode.value = 'scroll';
                    return;
                }
                // On Android the native layer draws a finger's ink. A finger that
                // reaches this gesture in ink mode is the first of two that the
                // layer handed over for a scroll or zoom: it must not leave a dot.
                if (NATIVE_INK && cfg.mode === 'ink' && !isStylus && !penErases) {
                    gestureMode.value = 'none';
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
                    lastErase.value = { x: e.x, y: e.y, t: Date.now() };
                    runOnJS(callJs)('onErase', pt.x, pt.y, cfg.eraserRadius / scale);
                    return;
                }
                gestureMode.value = 'draw';
                const pressure = isStylus && e.stylusData && e.stylusData.pressure >= 0 ? e.stylusData.pressure : 0.55;
                lastSample.value = { x: e.x, y: e.y, t: Date.now(), p: pressure };
                liveId.value += 1;
                live.value = [pt.x, pt.y, pressure];
                liveShown.value = { t: Date.now(), length: 3 };
                snapped.value = false;
                still.value = { x: e.x, y: e.y, t: Date.now() };
                if (!watching.value) {
                    watching.value = true;
                    runOnJS(callJs)('watchStroke', true);
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
                    if (distance >= ERASE_STEP && Date.now() - at.t >= ERASE_INTERVAL_MS) {
                        const radius = strokeCfg.value.eraserRadius;
                        const steps = Math.ceil(distance / Math.max(ERASE_STEP, radius / 2));
                        const path: number[] = [];
                        for (let i = 1; i < steps; i++) {
                            const between = toDoc(at.x + ((e.x - at.x) * i) / steps, at.y + ((e.y - at.y) * i) / steps);
                            path.push(between.x, between.y);
                        }
                        path.push(pt.x, pt.y);
                        lastErase.value = { x: e.x, y: e.y, t: Date.now() };
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
                // Every sample is kept; the stroke is redrawn at most every
                // LIVE_FRAME_MS (and by strokeFrame once the pen slows down).
                const now = Date.now();
                const redraw = now - liveShown.value.t >= Math.max(LIVE_FRAME_MS, liveCost.value * 2);
                live.modify((points) => {
                    'worklet';
                    points.push(pt.x, pt.y, pressure);
                    return points;
                }, redraw);
                if (redraw) {
                    liveShown.value = { t: now, length: live.value.length };
                }
            })
            .onEnd((e, success) => {
                if (gestureMode.value === 'scroll') {
                    fling(e.velocityX, e.velocityY);
                }
                // An active stroke that ends without success was cancelled, not
                // lifted: a second finger landed, or a palm that touched first
                // gave way to the pen (InkInputView cancels it), or Android
                // rejected it as a palm. Its ink is void. (A tap that never
                // moved never activates and does not come here: dots stay.)
                if (gestureMode.value === 'draw' && !success) {
                    multiTouch.value = true;
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
                if (watching.value) {
                    watching.value = false;
                    runOnJS(callJs)('watchStroke', false);
                }
                // A second finger landing (pinch) or a cancel voids the stroke it interrupted.
                if (multiTouch.value) {
                    live.value = [];
                    return;
                }
                const points = live.value.slice();
                const cfg = strokeCfg.value;
                const id = liveId.value;
                const stroke: InkStroke = snapped.value
                    ? { tool: cfg.tool, color: cfg.color, size: cfg.size, points, cut: true, shape: true }
                    : { tool: cfg.tool, color: cfg.color, size: cfg.size, points };
                pending.value = [...pending.value, { id, stroke }];
                snapped.value = false;
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
        const cfg = strokeCfg.value;
        const points = live.value;
        const started = performance.now();
        let path: SkPath;
        if (snapped.value) {
            path = shapeSkPath(points, shapeWidth({ tool: cfg.tool, color: cfg.color, size: cfg.size, points }));
        } else if (points.length < 3) {
            // (Also runs once on the JS thread at mount, where the holder must not be touched.)
            if (liveInk.value.ink) {
                liveInk.value.ink = null;
            }
            path = Skia.Path.Make();
        } else {
            // Mutated in place on the UI thread: nothing reacts to it, and it
            // carries over from frame to frame.
            const holder = liveInk.value;
            let ink = holder.ink;
            if (!ink || ink.id !== liveId.value || points.length < ink.trace.consumed * 3) {
                const spec = INK_TOOLS[cfg.tool] || INK_TOOLS.fountain;
                ink = { id: liveId.value, trace: createTrace(cfg.size, spec.thinning, spec.streamline, spec.taper, spec.nib), frozen: null, frozenTo: -1 };
                holder.ink = ink;
            }
            const trace = ink.trace;
            traceAppend(trace, points);
            let piece = nextFrozenPiece(ink.frozenTo, trace.done);
            if (piece) {
                const builder = ink.frozen ? Skia.PathBuilder.MakeFromPath(ink.frozen) : Skia.PathBuilder.Make();
                while (piece) {
                    addOutline(builder, traceOutline(trace, null, piece[0], piece[1], piece[0] === 0, false));
                    ink.frozenTo = piece[1];
                    piece = nextFrozenPiece(ink.frozenTo, trace.done);
                }
                ink.frozen = builder.build();
            }
            const tail = traceTail(trace, points);
            const from = liveTailStart(ink.frozenTo);
            // One path, frozen pieces and tail as separate contours: filled as a
            // union, so a translucent marker does not darken where they overlap.
            const builder = ink.frozen ? Skia.PathBuilder.MakeFromPath(ink.frozen) : Skia.PathBuilder.Make();
            addOutline(builder, traceOutline(trace, tail, from, tail.n - 1, from === 0, true));
            path = builder.build();
        }
        liveCost.value = performance.now() - started;
        return path;
    });

    // Strokes are pending only for a frame or two, so rebuilding this on each
    // change costs little; with none pending it is an empty picture.
    const pendingPicture = useDerivedValue(() => {
        const recorder = Skia.PictureRecorder();
        const canvas = recorder.beginRecording(Skia.XYWHRect(-CANVAS_EXTENT, -CANVAS_EXTENT, CANVAS_EXTENT * 2, CANVAS_EXTENT * 2));
        pending.value.forEach(({ stroke }) => {
            canvas.drawPath(inkSkPath(stroke), makeInkPaint(stroke));
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
    const nativePages = isPages ? `${docWidth}|${pitch}|${pageCount}` : '';
    useLayoutEffect(() => {
        nativeExtras.current = {
            blocked: inkBlocked,
            invert: invertInk,
            pages: isPages ? [docWidth, pitch, pageHeight(docWidth), pageCount] : null,
        };
        pushNativeConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [inkBlocked, invertInk, nativePages, pushNativeConfig]);

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

    // The scene (desk, paper, finished ink) as it was last drawn into the cache,
    // and what changed since: the UI thread redraws only the changed part.
    const sceneVersion = useRef(0);
    const sceneChanges = useRef<number[][]>([]);
    const sceneStrokes = useRef<InkStroke[]>([]);
    const sceneLook = useRef<unknown[]>([]);
    useLayoutEffect(() => {
        if (!SCENE_CACHE) {
            return;
        }
        sceneVersion.current += 1;
        const version = sceneVersion.current;
        const look = [paperPictures, pageClip, invertInk, deskColor, surfaceKey];
        if (look.some((item, index) => item !== sceneLook.current[index])) {
            // A new look: the whole scene is drawn again.
            sceneChanges.current = [];
        } else {
            const box = changedBounds(sceneStrokes.current, baseStrokes);
            // Nothing in the scene changed (e.g. only the selection outline did): an empty change.
            sceneChanges.current = [...sceneChanges.current, box ? [version, box.minX, box.minY, box.maxX, box.maxY] : [version]].slice(-SCENE_CHANGES_KEPT);
        }
        sceneLook.current = look;
        sceneStrokes.current = baseStrokes;
        sceneSource.value = {
            version,
            changes: sceneChanges.current,
            sheet: paperPictures.sheet,
            pattern: paperPictures.pattern,
            ink: inkPicture,
            clip: pageClip ?? null,
            invert: invertInk,
            desk: deskColor,
            generation: surfaceKey,
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [inkPicture, paperPictures, pageClip, invertInk, deskColor, surfaceKey]);

    // Desk, paper and finished ink drawn once into an offscreen image, which is
    // all a frame then draws of them. Without it every frame replayed every
    // stroke: the eraser ring moving, each erase pass and each new stroke cost
    // as much as the whole page, and a full page fell far behind the pen.
    const pixelRatio = PixelRatio.get();
    const sceneImage = useDerivedValue(() => {
        const scene = sceneSource.value;
        // (Also runs once on the JS thread at mount, where there is no surface to draw in.)
        if (!SCENE_CACHE || !scene || !(globalThis as { _WORKLET?: boolean })._WORKLET) {
            return null;
        }
        const width = Math.ceil(viewW.value * pixelRatio);
        const height = Math.ceil(viewH.value * pixelRatio);
        if (width <= 0 || height <= 0) {
            return null;
        }
        const s = scaleSV.value * zoom.value;
        const x = tx.value;
        const y = ty.value;
        const fade = patternOpacity.value;
        const cache = sceneCache.value;
        let full = !cache.surface || cache.width !== width || cache.height !== height || cache.generation !== scene.generation
            || cache.tx !== x || cache.ty !== y || cache.s !== s || cache.fade !== fade;
        let box: number[] | null = null;
        if (!full) {
            if (cache.version === scene.version) {
                return cache.image;
            }
            // Every change since the last draw must be known, or all is drawn again.
            for (let v = cache.version + 1; v <= scene.version && !full; v++) {
                const change = scene.changes.find((entry) => entry[0] === v);
                if (!change) {
                    full = true;
                } else if (change.length === 5) {
                    box = box
                        ? [Math.min(box[0], change[1]), Math.min(box[1], change[2]), Math.max(box[2], change[3]), Math.max(box[3], change[4])]
                        : [change[1], change[2], change[3], change[4]];
                }
            }
            if (!full && !box) {
                cache.version = scene.version;
                sceneShown.value = scene.version;
                return cache.image;
            }
        }
        if (!cache.surface || cache.width !== width || cache.height !== height || cache.generation !== scene.generation) {
            // A GPU context lost in the background would leave the old surface unusable.
            cache.surface = Skia.Surface.MakeOffscreen(width, height);
            cache.width = width;
            cache.height = height;
            cache.generation = scene.generation;
            if (!cache.surface) {
                return null;
            }
        }
        const canvas = cache.surface.getCanvas();
        canvas.save();
        if (!full && box) {
            // The changed part on screen, out to whole pixels and the edge of antialiasing.
            const k = s * pixelRatio;
            const left = Math.floor((box[0] * s + x) * pixelRatio) - 2;
            const top = Math.floor((box[1] * s + y) * pixelRatio) - 2;
            canvas.clipRect(Skia.XYWHRect(left, top, Math.ceil((box[2] - box[0]) * k) + 5, Math.ceil((box[3] - box[1]) * k) + 5), ClipOp.Intersect, false);
        }
        canvas.clear(Skia.Color(scene.desk));
        canvas.scale(pixelRatio, pixelRatio);
        canvas.translate(x, y);
        canvas.scale(s, s);
        canvas.drawPicture(scene.sheet);
        if (scene.pattern && fade > 0) {
            const paint = Skia.Paint();
            paint.setAlphaf(fade);
            canvas.saveLayer(paint);
            canvas.drawPicture(scene.pattern);
            canvas.restore();
        }
        canvas.save();
        if (scene.clip) {
            canvas.clipPath(scene.clip, ClipOp.Intersect, true);
        }
        if (scene.invert) {
            const paint = Skia.Paint();
            paint.setColorFilter(Skia.ColorFilter.MakeMatrix(SMART_INVERT_MATRIX));
            canvas.saveLayer(paint);
            canvas.drawPicture(scene.ink);
            canvas.restore();
        } else {
            canvas.drawPicture(scene.ink);
        }
        canvas.restore();
        canvas.restore();
        cache.surface.flush();
        cache.image = cache.surface.makeImageSnapshot();
        cache.version = scene.version;
        sceneShown.value = scene.version;
        cache.tx = x;
        cache.ty = y;
        cache.s = s;
        cache.fade = fade;
        return cache.image;
    });
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

    // The live stroke shows in the pen it started with, as it will be committed.
    const liveColor = useDerivedValue(() => strokeCfg.value.color);
    const liveOpacity = useDerivedValue(() => INK_TOOLS[strokeCfg.value.tool]?.opacity ?? 1);
    const liveBlend = useDerivedValue(() => (strokeCfg.value.tool === 'marker' ? 'multiply' : 'srcOver'));
    const liveGrainMatrix = useDerivedValue(() => pencilGrainMatrix(strokeCfg.value.color));
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
                        {SCENE_CACHE ? (
                            <Image image={sceneImage} x={0} y={0} width={view.width} height={view.height} fit="fill" />
                        ) : (
                            <Fill color={deskColor} />
                        )}
                        <Group transform={transform}>
                            {!SCENE_CACHE && <Picture picture={paperPictures.sheet} />}
                            {!SCENE_CACHE && paperPictures.pattern && <Picture picture={paperPictures.pattern} opacity={patternOpacity} />}
                            <Group layer={inkLayer} clip={pageClip}>
                                {!SCENE_CACHE && <Picture picture={inkPicture} />}
                                <Picture picture={pendingPicture} />
                                <Path path={livePath} color={liveColor} opacity={liveOpacity} blendMode={liveBlend}>
                                    {liveGrain && <PencilGrain matrix={liveGrainMatrix} />}
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
                {NATIVE_INK && view.width > 0 && (
                    <InkLiveView
                        ref={attachNativeInk}
                        style={StyleSheet.absoluteFill}
                        pointerEvents="none"
                        onInkBegin={handleInkBegin}
                        onInkStroke={handleInkStroke}
                    />
                )}
                {/* One blank page always follows the last one written on: count once there are two with ink. */}
                {isPages && pageCount > 2 && (
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
