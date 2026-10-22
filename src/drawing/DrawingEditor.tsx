import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
    Alert,
    Keyboard,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    useWindowDimensions,
    View,
} from 'react-native';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors, isDarkScheme } from '../theme/colors';
import { createStyles } from '../theme/createStyles';
import { CanvasMode, DrawingCanvas, DrawingCanvasHandle, TextTap } from './DrawingCanvas';
import { ColorPanel } from './ColorPanel';
import { DrawingDocument } from './drawingFormat';
import { DrawingAction, drawingReducer, emptyContent, initialDrawingState } from './drawingModel';
import { INK_COLORS, INK_DEFAULT_COLOR, INK_TEXT_LINE_HEIGHT, INK_TOOL_ORDER, INK_TOOLS, InkStroke, InkTool } from './ink';
import { DEFAULT_PAPER, PaperStyle } from './paper';
import { PaperPicker } from './PaperPicker';
import { pushRecentColor } from './colorMath';
import { measureText } from './textLayout';

type Props = {
    visible: boolean;
    /** Existing drawing to edit, or a fresh one (no strokes). */
    document: DrawingDocument | null;
    onSave: (doc: DrawingDocument) => void;
    onClose: () => void;
};

type ActiveTool = InkTool | 'eraser' | 'text';
type SettingsKey = InkTool | 'text';
type ToolSettings = Record<SettingsKey, { color: string; sizeIndex: number }>;

/** A label being typed: `index` null for a new one. */
type TextEdit = {
    index: number | null;
    x: number;
    y: number;
    screenX: number;
    screenY: number;
    scale: number;
    value: string;
};

const TEXT_SIZES = [14, 18, 24, 32, 44];
/** Palette colours are always on screen, so only other colours go to "Recent". */
const INK_COLOR_SET = new Set(INK_COLORS);

const TOOL_ICONS: Record<InkTool, keyof typeof MaterialCommunityIcons.glyphMap> = {
    fountain: 'fountain-pen-tip',
    ballpoint: 'pen',
    pencil: 'pencil',
    brush: 'brush',
    marker: 'marker',
};

const initialSettings = (): ToolSettings => {
    const settings = INK_TOOL_ORDER.reduce((acc, tool) => {
        acc[tool] = { color: INK_DEFAULT_COLOR[tool], sizeIndex: 1 };
        return acc;
    }, {} as ToolSettings);
    settings.text = { color: '#1D1D1F', sizeIndex: 1 };
    return settings;
};

// Settings survive closing the canvas, like a pen case.
let rememberedSettings: ToolSettings | null = null;
let rememberedTool: ActiveTool = 'fountain';
let rememberedPaper: PaperStyle = DEFAULT_PAPER;
let rememberedRecent: string[] = [];

