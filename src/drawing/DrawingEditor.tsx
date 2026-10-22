import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors, isDarkScheme } from '../theme/colors';
import { createStyles } from '../theme/createStyles';
import { DrawingCanvas, PaperTemplate } from './DrawingCanvas';
import { DrawingDocument } from './drawingEmbeds';
import { INK_COLORS, INK_DEFAULT_COLOR, INK_TOOL_ORDER, INK_TOOLS, InkStroke, InkTool, strokeHit } from './ink';

type Props = {
    visible: boolean;
    /** Existing drawing to edit, or a fresh one (no strokes). */
    document: DrawingDocument | null;
    onSave: (doc: DrawingDocument) => void;
    onClose: () => void;
};

type ToolSettings = Record<InkTool, { color: string; sizeIndex: number }>;

const TOOL_ICONS: Record<InkTool, keyof typeof MaterialCommunityIcons.glyphMap> = {
    fountain: 'fountain-pen-tip',
    ballpoint: 'pen',
    pencil: 'pencil',
    brush: 'brush',
    marker: 'marker',
};

const TEMPLATE_ORDER: PaperTemplate[] = ['blank', 'lines', 'grid', 'dots'];
const TEMPLATE_ICONS: Record<PaperTemplate, keyof typeof MaterialCommunityIcons.glyphMap> = {
    blank: 'checkbox-blank-outline',
    lines: 'notebook-outline',
    grid: 'grid',
    dots: 'dots-grid',
};

const initialSettings = (): ToolSettings => INK_TOOL_ORDER.reduce((acc, tool) => {
    acc[tool] = { color: INK_DEFAULT_COLOR[tool], sizeIndex: 1 };
    return acc;
}, {} as ToolSettings);

// Settings survive closing the canvas, like a pen case.
let rememberedSettings: ToolSettings | null = null;
let rememberedTool: InkTool = 'fountain';
let rememberedTemplate: PaperTemplate = 'blank';

