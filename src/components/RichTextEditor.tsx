import React, {
    forwardRef,
    memo,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import {
    RichText,
    TaskListBridge,
    TenTapStartKit,
    editorHtml as tentapEditorHtml,
    useBridgeState,
    useEditorBridge,
    useEditorContent,
} from '@10play/tentap-editor';
import { colors } from '../theme/colors';
import { MarkdownFormatType, MarkdownToolbar } from './MarkdownToolbar';
import {
    normalizeRichHighlightColors,
    removeAudioFromRichContent,
    richContentToEditorHtml,
} from '../utils/richContent';
import {
    countChecklistItems,
    resolveChecklistScaleFactor,
} from '../utils/checklistScale';

interface RichTextEditorProps {
    initialContent: string;
    onChange: (text: string) => void;
    onPlainTextChange?: (text: string) => void;
    onSelectionChange?: (selection: { start: number; end: number }) => void;
    onActiveStylesChange?: (styles: MarkdownFormatType[]) => void;
    onFocus?: () => void;
    onBlur?: () => void;
    reparseTrigger?: number;
    placeholder?: string;
    ListHeaderComponent?: React.ComponentType<any> | React.ReactElement | null;
    baseFontSize?: number;
    autoScalingEnabled?: boolean;
    lockedChecklistScaleFactor?: number | null;
    showToolbar?: boolean;
}

export interface RichTextEditorHandle {
    handleFormat: (type: MarkdownFormatType) => void;
    focusBlockAt: (lineIndex: number, ratio?: number) => void;
    removeAudioBlock: (audioPath: string) => void;
    setContent: (content: string) => void;
    flushPendingChanges: () => Promise<string>;
    blur: () => void;
}

const mapEditorStateToFormats = (state: Record<string, any>): MarkdownFormatType[] => {
    const styles: MarkdownFormatType[] = [];

    if (state.isBoldActive) styles.push('bold');
    if (state.isItalicActive) styles.push('italic');
    if (state.isUnderlineActive) styles.push('underline');
    if (state.isStrikeActive) styles.push('strikethrough');
    if (state.isTaskListActive) styles.push('todo');
    if (state.isBulletListActive || state.isOrderedListActive) styles.push('list');
    if (state.headingLevel === 1) styles.push('h1');
    if (state.headingLevel === 2) styles.push('h2');
    if (state.headingLevel === 3) styles.push('h3');

    if (typeof state.activeHighlight === 'string' && state.activeHighlight.length > 0) {
        styles.push('highlight');
        styles.push(`highlight:${state.activeHighlight}`);
    }

    return styles;
};

const injectEditorCssIntoSource = (sourceHtml: string, css: string): string => {
    const inlineStyleTag = `<style data-tag="vaulto-editor-inline-css">${css}</style>`;

    if (sourceHtml.includes('</head>')) {
        return sourceHtml.replace('</head>', `${inlineStyleTag}</head>`);
    }

    return `${inlineStyleTag}${sourceHtml}`;
};

const getChecklistCss = (baseFontSize: number, checklistScaleFactor: number) => {
    const checklistFontSize = Math.round(baseFontSize * checklistScaleFactor);
    const checklistLineHeight = Math.round(checklistFontSize * 1.55);
    const checkboxSize = Math.max(18, Math.round(baseFontSize * 1.28 * checklistScaleFactor));
    const checkboxRadius = Math.max(5, Math.round(checkboxSize * 0.24));
    const checkboxBorderWidth = Math.max(1.5, Number((checkboxSize * 0.08).toFixed(2)));
    const checkmarkWidth = Math.max(2, Math.round(checkboxSize * 0.14));
    const checkmarkHeight = Math.max(6, Math.round(checkboxSize * 0.32));
    const checkboxTopOffset = Math.max(1, Math.round((checklistLineHeight - checkboxSize) / 2) + 1);
    const checkboxSpacing = Math.max(8, Math.round(baseFontSize * 0.55 * checklistScaleFactor));
    const checklistItemSpacing = Math.max(4, Math.round(baseFontSize * 0.2 * checklistScaleFactor));

    return `
  .ProseMirror ul[data-type="taskList"] {
    list-style: none;
    padding-left: 0.25rem;
  }

  .ProseMirror ul[data-type="taskList"] li {
    display: flex;
    align-items: flex-start;
    font-size: ${checklistFontSize}px;
    line-height: ${checklistLineHeight}px;
    gap: ${checkboxSpacing}px;
  }

  .ProseMirror ul[data-type="taskList"] li:not(:last-child) {
    margin-bottom: ${checklistItemSpacing}px;
  }

  .ProseMirror ul[data-type="taskList"] li > label {
    position: relative;
    display: inline-flex;
    flex: 0 0 auto;
    align-items: flex-start;
    justify-content: center;
    margin-top: ${checkboxTopOffset}px;
    user-select: none;
  }

  .ProseMirror ul[data-type="taskList"] li > label > input {
    appearance: none;
    -webkit-appearance: none;
    position: absolute;
    inset: 0;
    width: ${checkboxSize}px;
    height: ${checkboxSize}px;
    margin: 0;
    accent-color: ${colors.primary};
    background: transparent;
    border: none;
    opacity: 0;
    cursor: pointer;
  }

  .ProseMirror ul[data-type="taskList"] li > label > span {
    display: inline-flex;
    width: ${checkboxSize}px;
    min-width: ${checkboxSize}px;
    height: ${checkboxSize}px;
    min-height: ${checkboxSize}px;
    box-sizing: border-box;
    align-items: center;
    justify-content: center;
    background: ${colors.activeWordHighlight};
    border: ${checkboxBorderWidth}px solid ${colors.primary};
    border-radius: ${checkboxRadius}px;
    transition: background-color 120ms ease, border-color 120ms ease;
  }

  .ProseMirror ul[data-type="taskList"] li > label > input:checked + span {
    background: ${colors.primary};
    border-color: ${colors.primary};
  }

  .ProseMirror ul[data-type="taskList"] li > label > input:checked + span::after {
    content: "";
    width: ${checkmarkWidth}px;
    height: ${checkmarkHeight}px;
    margin-top: -${Math.max(1, Math.round(checkboxSize * 0.06))}px;
    border: solid ${colors.surface};
    border-width: 0 ${checkmarkWidth}px ${checkmarkWidth}px 0;
    transform: rotate(45deg);
  }

  .ProseMirror ul[data-type="taskList"] li > div {
    flex: 1 1 auto;
    font-size: inherit;
    line-height: inherit;
  }

  .ProseMirror ul[data-type="taskList"] li > div > p {
    line-height: inherit;
    min-height: ${checklistLineHeight}px;
  }
`;
};

const getEditorCss = (baseFontSize: number, checklistScaleFactor: number) => {
    const baseLineHeight = Math.round(baseFontSize * 1.55);

    return `
  html, body {
    margin: 0;
    padding: 0;
    background: ${colors.background};
  }

  body {
    font-size: ${baseFontSize}px;
    line-height: ${baseLineHeight}px;
    color: ${colors.text};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .ProseMirror {
    min-height: 100%;
    padding: 0 0 72px;
    outline: none;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .ProseMirror p {
    margin: 0;
    min-height: ${baseLineHeight}px;
  }

  ${getChecklistCss(baseFontSize, checklistScaleFactor)}
`;
};

const RichTextEditorComponent = forwardRef<RichTextEditorHandle, RichTextEditorProps>((props, ref) => {
    const {
        initialContent,
        onChange,
        onPlainTextChange,
        onSelectionChange,
        onActiveStylesChange,
        onFocus,
        onBlur,
        reparseTrigger,
        placeholder,
        baseFontSize = 16,
        autoScalingEnabled = true,
        lockedChecklistScaleFactor = null,
        showToolbar = false,
    } = props;

    const initialEditorHtml = useMemo(() => richContentToEditorHtml(initialContent), []);
    const bridgeInitialContent = useMemo(() => richContentToEditorHtml(initialContent), [initialContent]);
    const contentChecklistScaleFactor = useMemo(() => (
        lockedChecklistScaleFactor
            ?? (autoScalingEnabled
                ? resolveChecklistScaleFactor(countChecklistItems(bridgeInitialContent), true)
                : 1)
    ), [autoScalingEnabled, bridgeInitialContent, lockedChecklistScaleFactor]);
    const initialEditorCssRef = useRef<string | null>(null);
    if (initialEditorCssRef.current === null) {
        initialEditorCssRef.current = getEditorCss(baseFontSize, contentChecklistScaleFactor);
    }
    const initialTaskListCssRef = useRef<string | null>(null);
    if (initialTaskListCssRef.current === null) {
        initialTaskListCssRef.current = getChecklistCss(baseFontSize, contentChecklistScaleFactor);
    }
    const editorSourceHtml = useMemo(() => (
        injectEditorCssIntoSource(tentapEditorHtml, initialEditorCssRef.current || '')
    ), []);
    const editorBridgeExtensions = useMemo(() => (
        [
            ...TenTapStartKit.filter((extension) => extension.name !== TaskListBridge.name),
            TaskListBridge.configureCSS(initialTaskListCssRef.current || ''),
        ]
    ), []);
    const editorTheme = useMemo(() => ({
        webview: {
            backgroundColor: colors.background,
        },
        webviewContainer: {
            backgroundColor: colors.background,
        },
    }), []);

    const editor = useEditorBridge({
        autofocus: false,
        avoidIosKeyboard: true,
        bridgeExtensions: editorBridgeExtensions,
        customSource: editorSourceHtml,
        initialContent: bridgeInitialContent,
        theme: editorTheme,
    });

    const editorState = useBridgeState(editor) as Record<string, any>;
    const editorHtml = useEditorContent(editor, {
        type: 'html',
        debounceInterval: 150,
    });
    const editorText = useEditorContent(editor, {
        type: 'text',
        debounceInterval: 80,
    });

    const lastExternalContentRef = useRef(initialContent);
    const lastHtmlRef = useRef(initialEditorHtml);
    const latestHtmlRef = useRef(initialEditorHtml);
    const pendingProgrammaticHtmlRef = useRef<string | null>(null);
    const pendingFlushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastFocusedRef = useRef(false);
    const [isColorPickerVisible, setIsColorPickerVisible] = useState(false);
    const checklistSourceHtml = typeof editorHtml === 'string'
        ? normalizeRichHighlightColors(editorHtml)
        : bridgeInitialContent;
    const checklistScaleFactor = useMemo(() => (
        lockedChecklistScaleFactor
            ?? (autoScalingEnabled
                ? resolveChecklistScaleFactor(countChecklistItems(checklistSourceHtml), true)
                : 1)
    ), [autoScalingEnabled, checklistSourceHtml, lockedChecklistScaleFactor]);

    const editorApi = editor as typeof editor & {
        setPlaceholder?: (value: string) => void;
        injectCSS?: (css: string, tag?: string) => void;
    };

    const applyProgrammaticContent = (content: string) => {
        const nextHtml = richContentToEditorHtml(content);

        if (nextHtml === lastHtmlRef.current) {
            lastExternalContentRef.current = content;
            return;
        }

        if (pendingFlushTimeoutRef.current) {
            clearTimeout(pendingFlushTimeoutRef.current);
            pendingFlushTimeoutRef.current = null;
        }

        pendingProgrammaticHtmlRef.current = nextHtml;
        latestHtmlRef.current = nextHtml;
        lastHtmlRef.current = nextHtml;
        lastExternalContentRef.current = content;
        editor.setContent(nextHtml);
    };

    const flushPendingContent = async (): Promise<string> => {
        const nextHtml = normalizeRichHighlightColors(await editor.getHTML());
        latestHtmlRef.current = nextHtml;

        if (pendingFlushTimeoutRef.current) {
            clearTimeout(pendingFlushTimeoutRef.current);
            pendingFlushTimeoutRef.current = null;
        }

        if (pendingProgrammaticHtmlRef.current !== null) {
            if (pendingProgrammaticHtmlRef.current === nextHtml) {
                pendingProgrammaticHtmlRef.current = null;
            }
            lastHtmlRef.current = nextHtml;
            lastExternalContentRef.current = nextHtml;
            return nextHtml;
        }

        if (nextHtml !== lastHtmlRef.current) {
            lastHtmlRef.current = nextHtml;
            lastExternalContentRef.current = nextHtml;
            onChange(nextHtml);
        }

        return nextHtml;
    };

    useEffect(() => {
        if (!editorState.isReady) {
            return;
        }

        editorApi.setPlaceholder?.(placeholder || '');
        editorApi.injectCSS?.(
            getEditorCss(baseFontSize, checklistScaleFactor),
            'vaulto-editor-minimal-css'
        );
    }, [baseFontSize, checklistScaleFactor, editorApi, editorState.isReady, placeholder]);

    useEffect(() => {
        if (!editorState.isReady) {
            return;
        }

        const flushPendingHtml = async (forceRead: boolean = false) => {
            let nextHtml = latestHtmlRef.current;

            if (forceRead) {
                nextHtml = normalizeRichHighlightColors(await editor.getHTML());
                latestHtmlRef.current = nextHtml;
            }

            if (nextHtml === lastHtmlRef.current) {
                return;
            }

            if (pendingFlushTimeoutRef.current) {
                clearTimeout(pendingFlushTimeoutRef.current);
                pendingFlushTimeoutRef.current = null;
            }

            lastHtmlRef.current = nextHtml;
            lastExternalContentRef.current = nextHtml;
            onChange(nextHtml);
        };

        if (!editorState.isReady || typeof editorHtml !== 'string') {
            return;
        }

        const normalizedEditorHtml = normalizeRichHighlightColors(editorHtml);
        latestHtmlRef.current = normalizedEditorHtml;
        if (pendingProgrammaticHtmlRef.current !== null) {
            if (pendingProgrammaticHtmlRef.current === normalizedEditorHtml) {
                pendingProgrammaticHtmlRef.current = null;
                lastHtmlRef.current = normalizedEditorHtml;
            }
            return;
        }

        if (normalizedEditorHtml === lastHtmlRef.current) {
            return;
        }

        if (pendingFlushTimeoutRef.current) {
            clearTimeout(pendingFlushTimeoutRef.current);
        }

        pendingFlushTimeoutRef.current = setTimeout(() => {
            pendingFlushTimeoutRef.current = null;
            void flushPendingHtml();
        }, 500);

        return () => {
            if (pendingFlushTimeoutRef.current) {
                clearTimeout(pendingFlushTimeoutRef.current);
                pendingFlushTimeoutRef.current = null;
            }
        };
    }, [editor, editorHtml, editorState.isReady, onChange]);

    useEffect(() => {
        if (!editorState.isReady) {
            return;
        }

        if (initialContent === lastExternalContentRef.current) {
            return;
        }

        applyProgrammaticContent(initialContent);
    }, [editorState.isReady, initialContent, reparseTrigger]);

    useEffect(() => {
        if (!onActiveStylesChange) {
            return;
        }

        onActiveStylesChange(mapEditorStateToFormats(editorState));
    }, [editorState, onActiveStylesChange]);

    useEffect(() => {
        if (!onSelectionChange || !editorState.selection) {
            return;
        }

        onSelectionChange({
            start: Number(editorState.selection.from || 0),
            end: Number(editorState.selection.to || 0),
        });
    }, [editorState.selection, onSelectionChange]);

    useEffect(() => {
        if (typeof editorText !== 'string') {
            return;
        }

        onPlainTextChange?.(editorText);
    }, [editorText, onPlainTextChange]);

    useEffect(() => {
        if (editorState.isFocused && !lastFocusedRef.current) {
            onFocus?.();
        }

        if (!editorState.isFocused && lastFocusedRef.current) {
            onBlur?.();
            void flushPendingContent();
        }

        lastFocusedRef.current = !!editorState.isFocused;
    }, [editorState.isFocused, onBlur, onFocus]);

    const applyFormat = (type: MarkdownFormatType) => {
        if (type === 'bold') {
            editor.toggleBold();
            return;
        }

        if (type === 'italic') {
            editor.toggleItalic();
            return;
        }

        if (type === 'strikethrough') {
            editor.toggleStrike();
            return;
        }

        if (type === 'underline') {
            editor.toggleUnderline();
            return;
        }

        if (type === 'list') {
            editor.toggleBulletList();
            return;
        }

        if (type === 'todo') {
            editor.toggleTaskList();
            return;
        }

        if (type === 'h1') {
            editor.toggleHeading(1);
            return;
        }

        if (type === 'h2') {
            editor.toggleHeading(2);
            return;
        }

        if (type === 'h3') {
            editor.toggleHeading(3);
            return;
        }

        if (type.startsWith('highlight')) {
            const [, color = 'yellow'] = type.split(':');
            if (color === 'white') {
                editor.unsetHighlight();
            } else {
                editor.setHighlight(color);
            }
        }
    };

    useImperativeHandle(ref, () => ({
        handleFormat: applyFormat,
        focusBlockAt: (_lineIndex: number, ratio: number = 1) => {
            if (ratio <= 0) {
                editor.focus('start');
                return;
            }

            editor.focus('end');
        },
        removeAudioBlock: async (audioPath: string) => {
            const currentHtml = await editor.getHTML();
            const nextHtml = removeAudioFromRichContent(currentHtml, audioPath);
            applyProgrammaticContent(nextHtml);
            onChange(nextHtml);
        },
        setContent: (content: string) => {
            applyProgrammaticContent(content);
        },
        flushPendingChanges: () => flushPendingContent(),
        blur: () => {
            editor.blur();
        },
    }), [applyFormat, editor, onChange]);

    return (
        <View style={styles.editorShell}>
            <RichText
                editor={editor}
                androidLayerType={Platform.OS === 'android' ? 'software' : undefined}
                nestedScrollEnabled
                overScrollMode="never"
                style={styles.webview}
            />
            {(showToolbar || isColorPickerVisible) && (
                Platform.OS === 'ios' ? (
                    <KeyboardAvoidingView
                        behavior="padding"
                        pointerEvents="box-none"
                        style={styles.toolbarAvoiding}
                    >
                        <View pointerEvents="auto" style={styles.toolbarContainer}>
                            <MarkdownToolbar
                                onFormat={applyFormat}
                                activeFormats={mapEditorStateToFormats(editorState)}
                                onColorPickerToggle={setIsColorPickerVisible}
                            />
                        </View>
                    </KeyboardAvoidingView>
                ) : (
                    <View pointerEvents="box-none" style={styles.toolbarAvoiding}>
                        <View pointerEvents="auto" style={styles.toolbarContainer}>
                            <MarkdownToolbar
                                onFormat={applyFormat}
                                activeFormats={mapEditorStateToFormats(editorState)}
                                onColorPickerToggle={setIsColorPickerVisible}
                            />
                        </View>
                    </View>
                )
            )}
        </View>
    );
});

export const RichTextEditor = memo(RichTextEditorComponent, (prev, next) => (
    prev.reparseTrigger === next.reparseTrigger &&
    prev.baseFontSize === next.baseFontSize &&
    prev.autoScalingEnabled === next.autoScalingEnabled &&
    prev.lockedChecklistScaleFactor === next.lockedChecklistScaleFactor &&
    prev.placeholder === next.placeholder &&
    prev.initialContent === next.initialContent
));

const styles = StyleSheet.create({
    editorShell: {
        flex: 1,
        minHeight: 200,
        backgroundColor: colors.background,
    },
    webview: {
        flex: 1,
        backgroundColor: colors.background,
    },
    toolbarAvoiding: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 50,
        elevation: 50,
    },
    toolbarContainer: {
        width: '100%',
        backgroundColor: colors.surface,
    },
});
