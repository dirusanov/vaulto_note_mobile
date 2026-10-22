import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { AppState, LayoutChangeEvent, StyleSheet, View } from 'react-native';
import {
    Canvas,
    Circle,
    ColorMatrix,
    FractalNoise,
    Group,
    Paint,
    Path,
    Rect,
    Skia,
    SkPath,
    Text as SkiaText,
} from '@shopify/react-native-skia';
import { Gesture, GestureDetector, PointerType } from 'react-native-gesture-handler';
import { runOnJS, runOnUI, useDerivedValue, useSharedValue } from 'react-native-reanimated';
import { INK_TOOLS, InkStroke, InkText, InkTool, SMART_INVERT_MATRIX, pencilGrainMatrix, strokeOutline, strokeOutlineFor } from './ink';
import { TextBox } from './drawingModel';
import { drawingBounds } from './drawingFormat';
import { PAPER_MARGIN_COLOR, PAPER_MARGIN_X, PaperStyle, paperDotRadius, paperGeometry, paperLineColor } from './paper';
import { fontFor, lineBaseline, textLines } from './textLayout';

export type CanvasMode = 'ink' | 'erase' | 'text';

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
    /** Label being edited in the text field overlay; the canvas does not draw it. */
    editingText: number | null;
    dark: boolean;
    themePaperColor: string;
    themeLineColor: string;
    deskColor: string;
    onCommit: (stroke: InkStroke) => void;
    onErase: (x: number, y: number, radius: number) => void;
    onEraseEnd: () => void;
    onTextTap: (tap: TextTap) => void;
    onTextMove: (index: number, dx: number, dy: number) => void;
    onStylus: () => void;
    onUndo: () => void;
    onRedo: () => void;
};

const MAX_ZOOM = 4;
const ERASER_SCREEN_RADIUS = 14;
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