export const DrawingEditor: React.FC<Props> = ({ visible, document, onSave, onClose }) => {
    const { t } = useTranslation();
    const { width, height } = useWindowDimensions();
    const isTablet = Math.min(width, height) >= 600;
    const dark = isDarkScheme();

    const [state, dispatch] = useReducer(drawingReducer, undefined, () => initialDrawingState());
    const { strokes, texts, paper } = state.content;
    const [settings, setSettings] = useState<ToolSettings>(() => rememberedSettings || initialSettings());
    const [activeTool, setActiveTool] = useState<ActiveTool>(rememberedTool);
    const [recent, setRecent] = useState<string[]>(rememberedRecent);
    const [popover, setPopover] = useState<'tool' | 'paper' | null>(null);
    const [stylusSeen, setStylusSeen] = useState(false);
    const [stylusOnly, setStylusOnly] = useState(false);
    // 0 until the canvas has measured itself (a new drawing takes its width).
    const [docWidth, setDocWidth] = useState(0);
    const [textEdit, setTextEdit] = useState<TextEdit | null>(null);
    const customColorUsed = useRef(false);
    const canvasRef = useRef<DrawingCanvasHandle>(null);
    const canvasAreaRef = useRef<View>(null);
    /** Screen y of the keyboard's top edge while it is open. */
    const [keyboardTop, setKeyboardTop] = useState<number | null>(null);

    useEffect(() => {
        const show = Keyboard.addListener('keyboardDidShow', (event) => setKeyboardTop(event.endCoordinates.screenY));
        const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardTop(null));
        return () => {
            show.remove();
            hide.remove();
        };
    }, []);

    useEffect(() => {
        if (!visible) {
            return;
        }
        dispatch({
            type: 'load',
            content: document
                ? { strokes: document.strokes, texts: document.texts || [], paper: document.paper || DEFAULT_PAPER }
                : emptyContent(rememberedPaper),
        });
        setPopover(null);
        setTextEdit(null);
        setDocWidth(document?.width || 0);
    }, [visible, document]);

    useEffect(() => {
        rememberedSettings = settings;
        rememberedTool = activeTool;
        rememberedRecent = recent;
    }, [settings, activeTool, recent]);

    const textBoxes = useMemo(() => texts.map(measureText), [texts]);

    // A label typed low on the page would sit under the keyboard: scroll the page
    // up until the field (and a line below it) is visible, as notebook apps do.
    const editingLines = textEdit ? textEdit.value.split('\n').length : 0;
    useEffect(() => {
        if (!textEdit || keyboardTop === null || !canvasAreaRef.current) {
            return;
        }
        canvasAreaRef.current.measureInWindow((_x, areaY) => {
            const lineHeight = (TEXT_SIZES[settings.text.sizeIndex] ?? 18) * INK_TEXT_LINE_HEIGHT * textEdit.scale;
            const fieldBottom = areaY + textEdit.screenY + lineHeight * (editingLines + 1) + 16;
            const overlap = fieldBottom - keyboardTop;
            if (overlap > 0) {
                const applied = canvasRef.current?.panBy(-overlap) ?? 0;
                if (applied) {
                    setTextEdit((edit) => (edit ? { ...edit, screenY: edit.screenY + applied } : edit));
                }
            }
        });
    // Re-check when the keyboard opens, the label grows a line or its size changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [keyboardTop, editingLines, settings.text.sizeIndex, textEdit?.index, textEdit?.x, textEdit?.y]);

    const settingsKey: SettingsKey = activeTool === 'text' ? 'text' : activeTool === 'eraser' ? 'fountain' : activeTool;
    const current = settings[settingsKey];
    const inkTool: InkTool = activeTool === 'text' || activeTool === 'eraser' ? 'fountain' : activeTool;
    const sizes = activeTool === 'text' ? TEXT_SIZES : INK_TOOLS[inkTool].sizes;
    const size = sizes[current.sizeIndex] ?? sizes[1];
    const mode: CanvasMode = activeTool === 'eraser' ? 'erase' : activeTool === 'text' ? 'text' : 'ink';

    /** The action that stores the label being typed, if any. */
    const textEditAction = useCallback((edit: TextEdit | null): DrawingAction | null => {
        if (!edit) {
            return null;
        }
        const style = { size: TEXT_SIZES[settings.text.sizeIndex] ?? 18, color: settings.text.color };
        return edit.index === null
            ? { type: 'addText', text: { x: edit.x, y: edit.y, text: edit.value, ...style } }
            : { type: 'updateText', index: edit.index, patch: { text: edit.value, ...style } };
    }, [settings.text]);

    const commitTextEdit = useCallback(() => {
        const action = textEditAction(textEdit);
        if (action) {
            dispatch(action);
        }
        setTextEdit(null);
    }, [textEdit, textEditAction]);

    const closePopover = useCallback(() => {
        if (customColorUsed.current) {
            customColorUsed.current = false;
            setRecent((list) => pushRecentColor(list, settings[settingsKey].color));
        }
        setPopover(null);
    }, [settings, settingsKey]);

    const handleCommit = useCallback((stroke: InkStroke) => {
        dispatch({ type: 'addStroke', stroke });
        closePopover();
    }, [closePopover]);

    const handleErase = useCallback((x: number, y: number, radius: number) => {
        dispatch({ type: 'eraseAt', x, y, radius, boxes: textBoxes });
    }, [textBoxes]);

    const handleEraseEnd = useCallback(() => dispatch({ type: 'eraseEnd' }), []);
    const handleUndo = useCallback(() => dispatch({ type: 'undo' }), []);
    const handleRedo = useCallback(() => dispatch({ type: 'redo' }), []);

    const handleTextTap = useCallback((tap: TextTap) => {
        if (textEdit) {
            // The first tap outside the field finishes the label being typed.
            commitTextEdit();
            return;
        }
        closePopover();
        if (tap.index >= 0) {
            const item = texts[tap.index];
            setSettings((prev) => ({
                ...prev,
                text: { color: item.color, sizeIndex: Math.max(0, TEXT_SIZES.indexOf(item.size)) },
            }));
            setTextEdit({
                index: tap.index,
                x: item.x,
                y: item.y,
                screenX: tap.screenX - (tap.x - item.x) * tap.scale,
                screenY: tap.screenY - (tap.y - item.y) * tap.scale,
                scale: tap.scale,
                value: item.text,
            });
            return;
        }
        const textSize = TEXT_SIZES[settings.text.sizeIndex] ?? 18;
        // Put the first line where the finger is, not below it.
        const lift = (textSize * INK_TEXT_LINE_HEIGHT) / 2;
        setTextEdit({
            index: null,
            x: tap.x,
            y: tap.y - lift,
            screenX: tap.screenX,
            screenY: tap.screenY - lift * tap.scale,
            scale: tap.scale,
            value: '',
        });
    }, [textEdit, commitTextEdit, closePopover, texts, settings.text.sizeIndex]);

    const handleTextMove = useCallback((index: number, dx: number, dy: number) => {
        const item = texts[index];
        if (item) {
            dispatch({ type: 'updateText', index, patch: { x: item.x + dx, y: item.y + dy } });
        }
    }, [texts]);

    const handleStylus = useCallback(() => {
        setStylusSeen((seen) => {
            if (!seen) {
                // First pen contact: switch to pen-only drawing (palm rejection).
                setStylusOnly(true);
            }
            return true;
        });
    }, []);

    const handleMeasure = useCallback((canvasWidth: number) => {
        setDocWidth((value) => value || Math.round(canvasWidth));
    }, []);

    const selectTool = (next: ActiveTool) => {
        if (textEdit) {
            commitTextEdit();
        }
        if (next === activeTool && next !== 'eraser') {
            if (popover === 'tool') {
                closePopover();
            } else {
                setPopover('tool');
            }
            return;
        }
        closePopover();
        setActiveTool(next);
    };

    const setColor = (color: string, source: 'swatch' | 'custom') => {
        if (source === 'custom') {
            customColorUsed.current = true;
        } else {
            setRecent((list) => (INK_COLOR_SET.has(color) ? list : pushRecentColor(list, color)));
        }
        setSettings((prev) => ({ ...prev, [settingsKey]: { ...prev[settingsKey], color } }));
    };

    const setSizeIndex = (index: number) => {
        setSettings((prev) => ({ ...prev, [settingsKey]: { ...prev[settingsKey], sizeIndex: index } }));
    };

    const setPaper = (next: PaperStyle) => {
        rememberedPaper = next;
        dispatch({ type: 'setPaper', paper: next });
    };

    const handleDone = () => {
        // Include the label still being typed: the reducer is pure, so the final
        // content can be computed right here instead of waiting for a render.
        const action = textEditAction(textEdit);
        const content = action ? drawingReducer(state, action).content : state.content;
        onSave({ id: document?.id || '', width: docWidth || width, ...content });
    };

    const handleClose = () => {
        const changed = state.undo.length > 0 || !!textEdit?.value.trim();
        if (!changed) {
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

    const editingTextSize = TEXT_SIZES[settings.text.sizeIndex] ?? 18;

    const toolPalette = (
        <View style={[styles.palette, isTablet ? styles.paletteFloating : styles.paletteDocked]}>
            {INK_TOOL_ORDER.map((inkToolOption) => {
                const active = activeTool === inkToolOption;
                return (
                    <TouchableOpacity
                        key={inkToolOption}
                        onPress={() => selectTool(inkToolOption)}
                        style={[styles.toolButton, active && styles.toolButtonActive]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={t(`drawing.tool.${inkToolOption}`, inkToolOption)}
                    >
                        <MaterialCommunityIcons name={TOOL_ICONS[inkToolOption]} size={24} color={active ? colors.primary : colors.textSecondary} />
                        <View style={[styles.toolInk, { backgroundColor: settings[inkToolOption].color }]} />
                    </TouchableOpacity>
                );
            })}
            <TouchableOpacity
                onPress={() => selectTool('text')}
                style={[styles.toolButton, activeTool === 'text' && styles.toolButtonActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: activeTool === 'text' }}
                accessibilityLabel={t('drawing.tool.text', 'Text')}
            >
                <MaterialCommunityIcons name="format-text" size={24} color={activeTool === 'text' ? colors.primary : colors.textSecondary} />
                <View style={[styles.toolInk, { backgroundColor: settings.text.color }]} />
            </TouchableOpacity>
            <TouchableOpacity
                onPress={() => selectTool('eraser')}
                style={[styles.toolButton, activeTool === 'eraser' && styles.toolButtonActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: activeTool === 'eraser' }}
                accessibilityLabel={t('drawing.eraser', 'Eraser')}
            >
                <MaterialCommunityIcons name="eraser" size={24} color={activeTool === 'eraser' ? colors.primary : colors.textSecondary} />
            </TouchableOpacity>
            <View style={styles.paletteDivider} />
            <TouchableOpacity
                onPress={() => {
                    if (activeTool === 'eraser') {
                        setActiveTool('fountain');
                    }
                    setPopover((open) => (open === 'tool' ? null : 'tool'));
                }}
                style={styles.toolButton}
                accessibilityRole="button"
                accessibilityLabel={t('drawing.colorAndSize', 'Color and size')}
            >
                <View style={[styles.colorDot, { backgroundColor: current.color }]} />
            </TouchableOpacity>
        </View>
    );

    const sizeRow = (
        <View style={styles.sizeRow}>
            {sizes.map((value, index) => {
                const active = index === current.sizeIndex;
                const dot = 5 + (23 * index) / (sizes.length - 1);
                return (
                    <TouchableOpacity
                        key={value}
                        onPress={() => setSizeIndex(index)}
                        style={[styles.sizeButton, active && styles.sizeButtonActive]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={`${t('drawing.size', 'Size')} ${index + 1}`}
                    >
                        {activeTool === 'text' ? (
                            <Text style={{ fontSize: 11 + index * 4, color: current.color, fontWeight: '600' }}>A</Text>
                        ) : (
                            <View
                                style={{
                                    width: dot,
                                    height: dot,
                                    borderRadius: 15,
                                    backgroundColor: current.color,
                                    opacity: INK_TOOLS[inkTool].opacity < 1 ? 0.6 : 1,
                                }}
                            />
                        )}
                    </TouchableOpacity>
                );
            })}
        </View>
    );

    const popoverContent = popover === 'tool' && activeTool !== 'eraser'
        ? (
            <>
                {sizeRow}
                <ColorPanel color={current.color} recent={recent} onChange={setColor} />
            </>
        )
        : popover === 'paper'
            ? <PaperPicker paper={paper} onChange={setPaper} />
            : null;

    const popoverView = popoverContent && (
        <View
            style={[
                styles.popover,
                isTablet ? (popover === 'paper' ? styles.popoverTabletRight : styles.popoverTablet) : styles.popoverPhone,
                !isTablet && { maxHeight: height * 0.6 },
            ]}
        >
            <ScrollView contentContainerStyle={styles.popoverScroll} keyboardShouldPersistTaps="handled" bounces={false}>
                {popoverContent}
            </ScrollView>
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
                        <TouchableOpacity onPress={handleUndo} disabled={!state.undo.length} style={styles.headerButton} accessibilityRole="button" accessibilityLabel={t('a11y.undo', 'Undo')}>
                            <MaterialIcons name="undo" size={24} color={state.undo.length ? colors.text : colors.textMuted} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={handleRedo} disabled={!state.redo.length} style={styles.headerButton} accessibilityRole="button" accessibilityLabel={t('a11y.redo', 'Redo')}>
                            <MaterialIcons name="redo" size={24} color={state.redo.length ? colors.text : colors.textMuted} />
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
                            onPress={() => (popover === 'paper' ? closePopover() : setPopover('paper'))}
                            style={[styles.headerButton, popover === 'paper' && styles.toolButtonActive]}
                            accessibilityRole="button"
                            accessibilityState={{ expanded: popover === 'paper' }}
                            accessibilityLabel={t('drawing.paper.title', 'Paper')}
                        >
                            <MaterialCommunityIcons name="notebook-outline" size={22} color={popover === 'paper' ? colors.primary : colors.textSecondary} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={handleDone} style={[styles.doneButton, { backgroundColor: colors.primary }]} accessibilityRole="button" accessibilityLabel={t('a11y.done', 'Done')}>
                            <Text style={[styles.doneText, { color: colors.onPrimary }]}>{t('drawing.done', 'Done')}</Text>
                        </TouchableOpacity>
                    </View>

                    <View ref={canvasAreaRef} style={styles.root} collapsable={false}>
                        <DrawingCanvas
                            ref={canvasRef}
                            bottomInset={textEdit && keyboardTop !== null ? height - keyboardTop : 0}
                            strokes={strokes}
                            texts={texts}
                            textBoxes={textBoxes}
                            paper={paper}
                            docWidth={docWidth}
                            onMeasure={handleMeasure}
                            mode={mode}
                            tool={inkTool}
                            color={current.color}
                            size={size}
                            stylusOnly={stylusOnly}
                            editingText={textEdit?.index ?? null}
                            dark={dark}
                            themePaperColor={colors.background}
                            themeLineColor={colors.border}
                            deskColor={colors.backgroundSecondary}
                            onCommit={handleCommit}
                            onErase={handleErase}
                            onEraseEnd={handleEraseEnd}
                            onTextTap={handleTextTap}
                            onTextMove={handleTextMove}
                            onStylus={handleStylus}
                            onUndo={handleUndo}
                            onRedo={handleRedo}
                        />
                        {textEdit && (
                            <TextInput
                                autoFocus
                                multiline
                                value={textEdit.value}
                                onChangeText={(value) => setTextEdit((edit) => (edit ? { ...edit, value } : edit))}
                                onBlur={commitTextEdit}
                                placeholder={t('drawing.textPlaceholder', 'Type here')}
                                placeholderTextColor={colors.textMuted}
                                style={[
                                    styles.textField,
                                    {
                                        left: Math.max(4, textEdit.screenX - 6),
                                        top: Math.max(4, textEdit.screenY - 4),
                                        maxWidth: width - Math.max(4, textEdit.screenX - 6) - 12,
                                        fontSize: editingTextSize * textEdit.scale,
                                        lineHeight: editingTextSize * textEdit.scale * INK_TEXT_LINE_HEIGHT,
                                        color: paper.color || !dark ? settings.text.color : colors.text,
                                    },
                                ]}
                            />
                        )}
                        {isTablet && (
                            <View pointerEvents="box-none" style={styles.floatingLayer}>
                                {toolPalette}
                                {popover === 'tool' && popoverView}
                            </View>
                        )}
                        {isTablet && popover === 'paper' && popoverView}
                        {!isTablet && popover && (
                            <Pressable style={StyleSheet.absoluteFill} onPress={closePopover} accessibilityLabel={t('a11y.close', 'Close')} />
                        )}
                        {!isTablet && popoverView}
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
    toolButton: { width: 46, height: 48, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
    toolButtonActive: { backgroundColor: colors.backgroundSecondary },
    toolInk: { position: 'absolute', bottom: 7, width: 14, height: 3, borderRadius: 2 },
    colorDot: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: colors.border },
    popover: {
        backgroundColor: colors.surface,
        borderRadius: 20,
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 6 },
        elevation: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
        overflow: 'hidden',
    },
    popoverScroll: { padding: 14, gap: 14 },
    popoverTablet: { marginTop: 10, width: 372, maxHeight: 560 },
    popoverTabletRight: { position: 'absolute', top: 8, right: 12, width: 372, maxHeight: 600 },
    popoverPhone: { position: 'absolute', left: 12, right: 12, bottom: 8 },
    sizeRow: { flexDirection: 'row', justifyContent: 'space-between' },
    sizeButton: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
    sizeButtonActive: { backgroundColor: colors.backgroundSecondary },
    textField: {
        position: 'absolute',
        minWidth: 180,
        paddingHorizontal: 6,
        paddingVertical: 4,
        borderWidth: 1.5,
        borderStyle: 'dashed',
        borderColor: colors.primary,
        borderRadius: 6,
        backgroundColor: 'transparent',
        textAlignVertical: 'top',
    },
}));
