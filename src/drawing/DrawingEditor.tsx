import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AppState,
    Keyboard,
    Modal,
    Platform,
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
import { InkInputView } from '../../modules/ink-input';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors, getColorScheme, isDarkScheme } from '../theme/colors';
import { createStyles } from '../theme/createStyles';
import { CanvasMode, DrawingCanvas, DrawingCanvasHandle, TextTap } from './DrawingCanvas';
import { ColorPanel } from './ColorPanel';
import { DrawingDocument } from './drawingFormat';
import { DrawingAction, DrawingState, EMPTY_SELECTION, EraseMode, Selection, drawingReducer, emptyContent, initialDrawingState, selectInLasso } from './drawingModel';
import { INK_COLORS, INK_DEFAULT_COLOR, INK_TEXT_LINE_HEIGHT, INK_TOOL_ORDER, INK_TOOLS, InkStroke, InkTool, invertedInkColor } from './ink';
import { DEFAULT_PAPER, PAPER_LAYOUTS, PAPER_PATTERNS, PaperStyle, isDarkPaper } from './paper';
import { StoredDrawingPrefs, loadDrawingPrefs, saveDrawingPrefs } from './drawingPrefs';
import { PaperPicker } from './PaperPicker';
import { pushRecentColor } from './colorMath';
import { measureText } from './textLayout';
import { appAlert } from '../components/AppAlert';

type Props = {
    visible: boolean;
    /** Existing drawing to edit, or a fresh one (no strokes). */
    document: DrawingDocument | null;
    onSave: (doc: DrawingDocument) => void;
    /**
     * Stores the drawing in the note without closing the canvas: called when
     * the app goes to the background, where Android may end it at any time.
     */
    onAutosave: (doc: DrawingDocument) => void;
    onClose: () => void;
};

type ActiveTool = InkTool | 'eraser' | 'text' | 'lasso';
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
/** Eraser radius on screen: the same however far the drawing is zoomed. */
const ERASER_SIZES = [7, 14, 26];
const QUICK_COLORS = ['#1D1D1F', '#1E88E5', '#E53935', '#43A047', '#FDD835'];
/** On a dark sheet black barely shows: white takes its place in the quick row. */
const QUICK_COLORS_DARK_PAPER = ['#FFFFFF', ...QUICK_COLORS.slice(1)];
type EraserSettings = { sizeIndex: number; mode: EraseMode };
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
let rememberedEraser: EraserSettings = { sizeIndex: 1, mode: 'partial' };
let rememberedToolsHidden = false;
let rememberedSnapShapes = true;

/**
 * A drawing open while the colour scheme changes: the ThemeProvider remounts the
 * whole app then, and with it this editor and the note screen that opened it.
 * The session is parked here on unmount and the editor that mounts next takes it
 * back and reopens itself, so a theme switch never loses a drawing.
 */
type ParkedDrawing = { document: DrawingDocument; state: DrawingState; docWidth: number; at: number };
let parkedDrawing: ParkedDrawing | null = null;
/** The remount happens at once; an older parked drawing belongs to something else. */
const PARKED_TTL_MS = 10_000;
const peekParkedDrawing = (): ParkedDrawing | null =>
    parkedDrawing && Date.now() - parkedDrawing.at < PARKED_TTL_MS ? parkedDrawing : null;
/** How long the app's own window must keep focus before the canvas counts as gone (see B2 effect). */
const LOST_WINDOW_MS = 400;

const ACTIVE_TOOLS: ActiveTool[] = [...INK_TOOL_ORDER, 'eraser', 'text', 'lasso'];
const isColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value);
const isIndex = (value: unknown, count: number): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) < count;

const luminance = (hex: string): number => {
    const value = parseInt(hex.replace('#', ''), 16) || 0;
    const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
        const c = channel / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG contrast ratio of two #RRGGBB colours (1..21). */
const contrast = (a: string, b: string): number => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
};