export const DrawingEditor: React.FC<Props> = ({ visible, document, onSave, onClose }) => {
    const { t } = useTranslation();
    const { width, height } = useWindowDimensions();
    const isTablet = Math.min(width, height) >= 600;
    const dark = isDarkScheme();

    const [strokes, setStrokes] = useState<InkStroke[]>([]);
    const [undoStack, setUndoStack] = useState<InkStroke[][]>([]);
    const [redoStack, setRedoStack] = useState<InkStroke[][]>([]);
    const [settings, setSettings] = useState<ToolSettings>(() => rememberedSettings || initialSettings());
    const [tool, setTool] = useState<InkTool>(rememberedTool);
    const [erasing, setErasing] = useState(false);
    const [popover, setPopover] = useState(false);
    const [template, setTemplate] = useState<PaperTemplate>(rememberedTemplate);
    const [stylusSeen, setStylusSeen] = useState(false);
    const [stylusOnly, setStylusOnly] = useState(false);
    // 0 until the canvas has measured itself (a new drawing takes its width).
    const [docWidth, setDocWidth] = useState(0);
    const strokesRef = useRef<InkStroke[]>([]);
    const eraseSnapshot = useRef<InkStroke[] | null>(null);

    useEffect(() => {
        if (!visible) {
            return;
        }
        const initial = document?.strokes || [];
        strokesRef.current = initial;
        setStrokes(initial);
        setUndoStack([]);
        setRedoStack([]);
        setPopover(false);
        setErasing(false);
        // A new drawing uses the whole canvas; the note shrinks it to its column.
        setDocWidth(document?.width || 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible, document]);

    useEffect(() => {
        rememberedSettings = settings;
        rememberedTool = tool;
        rememberedTemplate = template;
    }, [settings, tool, template]);

    const replaceStrokes = useCallback((next: InkStroke[], pushUndo: InkStroke[] | null) => {
        if (pushUndo) {
            setUndoStack((stack) => [...stack.slice(-99), pushUndo]);
            setRedoStack([]);
        }
        strokesRef.current = next;
        setStrokes(next);
    }, []);

    const handleCommit = useCallback((stroke: InkStroke) => {
        const prev = strokesRef.current;
        replaceStrokes([...prev, stroke], prev);
        setPopover(false);
    }, [replaceStrokes]);

    const handleErase = useCallback((x: number, y: number, radius: number) => {
        const prev = strokesRef.current;
        const next = prev.filter((stroke) => !strokeHit(stroke, x, y, radius));
        if (next.length === prev.length) {
            return;
        }
        // One undo step per eraser drag, however many strokes it removes.
        const first = eraseSnapshot.current === null;
        if (first) {
            eraseSnapshot.current = prev;
        }
        replaceStrokes(next, first ? prev : null);
    }, [replaceStrokes]);

    const handleEraseEnd = useCallback(() => {
        eraseSnapshot.current = null;
    }, []);

    const handleUndo = useCallback(() => {
        setUndoStack((stack) => {
            if (!stack.length) {
                return stack;
            }
            const previous = stack[stack.length - 1];
            setRedoStack((redo) => [...redo, strokesRef.current]);
            strokesRef.current = previous;
            setStrokes(previous);
            return stack.slice(0, -1);
        });
    }, []);

    const handleRedo = useCallback(() => {
        setRedoStack((stack) => {
            if (!stack.length) {
                return stack;
            }
            const next = stack[stack.length - 1];
            setUndoStack((undo) => [...undo, strokesRef.current]);
            strokesRef.current = next;
            setStrokes(next);
            return stack.slice(0, -1);
        });
    }, []);

    const handleStylus = useCallback(() => {
        setStylusSeen((seen) => {
            if (!seen) {
                // First pen contact: switch to pen-only drawing (palm rejection).
                setStylusOnly(true);
            }
            return true;
        });
    }, []);

    const handleToolPress = (next: InkTool) => {
        if (!erasing && next === tool) {
            setPopover((open) => !open);
            return;
        }
        setTool(next);
        setErasing(false);
        setPopover(false);
    };

    const handleMeasure = useCallback((canvasWidth: number) => {
        setDocWidth((current) => current || Math.round(canvasWidth));
    }, []);

    const handleDone = () => {
        onSave({ id: document?.id || '', width: docWidth || width, strokes: strokesRef.current });
    };

    const handleClose = () => {
        if (!undoStack.length) {
            onClose();
            return;
        }
        Alert.alert(
            t('drawing.discardTitle', 'Discard changes?'),
            t('drawing.discardBody', 'Your changes to this drawing will be lost.'),
            [
                { text: t('drawing.keepEditing', 'Keep editing'), style: 'cancel' },
                { text: t('drawing.discard', 'Discard'), style: 'destructive', onPress: onClose },
            ]
        );
    };

    const current = settings[tool];
    const sizes = INK_TOOLS[tool].sizes;
    const size = sizes[current.sizeIndex] ?? sizes[1];

    const toolPalette = (
        <View style={[styles.palette, isTablet ? styles.paletteFloating : styles.paletteDocked]}>
            {INK_TOOL_ORDER.map((inkTool) => {
                const active = !erasing && tool === inkTool;
                return (
                    <TouchableOpacity
                        key={inkTool}
                        onPress={() => handleToolPress(inkTool)}
                        style={[styles.toolButton, active && styles.toolButtonActive]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={t(`drawing.tool.${inkTool}`, inkTool)}
                    >
                        <MaterialCommunityIcons name={TOOL_ICONS[inkTool]} size={24} color={active ? colors.primary : colors.textSecondary} />
                        <View style={[styles.toolInk, { backgroundColor: settings[inkTool].color }]} />
                    </TouchableOpacity>
                );
            })}
            <TouchableOpacity
                onPress={() => { setErasing(true); setPopover(false); }}
                style={[styles.toolButton, erasing && styles.toolButtonActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: erasing }}
                accessibilityLabel={t('drawing.eraser', 'Eraser')}
            >
                <MaterialCommunityIcons name="eraser" size={24} color={erasing ? colors.primary : colors.textSecondary} />
            </TouchableOpacity>
            <View style={styles.paletteDivider} />
            <TouchableOpacity
                onPress={() => { setErasing(false); setPopover((open) => !open); }}
                style={styles.toolButton}
                accessibilityRole="button"
                accessibilityLabel={t('drawing.colorAndSize', 'Colour and size')}
            >
                <View style={[styles.colorDot, { backgroundColor: current.color }]} />
            </TouchableOpacity>
        </View>
    );

    const toolPopover = popover && !erasing && (
        <View style={[styles.popover, isTablet ? styles.popoverTablet : styles.popoverPhone]}>
            <View style={styles.sizeRow}>
                {sizes.map((value, index) => {
                    const active = index === current.sizeIndex;
                    const dot = 5 + (23 * index) / (sizes.length - 1);
                    return (
                        <TouchableOpacity
                            key={value}
                            onPress={() => setSettings((prev) => ({ ...prev, [tool]: { ...prev[tool], sizeIndex: index } }))}
                            style={[styles.sizeButton, active && styles.sizeButtonActive]}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active }}
                            accessibilityLabel={`${t('drawing.size', 'Size')} ${index + 1}`}
                        >
                            <View
                                style={{
                                    width: dot,
                                    height: dot,
                                    borderRadius: 15,
                                    backgroundColor: current.color,
                                    opacity: INK_TOOLS[tool].opacity < 1 ? 0.6 : 1,
                                }}
                            />
                        </TouchableOpacity>
                    );
                })}
            </View>
            <View style={styles.colorGrid}>
                {INK_COLORS.map((swatch) => {
                    const active = swatch === current.color;
                    return (
                        <TouchableOpacity
                            key={swatch}
                            onPress={() => setSettings((prev) => ({ ...prev, [tool]: { ...prev[tool], color: swatch } }))}
                            style={[styles.swatchRing, active && { borderColor: colors.primary }]}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active }}
                            accessibilityLabel={swatch}
                        >
                            <View style={[styles.swatch, { backgroundColor: swatch }]} />
                        </TouchableOpacity>
                    );
                })}
            </View>
        </View>
    );

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={handleClose} supportedOrientations={['portrait', 'landscape']}>
            <GestureHandlerRootView style={styles.root}>
                <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top', 'bottom', 'left', 'right']}>
                    <View style={[styles.header, { borderBottomColor: colors.border }]}>
                        <TouchableOpacity onPress={handleClose} style={styles.headerButton} accessibilityRole="button" accessibilityLabel={t('a11y.close', 'Close')}>
                            <MaterialIcons name="close" size={24} color={colors.text} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={handleUndo} disabled={!undoStack.length} style={styles.headerButton} accessibilityRole="button" accessibilityLabel={t('a11y.undo', 'Undo')}>
                            <MaterialIcons name="undo" size={24} color={undoStack.length ? colors.text : colors.textMuted} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={handleRedo} disabled={!redoStack.length} style={styles.headerButton} accessibilityRole="button" accessibilityLabel={t('a11y.redo', 'Redo')}>
                            <MaterialIcons name="redo" size={24} color={redoStack.length ? colors.text : colors.textMuted} />
                        </TouchableOpacity>
                        <View style={styles.headerSpacer} />
                        {stylusSeen && (
                            <TouchableOpacity
                                onPress={() => setStylusOnly((value) => !value)}
                                style={[styles.headerButton, !stylusOnly && styles.toolButtonActive]}
                                accessibilityRole="switch"
                                accessibilityState={{ checked: !stylusOnly }}
                                accessibilityLabel={t('drawing.fingerDrawing', 'Draw with finger')}
                            >
                                <MaterialCommunityIcons name={stylusOnly ? 'hand-back-right-off' : 'hand-back-right'} size={22} color={stylusOnly ? colors.textSecondary : colors.primary} />
                            </TouchableOpacity>
                        )}
                        <TouchableOpacity
                            onPress={() => setTemplate((value) => TEMPLATE_ORDER[(TEMPLATE_ORDER.indexOf(value) + 1) % TEMPLATE_ORDER.length])}
                            style={styles.headerButton}
                            accessibilityRole="button"
                            accessibilityLabel={t('drawing.paper', 'Paper')}
                        >
                            <MaterialCommunityIcons name={TEMPLATE_ICONS[template]} size={22} color={colors.textSecondary} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={handleDone} style={[styles.doneButton, { backgroundColor: colors.primary }]} accessibilityRole="button" accessibilityLabel={t('a11y.done', 'Done')}>
                            <Text style={[styles.doneText, { color: colors.onPrimary }]}>{t('drawing.done', 'Done')}</Text>
                        </TouchableOpacity>
                    </View>

                    <View style={styles.root}>
                        <DrawingCanvas
                            strokes={strokes}
                            docWidth={docWidth}
                            onMeasure={handleMeasure}
                            tool={tool}
                            color={current.color}
                            size={size}
                            erasing={erasing}
                            stylusOnly={stylusOnly}
                            template={template}
                            dark={dark}
                            paperColor={colors.background}
                            deskColor={colors.backgroundSecondary}
                            lineColor={colors.border}
                            onCommit={handleCommit}
                            onErase={handleErase}
                            onEraseEnd={handleEraseEnd}
                            onStylus={handleStylus}
                            onUndo={handleUndo}
                            onRedo={handleRedo}
                        />
                        {isTablet && (
                            <View pointerEvents="box-none" style={styles.floatingLayer}>
                                {toolPalette}
                                {toolPopover}
                            </View>
                        )}
                        {!isTablet && popover && (
                            <Pressable style={StyleSheet.absoluteFill} onPress={() => setPopover(false)} accessibilityLabel={t('a11y.close', 'Close')} />
                        )}
                        {!isTablet && toolPopover}
                    </View>
                    {!isTablet && toolPalette}
                </SafeAreaView>
            </GestureHandlerRootView>
        </Modal>
    );
};

