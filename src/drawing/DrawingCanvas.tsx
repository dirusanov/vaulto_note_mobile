import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { Canvas, Circle, ColorMatrix, FractalNoise, Group, Paint, Path, Rect, Skia, SkPath } from '@shopify/react-native-skia';
import { Gesture, GestureDetector, PointerType } from 'react-native-gesture-handler';
import { runOnJS, runOnUI, useDerivedValue, useSharedValue } from 'react-native-reanimated';
import { INK_TOOLS, InkStroke, InkTool, SMART_INVERT_MATRIX, pencilGrainMatrix, strokeBounds, strokeOutline, strokeOutlineFor } from './ink';

export type PaperTemplate = 'blank' | 'lines' | 'grid' | 'dots';

type Props = {
    strokes: InkStroke[];
    /** Width of the drawing's coordinate space; 0 for a new drawing (see onMeasure). */
    docWidth: number;
    onMeasure: (canvasWidth: number) => void;
    tool: InkTool;
    color: string;
    size: number;
    erasing: boolean;
    /** Once a pen has touched the canvas, fingers scroll instead of drawing. */
    stylusOnly: boolean;
    template: PaperTemplate;
    dark: boolean;
    paperColor: string;
    deskColor: string;
    lineColor: string;
    onCommit: (stroke: InkStroke) => void;
    onErase: (x: number, y: number, radius: number) => void;
    onEraseEnd: () => void;
    onStylus: () => void;
    onUndo: () => void;
    onRedo: () => void;
};

const MAX_ZOOM = 4;
const PAPER_STEP = 32;
const ERASER_SCREEN_RADIUS = 14;

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