const buildPaperPaths = (paper: PaperStyle, width: number, height: number) => {
    const { lines, dots } = paperGeometry(paper.pattern, width, height);
    let linePath: SkPath | null = null;
    let dotPath: SkPath | null = null;
    if (lines.length) {
        const builder = Skia.PathBuilder.Make();
        for (let i = 0; i < lines.length; i += 4) {
            builder.moveTo(lines[i], lines[i + 1]);
            builder.lineTo(lines[i + 2], lines[i + 3]);
        }
        linePath = builder.build();
    }
    if (dots.length) {
        const builder = Skia.PathBuilder.Make();
        for (let i = 0; i < dots.length; i += 2) {
            builder.addCircle(dots[i], dots[i + 1], paperDotRadius);
        }
        dotPath = builder.build();
    }
    return { linePath, dotPath };
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

const Label: React.FC<{ item: InkText }> = ({ item }) => {
    const font = fontFor(item.size);
    return (
        <>
            {textLines(item.text).map((line, index) => (line ? (
                <SkiaText key={index} x={item.x} y={item.y + lineBaseline(item.size, index)} text={line} font={font} color={item.color} />
            ) : null))}
        </>
    );
};

export const DrawingCanvas = forwardRef<DrawingCanvasHandle, Props>(({
    bottomInset, strokes, texts, textBoxes, paper, docWidth: docWidthProp, onMeasure, mode: canvasMode, tool, color, size, stylusOnly,
    editingText, dark, themePaperColor, themeLineColor, deskColor,
    onCommit, onErase, onEraseEnd, onTextTap, onTextMove, onStylus, onUndo, onRedo,
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

    const zoom = useSharedValue(1);
    const tx = useSharedValue(0);
    const ty = useSharedValue(0);
    const scaleSV = useSharedValue(baseScale);
    const docW = useSharedValue(docWidth);
    const viewW = useSharedValue(0);
    const viewH = useSharedValue(0);
    const contentBottom = useSharedValue(0);
    const bottomInsetSV = useSharedValue(0);
    // The JS thread does not see a shared value it wrote in the same tick, so
    // panBy (JS) reads the inset from a ref; worklets read the shared value.
    const bottomInsetRef = useRef(bottomInset);
    bottomInsetRef.current = bottomInset;

    const live = useSharedValue<number[]>([]);
    const liveId = useSharedValue(0);
    const lastSample = useSharedValue({ x: 0, y: 0, t: 0, p: 0.5 });
    const gestureMode = useSharedValue<'draw' | 'erase' | 'scroll' | 'text' | 'none'>('none');
    const eraser = useSharedValue({ x: -100, y: -100, visible: false });
    const hover = useSharedValue({ x: -100, y: -100, visible: false });
    const textBoxesSV = useSharedValue<number[]>([]);
    const textGesture = useSharedValue({ index: -1, startX: 0, startY: 0, screenX: 0, screenY: 0, moved: false });
    const dragOffset = useSharedValue({ dx: 0, dy: 0 });
    /** A second finger joined (pinch/scroll): the one-finger action it interrupted is void. */
    const multiTouch = useSharedValue(false);
    const [dragIndex, setDragIndex] = useState<number | null>(null);

    const toolSV = useSharedValue({ mode: canvasMode, tool, color, size, stylusOnly });
    useEffect(() => {
        toolSV.value = { mode: canvasMode, tool, color, size, stylusOnly };
    }, [canvasMode, tool, color, size, stylusOnly, toolSV]);

    useEffect(() => {
        textBoxesSV.value = texts.flatMap((item, index) => {
            const box = textBoxes[index] || { width: 0, height: 0 };
            return [item.x, item.y, box.width, box.height];
        });
    }, [texts, textBoxes, textBoxesSV]);

    useEffect(() => {
        scaleSV.value = baseScale;
        viewW.value = view.width;
        viewH.value = view.height;
        docW.value = docWidth;
        // On the UI thread, where the values written above are already visible.
        runOnUI(clampPan)();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [baseScale, view, docWidth]);

    const bounds = useMemo(() => drawingBounds(strokes, texts), [strokes, texts]);
    useEffect(() => {
        contentBottom.value = bounds ? bounds.maxY : 0;
    }, [bounds, contentBottom]);

    /**
     * Lowest scroll offset: past the content by 60% of a screen (room to keep
     * writing), never less than one screen of page, plus the bottom inset (the
     * keyboard) so any visible spot can be lifted above it.
     */
    const minScrollY = (z: number, inset: number) => {
        'worklet';
        const pageHeight = Math.max(contentBottom.value * scaleSV.value * z + viewH.value * 0.6, viewH.value);
        return -Math.max(0, pageHeight + inset - viewH.value);
    };

    const clampPan = () => {
        'worklet';
        const z = zoom.value;
        const pageWidth = docW.value * scaleSV.value * z;
        if (pageWidth <= viewW.value) {
            tx.value = (viewW.value - pageWidth) / 2;
        } else {
            tx.value = Math.min(0, Math.max(viewW.value - pageWidth, tx.value));
        }
        ty.value = Math.min(0, Math.max(minScrollY(z, bottomInsetSV.value), ty.value));
    };

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
            const next = Math.min(0, Math.max(minScrollY(zoom.value, bottomInsetRef.current), before + dy));
            ty.value = next;
            return next - before;
        },
    }), [zoom, contentBottom, scaleSV, viewH, bottomInsetSV, ty]);

    const commitLive = useCallback((points: number[], id: number, strokeTool: InkTool, strokeColor: string, strokeSize: number) => {
        onCommit({ tool: strokeTool, color: strokeColor, size: strokeSize, points });
        // Drop the live copy only after the committed path has rendered, and only
        // if no new stroke has started meanwhile (fast handwriting).
        requestAnimationFrame(() => {
            if (liveId.value === id) {
                live.value = [];
            }
        });
    }, [onCommit, live, liveId]);

    const finishTextDrag = useCallback((index: number, dx: number, dy: number) => {
        onTextMove(index, dx, dy);
        requestAnimationFrame(() => {
            setDragIndex(null);
            dragOffset.value = { dx: 0, dy: 0 };
        });
    }, [onTextMove, dragOffset]);

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

    const draw = Gesture.Pan()
        .maxPointers(1)
        .minDistance(0)
        .averageTouches(false)
        .onBegin((e) => {
            const isStylus = e.pointerType === PointerType.STYLUS;
            if (isStylus) {
                runOnJS(onStylus)();
            }
            const cfg = toolSV.value;
            // Typing a label is fine with a finger; drawing obeys pen-only mode.
            if (cfg.stylusOnly && !isStylus && cfg.mode !== 'text') {
                gestureMode.value = 'scroll';
                return;
            }
            hover.value = { x: -100, y: -100, visible: false };
            multiTouch.value = false;
            const pt = toDoc(e.x, e.y);
            const scale = scaleSV.value * zoom.value;
            if (cfg.mode === 'text') {
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
            if (cfg.mode === 'erase') {
                gestureMode.value = 'erase';
                eraser.value = { x: e.x, y: e.y, visible: true };
                runOnJS(onErase)(pt.x, pt.y, ERASER_SCREEN_RADIUS / scale);
                return;
            }
            gestureMode.value = 'draw';
            const pressure = isStylus && e.stylusData && e.stylusData.pressure >= 0 ? e.stylusData.pressure : 0.55;
            lastSample.value = { x: e.x, y: e.y, t: Date.now(), p: pressure };
            liveId.value += 1;
            live.value = [pt.x, pt.y, pressure];
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
                    runOnJS(setDragIndex)(g.index);
                }
                dragOffset.value = { dx: pt.x - g.startX, dy: pt.y - g.startY };
                return;
            }
            if (current === 'erase') {
                eraser.value = { x: e.x, y: e.y, visible: true };
                runOnJS(onErase)(pt.x, pt.y, ERASER_SCREEN_RADIUS / (scaleSV.value * zoom.value));
                return;
            }
            let pressure: number;
            if (e.pointerType === PointerType.STYLUS && e.stylusData && e.stylusData.pressure >= 0) {
                pressure = e.stylusData.pressure;
            } else {
                // A finger has no pressure: faster movement draws thinner, like ink.
                const now = Date.now();
                const prev = lastSample.value;
                const dt = Math.max(1, now - prev.t);
                const speed = Math.hypot(e.x - prev.x, e.y - prev.y) / dt;
                const target = Math.min(0.9, Math.max(0.2, 0.85 - speed * 0.22));
                pressure = prev.p + (target - prev.p) * 0.3;
                lastSample.value = { x: e.x, y: e.y, t: now, p: pressure };
            }
            live.modify((points) => {
                'worklet';
                points.push(pt.x, pt.y, pressure);
                return points;
            });
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
                    runOnJS(finishTextDrag)(g.index, offset.dx, offset.dy);
                } else if (!multiTouch.value) {
                    runOnJS(onTextTap)({
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
                runOnJS(onEraseEnd)();
                return;
            }
            if (current !== 'draw') {
                return;
            }
            const points = live.value.slice();
            // A second finger landing (pinch) cancels the stroke it interrupted.
            if (multiTouch.value) {
                live.value = [];
                return;
            }
            const cfg = toolSV.value;
            runOnJS(commitLive)(points, liveId.value, cfg.tool, cfg.color, cfg.size);
        });

    const pinchStart = useSharedValue({ zoom: 1, tx: 0, ty: 0 });
    const pinch = Gesture.Pinch()
        .onStart(() => {
            // Active only once two fingers are down (onBegin fires on the first).
            multiTouch.value = true;
            pinchStart.value = { zoom: zoom.value, tx: tx.value, ty: ty.value };
        })
        .onUpdate((e) => {
            const start = pinchStart.value;
            const next = Math.min(MAX_ZOOM, Math.max(1, start.zoom * e.scale));
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
        });

    const undoTap = Gesture.Tap().minPointers(2).maxDuration(250).onEnd((e, success) => {
        if (success && e.numberOfPointers === 2) {
            runOnJS(onUndo)();
        }
    });
    const redoTap = Gesture.Tap().minPointers(3).maxDuration(250).onEnd((e, success) => {
        if (success && e.numberOfPointers >= 3) {
            runOnJS(onRedo)();
        }
    });

    const hoverGesture = Gesture.Hover()
        .onUpdate((e) => {
            hover.value = { x: e.x, y: e.y, visible: true };
        })
        .onEnd(() => {
            hover.value = { x: -100, y: -100, visible: false };
        });

    const gesture = Gesture.Simultaneous(draw, pinch, scroll, undoTap, redoTap, hoverGesture);

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
        return outlineToSkPath(strokeOutline(live.value, cfg.size, spec.thinning, spec.streamline, spec.taper, false, spec.nib));
    });

    const eraserX = useDerivedValue(() => eraser.value.x);
    const eraserY = useDerivedValue(() => eraser.value.y);
    const eraserOpacity = useDerivedValue(() => (eraser.value.visible ? 1 : 0));
    const hoverX = useDerivedValue(() => hover.value.x);
    const hoverY = useDerivedValue(() => hover.value.y);
    const hoverRadius = useDerivedValue(() => {
        const cfg = toolSV.value;
        if (cfg.mode === 'erase') {
            return ERASER_SCREEN_RADIUS;
        }
        return Math.max(2, (cfg.mode === 'text' ? 3 : cfg.size / 2) * scaleSV.value * zoom.value);
    });
    const hoverOpacity = useDerivedValue(() => (hover.value.visible ? 0.45 : 0));

    const paperHeight = Math.ceil(((bounds?.maxY ?? 0) + (view.height / baseScale) * 3) / 512) * 512;
    const { linePath, dotPath } = useMemo(
        () => buildPaperPaths(paper, docWidth, paperHeight),
        [paper, docWidth, paperHeight]
    );
    const sheetColor = paper.color || themePaperColor;
    const lineColor = paperLineColor(paper.color, themeLineColor);
    // The theme's own paper flips with dark mode, and so does the ink on it; a
    // sheet with its own colour keeps true colours, as it will in the note.
    const invertInk = dark && !paper.color;

    const strokePaths = strokes.map((stroke, index) => (
        <Path
            key={index}
            path={pathFor(stroke)}
            color={stroke.color}
            opacity={INK_TOOLS[stroke.tool]?.opacity ?? 1}
        >
            {INK_TOOLS[stroke.tool]?.grain && <PencilGrain color={stroke.color} />}
        </Path>
    ));
    const labels = texts.map((item, index) => (
        index === editingText || index === dragIndex ? null : <Label key={index} item={item} />
    ));

    const liveOpacity = INK_TOOLS[tool]?.opacity ?? 1;
    const liveGrain = canvasMode === 'ink' && INK_TOOLS[tool]?.grain;
    const inkLayer = invertInk ? (
        <Paint>
            <ColorMatrix matrix={SMART_INVERT_MATRIX} />
        </Paint>
    ) : undefined;
    const sheetClip = { x: 0, y: -4000, width: docWidth, height: paperHeight + 8000 };

    const handleLayout = (event: LayoutChangeEvent) => {
        const { width, height } = event.nativeEvent.layout;
        setView({ width, height });
    };

    return (
        <GestureDetector gesture={gesture}>
            <View style={[styles.fill, { backgroundColor: deskColor }]} onLayout={handleLayout} collapsable={false}>
                {view.width > 0 && (
                    <Canvas key={surfaceKey} style={styles.fill}>
                        <Group transform={transform}>
                            <Rect {...sheetClip} color={sheetColor} />
                            <Group clip={sheetClip}>
                                {linePath && <Path path={linePath} color={lineColor} style="stroke" strokeWidth={1 / baseScale} />}
                                {dotPath && <Path path={dotPath} color={lineColor} />}
                                {paper.pattern === 'margin' && (
                                    <Rect x={PAPER_MARGIN_X - 0.5} y={sheetClip.y} width={1 / baseScale} height={sheetClip.height} color={PAPER_MARGIN_COLOR} />
                                )}
                            </Group>
                            <Group layer={inkLayer} clip={sheetClip}>
                                {strokePaths}
                                <Path path={livePath} color={color} opacity={liveOpacity}>
                                    {liveGrain && <PencilGrain color={color} />}
                                </Path>
                                {labels}
                                {dragIndex !== null && texts[dragIndex] && (
                                    <Group transform={dragTransform}>
                                        <Label item={texts[dragIndex]} />
                                    </Group>
                                )}
                            </Group>
                        </Group>
                        <Circle cx={eraserX} cy={eraserY} r={ERASER_SCREEN_RADIUS} color={lineColor} style="stroke" strokeWidth={1.5} opacity={eraserOpacity} />
                        <Circle cx={hoverX} cy={hoverY} r={hoverRadius} color={invertInk ? '#FFFFFF' : color} opacity={hoverOpacity} />
                    </Canvas>
                )}
            </View>
        </GestureDetector>
    );
});
DrawingCanvas.displayName = 'DrawingCanvas';

const styles = StyleSheet.create({
    fill: { flex: 1 },
});