/** Takes what was stored on the device, field by field, ignoring anything malformed. */
const applyStoredPrefs = (saved: StoredDrawingPrefs) => {
    const settings = initialSettings();
    const storedSettings = (saved.settings && typeof saved.settings === 'object' ? saved.settings : {}) as Record<string, any>;
    (Object.keys(settings) as SettingsKey[]).forEach((key) => {
        const item = storedSettings[key];
        if (item && isColor(item.color)) {
            settings[key].color = item.color.toUpperCase();
        }
        if (item && isIndex(item.sizeIndex, 5)) {
            settings[key].sizeIndex = item.sizeIndex;
        }
    });
    rememberedSettings = settings;
    if (ACTIVE_TOOLS.includes(saved.tool as ActiveTool)) {
        rememberedTool = saved.tool as ActiveTool;
    }
    const paper = saved.paper as Record<string, unknown> | undefined;
    if (paper && PAPER_PATTERNS.includes(paper.pattern as any) && PAPER_LAYOUTS.includes(paper.layout as any)
        && (paper.color === null || isColor(paper.color))) {
        rememberedPaper = { pattern: paper.pattern as any, layout: paper.layout as any, color: paper.color as string | null };
    }
    if (Array.isArray(saved.recent)) {
        rememberedRecent = saved.recent.filter(isColor).slice(0, 12);
    }
    const eraser = saved.eraser as Record<string, unknown> | undefined;
    if (eraser && isIndex(eraser.sizeIndex, ERASER_SIZES.length) && (eraser.mode === 'partial' || eraser.mode === 'stroke')) {
        rememberedEraser = { sizeIndex: eraser.sizeIndex as number, mode: eraser.mode };
    }
    if (typeof saved.toolsHidden === 'boolean') {
        rememberedToolsHidden = saved.toolsHidden;
    }
    if (typeof saved.snapShapes === 'boolean') {
        rememberedSnapShapes = saved.snapShapes;
    }
};

const persistPrefs = () => saveDrawingPrefs({
    settings: rememberedSettings,
    tool: rememberedTool,
    paper: rememberedPaper,
    recent: rememberedRecent,
    eraser: rememberedEraser,
    toolsHidden: rememberedToolsHidden,
    snapShapes: rememberedSnapShapes,
});

// Read once when the app loads this screen; an editor that opens before it
// finishes waits for it (see the load effect), so stored choices never lose
// to the defaults.
let prefsLoaded = false;
const prefsReady = loadDrawingPrefs().then((saved) => {
    if (saved) {
        applyStoredPrefs(saved);
    }
    prefsLoaded = true;
});