const buildPaperPath = (template: PaperTemplate, width: number, height: number): SkPath | null => {
    if (template === 'blank') {
        return null;
    }
    const path = Skia.PathBuilder.Make();
    for (let y = PAPER_STEP * 2; y < height; y += PAPER_STEP) {
        if (template === 'dots') {
            for (let x = PAPER_STEP; x < width; x += PAPER_STEP) {
                path.addCircle(x, y, 1.3);
            }
        } else {
            path.moveTo(0, y);
            path.lineTo(width, y);
        }
    }
    if (template === 'grid') {
        for (let x = PAPER_STEP; x < width; x += PAPER_STEP) {
            path.moveTo(x, 0);
            path.lineTo(x, height);
        }
    }
    return path.build();
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

export const DrawingCanvas: React.FC<Props> = ({
    strokes, docWidth: docWidthProp, onMeasure, tool, color, size, erasing, stylusOnly, template, dark, paperColor, deskColor, lineColor,
    onCommit, onErase, onEraseEnd, onStylus, onUndo, onRedo,
}) => {
    const [view, setView] = useState({ width: 0, height: 0 });
    const docWidth = docWidthProp || view.width || 1;
    useEffect(() => {
        if (!docWidthProp && view.width > 0) {
            onMeasure(view.width);
        }
    }, [docWidthProp, view.width, onMeasure]);
    // The page is the note's column: shown 1:1 on a tablet (with margins), fitted
    // to the screen on a phone. What you write is the size it has in the note.
    const baseScale = view.width > 0 ? Math.min(1, view.width / docWidth) : 1;

    const zoom = useSharedValue(1);
    const tx = useSharedValue(0);
    const ty = useSharedValue(0);
    const scaleSV = useSharedValue(baseScale);
    const docW = useSharedValue(docWidth);
    const viewW = useSharedValue(0);
    const viewH = useSharedValue(0);
    const contentBottom = useSharedValue(0);

    const live = useSharedValue<number[]>([]);
    const liveId = useSharedValue(0);
    const lastSample = useSharedValue({ x: 0, y: 0, t: 0, p: 0.5 });
    const mode = useSharedValue<'draw' | 'erase' | 'scroll' | 'none'>('none');
    const eraser = useSharedValue({ x: -100, y: -100, visible: false });
    const hover = useSharedValue({ x: -100, y: -100, visible: false });

    const toolSV = useSharedValue({ tool, color, size, erasing, stylusOnly });
    useEffect(() => {
        toolSV.value = { tool, color, size, erasing, stylusOnly };
    }, [tool, color, size, erasing, stylusOnly, toolSV]);

    useEffect(() => {
        scaleSV.value = baseScale;
        viewW.value = view.width;
        viewH.value = view.height;
        docW.value = docWidth;
        // On the UI thread, where the values written above are already visible.
        runOnUI(clampPan)();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [baseScale, view, docWidth]);

    const bounds = useMemo(() => strokeBounds(strokes), [strokes]);
    useEffect(() => {
        contentBottom.value = bounds ? bounds.maxY : 0;
    }, [bounds, contentBottom]);

    const clampPan = () => {
        'worklet';
        const z = zoom.value;
        const pageWidth = docW.value * scaleSV.value * z;
        if (pageWidth <= viewW.value) {
            tx.value = (viewW.value - pageWidth) / 2;
        } else {
            tx.value = Math.min(0, Math.max(viewW.value - pageWidth, tx.value));
        }
        const contentHeight = contentBottom.value * scaleSV.value * z + viewH.value * 0.6;
        const minTy = -Math.max(0, contentHeight - viewH.value);
        ty.value = Math.min(0, Math.max(minTy, ty.value));
    };

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

    const toDoc = (x: number, y: number) => {
        'worklet';
        const s = scaleSV.value * zoom.value;
        return { x: (x - tx.value) / s, y: (y - ty.value) / s };
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
            if (cfg.stylusOnly && !isStylus) {
                mode.value = 'scroll';
                return;
            }
            hover.value = { x: -100, y: -100, visible: false };
            const pt = toDoc(e.x, e.y);
            if (cfg.erasing) {
                mode.value = 'erase';
                eraser.value = { x: e.x, y: e.y, visible: true };
                runOnJS(onErase)(pt.x, pt.y, ERASER_SCREEN_RADIUS / (scaleSV.value * zoom.value));
                return;
            }
            mode.value = 'draw';
            const pressure = isStylus && e.stylusData && e.stylusData.pressure >= 0 ? e.stylusData.pressure : 0.55;
            lastSample.value = { x: e.x, y: e.y, t: Date.now(), p: pressure };
            liveId.value += 1;
            live.value = [pt.x, pt.y, pressure];
        })
        .onChange((e) => {
            if (mode.value === 'scroll') {
                tx.value += e.changeX;
                ty.value += e.changeY;
                clampPan();
            }
        })
        .onUpdate((e) => {
            if (mode.value === 'scroll') {
                return;
            }
            const pt = toDoc(e.x, e.y);
            if (mode.value === 'erase') {
                eraser.value = { x: e.x, y: e.y, visible: true };
                runOnJS(onErase)(pt.x, pt.y, ERASER_SCREEN_RADIUS / (scaleSV.value * zoom.value));
                return;
            }
            if (mode.value !== 'draw') {
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
        .onFinalize((_e, success) => {
            const current = mode.value;
            mode.value = 'none';
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
            if (!success && points.length < 9) {
                live.value = [];
                return;
            }
            const cfg = toolSV.value;
            runOnJS(commitLive)(points, liveId.value, cfg.tool, cfg.color, cfg.size);
        });

    const pinchStart = useSharedValue({ zoom: 1, tx: 0, ty: 0 });
    const pinch = Gesture.Pinch()
        .onStart(() => {
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
        return cfg.erasing ? ERASER_SCREEN_RADIUS : Math.max(2, (cfg.size / 2) * scaleSV.value * zoom.value);
    });
    const hoverOpacity = useDerivedValue(() => (hover.value.visible ? 0.45 : 0));

    const paperHeight = Math.ceil(((bounds?.maxY ?? 0) + (view.height / baseScale) * 3) / 512) * 512;
    const paperPath = useMemo(
        () => buildPaperPath(template, docWidth, paperHeight),
        [template, docWidth, paperHeight]
    );

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

    const liveOpacity = INK_TOOLS[tool]?.opacity ?? 1;
    const liveGrain = !erasing && INK_TOOLS[tool]?.grain;
    const inkLayer = dark ? (
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
                    <Canvas style={styles.fill}>
                        <Group transform={transform}>
                            <Rect x={0} y={-4000} width={docWidth} height={paperHeight + 8000} color={paperColor} />
                            {paperPath && (
                                <Path
                                    path={paperPath}
                                    color={lineColor}
                                    style={template === 'dots' ? 'fill' : 'stroke'}
                                    strokeWidth={1 / baseScale}
                                />
                            )}
                            <Group layer={inkLayer} clip={{ x: 0, y: -4000, width: docWidth, height: paperHeight + 8000 }}>
                                {strokePaths}
                                <Path path={livePath} color={color} opacity={liveOpacity}>
                                    {liveGrain && <PencilGrain color={color} />}
                                </Path>
                            </Group>
                        </Group>
                        <Circle cx={eraserX} cy={eraserY} r={ERASER_SCREEN_RADIUS} color={lineColor} style="stroke" strokeWidth={1.5} opacity={eraserOpacity} />
                        <Circle cx={hoverX} cy={hoverY} r={hoverRadius} color={dark ? '#FFFFFF' : color} opacity={hoverOpacity} />
                    </Canvas>
                )}
            </View>
        </GestureDetector>
    );
};

const styles = StyleSheet.create({
    fill: { flex: 1 },
});
