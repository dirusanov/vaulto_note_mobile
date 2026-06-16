import React, {
    forwardRef,
    memo,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import {
    BridgeExtension,
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
    AudioEmbedControlPayload,
    AudioEmbedRuntimeState,
    InsertAudioEmbedPayload,
    getAudioEmbedRuntimeJs,
    getAudioEmbedBridge,
} from './richTextAudioBridge';
import {
    normalizeRichHighlightColors,
    richContentToEditorHtml,
} from '../utils/richContent';
import {
    buildAudioEmbedPreviewSrc,
    stripTransientAudioEmbedState,
} from '../utils/audioEmbeds';
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
    /**
     * Extra space (px) reserved below the last line so it can scroll clear of the
     * docked formatting toolbar / keyboard and the Android navigation bar.
     */
    contentBottomPadding?: number;
    onAudioAction?: (payload: AudioEmbedControlPayload) => void;
}

export interface RichTextEditorHandle {
    handleFormat: (type: MarkdownFormatType) => void;
    focusBlockAt: (lineIndex: number, ratio?: number) => void;
    setContent: (content: string) => void;
    insertAudioEmbed: (payload: InsertAudioEmbedPayload) => void;
    setAudioEmbedState: (payload: AudioEmbedRuntimeState) => void;
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

const resolveEditorPlaceholder = (sourceHtml: string, placeholder?: string): string => {
    if (!placeholder) {
        return '';
    }

    const normalizedHtml = (sourceHtml || '')
        .replace(/<p>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, '')
        .replace(/<div>(?:\s|&nbsp;|<br\s*\/?>)*<\/div>/gi, '')
        .trim();

    return normalizedHtml.length === 0 ? placeholder : '';
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
    margin: 0;
    padding-left: 0.25rem;
    max-width: 100%;
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
    min-width: 0;
    font-size: inherit;
    line-height: inherit;
  }

  .ProseMirror ul[data-type="taskList"] li > div > p {
    line-height: inherit;
    min-height: ${checklistLineHeight}px;
  }
`;
};

const getEditorCss = (
    baseFontSize: number,
    checklistScaleFactor: number,
    bottomPadding: number = 72,
) => {
    const baseLineHeight = Math.round(baseFontSize * 1.55);
    const safeBottomPadding = Math.max(0, Math.round(bottomPadding));

    return `
  html, body {
    margin: 0;
    padding: 0;
    background: ${colors.background};
    width: 100%;
    max-width: 100%;
    overflow-x: hidden;
  }