export const DrawingEditor: React.FC<Props> = ({ visible, document, onSave, onAutosave, onClose }) => {
    const { t } = useTranslation();
    const { width, height } = useWindowDimensions();
    const isTablet = Math.min(width, height) >= 600;
    /** Wide enough for the tools to sit in the header row itself. */
    const inlineTools = width >= 1150;
    const dark = isDarkScheme();

    // A drawing parked by a theme remount (see parkedDrawing) reopens here with
    // its history; the parent knows nothing of it, so `open` covers both cases.
    const [restored, setRestored] = useState<ParkedDrawing | null>(null);
    const open = visible || !!restored;
    const activeDocument = visible ? document : restored?.document ?? null;

    // The reducer runs here, not in React: stateRef always holds every action
    // dispatched so far, even one React has not rendered yet or never will.
    // A theme switch unmounts the editor right after the canvas hands over the
    // stroke under the pen (see DrawingCanvas), and the parked drawing must
    // include it; useReducer would drop an action sent while unmounting.
    const [state, setRenderedState] = useState<DrawingState>(initialDrawingState);
    const stateRef = useRef(state);
    const dispatch = useCallback((action: DrawingAction) => {
        stateRef.current = drawingReducer(stateRef.current, action);
        setRenderedState(stateRef.current);
    }, []);
    const { strokes, texts, paper } = state.content;
    const [settings, setSettings] = useState<ToolSettings>(() => rememberedSettings || initialSettings());
    const [activeTool, setActiveTool] = useState<ActiveTool>(rememberedTool);
    const [recent, setRecent] = useState<string[]>(rememberedRecent);
    const [eraser, setEraser] = useState<EraserSettings>(rememberedEraser);
    const [toolsHidden, setToolsHidden] = useState(rememberedToolsHidden);
    const [snapShapes, setSnapShapes] = useState(rememberedSnapShapes);
    /** A short tip over the canvas, e.g. how shapes are drawn. */
    const [tip, setTip] = useState<string | null>(null);
    const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
    const selectionRef = useRef(selection);
    selectionRef.current = selection;
    const hasSelection = selection.strokes.length > 0 || selection.texts.length > 0;
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

    // Taken in an effect, not while rendering: the new tree renders before the
    // old one unmounts, and only the old one's cleanup parks the drawing. The
    // content comes back in the same render that opens the canvas, so the
    // editor is never open with an empty sheet (another remount right then
    // would park that).
    useEffect(() => {
        const parked = peekParkedDrawing();
        parkedDrawing = null;
        if (parked) {
            dispatch({ type: 'restore', state: parked.state });
            setDocWidth(parked.docWidth);
            setRestored(parked);
        }
    }, []);

    useEffect(() => {
        const show = Keyboard.addListener('keyboardDidShow', (event) => setKeyboardTop(event.endCoordinates.screenY));
        const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardTop(null));
        return () => {
            show.remove();
            hide.remove();
        };
    }, []);

    useEffect(() => {
        if (!open) {
            return;
        }
        let cancelled = false;
        // A restored session already holds its content (see above).
        const restoring = !visible;
        void prefsReady.then(() => {
            if (cancelled) {
                return;
            }
            // The tools come back as they were last used, even after a restart.
            setSettings(rememberedSettings || initialSettings());
            setActiveTool(rememberedTool);
            setRecent(rememberedRecent);
            setEraser(rememberedEraser);
            setToolsHidden(rememberedToolsHidden);
            setSnapShapes(rememberedSnapShapes);
            if (restoring) {
                return;
            }
            dispatch({
                type: 'load',
                content: document
                    // A parsed drawing always carries its paper; a new one (no paper
                    // yet) starts on the paper used last.
                    ? { strokes: document.strokes, texts: document.texts || [], paper: document.paper ?? rememberedPaper }
                    : emptyContent(rememberedPaper),
            });
        });
        setPopover(null);
        setTextEdit(null);
        setSelection(EMPTY_SELECTION);
        if (!restoring) {
            setDocWidth(document?.width || 0);
        }
        return () => {
            cancelled = true;
        };
    }, [visible, document, open]);

    useEffect(() => {
        // Before the stored choices are read, the state still holds defaults.
        if (!prefsLoaded || !open) {
            return;
        }
        rememberedSettings = settings;
        rememberedTool = activeTool;
        rememberedRecent = recent;
        rememberedEraser = eraser;
        rememberedToolsHidden = toolsHidden;
        rememberedSnapShapes = snapShapes;
        persistPrefs();
    }, [settings, activeTool, recent, eraser, toolsHidden, snapShapes, open]);

    useEffect(() => {
        if (!tip) {
            return;
        }
        const timer = setTimeout(() => setTip(null), 3000);
        return () => clearTimeout(timer);
    }, [tip]);

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

    const settingsKey: SettingsKey = activeTool === 'text' ? 'text' : activeTool === 'eraser' || activeTool === 'lasso' ? 'fountain' : activeTool;
    const current = settings[settingsKey];
    const inkTool: InkTool = activeTool === 'text' || activeTool === 'eraser' || activeTool === 'lasso' ? 'fountain' : activeTool;
    const sizes = activeTool === 'text' ? TEXT_SIZES : INK_TOOLS[inkTool].sizes;
    const size = sizes[current.sizeIndex] ?? sizes[1];
    const mode: CanvasMode = activeTool === 'eraser' ? 'erase' : activeTool === 'text' ? 'text' : activeTool === 'lasso' ? 'select' : 'ink';

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

    const handleErase = useCallback((x: number, y: number, radius: number, path?: number[]) => {
        setSelection(EMPTY_SELECTION);
        dispatch({ type: 'eraseAt', x, y, path, radius, boxes: textBoxes, mode: eraser.mode });
    }, [textBoxes, eraser.mode]);

    const handleEraseEnd = useCallback(() => dispatch({ type: 'eraseEnd' }), []);
    // Indices in a selection stop meaning the same items once history moves.
    const handleUndo = useCallback(() => {
        setSelection(EMPTY_SELECTION);
        dispatch({ type: 'undo' });
    }, []);
    const handleRedo = useCallback(() => {
        setSelection(EMPTY_SELECTION);
        dispatch({ type: 'redo' });
    }, []);

    const handleLasso = useCallback((polygon: number[]) => {
        setSelection(selectInLasso(stateRef.current.content, textBoxes, polygon));
    }, [textBoxes]);
    const handleSelectionMove = useCallback((dx: number, dy: number) => {
        dispatch({ type: 'moveSelection', selection: selectionRef.current, dx, dy });
    }, []);
    const duplicateSelection = () => {
        const { strokes: allStrokes, texts: allTexts } = stateRef.current.content;
        const copied = {
            strokes: selection.strokes.filter((index) => allStrokes[index]).length,
            texts: selection.texts.filter((index) => allTexts[index]).length,
        };
        dispatch({ type: 'duplicateSelection', selection, dx: 24, dy: 24 });
        // The copies are the last items: they become the selection, ready to be moved.
        setSelection({
            strokes: Array.from({ length: copied.strokes }, (_, i) => allStrokes.length + i),
            texts: Array.from({ length: copied.texts }, (_, i) => allTexts.length + i),
        });
    };
    const deleteSelection = () => {
        dispatch({ type: 'deleteSelection', selection });
        setSelection(EMPTY_SELECTION);
    };

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
        if (next === activeTool && next !== 'eraser' && next !== 'lasso') {
            if (popover === 'tool') {
                closePopover();
            } else {
                setPopover('tool');
            }
            return;
        }
        closePopover();
        setSelection(EMPTY_SELECTION);
        setActiveTool(next);
        // Mirrors the derived values below, for the canvas to use before the re-render lands.
        const nextInk: InkTool = next === 'text' || next === 'eraser' || next === 'lasso' ? 'fountain' : next;
        const nextKey: SettingsKey = next === 'text' ? 'text' : nextInk;
        const nextSizes = next === 'text' ? TEXT_SIZES : INK_TOOLS[nextInk].sizes;
        canvasRef.current?.applyTool({
            mode: next === 'eraser' ? 'erase' : next === 'text' ? 'text' : next === 'lasso' ? 'select' : 'ink',
            tool: nextInk,
            color: settings[nextKey].color,
            size: nextSizes[settings[nextKey].sizeIndex] ?? nextSizes[1],
        });
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
        persistPrefs();
        dispatch({ type: 'setPaper', paper: next });
    };

    const currentDocument = (): DrawingDocument => {
        // Include the label still being typed: the reducer is pure, so the final
        // content can be computed right here instead of waiting for a render.
        const action = textEditAction(textEdit);
        const latest = stateRef.current;
        const content = action ? drawingReducer(latest, action).content : latest.content;
        return { id: activeDocument?.id || '', width: docWidth || width, pos: activeDocument?.pos, ...content };
    };
    const latestDocument = useRef(currentDocument);
    latestDocument.current = currentDocument;

    // Parks the open session when a colour-scheme change unmounts the editor (the
    // scheme is already switched by then); any other unmount parks nothing.
    const renderedScheme = getColorScheme();
    const parkSession = useRef<() => void>(() => undefined);
    parkSession.current = () => {
        if (!open || getColorScheme() === renderedScheme) {
            return;
        }
        const action = textEditAction(textEdit);
        parkedDrawing = {
            document: currentDocument(),
            state: action ? drawingReducer(stateRef.current, action) : stateRef.current,
            docWidth,
            at: Date.now(),
        };
    };
    // The latest session is wanted at unmount, hence the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => () => parkSession.current(), []);

    const savedUndoDepth = useRef(0);
    useEffect(() => {
        if (open) {
            savedUndoDepth.current = 0;
        }
    }, [open, activeDocument]);
    useEffect(() => {
        if (!open) {
            return;
        }
        const subscription = AppState.addEventListener('change', (next) => {
            if (next !== 'background') {
                return;
            }
            const doc = latestDocument.current();
            const hasContent = doc.strokes.length > 0 || (doc.texts?.length ?? 0) > 0;
            // Only when something changed since opening (or since the last
            // autosave), and never to delete: an empty canvas is not a draft.
            if (hasContent && stateRef.current.undo.length !== savedUndoDepth.current) {
                savedUndoDepth.current = stateRef.current.undo.length;
                onAutosave(doc);
            }
        });
        return () => subscription.remove();
    }, [open, onAutosave]);

    const handleDone = () => {
        const doc = currentDocument();
        setRestored(null);
        onSave(doc);
    };

    const closeEditor = () => {
        setRestored(null);
        onClose();
    };

    const hasChanges = () => state.undo.length > 0 || !!textEdit?.value.trim();

    const handleClose = () => {
        if (!hasChanges()) {
            closeEditor();
            return;
        }
        appAlert(
            t('drawing.discardTitle', 'Discard changes?'),
            t('drawing.discardBody', 'Your changes to this drawing will be lost.'),
            [
                { text: t('drawing.keepEditing', 'Keep editing'), style: 'cancel' },
                { text: t('drawing.discard', 'Discard'), style: 'destructive', onPress: closeEditor },
            ]
        );
    };

    // A hardware Escape key makes Android cancel the Modal's window itself,
    // without the onRequestClose that Back sends: the canvas would vanish while
    // React still thinks it is open. The only trace is the app's own window
    // getting focus back and keeping it (a window shown on top takes it away
    // again within moments). Then the canvas is shown again in a fresh window
    // and closing goes the usual way, through "Discard changes?" when needed.
    // Focus changes before our window is up (opening, a theme remount) say nothing.
    const [modalKey, setModalKey] = useState(0);
    const windowShown = useRef(false);
    const askOnShow = useRef(false);
    const windowLost = useRef<() => void>(() => undefined);
    windowLost.current = () => {
        if (!windowShown.current) {
            return;
        }
        windowShown.current = false;
        if (!hasChanges()) {
            closeEditor();
            return;
        }
        // Asked once the new window is up, so the dialog opens above it.
        askOnShow.current = true;
        setModalKey((key) => key + 1);
    };
    const closeRef = useRef(handleClose);
    closeRef.current = handleClose;
    const handleShow = useCallback(() => {
        windowShown.current = true;
        if (askOnShow.current) {
            askOnShow.current = false;
            closeRef.current();
        }
    }, []);
    useEffect(() => {
        if (!open || Platform.OS !== 'android') {
            windowShown.current = false;
            return;
        }
        let timer: ReturnType<typeof setTimeout> | null = null;
        const cancel = () => {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
        };
        const focus = AppState.addEventListener('focus', () => {
            cancel();
            if (!windowShown.current) {
                return;
            }
            timer = setTimeout(() => {
                timer = null;
                windowLost.current();
            }, LOST_WINDOW_MS);
        });
        const blur = AppState.addEventListener('blur', cancel);
        return () => {
            cancel();
            focus.remove();
            blur.remove();
        };
    }, [open]);

    const editingTextSize = TEXT_SIZES[settings.text.sizeIndex] ?? 18;
    // The canvas shows ink inverted in dark mode on the theme paper: the toolbar
    // shows each colour the same way, so black reads as the white it draws.
    const shown = useCallback((value: string) => (dark && !paper.color ? invertedInkColor(value) : value), [dark, paper.color]);
    // A colour as dark (or as light) as the bar behind it would vanish there, as
    // black does on a coloured sheet in dark mode: such a swatch gets a clear ring.
    const barColor = inlineTools ? colors.background : colors.surface;
    const outlineOf = (value: string) => (contrast(shown(value), barColor) < 1.6 ? colors.textSecondary : colors.border);
    const quickBase = isDarkPaper(paper.color) ? QUICK_COLORS_DARK_PAPER : QUICK_COLORS;

    // Swatches always at hand in the bar, each in a fixed place (a colour picked
    // from the full palette takes the last one); the palette opens from the button after them.
    const quickColors = quickBase.includes(current.color) ? quickBase : [...quickBase.slice(0, -1), current.color];

    const toolButtons = (
        <>
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
                        <MaterialCommunityIcons name={TOOL_ICONS[inkToolOption]} size={22} color={active ? colors.primary : colors.textSecondary} />
                        <View style={[styles.toolInk, { backgroundColor: shown(settings[inkToolOption].color), borderColor: outlineOf(settings[inkToolOption].color) }]} />
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
                <MaterialCommunityIcons name="format-text" size={22} color={activeTool === 'text' ? colors.primary : colors.textSecondary} />
                <View style={[styles.toolInk, { backgroundColor: shown(settings.text.color), borderColor: outlineOf(settings.text.color) }]} />
            </TouchableOpacity>
            <TouchableOpacity
                onPress={() => selectTool('eraser')}
                style={[styles.toolButton, activeTool === 'eraser' && styles.toolButtonActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: activeTool === 'eraser' }}
                accessibilityLabel={t('drawing.eraser', 'Eraser')}
            >
                <MaterialCommunityIcons name="eraser" size={22} color={activeTool === 'eraser' ? colors.primary : colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
                onPress={() => selectTool('lasso')}
                style={[styles.toolButton, activeTool === 'lasso' && styles.toolButtonActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: activeTool === 'lasso' }}
                accessibilityLabel={t('drawing.tool.lasso', 'Lasso')}
            >
                <MaterialCommunityIcons name="lasso" size={22} color={activeTool === 'lasso' ? colors.primary : colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
                onPress={() => {
                    const next = !snapShapes;
                    setSnapShapes(next);
                    setTip(next ? t('drawing.shapesOn', 'Draw a shape and hold the pen still to straighten it') : t('drawing.shapesOff', 'Shapes stay as drawn'));
                }}
                style={[styles.toolButton, snapShapes && styles.toolButtonActive]}
                accessibilityRole="switch"
                accessibilityState={{ checked: snapShapes }}
                accessibilityLabel={t('drawing.shapes', 'Shapes')}
            >
                <MaterialCommunityIcons name="shape-outline" size={22} color={snapShapes ? colors.primary : colors.textSecondary} />
            </TouchableOpacity>
        </>
    );

    // Thickness of the active tool, right in the bar: one tap, no menu.
    const sizeButtons = activeTool === 'eraser'
        ? ERASER_SIZES.map((value, index) => {
            const active = index === eraser.sizeIndex;
            return (
                <TouchableOpacity
                    key={value}
                    onPress={() => setEraser((prev) => ({ ...prev, sizeIndex: index }))}
                    style={[styles.sizeButton, active && styles.toolButtonActive]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`${t('drawing.size', 'Size')} ${index + 1}`}
                >
                    <View style={{ width: 6 + index * 7, height: 6 + index * 7, borderRadius: 12, borderWidth: 1.5, borderColor: active ? colors.primary : colors.textSecondary }} />
                </TouchableOpacity>
            );
        })
        : sizes.map((value, index) => {
            const active = index === current.sizeIndex;
            const dot = 4 + (14 * index) / (sizes.length - 1);
            return (
                <TouchableOpacity
                    key={value}
                    onPress={() => setSizeIndex(index)}
                    style={[styles.sizeButton, active && styles.toolButtonActive]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`${t('drawing.size', 'Size')} ${index + 1}`}
                >
                    {activeTool === 'text' ? (
                        <Text style={{ fontSize: 10 + index * 3, color: active ? colors.primary : colors.textSecondary, fontWeight: '700' }}>A</Text>
                    ) : (
                        <View
                            style={{
                                width: dot,
                                height: dot,
                                borderRadius: 10,
                                backgroundColor: shown(current.color),
                                borderWidth: 1,
                                borderColor: outlineOf(current.color),
                                opacity: INK_TOOLS[inkTool].opacity < 1 ? 0.6 : 1,
                            }}
                        />
                    )}
                </TouchableOpacity>
            );
        });

    // The eraser has no colour; its two ways of erasing take the swatches' place.
    const colorButtons = activeTool === 'eraser'
        ? (['partial', 'stroke'] as EraseMode[]).map((value) => {
            const active = eraser.mode === value;
            return (
                <TouchableOpacity
                    key={value}
                    onPress={() => setEraser((prev) => ({ ...prev, mode: value }))}
                    style={[styles.modeButton, active && styles.toolButtonActive]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                >
                    <MaterialCommunityIcons name={value === 'partial' ? 'eraser' : 'gesture'} size={18} color={active ? colors.primary : colors.textSecondary} />
                    <Text style={[styles.modeText, { color: active ? colors.primary : colors.textSecondary }]} numberOfLines={1}>
                        {value === 'partial' ? t('drawing.erasePartial', 'Erase part') : t('drawing.eraseStroke', 'Whole stroke')}
                    </Text>
                </TouchableOpacity>
            );
        })
        : (
            <>
                {quickColors.map((value) => {
                    const active = value === current.color;
                    return (
                        <TouchableOpacity
                            key={value}
                            onPress={() => setColor(value, 'swatch')}
                            style={styles.swatchButton}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active }}
                            accessibilityLabel={value}
                        >
                            <View style={[styles.swatch, { backgroundColor: shown(value), borderColor: outlineOf(value) }, active && { borderColor: colors.primary, borderWidth: 2.5 }]} />
                        </TouchableOpacity>
                    );
                })}
                <TouchableOpacity
                    onPress={() => setPopover((open) => (open === 'tool' ? null : 'tool'))}
                    style={[styles.swatchButton, popover === 'tool' && styles.toolButtonActive]}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: popover === 'tool' }}
                    accessibilityLabel={t('drawing.color.palette', 'Palette')}
                >
                    <MaterialCommunityIcons name="palette-outline" size={22} color={popover === 'tool' ? colors.primary : colors.textSecondary} />
                </TouchableOpacity>
            </>
        );

    // With the lasso the swatches recolour what is selected.
    const recolorButtons = quickBase.map((value) => (
        <TouchableOpacity
            key={value}
            onPress={() => dispatch({ type: 'recolorSelection', selection, color: value })}
            disabled={!hasSelection}
            style={[styles.swatchButton, !hasSelection && styles.disabled]}
            accessibilityRole="button"
            accessibilityLabel={value}
        >
            <View style={[styles.swatch, { backgroundColor: shown(value), borderColor: outlineOf(value) }]} />
        </TouchableOpacity>
    ));

    const toolBarContent = activeTool === 'lasso'
        ? (
            <>
                {toolButtons}
                <View style={styles.paletteDivider} />
                {recolorButtons}
            </>
        )
        : (
            <>
                {toolButtons}
                <View style={styles.paletteDivider} />
                {sizeButtons}
                <View style={styles.paletteDivider} />
                {colorButtons}
            </>
        );

    const selectionBar = hasSelection && (
        <View style={styles.selectionBar}>
            <TouchableOpacity onPress={duplicateSelection} style={styles.selectionButton} accessibilityRole="button" accessibilityLabel={t('drawing.duplicate', 'Duplicate')}>
                <MaterialCommunityIcons name="content-copy" size={20} color={colors.text} />
                <Text style={[styles.selectionText, { color: colors.text }]}>{t('drawing.duplicate', 'Duplicate')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={deleteSelection} style={styles.selectionButton} accessibilityRole="button" accessibilityLabel={t('drawing.delete', 'Delete')}>
                <MaterialCommunityIcons name="delete-outline" size={20} color={colors.error} />
                <Text style={[styles.selectionText, { color: colors.error }]}>{t('drawing.delete', 'Delete')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setSelection(EMPTY_SELECTION)} style={styles.selectionButton} accessibilityRole="button" accessibilityLabel={t('drawing.deselect', 'Deselect')}>
                <MaterialCommunityIcons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
        </View>
    );

    const popoverContent = popover === 'tool' && activeTool !== 'eraser'
        ? <ColorPanel color={current.color} recent={recent} onChange={setColor} display={shown} />
        : popover === 'paper'
            ? <PaperPicker paper={paper} onChange={setPaper} />
            : null;

    const popoverView = popoverContent && (
        <View
            style={[
                styles.popover,
                isTablet
                    ? [styles.popoverTablet, popover === 'paper' ? { right: 12 } : { left: Math.max(12, (width - 372) / 2) }]
                    : styles.popoverPhone,
                !isTablet && { maxHeight: height * 0.6 },
            ]}
        >
            <ScrollView contentContainerStyle={styles.popoverScroll} keyboardShouldPersistTaps="handled" bounces={false}>
                {popoverContent}
            </ScrollView>
        </View>
    );

    return (
        <Modal
            key={modalKey}
            visible={open}
            animationType="slide"
            presentationStyle="fullScreen"
            onRequestClose={handleClose}
            onShow={handleShow}
            supportedOrientations={['portrait', 'landscape']}
        >
            {/* Palm rejection and every pen sample: above the gesture root, so gestures see the filtered touches. */}
            <InkInputView style={styles.root} collapsable={false}>
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
                            {inlineTools ? (
                                <View style={styles.headerTools}>{toolBarContent}</View>
                            ) : (
                                <View style={styles.headerSpacer} />
                            )}
                            {!inlineTools && (
                                <TouchableOpacity
                                    onPress={() => setToolsHidden((value) => !value)}
                                    style={[styles.headerButton, toolsHidden && styles.toolButtonActive]}
                                    accessibilityRole="switch"
                                    accessibilityState={{ checked: !toolsHidden }}
                                    accessibilityLabel={t('drawing.showTools', 'Show tools')}
                                >
                                    <MaterialCommunityIcons
                                        name={toolsHidden ? 'chevron-down' : 'chevron-up'}
                                        size={24}
                                        color={toolsHidden ? colors.primary : colors.textSecondary}
                                    />
                                </TouchableOpacity>
                            )}
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
                            {/* Its place is kept, so the tools do not shift when the first pen touch adds it. */}
                            {!stylusSeen && inlineTools && <View style={styles.headerButton} />}
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

                        {!inlineTools && !toolsHidden && (
                            // Docked above the canvas, never over it.
                            <View style={[styles.toolRow, { borderBottomColor: colors.border }]}>
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toolRowContent} keyboardShouldPersistTaps="handled">
                                    {toolBarContent}
                                </ScrollView>
                            </View>
                        )}
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
                                eraserRadius={ERASER_SIZES[eraser.sizeIndex] ?? ERASER_SIZES[1]}
                            snapShapes={snapShapes}
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
                                selection={selection}
                                onLasso={handleLasso}
                                onSelectionMove={handleSelectionMove}
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
                            {selectionBar}
                            {tip && (
                                <View pointerEvents="none" style={styles.tip}>
                                    <Text style={styles.tipText}>{tip}</Text>
                                </View>
                            )}
                            {!isTablet && popover && (
                                <Pressable style={StyleSheet.absoluteFill} onPress={closePopover} accessibilityLabel={t('a11y.close', 'Close')} />
                            )}
                            {popoverView}
                        </View>
                    </SafeAreaView>
                </GestureHandlerRootView>
            </InkInputView>
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
    // Left-aligned: the tools keep their places when the options after them change.
    headerTools: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 2, paddingStart: 16 },
    toolRow: { height: 50, borderBottomWidth: StyleSheet.hairlineWidth, backgroundColor: colors.surface },
    toolRowContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'flex-start', paddingHorizontal: 8, gap: 2 },
    paletteDivider: { width: StyleSheet.hairlineWidth, height: 26, backgroundColor: colors.border, marginHorizontal: 6 },
    toolButton: { width: 40, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    toolButtonActive: { backgroundColor: colors.backgroundSecondary },
    toolInk: { position: 'absolute', bottom: 5, width: 14, height: 3, borderRadius: 2, borderWidth: StyleSheet.hairlineWidth },
    swatchButton: { width: 36, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    swatch: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border },
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
    popoverTablet: { position: 'absolute', top: 8, width: 372, maxHeight: 600 },
    popoverPhone: { position: 'absolute', left: 12, right: 12, top: 8 },
    // At the bottom, away from what is usually selected (it is drawn from the top down).
    selectionBar: {
        position: 'absolute',
        bottom: 20,
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 6,
        borderRadius: 22,
        backgroundColor: colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
        shadowColor: '#000',
        shadowOpacity: 0.14,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 3 },
        elevation: 5,
    },
    selectionButton: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 44, paddingHorizontal: 12, borderRadius: 22 },
    selectionText: { fontSize: 14, fontWeight: '600' },
    disabled: { opacity: 0.35 },
    tip: {
        position: 'absolute',
        top: 12,
        alignSelf: 'center',
        maxWidth: '90%',
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 16,
        backgroundColor: 'rgba(0,0,0,0.72)',
    },
    tipText: { color: '#FFFFFF', fontSize: 14, fontWeight: '500', textAlign: 'center' },
    modeButton: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 44, borderRadius: 12, paddingHorizontal: 10 },
    modeText: { fontSize: 14, fontWeight: '600' },
    sizeButton: { width: 36, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
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