const styles = createStyles(() => ({
    root: { flex: 1 },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        height: 52,
        borderBottomWidth: StyleSheet.hairlineWidth,
        gap: 4,
    },
    headerButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
    headerSpacer: { flex: 1 },
    doneButton: { paddingHorizontal: 18, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
    doneText: { fontSize: 15, fontWeight: '600' },
    floatingLayer: { position: 'absolute', top: 12, left: 0, right: 0, alignItems: 'center' },
    palette: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surface,
        paddingHorizontal: 6,
        gap: 2,
    },
    paletteFloating: {
        borderRadius: 28,
        paddingVertical: 4,
        shadowColor: '#000',
        shadowOpacity: 0.16,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 4 },
        elevation: 6,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
    },
    paletteDocked: {
        justifyContent: 'space-around',
        paddingVertical: 6,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: colors.border,
    },
    paletteDivider: { width: StyleSheet.hairlineWidth, height: 28, backgroundColor: colors.border, marginHorizontal: 4 },
    toolButton: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
    toolButtonActive: { backgroundColor: colors.backgroundSecondary },
    toolInk: { position: 'absolute', bottom: 7, width: 14, height: 3, borderRadius: 2 },
    colorDot: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: colors.border },
    popover: {
        backgroundColor: colors.surface,
        borderRadius: 20,
        padding: 14,
        gap: 14,
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 6 },
        elevation: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
    },
    popoverTablet: { marginTop: 10, width: 340 },
    popoverPhone: { position: 'absolute', left: 12, right: 12, bottom: 8 },
    sizeRow: { flexDirection: 'row', justifyContent: 'space-between' },
    sizeButton: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
    sizeButtonActive: { backgroundColor: colors.backgroundSecondary },
    colorGrid: { flexDirection: 'row', flexWrap: 'wrap', alignSelf: 'center', width: 6 * 44 + 5 * 8, gap: 8 },
    swatchRing: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
    swatch: { width: 32, height: 32, borderRadius: 16 },
}));