  body {
    font-size: ${baseFontSize}px;
    line-height: ${baseLineHeight}px;
    color: ${colors.text};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .ProseMirror {
    box-sizing: border-box;
    min-height: 100%;
    width: 100%;
    max-width: 100%;
    padding: 0 0 ${safeBottomPadding}px;
    outline: none;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-x: hidden;
  }

  .ProseMirror p {
    margin: 0;
    min-height: ${baseLineHeight}px;
  }

  .ProseMirror ul,
  .ProseMirror ol {
    margin: 0;
    padding-left: 1.35rem;
    max-width: 100%;
  }

  .ProseMirror li {
    margin: 0;
  }

  .ProseMirror li > p {
    margin: 0;
    min-width: 0;
  }

  /* Hide placeholder on empty checklist items */
  .ProseMirror ul[data-type="taskList"] *::before,
  .ProseMirror ul[data-type="taskList"]::before,
  .ProseMirror ul[data-type="taskList"].is-editor-empty::before,
  .ProseMirror ul[data-type="taskList"].is-empty::before,
  .ProseMirror ul[data-type="taskList"] .is-editor-empty::before,
  .ProseMirror ul[data-type="taskList"] .is-empty::before,
  .ProseMirror ul[data-type="taskList"] [data-placeholder]::before {
    content: none !important;
    display: none !important;
    opacity: 0 !important;
    visibility: hidden !important;
  }
  ${getChecklistCss(baseFontSize, checklistScaleFactor)}
`;
};

const TASK_ITEM_REFOCUS_MESSAGE_TYPE = 'vaulto-task-item-refocus';

const getTaskItemRefocusJs = () => `
(() => {
  const MESSAGE_TYPE = ${JSON.stringify(TASK_ITEM_REFOCUS_MESSAGE_TYPE)};
  const INSTALL_FLAG = '__vaultoTaskItemRefocusInstalled';
  const TASK_ITEM_SELECTOR = 'li[data-type="taskItem"]';

  if (window[INSTALL_FLAG]) {
    return true;
  }

  window[INSTALL_FLAG] = true;

  const postRefocusMessage = () => {
    window.ReactNativeWebView?.postMessage(JSON.stringify({ type: MESSAGE_TYPE }));
  };

  const resolveSelectionContext = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
      return null;
    }

    const range = selection.getRangeAt(0);
    const anchorNode = range.startContainer;
    const anchorElement = anchorNode instanceof Element ? anchorNode : anchorNode.parentElement;

    if (!(anchorElement instanceof Element)) {
      return null;
    }

    const taskItem = anchorElement.closest(TASK_ITEM_SELECTOR);
    if (!(taskItem instanceof HTMLElement)) {
      return null;
    }

    const contentRoot = Array.from(taskItem.children).find(
      (child) => child instanceof HTMLDivElement
    ) || taskItem.querySelector('div');
    if (!(contentRoot instanceof HTMLElement)) {
      return null;
    }

    if (!contentRoot.contains(anchorNode) && !contentRoot.contains(anchorElement)) {
      return null;
    }

    return { range, contentRoot };
  };

  const isAtStartOfTaskItem = () => {
    const context = resolveSelectionContext();
    if (!context) {
      return false;
    }

    const prefixRange = context.range.cloneRange();
    prefixRange.selectNodeContents(context.contentRoot);
    prefixRange.setEnd(context.range.startContainer, context.range.startOffset);

    const prefixText = prefixRange.toString()
      .replace(/\\u200B/g, '')
      .replace(/\\n/g, '')
      .replace(/\\r/g, '');

    return prefixText.length === 0;
  };

  let refocusTimer = null;

  const scheduleRefocus = () => {
    if (refocusTimer) {
      window.clearTimeout(refocusTimer);
    }

    refocusTimer = window.setTimeout(() => {
      refocusTimer = null;
      postRefocusMessage();
    }, 24);
  };

  const maybeScheduleRefocus = () => {
    if (!isAtStartOfTaskItem()) {
      return;
    }

    scheduleRefocus();
  };

  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.key !== 'Backspace') {
      return;
    }

    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    maybeScheduleRefocus();
  }, true);

  document.addEventListener('beforeinput', (event) => {
    if (typeof InputEvent === 'undefined' || !(event instanceof InputEvent)) {
      return;
    }

    if (event.defaultPrevented || event.inputType !== 'deleteContentBackward') {
      return;
    }

    maybeScheduleRefocus();
  }, true);
})();
true;
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
        autoScalingEnabled = true,
        lockedChecklistScaleFactor = null,
        showToolbar = false,
        contentBottomPadding = 72,
        onAudioAction,
    } = props;

    const taskItemRefocusBridge = useMemo(() => (
        new BridgeExtension({
            forceName: 'vaultoTaskItemRefocusBridge',
            onEditorMessage: (message: { type?: string }, editorBridge) => {
                if (message.type !== TASK_ITEM_REFOCUS_MESSAGE_TYPE) {
                    return false;
                }

                setTimeout(() => {
                    editorBridge.focus(undefined);
                }, 30);

                return true;
            },
        })
    ), []);

    const renderedExternalHtml = useMemo(
        () => richContentToEditorHtml(initialContent),
        [initialContent]
    );
    const initialEditorHtmlRef = useRef(renderedExternalHtml);
    const bridgeInitialContent = renderedExternalHtml;
    const contentChecklistScaleFactor = useMemo(() => (
        lockedChecklistScaleFactor
            ?? (autoScalingEnabled
                ? resolveChecklistScaleFactor(countChecklistItems(bridgeInitialContent), true)
                : 1)
    ), [autoScalingEnabled, bridgeInitialContent, lockedChecklistScaleFactor]);
    const initialEditorCssRef = useRef<string | null>(null);
    if (initialEditorCssRef.current === null) {
        initialEditorCssRef.current = getEditorCss(baseFontSize, contentChecklistScaleFactor, contentBottomPadding);
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
            taskItemRefocusBridge,
            getAudioEmbedBridge(onAudioAction),
        ]
    ), [onAudioAction, taskItemRefocusBridge]);
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
    const lastHtmlRef = useRef(initialEditorHtmlRef.current);
    const latestHtmlRef = useRef(initialEditorHtmlRef.current);
    const lastReparseTriggerRef = useRef(reparseTrigger);
    const pendingProgrammaticHtmlRef = useRef<string | null>(null);
    const pendingFlushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastFocusedRef = useRef(false);
    const [isColorPickerVisible, setIsColorPickerVisible] = useState(false);
    const editorApi = editor as typeof editor & {
        setPlaceholder?: (value: string) => void;
        injectCSS?: (css: string, tag?: string) => void;
        injectJS?: (js: string) => void;
        setImage?: (src: string) => void;
    };
    const normalizeEditorHtml = useCallback((html: unknown): string => {
        if (typeof html !== 'string') {
            return '<p></p>';
        }

        const trimmed = html.trim();
        if (!trimmed) {
            return '<p></p>';
        }

        return normalizeRichHighlightColors(stripTransientAudioEmbedState(trimmed));
    }, []);
    const currentEditorHtml = useMemo(() => (
        editorHtml ? normalizeEditorHtml(editorHtml) : bridgeInitialContent
    ), [bridgeInitialContent, editorHtml, normalizeEditorHtml]);
    const checklistSourceHtml = typeof currentEditorHtml === 'string'
        ? currentEditorHtml
        : bridgeInitialContent;
    const checklistScaleFactor = useMemo(() => (
        lockedChecklistScaleFactor
            ?? (autoScalingEnabled
                ? resolveChecklistScaleFactor(countChecklistItems(checklistSourceHtml), true)
                : 1)
    ), [autoScalingEnabled, checklistSourceHtml, lockedChecklistScaleFactor]);
    const resolvedPlaceholder = useMemo(
        () => resolveEditorPlaceholder(checklistSourceHtml, placeholder),
        [checklistSourceHtml, placeholder]
    );

    const applyProgrammaticContent = (content: string, nextHtmlOverride?: string) => {
        const nextHtml = nextHtmlOverride ?? richContentToEditorHtml(content);

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
        const nextHtml = normalizeEditorHtml(await editor.getHTML());
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
            return nextHtml;
        }

        if (nextHtml !== lastHtmlRef.current) {
            lastHtmlRef.current = nextHtml;
            onChange(nextHtml);
        }

        return nextHtml;
    };

    useEffect(() => {
        if (!editorState.isReady) {
            return;
        }

        editorApi.setPlaceholder?.(resolvedPlaceholder);
        editorApi.injectCSS?.(
            getEditorCss(baseFontSize, checklistScaleFactor, contentBottomPadding),
            'vaulto-editor-minimal-css'
        );
        editorApi.injectJS?.(getTaskItemRefocusJs());
        editorApi.injectJS?.(getAudioEmbedRuntimeJs());
    }, [baseFontSize, checklistScaleFactor, contentBottomPadding, editorApi, editorState.isReady, resolvedPlaceholder]);


    useEffect(() => {
        if (!editorState.isReady) {
            return;
        }

        const flushPendingHtml = async (forceRead: boolean = false) => {
            let nextHtml = latestHtmlRef.current;

            if (forceRead) {
                nextHtml = normalizeEditorHtml(await editor.getHTML());
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
            onChange(nextHtml);
        };

        if (!editorState.isReady || typeof currentEditorHtml !== 'string') {
            return;
        }

        const normalizedEditorHtml = currentEditorHtml;
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
    }, [currentEditorHtml, editor, editorState.isReady, normalizeEditorHtml, onChange]);

    useEffect(() => {
        if (!editorState.isReady) {
            return;
        }

        const reparseChanged = reparseTrigger !== lastReparseTriggerRef.current;
        const contentChanged = initialContent !== lastExternalContentRef.current;
        const renderedHtmlChanged = renderedExternalHtml !== lastHtmlRef.current;

        if (!reparseChanged && !contentChanged && !renderedHtmlChanged) {
            return;
        }

        lastReparseTriggerRef.current = reparseTrigger;
        applyProgrammaticContent(initialContent, renderedExternalHtml);
    }, [editorState.isReady, initialContent, renderedExternalHtml, reparseTrigger]);

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
        setContent: (content: string) => {
            applyProgrammaticContent(content);
        },
        insertAudioEmbed: (payload: InsertAudioEmbedPayload) => {
            const previewSrc = buildAudioEmbedPreviewSrc({
                path: payload.path,
                duration: payload.duration,
            });

            if (!previewSrc) {
                return;
            }

            if (
                payload.selection &&
                Number.isFinite(payload.selection.start) &&
                Number.isFinite(payload.selection.end)
            ) {
                editor.setSelection(
                    Math.max(0, Math.floor(Number(payload.selection.start))),
                    Math.max(0, Math.floor(Number(payload.selection.end)))
                );
            }

            editorApi.setImage?.(previewSrc);
            editorApi.injectJS?.(`
                setTimeout(() => {
                    try {
                        const editorRoot = document.querySelector('.ProseMirror');
                        if (!editorRoot) {
                            return;
                        }

                        editorRoot.focus();
                        document.execCommand('insertParagraph');
                    } catch (error) {
                        console.warn('Failed to create paragraph after audio embed', error);
                    }
                }, 24);
                true;
            `);
        },
        setAudioEmbedState: (payload: AudioEmbedRuntimeState) => {
            editorApi.injectJS?.(`
                window.__vaultoAudioPreviewApi?.setState(${JSON.stringify(payload)});
                true;
            `);
        },
        flushPendingChanges: () => flushPendingContent(),
        blur: () => {
            editor.blur();
        },
    }), [applyFormat, editor, editorApi]);

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
    prev.initialContent === next.initialContent &&
    prev.contentBottomPadding === next.contentBottomPadding &&
    prev.onAudioAction === next.onAudioAction
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
