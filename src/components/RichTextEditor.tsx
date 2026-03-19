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
    showToolbar?: boolean;
}

export interface RichTextEditorHandle {
    handleFormat: (type: MarkdownFormatType) => void;
    focusBlockAt: (lineIndex: number, ratio?: number) => void;
    removeAudioBlock: (audioPath: string) => void;
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

const getMinimalEditorCss = (baseFontSize: number) => `
  html, body {
    margin: 0;
    padding: 0;
    background: ${colors.background};
  }

  body {
    font-size: ${baseFontSize}px;
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
`;

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
        showToolbar = false,
    } = props;

    const initialEditorHtml = useMemo(() => richContentToEditorHtml(initialContent), []);
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
        initialContent: initialEditorHtml,
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
    const mountedRef = useRef(false);
    const [isColorPickerVisible, setIsColorPickerVisible] = useState(false);

    const editorApi = editor as typeof editor & {
        setPlaceholder?: (value: string) => void;
        injectCSS?: (css: string, tag?: string) => void;
    };

    useEffect(() => {
        if (!editorState.isReady) {
            return;
        }

        editorApi.setPlaceholder?.(placeholder || '');
        editorApi.injectCSS?.(getMinimalEditorCss(baseFontSize), 'vaulto-editor-minimal-css');
    }, [baseFontSize, editorApi, editorState.isReady, placeholder]);

    useEffect(() => {
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
        if (
            pendingProgrammaticHtmlRef.current !== null &&
            pendingProgrammaticHtmlRef.current === normalizedEditorHtml
        ) {
            pendingProgrammaticHtmlRef.current = null;
            lastHtmlRef.current = normalizedEditorHtml;
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
        if (!mountedRef.current) {
            mountedRef.current = true;
            return;
        }

        if (!editorState.isReady) {
            return;
        }

        if (initialContent === lastExternalContentRef.current) {
            return;
        }

        const nextHtml = richContentToEditorHtml(initialContent);
        if (nextHtml === lastHtmlRef.current) {
            lastExternalContentRef.current = initialContent;
            return;
        }

        if (pendingFlushTimeoutRef.current) {
            clearTimeout(pendingFlushTimeoutRef.current);
            pendingFlushTimeoutRef.current = null;
        }

        pendingProgrammaticHtmlRef.current = nextHtml;
        latestHtmlRef.current = nextHtml;
        lastHtmlRef.current = nextHtml;
        lastExternalContentRef.current = initialContent;
        editor.setContent(nextHtml);
    }, [editor, editorState.isReady, initialContent, reparseTrigger]);

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
        const flushOnBlur = async () => {
            const nextHtml = normalizeRichHighlightColors(await editor.getHTML());
            latestHtmlRef.current = nextHtml;

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

        if (editorState.isFocused && !lastFocusedRef.current) {
            onFocus?.();
        }

        if (!editorState.isFocused && lastFocusedRef.current) {
            onBlur?.();
            void flushOnBlur();
        }

        lastFocusedRef.current = !!editorState.isFocused;
    }, [editor, editorState.isFocused, onBlur, onFocus, onChange]);

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

            if (pendingFlushTimeoutRef.current) {
                clearTimeout(pendingFlushTimeoutRef.current);
                pendingFlushTimeoutRef.current = null;
            }

            pendingProgrammaticHtmlRef.current = nextHtml;
            latestHtmlRef.current = nextHtml;
            lastHtmlRef.current = nextHtml;
            lastExternalContentRef.current = nextHtml;
            editor.setContent(nextHtml);
            onChange(nextHtml);
        },
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
