import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect, memo } from 'react';
import {
    View,
    TextInput,
    TouchableOpacity,
    Text,
    ActivityIndicator,
    Alert,
    ScrollView,
    KeyboardAvoidingView,
    Platform,
    Modal,
    TouchableWithoutFeedback,
    Keyboard,
    Dimensions,
    Share,
    Animated,
    AppState,
    Linking,
} from 'react-native';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import { Sound } from '../services/audioPlayback';
import { captureRef } from 'react-native-view-shot';
import { GestureHandlerRootView, ScrollView as GestureHandlerScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { RichTextEditor, RichTextEditorHandle } from '../components/RichTextEditor';
import { AudioEmbedControlPayload } from '../components/richTextAudioBridge';
import { CommonActions, useFocusEffect, useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialIcons } from '@expo/vector-icons';
import { RootStackParamList } from '../navigation/types';
import { useNotesContext } from '../contexts/NotesContext';
import { useAuth } from '../hooks/useAuth';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors, isDarkScheme } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { VoiceRecorder } from '../components/VoiceRecorder';
import { getLocalWhisperModelStatus, startRealtimeDictation } from '../services/LocalWhisperService';
import { LocalWhisperDownloadModal } from '../components/LocalWhisperDownloadModal';
import { AudioPlayer } from '../components/AudioPlayer';
import { PrivacyWarningModal } from '../components/PrivacyWarningModal';
import { DeleteConfirmationDialog } from '../components/DeleteConfirmationDialog';
import { VersionsSheet, VersionListItem } from '../components/VersionsSheet';
import { TasksSheet, TaskSheetItem } from '../components/TasksSheet';
import {
    checklistTitlesFromMarkdown,
    googleCalendarUrl,
    isTaskInNote,
    taskToCalendarEvent,
    tasksToChecklistMarkdown,
    type ExtractedTask,
} from '../utils/taskExtraction';
import { markdownToTiptapHtml } from '../utils/tiptapMarkdownAdapter';
import { CompareVersionsModal } from '../components/CompareVersionsModal';
import { UndoSnackbar } from '../components/UndoSnackbar';

import { AudioService, AudioRecording } from '../services/AudioService';
import { transcribeAudio, processVoiceNote, isOnDeviceTranscriptionActive, ON_DEVICE_MODEL_REQUIRED } from '../services/TranscriptionService';
import { getCryptoMode } from '../crypto/encryption';
import { saveVoiceRecordingLocal, getVoiceRecordingsLocal, deleteVoiceRecordingLocal } from '../services/DatabaseService';
import { getLocalLLMModelStatus, isLocalLLMRuntimeAvailable } from '../services/LocalLLMService';
import { Note, NotePrivacy, StorageScope, VoiceRecording } from '../api/notes';
import * as Haptics from 'expo-haptics';

import {
    improveText,
    loadImprovementOptions,
    optionExpectsJson,
    saveImprovementOptions,
    AIImprovementOption,
    DEFAULT_IMPROVEMENT_OPTIONS,
    ensureTemplateHasPlaceholder,
    extractTasks,
} from '../services/AIService';
import {
    AIProvider,
    getAgentModeEnabled,
    getTranscriptionEnabled,
    getAIProvider,
    getFontSize,
    setFontSize,
    getAutoScalingEnabled,
    setAutoScalingEnabled,
    getPrivateAIAllowed,
    setPrivateAIAllowed,
    getChecklistScaleLocks,
    setChecklistScaleLock,
    getTranscriptionLanguage,
    getOnDeviceOfferShown,
    setOnDeviceOfferShown,
    incrementRecordingsCount,
    setOnDeviceTranscription,
} from '../utils/storage';
import { MarkdownToolbar, MarkdownFormatType } from '../components/MarkdownToolbar';
import { TextAppearanceModal } from '../components/TextAppearanceModal';
import { AIProcessingIndicator, AIActiveTask } from '../components/AIProcessingIndicator';
import { TranscriptionIndicator } from '../components/TranscriptionIndicator';
import { LimitModal } from '../components/LimitModal';
import { ErrorModal } from '../components/ErrorModal';
import { SignInRequiredModal } from '../components/SignInRequiredModal';
import { getErrorMessage } from '../utils/errorMessage';
import { LOCAL_WHISPER_ENABLED } from '../utils/featureFlags';
import {
    appendPlainTextSnippetToRichContent,
    deriveAutoTitleFromPlainText,
    extractEmbeddedAudioPaths,
    hasMeaningfulRichContent,
    isRichHtmlContent,
    removeAudioFromRichContent,
    normalizeModelMarkdownForEditor,
    richContentToAgentMarkdown,
    richContentToMarkdown,
    richContentToPlainText,
    stripAudioEmbedsFromRichContent,
    titleMatchesContextScript,
} from '../utils/richContent';
import { getLocalizedPresetDescription, getLocalizedPresetLabel } from '../i18n/presetLabels';
import { getVersionSwipeHintSeen, setVersionSwipeHintSeen } from '../utils/storage';
import {
    agentOptionIdForMode,
    buildLineageLabel,
    buildVariantDisplayLabels,
    chipTextForLabel,
    englishStepName,
    isDerivedLabel,
    markUserVariantName,
    plainVariantTitle,
    userVariantName,
    PREVIOUS_ORIGINAL_OPTION_ID,
    storedStepLabelOf,
    variantIconFor,
} from '../i18n/variantLabels';
import {
    resolveChecklistScaleForContent,
} from '../utils/checklistScale';
import { buildAudioEmbedHtml } from '../utils/audioEmbeds';
import { sanitizeDisplayLabel, stripStoredTitleMarkdown } from '../utils/markdownUtils';
import { MarkdownPreview } from '../components/MarkdownPreview';
import { createStyles } from '../theme/createStyles';
import { haptics } from '../utils/haptics';
import { rtlFlip } from '../i18n/direction';

// Chips stay 40dp tall to keep the row compact; the slop makes the target 48dp.
const CHIP_HIT_SLOP = { top: 4, bottom: 4 };

type NoteEditScreenRouteProp = RouteProp<RootStackParamList, 'NoteEdit'>;
type NoteEditScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'NoteEdit'>;
const CUSTOM_AI_UNIVERSAL_ERROR = 'Unable to connect to your Custom AI provider. Check provider API key and provider settings.';
const NEW_NOTE_AUTO_SCALE_DRAFT_ID = '__new_note_auto_scale_draft__';
const FLOATING_MIC_BASE_BOTTOM_OFFSET = spacing.xxl + 20;
const FLOATING_MIC_KEYBOARD_GAP = 28;
const FLOATING_MIC_TOOLBAR_HEIGHT = 44;
// Breathing room below the last editor line so it clears the docked toolbar
// (keyboard open) and the Android navigation bar (keyboard closed).
const EDITOR_CONTENT_BOTTOM_GAP = 24;

const normalizeTextForComparison = (value: string): string =>
    value.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();

const areTextsEquivalent = (a: string, b: string): boolean =>
    normalizeTextForComparison(a) === normalizeTextForComparison(b);

const countNormalizedOccurrences = (haystack: string, needle: string): number => {
    if (!needle) return 0;

    let count = 0;
    let offset = 0;

    while (true) {
        const index = haystack.indexOf(needle, offset);
        if (index === -1) break;
        count += 1;
        offset = index + needle.length;
    }

    return count;
};

const appendSnippetToContent = (base: string, snippet: string): string => {
    return appendPlainTextSnippetToRichContent(base, snippet);
};

const insertBlockAtSelection = (
    base: string,
    block: string,
    selection?: { start: number; end: number } | null
): string => {
    const source = base || '';
    const nextBlock = block.trim();
    if (!nextBlock) {
        return source;
    }

    const rawStart = selection?.start ?? source.length;
    const rawEnd = selection?.end ?? rawStart;
    const start = Math.max(0, Math.min(rawStart, source.length));
    const end = Math.max(start, Math.min(rawEnd, source.length));
    const before = source.slice(0, start);
    const after = source.slice(end);
    const prefix = before.length > 0 && !before.endsWith('\n') ? '\n' : '';
    const suffix = after.length > 0 && !after.startsWith('\n') ? '\n' : '';

    return `${before}${prefix}${nextBlock}${suffix}${after}`;
};

const normalizeAttachedAudioPath = (value?: string | null): string | null => {
    if (!value) return null;
    let normalized = value.trim();
    // Strip file:// prefix for matching only
    normalized = normalized.replace(/^file:\/\/\/?/, '');
    // Normalize slashes
    normalized = normalized.replace(/\/+/g, '/');
    // Ensure leading slash for absolute paths
    if (!normalized.startsWith('/')) {
        normalized = '/' + normalized;
    }
    return normalized;
};

const deriveTitleFromText = (text: string): string => {
    // The source can be raw markdown from the model or editor HTML, and both used
    // to leak syntax ("**Итоги:**") into the title field, which renders literally.
    // Only the first block: sanitizeDisplayLabel folds newlines into spaces, so
    // a heading and the list under it used to merge into one long "title".
    const firstLine = richContentToPlainText(text || '')
        .split('\n')
        .map((line) => line.trim())
        .find(Boolean) || '';
    const cleaned = sanitizeDisplayLabel(firstLine);

    if (!cleaned) return '';

    const sentence = cleaned.split(/[.!?;\n]/)[0]?.trim() || '';
    const source = sentence || cleaned;
    if (!source) return '';

    const words = source.split(' ').filter(Boolean).slice(0, 6);
    if (words.length === 0) return '';

    const title = words.join(' ').trim();
    return title.length > 80 ? title.slice(0, 80).trim() : title;
};

type MicInputMode = 'agent' | 'force_text';

const TODO_LIST_LINE_REGEX = /^\s*[-*]\s*\[(?:[ xX])?\]\s+/m;
const CHECKLIST_ITEM_LINE_REGEX = /^\s*[-*]\s*\[(?:[ xX])?\]\s*(.*)$/;
const CHECKLIST_MUTABLE_LINE_REGEX = /^(\s*[-*]\s*)\[(?:([ xX]))?\](\s*)(.*)$/;
const RICH_TASK_ITEM_BLOCK_REGEX = /<li\b(?=[^>]*data-type=(["'])taskItem\1)[^>]*>[\s\S]*?<\/li>/gi;
const RICH_CHECKBOX_INPUT_TAG_REGEX = /<input\b(?=[^>]*type=(["'])checkbox\1)[^>]*>/i;
const RICH_DATA_CHECKED_ATTR_REGEX = /data-checked=(["'])(true|false)\1/i;
const RICH_BOOLEAN_CHECKED_ATTR_REGEX = /\schecked(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?/i;
const STRUCTURED_LIST_LINE_REGEX = /^\s*(?:[-*]\s*\[(?:[ xX])?\]\s+|[-*]\s+|\d+[\.\)]\s+)/;

const stripListMarker = (value: string): string =>
    value
        .replace(/^\s*[-*]\s+/, '')
        .replace(/^\s*\d+[\.\)]\s+/, '')
        .trim();

const normalizeStructuredListLine = (value: string): string =>
    value
        .replace(/^\s*[-*]\s*\[(?:[ xX])?\]\s+/, '')
        .replace(/^\s*[-*]\s+/, '')
        .replace(/^\s*\d+[\.\)]\s+/, '')
        .replace(/\s+/g, ' ')
        .trim();

const extractStructuredListLines = (value: string): string[] =>
    (value || '')
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter((line) => STRUCTURED_LIST_LINE_REGEX.test(line))
        .map(normalizeStructuredListLine)
        .filter(Boolean);

const hasContiguousLineBlock = (haystack: string[], needle: string[]): boolean => {
    if (needle.length === 0 || haystack.length < needle.length) return false;

    for (let start = 0; start <= haystack.length - needle.length; start += 1) {
        let matched = true;
        for (let offset = 0; offset < needle.length; offset += 1) {
            if (haystack[start + offset] !== needle[offset]) {
                matched = false;
                break;
            }
        }
        if (matched) return true;
    }

    return false;
};

const contentAlreadyContainsStructuredListBlock = (base: string, block: string): boolean => {
    const blockLines = extractStructuredListLines(block);
    if (blockLines.length < 2) return false;

    const comparableBase = isRichHtmlContent(base) ? richContentToPlainText(base) : base;
    const baseLines = (comparableBase || '')
        .split(/\r?\n/)
        .map((line) => normalizeStructuredListLine(line.trimEnd()));

    return hasContiguousLineBlock(baseLines, blockLines);
};

const normalizeChecklistCommandText = (value: string): string =>
    value
        .toLocaleLowerCase()
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

const extractChecklistItemTexts = (content: string): string[] => {
    const comparableContent = isRichHtmlContent(content)
        ? richContentToAgentMarkdown(content)
        : content;

    return (comparableContent || '')
        .split(/\r?\n/)
        .map((line) => {
            const match = line.match(CHECKLIST_ITEM_LINE_REGEX);
            return match ? normalizeChecklistCommandText(match[1] || '') : '';
        })
        .filter(Boolean);
};

const transcriptDirectlyMentionsChecklistItem = (content: string, transcript: string): boolean => {
    const normalizedTranscript = normalizeChecklistCommandText(transcript);
    if (!normalizedTranscript) return false;

    return extractChecklistItemTexts(content).some((itemText) => (
        itemText.length >= 2 && normalizedTranscript.includes(itemText)
    ));
};

type ParsedChecklistItem = {
    checked: boolean;
    text: string;
};

const parseChecklistLineForCommandFallback = (line: string): ParsedChecklistItem | null => {
    const match = line.match(CHECKLIST_MUTABLE_LINE_REGEX);
    if (!match) return null;

    const text = normalizeChecklistCommandText(match[4] || '');
    if (!text) return null;

    return {
        checked: typeof match[2] === 'string' && match[2].toLowerCase() === 'x',
        text,
    };
};

const parseChecklistItemsForCommandFallback = (content: string): ParsedChecklistItem[] => {
    if (!content) return [];

    if (!isRichHtmlContent(content)) {
        return (content || '')
            .split(/\r?\n/)
            .map(parseChecklistLineForCommandFallback)
            .filter((item): item is ParsedChecklistItem => !!item);
    }

    return Array.from(content.matchAll(RICH_TASK_ITEM_BLOCK_REGEX))
        .map((match) => parseChecklistLineForCommandFallback(richContentToAgentMarkdown(match[0])))
        .filter((item): item is ParsedChecklistItem => !!item);
};

const updateMarkdownChecklistItemsCheckedPreservingFormat = (
    content: string,
    itemTextsToCheck: Set<string>,
): string | null => {
    if (!content || itemTextsToCheck.size === 0) return null;

    let changed = false;
    const nextContent = content.replace(/^(\s*[-*]\s*)\[(?:([ xX]))?\](\s*)(.*)$/gm, (line, prefix, marker, spacing, text) => {
        const normalizedItemText = normalizeChecklistCommandText(text || '');
        const isChecked = typeof marker === 'string' && marker.toLowerCase() === 'x';
        if (!normalizedItemText || isChecked || !itemTextsToCheck.has(normalizedItemText)) {
            return line;
        }

        changed = true;
        return `${prefix}[x]${spacing}${text}`;
    });

    return changed ? nextContent : null;
};

const setRichTaskItemCheckedState = (block: string, checked: boolean): string => {
    let nextBlock = block;

    if (RICH_DATA_CHECKED_ATTR_REGEX.test(nextBlock)) {
        nextBlock = nextBlock.replace(
            RICH_DATA_CHECKED_ATTR_REGEX,
            (_match, quote: string) => `data-checked=${quote}${checked ? 'true' : 'false'}${quote}`
        );
    } else {
        nextBlock = nextBlock.replace(/^<li\b/i, `<li data-checked="${checked ? 'true' : 'false'}"`);
    }

    nextBlock = nextBlock.replace(RICH_CHECKBOX_INPUT_TAG_REGEX, (inputTag) => {
        const hasCheckedAttr = RICH_BOOLEAN_CHECKED_ATTR_REGEX.test(inputTag);
        if (checked) {
            if (hasCheckedAttr) return inputTag;
            return inputTag.replace(/\/?>$/, (closing) => ` checked${closing}`);
        }

        return inputTag.replace(RICH_BOOLEAN_CHECKED_ATTR_REGEX, '');
    });

    return nextBlock;
};

const updateRichChecklistItemsCheckedPreservingFormat = (
    content: string,
    itemTextsToCheck: Set<string>,
): string | null => {
    if (!content || itemTextsToCheck.size === 0) return null;

    let changed = false;
    const nextContent = content.replace(RICH_TASK_ITEM_BLOCK_REGEX, (block) => {
        const parsedItem = parseChecklistLineForCommandFallback(richContentToAgentMarkdown(block));
        if (!parsedItem || parsedItem.checked || !itemTextsToCheck.has(parsedItem.text)) {
            return block;
        }

        const updatedBlock = setRichTaskItemCheckedState(block, true);
        changed = changed || updatedBlock !== block;
        return updatedBlock;
    });

    return changed ? nextContent : null;
};

const resolveDirectChecklistCheckFallback = (content: string, transcript: string): string | null => {
    const normalizedTranscript = normalizeChecklistCommandText(transcript);
    if (!normalizedTranscript) return null;

    const items = parseChecklistItemsForCommandFallback(content);
    if (items.length === 0) return null;

    const directlyMentionedUncheckedItems = items.filter((item) => (
        !item.checked &&
        item.text.length >= 2 &&
        normalizedTranscript.includes(item.text)
    ));
    if (directlyMentionedUncheckedItems.length === 0) return null;

    let residualIntent = normalizedTranscript;
    directlyMentionedUncheckedItems
        .slice()
        .sort((left, right) => right.text.length - left.text.length)
        .forEach((item) => {
            residualIntent = residualIntent.replace(item.text, ' ');
        });
    residualIntent = residualIntent
        .replace(/[.,!?;:()[\]{}"'`/\\+-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!residualIntent) {
        return null;
    }

    const itemTextsToCheck = new Set(directlyMentionedUncheckedItems.map((item) => item.text));
    return isRichHtmlContent(content)
        ? updateRichChecklistItemsCheckedPreservingFormat(content, itemTextsToCheck)
        : updateMarkdownChecklistItemsCheckedPreservingFormat(content, itemTextsToCheck);
};

const extractListLikeItems = (text: string): string[] => {
    const trimmed = (text || '').trim();
    if (!trimmed) return [];

    if (trimmed.includes('\n')) {
        return trimmed
            .split('\n')
            .map(stripListMarker)
            .filter(Boolean);
    }

    if (trimmed.includes(';')) {
        return trimmed
            .split(';')
            .map(stripListMarker)
            .filter(Boolean);
    }

    if (trimmed.includes(',')) {
        const commaItems = trimmed
            .split(',')
            .map(stripListMarker)
            .filter(Boolean);

        // Commas are common in normal dictation. Treat as list only for compact multi-item phrases.
        const isCompactCommaList =
            commaItems.length >= 3 &&
            commaItems.every((item) => item.length <= 32 && !/[.!?]/.test(item));

        if (isCompactCommaList) {
            return commaItems;
        }
    }

    return [];
};

const looksLikeListDictation = (text: string): boolean => {
    const trimmed = (text || '').trim();
    if (!trimmed) return false;
    if (/^\s*[-*]\s+/.test(trimmed) || /^\s*\d+[\.\)]\s+/.test(trimmed)) return true;
    const items = extractListLikeItems(trimmed);
    return items.length >= 2;
};

const appendDictationToTodoContent = (base: string, dictatedText: string): string => {
    const normalizedBase = (base || '').trimEnd();
    const normalizedDictation = (dictatedText || '').trim();
    if (!normalizedDictation) return normalizedBase;

    if (looksLikeListDictation(normalizedDictation)) {
        const items = extractListLikeItems(normalizedDictation);
        const checklist = (items.length > 0 ? items : [normalizedDictation]).map((item) => `- [ ] ${item}`);
        return appendSnippetToContent(normalizedBase, checklist.join('\n'));
    }

    return appendSnippetToContent(normalizedBase, normalizedDictation);
};

/**
 * Joins the text a note had when dictation started with the transcript Whisper
 * reports. The transcript is always the full session text, so it replaces - never
 * extends - whatever the previous update wrote.
 */
const composeDictatedContent = (baseText: string, transcript: string): string => {
    const dictated = (transcript || '').trim();
    if (!dictated) return baseText;
    if (!baseText) return dictated;
    return /\s$/.test(baseText) ? `${baseText}${dictated}` : `${baseText} ${dictated}`;
};

/** Returns an i18n key rather than English text so agent feedback follows the app language. */
const buildAgentStatusKey = (mode?: string | null, action: 'created' | 'updated' = 'updated'): string => {
    const normalizedMode = (mode || '').toLowerCase();
    if (normalizedMode === 'todo' || normalizedMode === 'list') {
        return action === 'created' ? 'edit.agent.createdChecklist' : 'edit.agent.updatedChecklist';
    }
    if (normalizedMode === 'format') {
        return action === 'created' ? 'edit.agent.createdImprovedView' : 'edit.agent.updatedFormatting';
    }
    return action === 'created' ? 'edit.agent.createdImprovedView' : 'edit.agent.updatedNote';
};

/** Maps the server's machine-readable confirmation reason to a localized question. */
const AGENT_CONFIRMATION_KEYS: Record<string, string> = {
    clear_content: 'edit.agent.confirmClear',
    replace_content: 'edit.agent.confirmReplace',
    remove_items: 'edit.agent.confirmRemoveItems',
    checklist_update: 'edit.agent.confirmChecklist',
};

const HeaderTitle = memo(({
    title,
    onChange,
    onFocus,
    inputRef,
    autoTitle,
}: {
    title: string;
    onChange: (t: string) => void;
    onFocus: () => void;
    inputRef?: React.RefObject<TextInput | null>;
    /** What the notes list shows for an untitled note; hinted here too. */
    autoTitle?: string;
}) => {
    const { t } = useTranslation();

    return (
        <TextInput
            ref={inputRef}
            style={styles.titleInput}
            placeholder={autoTitle || t('edit.titlePlaceholder', 'Title')}
            placeholderTextColor={colors.textMuted}
            value={title}
            onChangeText={onChange}
            onFocus={onFocus}
            maxLength={100}
            multiline
        />
    );
});

const HeaderMeta = memo(({ dateStr, charCount }: { dateStr: string; charCount: number }) => {
    const { t } = useTranslation();

    return (
        <View style={styles.metaInfo}>
            <Text style={styles.metaText}>
                {dateStr}  |  {t('edit.charactersCount', '{{count}} characters', { count: charCount })}
            </Text>
        </View>
    );
});

const MemoizedImprovementChips = memo(({
    noteImprovements,
    activeVariantId,
    handleVariantSelect,
    onRequestDelete,
    onOpenAllVersions,
    optionIcons,
    displayLabels,
}: {
    noteImprovements: any[],
    activeVariantId: string,
    handleVariantSelect: (id: string) => void,
    onRequestDelete: (id: string) => void,
    onOpenAllVersions: () => void,
    /** option id -> Material icon, so a chip shows which action produced it. */
    optionIcons: Record<string, string>,
    /** variant id -> localized step label ("Summarize", "Professional → Summarize"). */
    displayLabels: Record<string, string>,
}) => {
    const { t } = useTranslation();
    const scrollRef = useRef<any>(null);
    /** variant id -> chip offset/width, so the active tab can be revealed. */
    const chipLayoutsRef = useRef<Record<string, { x: number; width: number }>>({});
    const viewportWidthRef = useRef(0);
    /** Last variant we actually scrolled to, so onLayout does not fight the user. */
    const revealedForRef = useRef<string | null>(null);

    const revealChip = useCallback((variantId: string, force = false) => {
        if (variantId === 'original') return; // pinned outside the scroll row
        if (!force && revealedForRef.current === variantId) return;

        const layout = chipLayoutsRef.current[variantId];
        const viewportWidth = viewportWidthRef.current;
        // Measurements can still be missing right after mount; leave the marker
        // untouched so the next onLayout retries.
        if (!layout || !viewportWidth) return;
        if (typeof scrollRef.current?.scrollTo !== 'function') return;

        // Centre the active chip so neighbours stay visible on both sides and it
        // stays obvious that there are more variants past the edge.
        const target = layout.x + layout.width / 2 - viewportWidth / 2;
        revealedForRef.current = variantId;
        scrollRef.current.scrollTo({ x: Math.max(0, target), animated: true });
    }, []);

    // Switching a variant first flushes the editor and saves the draft, so the
    // real active id lands a few hundred ms after the tap. Highlight the tapped
    // chip immediately instead of leaving the row looking unresponsive.
    const [pendingVariantId, setPendingVariantId] = useState<string | null>(null);
    const selectedVariantId = pendingVariantId ?? activeVariantId;

    useEffect(() => {
        if (pendingVariantId === null) return undefined;
        if (pendingVariantId === activeVariantId) {
            setPendingVariantId(null);
            return undefined;
        }
        // Safety net: never leave a stale highlight if the switch never lands.
        const timer = setTimeout(() => setPendingVariantId(null), 4000);
        return () => clearTimeout(timer);
    }, [activeVariantId, pendingVariantId]);

    // Switching from anywhere (chip tap, agent creating a variant) should bring
    // the active tab into view instead of leaving it off-screen.
    useEffect(() => {
        const timer = setTimeout(() => revealChip(selectedVariantId, true), 60);
        return () => clearTimeout(timer);
    }, [selectedVariantId, noteImprovements.length, revealChip]);

    const selectVariant = useCallback((variantId: string) => {
        if (variantId === selectedVariantId) return;
        void Haptics.selectionAsync().catch(() => undefined);
        setPendingVariantId(variantId);
        handleVariantSelect(variantId);
    }, [selectedVariantId, handleVariantSelect]);

    if (noteImprovements.length === 0) return null;
    const originalActive = selectedVariantId === 'original';
    return (
        <View style={[styles.variantContainer, styles.variantRow]}>
            {/* Original stays pinned: it is the reference every version is read against. */}
            <TouchableOpacity
                style={[styles.variantChip, styles.variantOriginalChip, originalActive && styles.variantChipActive]}
                onPress={() => selectVariant('original')}
                hitSlop={CHIP_HIT_SLOP}
                accessibilityRole="button"
                accessibilityState={{ selected: originalActive }}
                accessibilityLabel={t("a11y.originalVersion", "Original version")}
            >
                <MaterialIcons
                    name="article"
                    size={14}
                    color={originalActive ? colors.onPrimary : colors.textSecondary}
                    style={styles.variantChipIcon}
                />
                <Text style={[styles.variantChipText, originalActive && styles.variantChipTextActive]}>
                    {t("edit.original")}
                </Text>
            </TouchableOpacity>
            <GestureHandlerScrollView
                ref={scrollRef}
                horizontal
                nestedScrollEnabled
                directionalLockEnabled
                showsHorizontalScrollIndicator={false}
                style={styles.variantScroll}
                contentContainerStyle={styles.variantScrollContent}
                keyboardShouldPersistTaps="always"
                onLayout={(event) => {
                    // Chips can be measured before the row is, so retry the reveal
                    // once the viewport width is finally known.
                    viewportWidthRef.current = event.nativeEvent.layout.width;
                    revealChip(selectedVariantId);
                }}
            >
                {noteImprovements.map((imp: any, index: number) => {
                    const isActive = selectedVariantId === imp.id;
                    const chipIcon = variantIconFor(imp, optionIcons);
                    const chipLabel = displayLabels[imp.id] || `${t("edit.improvement")} ${index + 1}`;
                    const chipText = chipTextForLabel(chipLabel);
                    return (
                        <View
                            style={styles.variantChipWrapper}
                            key={imp.id}
                            onLayout={(event) => {
                                const { x, width } = event.nativeEvent.layout;
                                chipLayoutsRef.current[imp.id] = { x, width };
                                revealChip(selectedVariantId);
                            }}
                        >
                            <TouchableOpacity
                                style={[styles.variantChip, isActive && styles.variantChipActive]}
                                onPress={() => selectVariant(imp.id)}
                                hitSlop={CHIP_HIT_SLOP}
                                onLongPress={onOpenAllVersions}
                                delayLongPress={400}
                                accessibilityRole="button"
                                accessibilityState={{ selected: isActive }}
                                accessibilityLabel={chipLabel}
                            >
                                {isDerivedLabel(chipLabel) && (
                                    // Made from another version, not from the original.
                                    <MaterialIcons
                                        name="subdirectory-arrow-right"
                                        size={14}
                                        color={isActive ? colors.onPrimary : colors.textSecondary}
                                    />
                                )}
                                <MaterialIcons
                                    name={chipIcon as any}
                                    size={14}
                                    color={isActive ? colors.onPrimary : colors.textSecondary}
                                    style={styles.variantChipIcon}
                                />
                                <Text
                                    numberOfLines={1}
                                    style={[
                                        styles.variantChipText,
                                        isActive && styles.variantChipTextActive,
                                    ]}
                                >
                                    {chipText}
                                </Text>
                            </TouchableOpacity>
                            {/* Close affordance only on the active chip, like editor tabs.
                                Deleting is undoable, and the full list offers it for any version. */}
                            {isActive && (
                                <TouchableOpacity
                                    style={styles.variantDeleteButton}
                                    onPress={() => onRequestDelete(imp.id)}
                                    hitSlop={6}
                                    accessibilityRole="button"
                                    accessibilityLabel={t("a11y.removeVersion", "Remove this version")}
                                >
                                    <MaterialIcons name="close" size={16} color={colors.textTertiary} />
                                </TouchableOpacity>
                            )}
                        </View>
                    );
                })}
            </GestureHandlerScrollView>
            {noteImprovements.length >= 2 && (
                <TouchableOpacity
                    style={styles.variantAllButton}
                    onPress={onOpenAllVersions}
                    hitSlop={CHIP_HIT_SLOP}
                    accessibilityRole="button"
                    accessibilityLabel={t("a11y.allVersions", "All versions")}
                >
                    <MaterialIcons name="view-list" size={18} color={colors.primary} />
                    <Text style={styles.variantAllCount}>{noteImprovements.length + 1}</Text>
                </TouchableOpacity>
            )}
        </View>
    );
});

const buildAgentImprovementLabel = (
    primaryTitle?: string | null,
    fallbackTitle?: string | null,
): string => {
    // Chips are plain <Text>: any markdown the model wraps a title in would be
    // rendered as literal "**" characters, so strip it at the single funnel.
    const normalizeTitleLabel = (value: string): string => sanitizeDisplayLabel(value);

    const candidates = [primaryTitle || '', fallbackTitle || ''];
    for (const candidate of candidates) {
        const normalized = normalizeTitleLabel(candidate);
        if (normalized) {
            return normalized;
        }
    }
    return '';
};

// History stack implementation - separate history for each variant
interface HistoryState {
    content: string;
    title: string;
}

interface VariantHistory {
    history: HistoryState[];
    index: number;
}

interface PendingVoiceInsertion {
    recordingId: string;
    variantId: string;
    baseContent: string;
    dictationContent: string;
}

interface AgentQueueTask {
    id: string;
    transcribedText: string;
    sessionId: number;
    noteId: string | undefined;
    targetVariantId: string;
    agentContextContent?: string;
    followLatestDerivedVariant?: boolean;
    micMode: MicInputMode;
    recordingId?: string;
    recordingIds?: string[];
    isBackground?: boolean;
    preserveOriginalOnInstruction?: boolean;
    dictationAlreadyApplied?: boolean;
}

interface NoteProcessingState {
    isTranscribing: boolean;
    isAIProcessing: boolean;
    queueLength: number;
    activeTasks?: AIActiveTask[];
}

const noteProcessingStateById = new Map<string, NoteProcessingState>();
const noteProcessingListeners = new Map<string, Set<(state: NoteProcessingState) => void>>();
const emptyNoteProcessingState: NoteProcessingState = {
    isTranscribing: false,
    isAIProcessing: false,
    queueLength: 0,
    activeTasks: [],
};

const getNoteProcessingState = (noteId: string): NoteProcessingState => {
    return noteProcessingStateById.get(noteId) ?? emptyNoteProcessingState;
};

const notifyNoteProcessingListeners = (noteId: string, state: NoteProcessingState) => {
    const listeners = noteProcessingListeners.get(noteId);
    if (!listeners) return;
    listeners.forEach((listener) => listener(state));
};

const setNoteProcessingState = (noteId: string, patch: Partial<NoteProcessingState>) => {
    const previous = getNoteProcessingState(noteId);
    const next: NoteProcessingState = {
        isTranscribing: patch.isTranscribing ?? previous.isTranscribing,
        isAIProcessing: patch.isAIProcessing ?? previous.isAIProcessing,
        queueLength: patch.queueLength ?? previous.queueLength,
        activeTasks: patch.activeTasks ?? previous.activeTasks,
    };
    const shouldClear = !next.isTranscribing && !next.isAIProcessing && next.queueLength <= 0;
    if (shouldClear) {
        noteProcessingStateById.delete(noteId);
    } else {
        noteProcessingStateById.set(noteId, next);
    }
    notifyNoteProcessingListeners(noteId, shouldClear ? emptyNoteProcessingState : next);
};

const subscribeNoteProcessingState = (
    noteId: string,
    listener: (state: NoteProcessingState) => void
) => {
    const listeners = noteProcessingListeners.get(noteId) ?? new Set<(state: NoteProcessingState) => void>();
    listeners.add(listener);
    noteProcessingListeners.set(noteId, listeners);
    listener(getNoteProcessingState(noteId));
    return () => {
        const current = noteProcessingListeners.get(noteId);
        if (!current) return;
        current.delete(listener);
        if (current.size === 0) {
            noteProcessingListeners.delete(noteId);
        }
    };
};

export const NoteEditScreen = () => {
    const { t, i18n } = useTranslation();
    const AGENT_HISTORY_LIMIT = 5;
    // Outer safety net only. It must stay above the inner deadlines
    // (transcription + agent), otherwise it aborts work that is still healthy.
    const AGENT_TASK_TIMEOUT_MS = 240000;
    const navigation = useNavigation<NoteEditScreenNavigationProp>();
    const route = useRoute<NoteEditScreenRouteProp>();
    const insets = useSafeAreaInsets();
    const {
        createNote,
        updateNote,
        deleteNote,
        notes,
        createImprovement,
        updateImprovement,
        deleteImprovement,
        setActiveVariant,
        updateNoteProtection,
    } = useNotesContext();
    const { isAuthenticated, isGuest, userId, refreshProfile } = useAuth();
    const [isRealtimeDictating, setIsRealtimeDictating] = useState(false);
    const [showLocalWhisperModal, setShowLocalWhisperModal] = useState(false);
    const realtimeDictationStopRef = useRef<(() => Promise<void>) | null>(null);
    const dictationSessionRef = useRef<{
        variantId: string;
        baseText: string;
        latestTranscript: string;
    } | null>(null);
    const [allowPrivateAI, setAllowPrivateAI] = useState(false);
    const ICON_CHOICES = ['translate', 'spellcheck', 'bolt', 'lightbulb', 'auto-awesome', 'text-fields', 'chat', 'edit'];
    const normalizePrivacy = (value?: NotePrivacy): NotePrivacy => {
        if (value === 'hidden') return value;
        return 'normal';
    };
    const normalizeScope = (value?: StorageScope): StorageScope => {
        return value === 'local_only' ? 'local_only' : 'sync';
    };
    const routeNoteId = route.params?.noteId;

    const [localNoteId, setLocalNoteId] = useState(routeNoteId);
    const localNoteIdRef = useRef(localNoteId);
    const pendingRouteNoteSyncRef = useRef<string | null | undefined>(routeNoteId);
    const createdDraftNoteIdRef = useRef<string | null>(null);


    useEffect(() => {
        localNoteIdRef.current = localNoteId;
    }, [localNoteId]);

    const updateRouteParamsIfCurrent = useCallback((params: Partial<RootStackParamList['NoteEdit']>) => {
        if (!isMounted.current) {
            return false;
        }

        const routeStillMounted = navigation
            .getState()
            .routes
            .some((stateRoute) => stateRoute.key === route.key);

        if (!routeStillMounted) {
            return false;
        }

        navigation.dispatch({
            ...CommonActions.setParams(params),
            source: route.key,
        });

        return true;
    }, [navigation, route.key]);

    const bindCreatedDraftToRoute = useCallback((noteId: string) => {
        createdDraftNoteIdRef.current = noteId;
        updateRouteParamsIfCurrent({ noteId });
    }, [updateRouteParamsIfCurrent]);

    // Voice Recordings
    const [voiceRecordings, setVoiceRecordings] = useState<VoiceRecording[]>([]);
    const voiceRecordingsRef = useRef<VoiceRecording[]>([]);

    useEffect(() => {
        voiceRecordingsRef.current = voiceRecordings;
    }, [voiceRecordings]);

    const existingNote = notes.find(n => n.id === localNoteId);
    const noteImprovements = useMemo(() => existingNote?.improvements ?? [], [existingNote?.improvements]);
    const [storageScope, setStorageScope] = useState<StorageScope>(
        route.params?.initialStorageScope ?? existingNote?.storage_scope ?? 'sync'
    );
    const [privacy, setPrivacy] = useState<NotePrivacy>(
        route.params?.initialPrivacy ?? existingNote?.privacy ?? 'normal'
    );
    // Protected: the note never leaves the device unencrypted (no cloud AI, no
    // cloud transcription, sync only end-to-end encrypted). A ref keeps async
    // save/record paths from reading a stale value.
    const [isProtected, setIsProtected] = useState<boolean>(!!existingNote?.is_protected);
    const isProtectedRef = useRef(isProtected);
    isProtectedRef.current = isProtected;

    // Refresh recordings when list modal opens


    // Determine initial active variant based on is_active flags
    const getInitialActiveVariantId = () => {
        if (!existingNote) return 'original';
        if (existingNote.is_active) return 'original';
        const activeChild = existingNote.improvements?.find(imp => imp.is_active);
        if (activeChild) return activeChild.id;
        return 'original';
    };

    const [activeVariantId, setActiveVariantId] = useState<string>(getInitialActiveVariantId());

    const [title, setTitle] = useState(() => {
        const initialVariantId = getInitialActiveVariantId();
        if (initialVariantId === 'original') {
            return existingNote?.title || '';
        }
        const improvement = existingNote?.improvements?.find(i => i.id === initialVariantId);
        return improvement?.title || improvement?.label || existingNote?.title || '';
    });
    const [showVersionsSheet, setShowVersionsSheet] = useState(false);
    const [showCompareVersions, setShowCompareVersions] = useState(false);
    const [tasksSheet, setTasksSheet] = useState<{ visible: boolean; loading: boolean; error: string | null; tasks: TaskSheetItem[] }>({
        visible: false, loading: false, error: null, tasks: [],
    });
    // Which text a preset runs on while a version is open; results are always saved
    // as a new version, so choosing "this version" never overwrites anything.
    const [improveSource, setImproveSource] = useState<'original' | 'current'>('original');
    // Deleting a version hides it at once and only deletes after the undo window.
    const [hiddenVariantIds, setHiddenVariantIds] = useState<string[]>([]);
    const hiddenVariantIdsRef = useRef<string[]>([]);
    hiddenVariantIdsRef.current = hiddenVariantIds;
    const [undoMessage, setUndoMessage] = useState<string | null>(null);
    const [renameTarget, setRenameTarget] = useState<{ id: string; value: string } | null>(null);
    const [showSwipeHint, setShowSwipeHint] = useState(false);
    const pendingVariantDeleteRef = useRef<{ id: string; noteId: string; timer: ReturnType<typeof setTimeout> } | null>(null);
    const visibleImprovements = useMemo(
        () => noteImprovements.filter((imp: any) => !hiddenVariantIds.includes(imp.id)),
        [hiddenVariantIds, noteImprovements]
    );
    // The note keeps one title; versions have their own only internally.
    const [noteTitle, setNoteTitle] = useState<string>(existingNote?.title || '');
    const noteTitleSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [isDeletingNote, setIsDeletingNote] = useState<boolean>(false);
    const [recordingToDelete, setRecordingToDelete] = useState<{ id: string, path: string } | null>(null);
    const [content, setContent] = useState(() => {
        const initialId = getInitialActiveVariantId();
        if (initialId === 'original') return stripAudioEmbedsFromRichContent(existingNote?.content || '');
        const imp = existingNote?.improvements?.find(i => i.id === initialId);
        return stripAudioEmbedsFromRichContent(imp?.content || existingNote?.content || '');
    });
    const [showMenu, setShowMenu] = useState(false);
    const [, setIsSaving] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editMode, setEditMode] = useState<'visual' | 'raw'>('visual');
    const [reparseTrigger, setReparseTrigger] = useState(0);

    // Toast State
    const toastOpacity = useRef(new Animated.Value(0)).current;
    const [toastMessage, setToastMessage] = useState('');

    const showToast = (message: string, duration = 2000) => {
        setToastMessage(message);
        // Reset opacity in case another toast is running
        toastOpacity.setValue(0);

        Animated.sequence([
            Animated.timing(toastOpacity, {
                toValue: 1,
                duration: 200,
                useNativeDriver: true,
            }),
            Animated.delay(duration),
            Animated.timing(toastOpacity, {
                toValue: 0,
                duration: 250,
                useNativeDriver: true,
            }),
        ]).start();
    };

    const isPrivateContent = (): boolean => {
        const effectiveScope = normalizeScope(existingNote?.storage_scope ?? storageScope);
        return effectiveScope === 'local_only' || isProtectedRef.current;
    };

    const ensurePrivateShareAllowed = (): boolean => {
        if (!isPrivateContent()) {
            return true;
        }
        Alert.alert(
            t("edit.shareBlockedTitle", "Sharing disabled for private notes"),
            t("settings.ui.shareBlockedLocal", "To prevent leaks, share and export are blocked for local-only notes.")
        );
        return false;
    };

    // Export & Share Refs and Handlers
    const viewShotRef = useRef<View>(null);

    // Copy/share/export use the note's title, the one the header shows, not the
    // open version's internal title.
    const exportTitle = activeVariantId === 'original' ? title : (noteTitle || title);

    const handleCopyPlainText = async () => {
        setShowMenu(false);
        const fullText = `${exportTitle}\n\n${richContentToPlainText(content)}`;
        const plainText = richContentToPlainText(fullText);
        await Clipboard.setStringAsync(plainText.trim());
        haptics.success();
        showToast(t("edit.textCopied"));
    };

    const handleCopyMarkdown = async () => {
        setShowMenu(false);
        let markdown = editMode === 'raw' ? rawMarkdownRef.current : richContentToMarkdown(content);
        if (editMode === 'visual' && editorRef.current && isRichHtmlContent(content)) {
            try {
                markdown = await editorRef.current.getMarkdown();
            } catch (error) {
                console.warn('Failed to serialize editor document, using HTML fallback:', error);
            }
        }
        const contentWithoutAudio = markdown
            .replace(/^\s*!\[audio\]\([^)]+\)\s*$/gm, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        const fullText = `${exportTitle ? '# ' + exportTitle + '\n\n' : ''}${contentWithoutAudio}`;
        await Clipboard.setStringAsync(fullText);
        haptics.success();
        showToast(t("edit.markdownCopied"));
    };

    const handleShareText = async () => {
        setShowMenu(false);
        if (!ensurePrivateShareAllowed()) return;
        const contentWithoutAudio = isRichHtmlContent(content)
            ? richContentToPlainText(content)
            : content
                .replace(/!\[audio\]\([^)]+\)/g, '')
                .replace(/\n{3,}/g, '\n\n')
                .trim();

        const fullText = `${exportTitle}\n\n${contentWithoutAudio}`;
        try {
            await Share.share({
                message: fullText,
                title: exportTitle || t("notes.note", "Note"),
            });
        } catch (error) {
            console.error('Error sharing note:', error);
        }
    };

    const handleExportMarkdownFile = async () => {
        setShowMenu(false);
        if (!ensurePrivateShareAllowed()) return;
        try {
            const dateStr = existingNote?.created_at
                ? new Date(existingNote.created_at).toISOString().split('T')[0]
                : new Date().toISOString().split('T')[0];

            // Allow basic latin, numbers, and cyrillic, replace others with underscore
            const safeTitle = (exportTitle || 'note').replace(/[^a-z0-9а-яё]/gi, '_').toLowerCase();
            const filename = `${safeTitle}_${dateStr}.md`;

            const fileUri = `${FileSystem.documentDirectory}${filename} `;
            const exportBody = isRichHtmlContent(content)
                ? richContentToPlainText(content)
                : content;
            const fullText = `${exportTitle ? '# ' + exportTitle + '\n\n' : ''}${exportBody} `;

            await FileSystem.writeAsStringAsync(fileUri, fullText, {
                encoding: 'utf8',
            });

            if (await Sharing.isAvailableAsync()) {
                await Sharing.shareAsync(fileUri, {
                    dialogTitle: 'Export Note as Markdown',
                    mimeType: 'text/markdown',
                    UTI: 'net.daringfireball.markdown', // Helping iOS identify it as markdown
                });
            } else {
                Alert.alert(t('common.errorTitle', 'Error'), t('alerts.shareUnavailable', 'Sharing is not available on this device.'));
            }
        } catch (error) {
            console.error('Error exporting markdown:', error);
            Alert.alert(t("common.errorTitle"), t("edit.exportMarkdownFailed", "Failed to export markdown file"));
        }
    };

    const handleExportImage = async () => {
        setShowMenu(false);
        if (!ensurePrivateShareAllowed()) return;
        try {
            if (viewShotRef.current) {
                const uri = await captureRef(viewShotRef, {
                    format: 'png',
                    quality: 0.9,
                    result: 'tmpfile',
                });

                if (await Sharing.isAvailableAsync()) {
                    await Sharing.shareAsync(uri, {
                        mimeType: 'image/png',
                        dialogTitle: 'Share Note as Image',
                    });
                } else {
                    Alert.alert(t('common.errorTitle', 'Error'), t('alerts.shareUnavailable', 'Sharing is not available on this device.'));
                }
            } else {
                Alert.alert(t('common.errorTitle', 'Error'), t('alerts.captureFailed', 'Could not create the image.'));
            }
        } catch (error) {
            console.error('Error exporting image:', error);
            Alert.alert(t("common.errorTitle"), t("edit.exportImageFailed", "Failed to export image"));
        }
    };

    // History for Undo/Redo - separate for each variant
    const variantHistories = useRef<Record<string, VariantHistory>>({});
    const historyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Initialize history for original variant
    if (!variantHistories.current['original']) {
        variantHistories.current['original'] = {
            history: [{ title: existingNote?.title || '', content: stripAudioEmbedsFromRichContent(existingNote?.content || '') }],
            index: 0
        };
    }

    // Audio state
    const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
    const [showPrivacyWarning, setShowPrivacyWarning] = useState(false);
    const [recordingsPreviewUri, setRecordingsPreviewUri] = useState<string | null>(null);
    const [recordingsPreviewDuration, setRecordingsPreviewDuration] = useState<number>(0);
    const [isTranscribing, setIsTranscribingState] = useState(false);
    const [, setIsRecordingFlowActive] = useState(false);

    const lastSavedTitle = useRef(stripStoredTitleMarkdown(existingNote?.title || ''));
    const lastSavedContent = useRef(stripAudioEmbedsFromRichContent(existingNote?.content || ''));
    const skipAutoSaveRef = useRef(false);
    const isMounted = useRef(true);
    const inlineEditorAudioRef = useRef<{
        path: string | null;
        sound: Sound | null;
        duration: number;
        position: number;
        isPlaying: boolean;
        playbackSpeed: number;
        isLoading: boolean;
    }>({
        path: null,
        sound: null,
        duration: 0,
        position: 0,
        isPlaying: false,
        playbackSpeed: 1,
        isLoading: false,
    });

    const [playingRecordingId, setPlayingRecordingId] = useState<string | null>(null);
    const [transcribingRecordingId, setTranscribingRecordingId] = useState<string | null>(null);
    const [, setTranscriptionEnabled] = useState(true);
    const lastTranscribedExpectationRef = useRef<{
        text: string;
        expiresAt: number;
        satisfied: boolean;
    } | null>(null);

    // Ref to track the intentionally selected variant to avoid flickering during async updates
    const optimisticActiveVariant = useRef<string | null>(null);

    useEffect(() => {
        if (existingNote) {
            setStorageScope(normalizeScope(existingNote.storage_scope));
            setPrivacy(normalizePrivacy(existingNote.privacy));
            setIsProtected(!!existingNote.is_protected);
            return;
        }

        if (route.params?.initialPrivacy || route.params?.initialStorageScope) {
            const nextPrivacy = normalizePrivacy(route.params?.initialPrivacy);
            const nextScope = normalizeScope(route.params?.initialStorageScope);
            setPrivacy(nextPrivacy);
            setStorageScope(nextScope);
        }
    }, [existingNote?.id, existingNote?.privacy, existingNote?.storage_scope, existingNote?.is_protected, route.params?.initialPrivacy, route.params?.initialStorageScope]);

    // Force re-render on history update to show undo/redo arrows

    // AI State
    const [showAIModal, setShowAIModal] = useState(false);
    const [isAIProcessing, setIsAIProcessingState] = useState(false);
    const [aiOptions, setAiOptions] = useState<AIImprovementOption[]>(DEFAULT_IMPROVEMENT_OPTIONS);
    // Lets a variant chip show the icon of the action that produced it, so
    // "Fix Grammar" and "Summarize" are distinguishable at a glance.
    const improvementOptionIcons = useMemo(
        () => aiOptions.reduce<Record<string, string>>((acc, option) => {
            if (option.id && option.icon) acc[option.id] = option.icon;
            return acc;
        }, {}),
        [aiOptions]
    );
    const aiOptionsById = useMemo(
        () => aiOptions.reduce<Record<string, AIImprovementOption>>((acc, option) => {
            if (option.id) acc[option.id] = option;
            return acc;
        }, {}),
        [aiOptions]
    );
    const variantDisplayLabels = useMemo(
        () => buildVariantDisplayLabels(visibleImprovements, t, aiOptionsById, (index) => `${t("edit.improvement")} ${index + 1}`),
        [aiOptionsById, t, visibleImprovements]
    );
    const [aiOptionsLoading, setAiOptionsLoading] = useState(false);
    const [showPromptBuilder, setShowPromptBuilder] = useState(false);
    const [newPromptTitle, setNewPromptTitle] = useState('');
    const [newPromptTemplate, setNewPromptTemplate] = useState('');
    const [newPromptIcon, setNewPromptIcon] = useState<string>(ICON_CHOICES[0]);
    const [agentModeIndicatorEnabled, setAgentModeIndicatorEnabled] = useState(false);

    // Voice Recordings List State
    const [showRecordingsList, setShowRecordingsList] = useState(false);
    const [showRecordingTextModal, setShowRecordingTextModal] = useState(false);
    const [selectedRecordingForText, setSelectedRecordingForText] = useState<VoiceRecording | null>(null);
    const [pendingMicInputMode, setPendingMicInputMode] = useState<MicInputMode>('agent');
    const [rawSelection, setRawSelection] = useState({ start: 0, end: 0 });
    // Raw mode edits Markdown while notes are stored as editor HTML, so the
    // text shown is kept separately; the ref holds the content it mirrors.
    const [rawMarkdown, setRawMarkdown] = useState('');
    const rawMarkdownRef = useRef('');
    const rawSourceContentRef = useRef<string | null>(null);
    const pendingMicInputModeRef = useRef<MicInputMode>('agent');
    const micLongPressHandledRef = useRef(false);
    const visualSelectionRef = useRef<{ start: number; end: number } | null>(null);

    const showVoiceResultStatus = useCallback((_message: string, _recordingId?: string) => {
        // Intentionally disabled per UX request: no floating status popups.
    }, []);

    const setRecordingOutcomeStatus = useCallback((_recordingId: string | undefined, _status: string) => {
        // Intentionally disabled per UX request: no per-recording status badges.
    }, []);


    const registerTranscribedInsertion = useCallback((rawText: string) => {
        const normalized = normalizeTextForComparison(rawText);
        if (!normalized) return;
        lastTranscribedExpectationRef.current = {
            text: normalized,
            expiresAt: Date.now() + 5000,
            satisfied: false,
        };
    }, []);

    const clearTranscribedInsertionExpectation = useCallback(() => {
        lastTranscribedExpectationRef.current = null;
    }, []);

    useEffect(() => {
        pendingMicInputModeRef.current = pendingMicInputMode;
    }, [pendingMicInputMode]);

    useEffect(() => {
        const expectation = lastTranscribedExpectationRef.current;
        if (!expectation) return;
        if (Date.now() > expectation.expiresAt) {
            lastTranscribedExpectationRef.current = null;
            return;
        }
        const normalizedContent = normalizeTextForComparison(content);
        const hasText = normalizedContent.includes(expectation.text);
        if (!expectation.satisfied) {
            if (hasText) {
                expectation.satisfied = true;
            }
            return;
        }
        if (!hasText) {
            const message = 'Transcribed text vanished after insertion';
            console.error(message, {
                expectation,
                content,
            });
            lastTranscribedExpectationRef.current = null;
            if (__DEV__) {
                throw new Error(`${message}: ${expectation.text}`);
            }
        }
    }, [content]);

    // Refresh recordings when list modal opens
    useEffect(() => {
        if (showRecordingsList && localNoteId && userId) {
            getVoiceRecordingsLocal(userId, localNoteId).then((recs) => {
                setVoiceRecordings(recs);
            });
        }
    }, [showRecordingsList, localNoteId]);

    useEffect(() => {
        return () => {
            const activeSound = inlineEditorAudioRef.current.sound;
            if (activeSound) {
                void activeSound.unloadAsync();
            }
            void AudioService.cleanupTempFiles(['embed']);
        };
    }, []);

    // Custom Instruction State
    const [customInstruction, setCustomInstruction] = useState('');
    const [isRecordingInstruction, setIsRecordingInstruction] = useState(false);
    const [showCustomInput, setShowCustomInput] = useState(false);

    // Error Modal State
    const [errorModalVisible, setErrorModalVisible] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [errorTitle, setErrorTitle] = useState<string | undefined>(undefined);
    const [errorShowSettingsAction, setErrorShowSettingsAction] = useState(false);
    const [currentAIProvider, setCurrentAIProvider] = useState<AIProvider>('vaulto_ai');
    const [showTranscriptionAuthModal, setShowTranscriptionAuthModal] = useState(false);
    const [activeImprovementTask, setActiveImprovementTask] = useState<AIActiveTask | null>(null);
    // Manual AI results wait here for Accept / Try again / Discard. Nothing is
    // persisted and no variant is created until the user accepts.
    const [improvementPreview, setImprovementPreview] = useState<{
        option: AIImprovementOption;
        sourceText: string;
        resultText: string;
        variantId: string;
    } | null>(null);
    const [isPreviewRegenerating, setIsPreviewRegenerating] = useState(false);
    const showPrettyQuotaNotification = useCallback((errorValue: unknown, fallback: string): boolean => {
        const originalErrorMsg = getErrorMessage(errorValue, '');
        const raw = originalErrorMsg.toLowerCase();

        // If it's the standard generic usage limit error from our Service layer 403 intercept,
        // the LimitModal will already handle it via onLimitReached event.
        if (
            raw.includes('403') ||
            raw.includes('usage limit reached') ||
            raw.includes('token limit exceeded') ||
            raw.includes('transcription_exhausted') ||
            raw.includes('not enough transcription minutes') ||
            raw.includes('trial limit exceeded')
        ) {
            console.log('[NoteEditScreen] Skipping normal error modal because LimitModal should handle 403');
            return true;
        }

        if (currentAIProvider === 'openai' || raw.includes('custom ai configuration') || raw.includes('custom ai, please check your base url')) {
            setErrorTitle('Custom AI Error');
            setErrorMessage(originalErrorMsg || CUSTOM_AI_UNIVERSAL_ERROR);
            setErrorShowSettingsAction(true);
            setErrorModalVisible(true);
            return false;
        }

        setErrorTitle(undefined);
        setErrorMessage(originalErrorMsg || fallback || t("common.errorOccurred", "An error occurred"));
        setErrorShowSettingsAction(false);
        setErrorModalVisible(true);
        return false;
    }, [currentAIProvider]);

    const requestPrivateAIConsent = useCallback(async (): Promise<boolean> => {
        const onDeviceProvider = currentAIProvider === 'local_llm' || currentAIProvider === 'local';
        if (isProtectedRef.current && !onDeviceProvider) {
            // No "allow once": the promise of a protected note is that its text
            // never reaches a server unencrypted.
            Alert.alert(
                t('edit.protected.aiBlockedTitle', 'Protected note'),
                t('edit.protected.aiBlockedDesc', 'AI features send the text to a server, so they are off for protected notes. Remove protection to use them.'),
            );
            return false;
        }
        const isPrivate = normalizeScope(storageScope) === 'local_only';
        if (
            !isPrivate ||
            allowPrivateAI ||
            currentAIProvider === 'local_whisper' ||
            currentAIProvider === 'local_llm' ||
            currentAIProvider === 'local'
        ) {
            return true;
        }

        return await new Promise<boolean>((resolve) => {
            Alert.alert(
                t("edit.privateProtectionTitle"),
                t("edit.privateProtectionDesc"),
                [
                    { text: t("common.cancel"), style: 'cancel', onPress: () => resolve(false) },
                    { text: t("edit.allowOnce"), onPress: () => resolve(true) },
                    {
                        text: t("edit.alwaysAllowPrivate"),
                        onPress: async () => {
                            await setPrivateAIAllowed(true);
                            await setAllowPrivateAI(true);
                            resolve(true);
                        },
                    },
                ]
            );
        });
    }, [allowPrivateAI, currentAIProvider, privacy, setAllowPrivateAI, storageScope]);

    /**
     * Destructive agent results (clearing, whole-note rewrites, checklist removals) are
     * gated here. The backend flags them; nothing may be written until the user agrees.
     */
    const confirmAgentChange = useCallback(
        async (kind?: string, serverMessage?: string | null): Promise<boolean> => {
            const localizedKey = kind ? AGENT_CONFIRMATION_KEYS[kind] : undefined;
            const question =
                (localizedKey ? t(localizedKey) : '') ||
                (serverMessage || '').trim() ||
                t('edit.agent.confirmTitle');

            return await new Promise<boolean>((resolve) => {
                Alert.alert(
                    t('edit.agent.confirmTitle'),
                    question,
                    [
                        { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
                        {
                            text: t('edit.agent.apply'),
                            style: kind === 'clear_content' || kind === 'remove_items' ? 'destructive' : 'default',
                            onPress: () => resolve(true),
                        },
                    ],
                    { cancelable: true, onDismiss: () => resolve(false) }
                );
            });
        },
        [t]
    );

    const handleAiAccess = async (callback: () => void) => {
        const isLocalAiProvider =
            currentAIProvider === 'local_llm' ||
            currentAIProvider === 'local_whisper' ||
            currentAIProvider === 'local';

        const needsLocalLLMRuntime =
            currentAIProvider === 'local_llm' ||
            currentAIProvider === 'local';

        if (needsLocalLLMRuntime && !isLocalLLMRuntimeAvailable()) {
            Alert.alert(
                t('alerts.localLlmUnavailableTitle', 'On-device AI is unavailable'),
                t('alerts.localLlmUnavailableText', 'This version of the app cannot run AI on the phone. Update the app or switch to Vaulto AI in Settings.'),
            );
            return;
        }

        if (needsLocalLLMRuntime) {
            const llmStatus = await getLocalLLMModelStatus().catch(() => null);
            if (!llmStatus?.isDownloaded) {
                Alert.alert(
                    t('localAI.modelMissingTitle', 'Download the AI model'),
                    t('localAI.modelMissingDesc', 'On-device AI needs its model ({{model}}, {{size}}) on the phone. Download it once in Settings → AI Model; after that everything works offline.', {
                        model: llmStatus?.selectedModel.label ?? 'Qwen3.5',
                        size: llmStatus?.selectedModel.sizeLabel ?? '',
                    }),
                    [
                        { text: t('common.cancel'), style: 'cancel' },
                        { text: t('localAI.openSettings', 'Open Settings'), onPress: () => navigation.navigate('Settings') },
                    ],
                );
                return;
            }
        }

        if (isGuest && !isLocalAiProvider) {
            Alert.alert(
                t('alerts.aiLockedTitle', 'Sign in to use AI'),
                t('alerts.aiLockedText', 'Cloud AI features are available after signing in. On-device AI works without an account.'),
                [
                    { text: t('common.cancel', 'Cancel'), style: 'cancel' },
                    {
                        text: t('ask.signIn', 'Sign in'),
                        onPress: () => navigation.navigate('SignIn')
                    }
                ]
            );
            return;
        }
        const consentGranted = await requestPrivateAIConsent();
        if (!consentGranted) {
            return;
        }
        callback();
    };



    // After the protection change the local note is re-read; mirror it now so the
    // menu and the AI gates do not wait for that round trip.
    const applyProtection = useCallback(async (next: { isProtected: boolean; sync: boolean }) => {
        setIsProtected(next.isProtected);
        isProtectedRef.current = next.isProtected;
        setStorageScope(next.sync ? 'sync' : 'local_only');
        if (localNoteId) {
            await updateNoteProtection(localNoteId, next);
        }
    }, [localNoteId, updateNoteProtection]);

    const confirm = useCallback((title: string, message: string, action: string, destructive = false) =>
        new Promise<boolean>((resolve) => {
            Alert.alert(title, message, [
                { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
                { text: action, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
            ], { cancelable: true, onDismiss: () => resolve(false) });
        }), [t]);

    const accountEncrypted = isAuthenticated && !isGuest && getCryptoMode() === 'e2ee';

    const handleProtectNote = useCallback(async () => {
        const signedIn = isAuthenticated && !isGuest;
        const lines = [t('edit.protected.protectDesc', 'The text never leaves this phone unencrypted: AI features and cloud voice transcription are turned off for this note. Voice is transcribed on the phone.')];
        if (signedIn && !accountEncrypted && localNoteId) {
            lines.push(t('edit.protected.protectNoE2ee', 'End-to-end encryption is off, so the note is removed from the server and your other devices and stays on this phone until you turn encryption on.'));
        }
        const ok = await confirm(t('edit.protected.protectTitle', 'Protect this note?'), lines.join('\n\n'), t('edit.protected.protect', 'Protect'));
        if (ok) await applyProtection({ isProtected: true, sync: true });
    }, [accountEncrypted, applyProtection, confirm, isAuthenticated, isGuest, localNoteId, t]);

    const handleUnprotectNote = useCallback(async () => {
        const ok = await confirm(
            t('edit.protected.unprotectTitle', 'Remove protection?'),
            t('edit.protected.unprotectDesc', 'The note syncs like any other note again, and AI features can send its text to the server.'),
            t('edit.protected.unprotect', 'Remove protection'),
        );
        if (ok) await applyProtection({ isProtected: false, sync: true });
    }, [applyProtection, confirm, t]);

    const handleProtectedSyncToggle = useCallback(async () => {
        const syncOn = normalizeScope(storageScope) === 'sync';
        if (syncOn) {
            const ok = await confirm(
                t('edit.protected.syncOffTitle', 'Keep only on this phone?'),
                t('edit.protected.syncOffDesc', 'The note is removed from the server and your other devices. If this phone is lost or the app is deleted, the note is gone for good — there is no copy anywhere.'),
                t('edit.protected.syncOff', 'Turn off sync'),
                true,
            );
            if (ok) await applyProtection({ isProtected: true, sync: false });
            return;
        }
        await applyProtection({ isProtected: true, sync: true });
        if (!accountEncrypted) {
            Alert.alert(
                t('edit.protected.syncWaitsTitle', 'Sync waits for encryption'),
                isAuthenticated && !isGuest
                    ? t('edit.protected.syncWaitsE2ee', 'Protected notes sync only end-to-end encrypted. Turn on encryption in Settings → Cloud Sync and the note syncs.')
                    : t('edit.protected.syncWaitsSignIn', 'Without an account notes stay on this phone. Sign in and turn on end-to-end encryption to sync.'),
            );
        }
    }, [accountEncrypted, applyProtection, confirm, isAuthenticated, isGuest, storageScope, t]);

    // Why the model download was opened: live dictation (start it afterwards), a
    // protected recording, or turning on free on-device transcription.
    const [whisperModalPurpose, setWhisperModalPurpose] = useState<'dictate' | 'protected' | 'enable'>('dictate');
    // Free on-device transcription, offered where it helps: a guest who cannot use
    // the cloud, and once to everyone after a few recordings.
    const onDeviceOfferedRef = useRef(false);
    const offerOnDeviceTranscription = useCallback(async (reason: 'guest' | 'suggest') => {
        if (!LOCAL_WHISPER_ENABLED || onDeviceOfferedRef.current) return;
        if (await isOnDeviceTranscriptionActive()) return;
        if (reason === 'suggest') {
            if (await getOnDeviceOfferShown()) return;
            await setOnDeviceOfferShown();
        }
        onDeviceOfferedRef.current = true;
        const modelReady = (await getLocalWhisperModelStatus().catch(() => null))?.isDownloaded;
        const enable = () => {
            if (modelReady) {
                void setOnDeviceTranscription(true);
                showToast(t('edit.onDeviceOffer.enabled', 'Recordings are now transcribed on this phone'));
                return;
            }
            setWhisperModalPurpose('enable');
            setShowLocalWhisperModal(true);
        };
        const buttons: any[] = [
            { text: t('edit.onDeviceOffer.later', 'Not now'), style: 'cancel' },
        ];
        if (reason === 'guest') {
            buttons.push({ text: t('edit.onDeviceOffer.signIn', 'Sign in'), onPress: () => navigation.navigate('SignIn') });
        }
        buttons.push({
            text: modelReady ? t('edit.onDeviceOffer.turnOn', 'Turn on') : t('edit.onDeviceOffer.download', 'Download'),
            onPress: enable,
        });
        Alert.alert(
            reason === 'guest'
                ? t('edit.onDeviceOffer.guestTitle', 'Get text without an account')
                : t('edit.onDeviceOffer.suggestTitle', 'Transcribe for free on your phone'),
            reason === 'guest'
                ? t('edit.onDeviceOffer.guestDesc', 'This recording is saved as audio. Download the speech model once and your next recordings turn into text right on the phone — free, offline, no sign-in.')
                : t('edit.onDeviceOffer.suggestDesc', 'Download the speech model once: recordings turn into text right on the phone, free and offline, and the audio never leaves it.'),
            buttons,
        );
    }, [navigation, t]);

    const promptOnDeviceModelForProtected = useCallback(() => {
        Alert.alert(
            t('edit.protected.modelTitle', 'Recording saved without text'),
            t('edit.protected.modelDesc', 'Protected notes are transcribed only on the phone. Download the speech model once to get text from recordings.'),
            [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('edit.protected.modelDownload', 'Download model'),
                    onPress: () => {
                        setWhisperModalPurpose('protected');
                        setShowLocalWhisperModal(true);
                    },
                },
            ],
        );
    }, [t]);

    // Text Appearance State
    const [fontSize, setFontSizeState] = useState(16);
    const [autoScalingEnabled, setAutoScalingEnabledState] = useState(true);
    const [appearanceReady, setAppearanceReady] = useState(false);
    const [noteViewReady, setNoteViewReady] = useState(true);
    const [checklistScaleLocks, setChecklistScaleLocksState] = useState<Record<string, number>>({});
    const [draftOriginalChecklistScaleFactor, setDraftOriginalChecklistScaleFactor] = useState<number | null>(null);
    const [pendingCreationAutoScaleNoteId, setPendingCreationAutoScaleNoteId] = useState<string | null>(
        routeNoteId ? null : NEW_NOTE_AUTO_SCALE_DRAFT_ID
    );
    const [showAppearanceModal, setShowAppearanceModal] = useState(false);

    // AI Request History (Session based)
    const [requestHistory, setRequestHistory] = useState<string[]>([]);
    const requestHistoryRef = useRef<string[]>([]);

    const [activeFormats, setActiveFormats] = useState<MarkdownFormatType[]>([]);
    const [keyboardVisibleState, setKeyboardVisibleState] = useState(false);
    const [keyboardHeight, setKeyboardHeight] = useState(0);
    const [isColorPickerVisible, setIsColorPickerVisible] = useState(false);
    const editorRef = useRef<RichTextEditorHandle>(null);
    const titleInputRef = useRef<TextInput>(null);
    const rawEditorRef = useRef<TextInput>(null);
    const handleContentChangeRef = useRef<(text: string) => void>(() => undefined);
    const keyboardVisibleRef = useRef(false);
    const visualEditorFocusedRef = useRef(false);
    const visualKeyboardHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [visualPlainText, setVisualPlainText] = useState(() => richContentToPlainText(content));
    const embeddedAudioPaths = useMemo(() => extractEmbeddedAudioPaths(content), [content]);

    const improvementDraftsRef = useRef<Record<string, string>>({});
    const improvementSavedRef = useRef<Record<string, string>>({});
    const improvementTitleDraftsRef = useRef<Record<string, string>>({});
    const improvementTitleSavedRef = useRef<Record<string, string>>({});
    const checklistScaleLocksRef = useRef<Record<string, number>>({});

    const resolveImprovementVariantTitle = useCallback((variantId: string): string => {
        const draftTitle = improvementTitleDraftsRef.current[variantId];
        if (typeof draftTitle === 'string') {
            // What the user is typing right now stays untouched.
            return draftTitle;
        }
        // Stored titles predate the markdown stripping done at creation time, so
        // heal them on read - the title field is a plain TextInput and would
        // otherwise show "**Итоги**" verbatim.
        const improvement = noteImprovements.find((imp) => imp.id === variantId);
        const improvementTitle = stripStoredTitleMarkdown(improvement?.title || '');
        if (improvementTitle) {
            return improvementTitle;
        }
        const improvementLabel = stripStoredTitleMarkdown(improvement?.label || '');
        if (improvementLabel) {
            return improvementLabel;
        }
        return existingNote?.title || '';
    }, [existingNote?.title, noteImprovements]);

    // Queue for transcribed text tasks to ensure strict sequential agent processing
    const agentQueue = useRef<AgentQueueTask[]>([]);
    const activeAgentTasksRef = useRef<AgentQueueTask[]>([]);
    const pendingVoiceInsertionsRef = useRef<Map<string, PendingVoiceInsertion>>(new Map());
    const derivedVariantBySourceRef = useRef<Record<string, string>>({});
    const [queueLength, setQueueLengthState] = useState(0);
    const [activeAITasks, setActiveAITasks] = useState<AIActiveTask[]>([]);
    const isProcessingQueue = useRef(false);
    const agentSessionIdRef = useRef(0);
    const isTranscribingRef = useRef(isTranscribing);
    const isAIProcessingRef = useRef(isAIProcessing);
    const queueLengthRef = useRef(queueLength);

    // Ref to hold the absolute latest content to ensure queue picks up changes from previous steps
    const currentContentRef = useRef(content);
    // Ref to track active variant for queue processing
    const activeVariantIdRef = useRef(activeVariantId);

    // Refs for safe note creation (prevent duplicates)
    const isCreatingNote = useRef(false);
    const pendingSaveAfterCreate = useRef(false);
    const currentTitleRef = useRef(title);
    const titleLockRef = useRef<boolean>(!!(existingNote?.title || '').trim());

    const persistChecklistScaleLock = useCallback(async (variantId: string, scaleFactor: number) => {
        if (!variantId || !Number.isFinite(scaleFactor) || scaleFactor <= 0) {
            return;
        }

        const nextLocks = {
            ...checklistScaleLocksRef.current,
            [variantId]: scaleFactor,
        };

        checklistScaleLocksRef.current = nextLocks;
        setChecklistScaleLocksState(nextLocks);
        await setChecklistScaleLock(variantId, scaleFactor);
    }, []);

    const stageOriginalCreationAutoScale = useCallback((variantId: string, nextContent: string) => {
        if (
            !autoScalingEnabled ||
            variantId !== 'original' ||
            !pendingCreationAutoScaleNoteId
        ) {
            return;
        }

        const nextScale = resolveChecklistScaleForContent(nextContent, true);
        setDraftOriginalChecklistScaleFactor(nextScale);

        const currentNoteId = localNoteIdRef.current;
        if (
            currentNoteId &&
            pendingCreationAutoScaleNoteId === currentNoteId &&
            nextScale !== null &&
            typeof checklistScaleLocksRef.current[currentNoteId] !== 'number'
        ) {
            void (async () => {
                await persistChecklistScaleLock(currentNoteId, nextScale);
                setPendingCreationAutoScaleNoteId(null);
            })();
        }
    }, [autoScalingEnabled, pendingCreationAutoScaleNoteId, persistChecklistScaleLock]);

    const handleCreatedNoteAutoScale = useCallback(async (newNoteId: string, contentForLock?: string) => {
        if (!newNoteId || pendingCreationAutoScaleNoteId !== NEW_NOTE_AUTO_SCALE_DRAFT_ID) {
            return;
        }

        if (!autoScalingEnabled) {
            setPendingCreationAutoScaleNoteId(null);
            setDraftOriginalChecklistScaleFactor(null);
            return;
        }

        const resolvedScale = draftOriginalChecklistScaleFactor ?? resolveChecklistScaleForContent(
            contentForLock ?? currentContentRef.current,
            true
        );

        if (resolvedScale !== null) {
            await persistChecklistScaleLock(newNoteId, resolvedScale);
            setPendingCreationAutoScaleNoteId(null);
            setDraftOriginalChecklistScaleFactor(resolvedScale);
            return;
        }

        setPendingCreationAutoScaleNoteId(newNoteId);
    }, [autoScalingEnabled, draftOriginalChecklistScaleFactor, pendingCreationAutoScaleNoteId, persistChecklistScaleLock]);

    const syncVisibleContent = useCallback((nextContent: string, options?: { syncEditor?: boolean }) => {
        stageOriginalCreationAutoScale(activeVariantIdRef.current, nextContent);
        setContent(nextContent);
        currentContentRef.current = nextContent;
        if (options?.syncEditor !== false && editMode === 'visual') {
            editorRef.current?.setContent(nextContent);
        }
    }, [editMode, stageOriginalCreationAutoScale]);

    const syncVisibleTitle = useCallback((nextTitle: string) => {
        // Only programmatic loads go through here; user typing uses
        // handleTitleChange, so cleaning stored markdown is safe.
        const visibleTitle = stripStoredTitleMarkdown(nextTitle);
        setTitle(visibleTitle);
        currentTitleRef.current = visibleTitle;
    }, []);

    const flushVisualEditorContent = useCallback(async (): Promise<string> => {
        if (editMode !== 'visual') {
            return currentContentRef.current;
        }

        let latestContent: string | undefined;

        try {
            latestContent = await Promise.race([
                Promise.resolve(editorRef.current?.flushPendingChanges?.()),
                new Promise<string | undefined>((resolve) => {
                    setTimeout(() => resolve(undefined), 900);
                }),
            ]);
        } catch (error) {
            console.error('Failed to flush visual editor content:', error);
            return currentContentRef.current;
        }

        if (typeof latestContent !== 'string') {
            return currentContentRef.current;
        }

        const sanitizedLatestContent = stripAudioEmbedsFromRichContent(latestContent);
        currentContentRef.current = sanitizedLatestContent;
        if (activeVariantIdRef.current === 'original') {
            setContent(sanitizedLatestContent);
        } else {
            improvementDraftsRef.current[activeVariantIdRef.current] = sanitizedLatestContent;
            if (activeVariantIdRef.current === activeVariantId) {
                setContent(sanitizedLatestContent);
            }
        }

        return sanitizedLatestContent;
    }, [activeVariantId, editMode]);

    const showRawMarkdown = useCallback((markdown: string, sourceContent: string) => {
        rawSourceContentRef.current = sourceContent;
        rawMarkdownRef.current = markdown;
        setRawMarkdown(markdown);
    }, []);

    const enterRawMode = useCallback(async () => {
        setShowMenu(false);
        setIsEditing(false);
        if (editMode === 'raw') {
            return;
        }

        const latestContent = await flushVisualEditorContent();
        let markdown = richContentToMarkdown(latestContent);
        if (isRichHtmlContent(latestContent) && editorRef.current) {
            try {
                markdown = await editorRef.current.getMarkdown();
            } catch (error) {
                console.warn('Failed to serialize editor document, using HTML fallback:', error);
            }
        }

        showRawMarkdown(markdown, latestContent);
        setEditMode('raw');
    }, [editMode, flushVisualEditorContent, showRawMarkdown]);

    const handleRawTextChange = useCallback((text: string) => {
        rawSourceContentRef.current = stripAudioEmbedsFromRichContent(text);
        rawMarkdownRef.current = text;
        setRawMarkdown(text);
        handleContentChangeRef.current(text);
    }, []);

    const prepareEditorSnapshotForExit = useCallback(async () => {
        titleInputRef.current?.blur();
        rawEditorRef.current?.blur();
        editorRef.current?.blur();
        visualEditorFocusedRef.current = false;
        Keyboard.dismiss();
        await new Promise<void>((resolve) => {
            setTimeout(() => resolve(), 32);
        });
        await flushVisualEditorContent();
    }, [flushVisualEditorContent]);

    const resolveNoteViewState = useCallback((note?: Note | null) => {
        if (!note) {
            return {
                variantId: 'original',
                title: '',
                content: '',
            };
        }

        const nextVariantId = note.is_active
            ? 'original'
            : note.improvements?.find((imp) => imp.is_active)?.id || 'original';
        const nextImprovement = nextVariantId === 'original'
            ? null
            : note.improvements?.find((imp) => imp.id === nextVariantId) || null;

        return {
            variantId: nextVariantId,
            title: nextVariantId === 'original'
                ? note.title || ''
                : nextImprovement?.title || nextImprovement?.label || note.title || '',
            content: stripAudioEmbedsFromRichContent(nextVariantId === 'original'
                ? note.content || ''
                : nextImprovement?.content || note.content || ''),
        };
    }, []);

    useLayoutEffect(() => {
        if (
            !routeNoteId &&
            createdDraftNoteIdRef.current &&
            localNoteIdRef.current === createdDraftNoteIdRef.current
        ) {
            return;
        }

        if (routeNoteId === localNoteIdRef.current) {
            return;
        }

        setNoteViewReady(false);
        const targetNote = routeNoteId
            ? notes.find((note) => note.id === routeNoteId) || null
            : null;
        optimisticActiveVariant.current = null;
        setLocalNoteId(routeNoteId);
        localNoteIdRef.current = routeNoteId;
        setVoiceRecordings([]);
        setRecordingsPreviewUri(null);
        setRecordingsPreviewDuration(0);
        setPlayingRecordingId(null);

        if (!routeNoteId) {
            setActiveVariantId('original');
            activeVariantIdRef.current = 'original';
            syncVisibleTitle('');
            syncVisibleContent('', { syncEditor: false });
            pendingRouteNoteSyncRef.current = undefined;
            setPendingCreationAutoScaleNoteId(NEW_NOTE_AUTO_SCALE_DRAFT_ID);
            setDraftOriginalChecklistScaleFactor(null);
            setNoteViewReady(true);
            setReparseTrigger((prev) => prev + 1);
            return;
        }

        if (targetNote) {
            const nextState = resolveNoteViewState(targetNote);
            setActiveVariantId(nextState.variantId);
            activeVariantIdRef.current = nextState.variantId;
            syncVisibleTitle(nextState.title);
            syncVisibleContent(nextState.content, { syncEditor: false });
            pendingRouteNoteSyncRef.current = undefined;
            setPendingCreationAutoScaleNoteId(null);
            setDraftOriginalChecklistScaleFactor(null);
            setNoteViewReady(true);
            setReparseTrigger((prev) => prev + 1);
            return;
        }

        pendingRouteNoteSyncRef.current = routeNoteId;
    }, [notes, resolveNoteViewState, routeNoteId, syncVisibleContent, syncVisibleTitle]);

    useLayoutEffect(() => {
        const pendingRouteNoteId = pendingRouteNoteSyncRef.current;

        if (pendingRouteNoteId === undefined) {
            return;
        }

        if (pendingRouteNoteId !== (localNoteId ?? null)) {
            return;
        }

        const targetNote = pendingRouteNoteId
            ? notes.find((note) => note.id === pendingRouteNoteId) || null
            : null;

        if (pendingRouteNoteId && !targetNote) {
            return;
        }

        const nextState = resolveNoteViewState(targetNote);
        setActiveVariantId(nextState.variantId);
        activeVariantIdRef.current = nextState.variantId;
        syncVisibleTitle(nextState.title);
        syncVisibleContent(nextState.content, { syncEditor: false });
        pendingRouteNoteSyncRef.current = undefined;
        setPendingCreationAutoScaleNoteId(null);
        setDraftOriginalChecklistScaleFactor(null);
        setNoteViewReady(true);
        setReparseTrigger((prev) => prev + 1);
    }, [localNoteId, notes, resolveNoteViewState, syncVisibleContent, syncVisibleTitle]);

    const applyTrackedProcessingState = useCallback((patch: Partial<NoteProcessingState>, noteIdOverride?: string) => {
        const noteId = noteIdOverride ?? localNoteIdRef.current;
        if (!noteId) return;
        setNoteProcessingState(noteId, patch);
    }, []);

    const setTrackedIsTranscribing = useCallback((value: boolean, noteIdOverride?: string) => {
        setIsTranscribingState(value);
        applyTrackedProcessingState({ isTranscribing: value }, noteIdOverride);
    }, [applyTrackedProcessingState]);

    const setTrackedIsAIProcessing = useCallback((value: boolean, noteIdOverride?: string) => {
        setIsAIProcessingState(value);
        applyTrackedProcessingState({ isAIProcessing: value }, noteIdOverride);
    }, [applyTrackedProcessingState]);

    const setTrackedQueueLength = useCallback((value: number, tasksMap: Map<string, AIActiveTask>, noteIdOverride?: string) => {
        const normalized = Math.max(0, value);
        setQueueLengthState(normalized);
        const activeTasks = Array.from(tasksMap.values());
        setActiveAITasks(activeTasks);
        applyTrackedProcessingState({ queueLength: normalized, activeTasks }, noteIdOverride);
    }, [applyTrackedProcessingState]);

    const getTaskRecordingIds = (task: AgentQueueTask): string[] => {
        if (task.recordingIds && task.recordingIds.length > 0) {
            return [...task.recordingIds];
        }
        if (task.recordingId) {
            return [task.recordingId];
        }
        return [];
    };

    const getPendingTaskCount = (tasks: AgentQueueTask[]): number => {
        return tasks.reduce((count, current) => {
            const recordingCount = getTaskRecordingIds(current).length;
            return count + Math.max(recordingCount, 1);
        }, 0);
    };

    const refreshTrackedQueueLength = useCallback(() => {
        const tasksMap = new Map<string, AIActiveTask>();
        if (activeAgentTasksRef.current.length > 0) {
            activeAgentTasksRef.current.forEach(t => {
                tasksMap.set(t.id, {
                    id: t.id,
                    text: t.transcribedText || '',
                });
            });
        }
        agentQueue.current.forEach(t => {
            if (!tasksMap.has(t.id)) {
                tasksMap.set(t.id, {
                    id: t.id,
                    text: t.transcribedText || '',
                });
            }
        });
        setTrackedQueueLength(getPendingTaskCount(agentQueue.current), tasksMap);
    }, [setTrackedQueueLength]);

    const getTaskKey = (task: AgentQueueTask): string => {
        return `${task.targetVariantId}|${task.micMode}|${!!task.isBackground}|${!!task.preserveOriginalOnInstruction}`;
    };

    const getRepresentativeRecordingId = (task: AgentQueueTask): string | undefined => {
        if (task.recordingIds && task.recordingIds.length > 0) {
            return task.recordingIds[task.recordingIds.length - 1];
        }
        return task.recordingId;
    };

    const resolveTaskTargetVariantId = useCallback((task: AgentQueueTask): string => {
        const baseTargetVariantId = task.targetVariantId || 'original';
        if (!task.followLatestDerivedVariant) {
            return hiddenVariantIdsRef.current.includes(baseTargetVariantId) ? 'original' : baseTargetVariantId;
        }

        const target = derivedVariantBySourceRef.current[baseTargetVariantId] || baseTargetVariantId;
        // A version waiting out its undo window (or already deleted) must not receive
        // dictation that would vanish with it; the original is the safe fallback.
        return hiddenVariantIdsRef.current.includes(target) ? 'original' : target;
    }, []);


    const syncTrackedProcessingToNote = useCallback((noteId: string) => {
        setNoteProcessingState(noteId, {
            isTranscribing: isTranscribingRef.current,
            isAIProcessing: isAIProcessingRef.current,
            queueLength: queueLengthRef.current,
        });
    }, []);

    useEffect(() => {
        if (!localNoteId) {
            setIsTranscribingState(false);
            setIsAIProcessingState(false);
            setQueueLengthState(0);
            setActiveAITasks([]);
            return;
        }
        return subscribeNoteProcessingState(localNoteId, (next) => {
            setIsTranscribingState(next.isTranscribing);
            setIsAIProcessingState(next.isAIProcessing);
            setQueueLengthState(next.queueLength);
            setActiveAITasks(next.activeTasks || []);
        });
    }, [localNoteId]);

    useEffect(() => {
        isTranscribingRef.current = isTranscribing;
    }, [isTranscribing]);

    useEffect(() => {
        isAIProcessingRef.current = isAIProcessing;
    }, [isAIProcessing]);

    useEffect(() => {
        queueLengthRef.current = queueLength;
    }, [queueLength]);

    // Sync contentRef whenever content state changes
    useEffect(() => {
        currentContentRef.current = content;
    }, [content]);

    useEffect(() => {
        if (editMode === 'visual' && visualEditorFocusedRef.current) {
            return;
        }

        setVisualPlainText(richContentToPlainText(content));
    }, [content, editMode]);

    // Sync activeVariantIdRef
    useEffect(() => {
        activeVariantIdRef.current = activeVariantId;
    }, [activeVariantId]);

    // Sync currentTitleRef
    useEffect(() => {
        currentTitleRef.current = title;
    }, [title]);

    useEffect(() => {
        if ((existingNote?.title || '').trim()) {
            titleLockRef.current = true;
        }
    }, [existingNote?.title]);

    // Keep latest request history for queued async processing.
    useEffect(() => {
        requestHistoryRef.current = requestHistory;
    }, [requestHistory]);

    const clearAgentSessionState = useCallback(() => {
        agentSessionIdRef.current += 1;
        setRequestHistory([]);
        requestHistoryRef.current = [];
        agentQueue.current = [];
        activeAgentTasksRef.current = [];
        pendingVoiceInsertionsRef.current.clear();
        derivedVariantBySourceRef.current = {};
        refreshTrackedQueueLength();
    }, [refreshTrackedQueueLength]);

    const loadSettings = async () => {
        const [size, scaling, privateAIAllowed, storedChecklistScaleLocks] = await Promise.all([
            getFontSize(),
            getAutoScalingEnabled(),
            getPrivateAIAllowed(),
            getChecklistScaleLocks(),
        ]);
        setFontSizeState(size);
        setAutoScalingEnabledState(scaling);
        setAllowPrivateAI(privateAIAllowed);
        checklistScaleLocksRef.current = storedChecklistScaleLocks;
        setChecklistScaleLocksState(storedChecklistScaleLocks);
        setAppearanceReady(true);
    };

    useEffect(() => {
        if (localNoteId && userId) {
            getVoiceRecordingsLocal(userId, localNoteId).then((recs) => {
                setVoiceRecordings(recs);
            });
        }
    }, [localNoteId, userId]);

    const handleFontSizeChange = useCallback((size: number) => {
        void (async () => {
            await flushVisualEditorContent();
            setFontSizeState(size);
            setFontSize(size);
        })();
    }, [flushVisualEditorContent]);

    const handleAutoScalingChange = useCallback((enabled: boolean) => {
        void (async () => {
            await flushVisualEditorContent();
            setAutoScalingEnabledState(enabled);
            setAutoScalingEnabled(enabled);
        })();
    }, [flushVisualEditorContent]);

    useFocusEffect(
        useCallback(() => {
            loadSettings();
        }, [])
    );

    const shouldUseCreationAutoScalePreview = useMemo(() => (
        autoScalingEnabled &&
        activeVariantId === 'original' &&
        !!pendingCreationAutoScaleNoteId &&
        (
            pendingCreationAutoScaleNoteId === NEW_NOTE_AUTO_SCALE_DRAFT_ID ||
            pendingCreationAutoScaleNoteId === (localNoteId ?? null)
        )
    ), [activeVariantId, autoScalingEnabled, localNoteId, pendingCreationAutoScaleNoteId]);

    const activeVariantChecklistScaleFactor = useMemo(() => {
        const lockedScale = checklistScaleLocks[activeVariantId];
        if (typeof lockedScale === 'number') {
            return lockedScale;
        }

        if (shouldUseCreationAutoScalePreview) {
            return draftOriginalChecklistScaleFactor;
        }

        return null;
    }, [activeVariantId, checklistScaleLocks, draftOriginalChecklistScaleFactor, shouldUseCreationAutoScalePreview]);

    useEffect(() => {
        if (!existingNote) {
            return;
        }

        const shouldDeferExternalContentSync =
            editMode === 'visual' && visualEditorFocusedRef.current;

        // Initialize history with loaded content if it was empty (fixes Undo wiping content)
        const currentOriginalHist = variantHistories.current['original'];
        if (currentOriginalHist && currentOriginalHist.history.length === 1 && currentOriginalHist.index === 0) {
            const firstState = currentOriginalHist.history[0];
            if (!firstState.title && !firstState.content && (existingNote.title || existingNote.content)) {
                variantHistories.current['original'] = {
                    history: [{
                        title: existingNote.title || '',
                        content: stripAudioEmbedsFromRichContent(existingNote.content || '')
                    }],
                    index: 0
                };
            }
        }

        // Sync drafts for improvements
        if (noteImprovements.length > 0) {
            const drafts = { ...improvementDraftsRef.current };
            const saved = { ...improvementSavedRef.current };
            const titleDrafts = { ...improvementTitleDraftsRef.current };
            const titleSaved = { ...improvementTitleSavedRef.current };
            const noteImprovementIds = new Set(noteImprovements.map(imp => imp.id));

            Object.keys(drafts).forEach((id) => {
                if (!noteImprovementIds.has(id)) {
                    delete drafts[id];
                    delete saved[id];
                    delete titleDrafts[id];
                    delete titleSaved[id];
                }
            });

            noteImprovements.forEach(imp => {
                const contentValue = stripAudioEmbedsFromRichContent(imp.content ?? '');
                const titleValue = stripStoredTitleMarkdown(imp.title || '');

                if (saved[imp.id] === undefined) {
                    drafts[imp.id] = contentValue;
                    saved[imp.id] = contentValue;
                } else if (saved[imp.id] === drafts[imp.id]) {
                    drafts[imp.id] = contentValue;
                    saved[imp.id] = contentValue;
                }

                if (titleSaved[imp.id] === undefined) {
                    titleDrafts[imp.id] = titleValue;
                    titleSaved[imp.id] = titleValue;
                } else if (titleSaved[imp.id] === titleDrafts[imp.id]) {
                    titleDrafts[imp.id] = titleValue;
                    titleSaved[imp.id] = titleValue;
                }

                if (!shouldDeferExternalContentSync && activeVariantId === imp.id && drafts[imp.id] !== undefined) {
                    syncVisibleContent(drafts[imp.id]);
                    syncVisibleTitle(titleDrafts[imp.id] ?? titleValue);
                }
            });
            improvementDraftsRef.current = drafts;
            improvementSavedRef.current = saved;
            improvementTitleDraftsRef.current = titleDrafts;
            improvementTitleSavedRef.current = titleSaved;
        } else {
            improvementDraftsRef.current = {};
            improvementSavedRef.current = {};
            improvementTitleDraftsRef.current = {};
            improvementTitleSavedRef.current = {};
        }

        if (!shouldDeferExternalContentSync && activeVariantId === 'original') {
            if (lastSavedTitle.current === title) {
                const nextTitle = existingNote.title || '';
                // Avoid regressing non-empty in-memory title to transient empty value from stale refresh.
                const storeIsCaughtUp = nextTitle === lastSavedTitle.current;
                if (storeIsCaughtUp && (nextTitle.trim().length > 0 || !title.trim()) && nextTitle !== title) {
                    syncVisibleTitle(nextTitle);
                }
            }
            if (lastSavedContent.current === content) {
                const nextContent = stripAudioEmbedsFromRichContent(existingNote.content || '');
                const storeIsCaughtUp = nextContent === lastSavedContent.current;
                if (storeIsCaughtUp && nextContent !== content) {
                    syncVisibleContent(nextContent);
                }
            }
        } else if (!shouldDeferExternalContentSync) {
            const nextTitle = resolveImprovementVariantTitle(activeVariantId);
            if (nextTitle !== title) {
                syncVisibleTitle(nextTitle);
            }
        }

        lastSavedTitle.current = stripStoredTitleMarkdown(existingNote.title || '');
        lastSavedContent.current = stripAudioEmbedsFromRichContent(existingNote.content || '');
    }, [existingNote, noteImprovements, activeVariantId, title, content, editMode, resolveImprovementVariantTitle, syncVisibleContent, syncVisibleTitle]);

    // Restore active variant from is_active flags when note loads
    useEffect(() => {
        if (!existingNote) return;
        if (editMode === 'visual' && visualEditorFocusedRef.current) return;

        const correctActiveVariantId = getInitialActiveVariantId();

        // Check if we are waiting for an optimistic update to settle (prevents flickering)
        if (optimisticActiveVariant.current) {
            if (correctActiveVariantId === optimisticActiveVariant.current) {
                // Server state matches our optimistic selection, we are synced
                optimisticActiveVariant.current = null;
            } else if (activeVariantId === optimisticActiveVariant.current) {
                // We are currently showing our optimistic choice, but server disagrees (lag).
                // Ignore the server update to prevent "flickering" back to original.
                console.log('[NoteEditScreen] Ignoring variant revert due to optimistic state:', {
                    current: activeVariantId,
                    serverSays: correctActiveVariantId
                });
                return;
            }
        }

        if (correctActiveVariantId !== activeVariantId) {
            console.log('[NoteEditScreen] Restoring active variant from is_active flags:', {
                current: activeVariantId,
                correct: correctActiveVariantId,
                parentActive: existingNote.is_active,
                improvementsCount: existingNote.improvements?.length || 0
            });

            setActiveVariantId(correctActiveVariantId);
            activeVariantIdRef.current = correctActiveVariantId;

            // Update content to show the correct variant
            if (correctActiveVariantId === 'original') {
                const nextTitle = existingNote.title || '';
                // Avoid wiping a non-empty in-memory title because of transient stale refresh.
                if (nextTitle.trim().length > 0 || !currentTitleRef.current.trim()) {
                    syncVisibleTitle(nextTitle);
                }
                syncVisibleContent(stripAudioEmbedsFromRichContent(existingNote.content || ''));
            } else {
                const improvement = existingNote.improvements?.find(i => i.id === correctActiveVariantId);
                if (improvement) {
                    const improvementContent = stripAudioEmbedsFromRichContent(improvement.content || '');
                    const improvementTitle =
                        improvementTitleDraftsRef.current[correctActiveVariantId] ??
                        (improvement.title || existingNote.title || '');
                    syncVisibleContent(improvementContent);
                    syncVisibleTitle(improvementTitle);
                    improvementDraftsRef.current[correctActiveVariantId] = improvementContent;
                    improvementSavedRef.current[correctActiveVariantId] = improvementContent;
                    improvementTitleDraftsRef.current[correctActiveVariantId] = improvementTitle;
                    improvementTitleSavedRef.current[correctActiveVariantId] = improvementTitle;
                }
            }
        }
    }, [editMode, existingNote?.id, existingNote?.is_active, JSON.stringify(existingNote?.improvements?.map(i => ({ id: i.id, is_active: i.is_active }))), syncVisibleContent, syncVisibleTitle]);

    useEffect(() => {
        const loadSettings = async () => {
            const provider = await getAIProvider();
            if ((!isAuthenticated || isGuest) && provider !== 'local_whisper') {
                setTranscriptionEnabled(false);
                return;
            }
            const transcription = await getTranscriptionEnabled();
            setTranscriptionEnabled(transcription);
        };
        loadSettings();
    }, [isAuthenticated, isGuest]);

    useEffect(() => {
        const fetchAiOptions = async () => {
            setAiOptionsLoading(true);
            try {
                const options = await loadImprovementOptions();
                setAiOptions(options.length > 0 ? options : DEFAULT_IMPROVEMENT_OPTIONS);
            } finally {
                setAiOptionsLoading(false);
            }
        };

        fetchAiOptions();
    }, []);

    useEffect(() => {
        isMounted.current = true;
        return () => {
            isMounted.current = false;
        };
    }, []);

    useEffect(() => {
        if (editMode === 'visual' && visualEditorFocusedRef.current) return;
        if (activeVariantId !== 'original') {
            const exists = noteImprovements.some(imp => imp.id === activeVariantId);
            const isPendingOptimistic = optimisticActiveVariant.current === activeVariantId;
            const hasLocalVariantState =
                improvementDraftsRef.current[activeVariantId] !== undefined ||
                improvementSavedRef.current[activeVariantId] !== undefined;

            // Newly created/switching variants may be temporarily missing in refreshed list.
            if (!exists && !isPendingOptimistic && !hasLocalVariantState) {
                setActiveVariantId('original');
                activeVariantIdRef.current = 'original';
                syncVisibleTitle(existingNote?.title || '');
                syncVisibleContent(stripAudioEmbedsFromRichContent(existingNote?.content || ''));
            }
        }
    }, [activeVariantId, editMode, noteImprovements, existingNote?.content, existingNote?.title, syncVisibleContent, syncVisibleTitle]);

    // Handle history updates for current variant
    const updateHistory = (newTitle: string, newContent: string, variantIdOverride?: string) => {
        // Clear existing timeout to debounce history updates
        if (historyTimeoutRef.current) {
            clearTimeout(historyTimeoutRef.current);
        }

        const targetVariantId = variantIdOverride ?? activeVariantIdRef.current;

        historyTimeoutRef.current = setTimeout(() => {
            const variantId = targetVariantId;
            const currentHistory = variantHistories.current[variantId] || {
                history: [],
                index: -1
            };

            const newHistory = currentHistory.history.slice(0, currentHistory.index + 1);
            newHistory.push({ title: newTitle, content: newContent });
            // Limit history size to 50 items
            if (newHistory.length > 50) {
                newHistory.shift();
            } else {
                currentHistory.index++;
            }

            variantHistories.current[variantId] = {
                history: newHistory,
                index: currentHistory.index
            };
        }, 500); // 500ms debounce
    };

    // Immediate history update for discrete actions (AI, Voice)
    const updateHistoryImmediate = (newTitle: string, newContent: string, variantIdOverride?: string) => {
        if (historyTimeoutRef.current) {
            clearTimeout(historyTimeoutRef.current);
        }

        const variantId = variantIdOverride ?? activeVariantIdRef.current;
        const currentHistory = variantHistories.current[variantId] || {
            history: [],
            index: -1
        };

        const newHistory = currentHistory.history.slice(0, currentHistory.index + 1);
        newHistory.push({ title: newTitle, content: newContent });

        if (newHistory.length > 50) {
            newHistory.shift();
        } else {
            currentHistory.index++;
        }

        variantHistories.current[variantId] = {
            history: newHistory,
            index: currentHistory.index
        };

    };

    const replaceCurrentHistoryState = useCallback((
        variantId: string,
        titleValue: string,
        contentValue: string
    ) => {
        const currentHistory = variantHistories.current[variantId];
        if (!currentHistory || currentHistory.history.length === 0 || currentHistory.index < 0) {
            variantHistories.current[variantId] = {
                history: [{ title: titleValue, content: contentValue }],
                index: 0,
            };
            return;
        }

        const safeIndex = Math.max(0, Math.min(currentHistory.index, currentHistory.history.length - 1));
        const nextHistory = [...currentHistory.history];
        nextHistory[safeIndex] = { title: titleValue, content: contentValue };
        variantHistories.current[variantId] = {
            history: nextHistory,
            index: safeIndex,
        };
    }, []);

    const scrubAudioFromVariantHistory = useCallback((variantId: string, audioPath: string) => {
        const currentHistory = variantHistories.current[variantId];
        if (!currentHistory || currentHistory.history.length === 0) {
            return;
        }

        variantHistories.current[variantId] = {
            ...currentHistory,
            history: currentHistory.history.map((entry) => ({
                ...entry,
                content: removeAudioFromRichContent(entry.content, audioPath),
            })),
        };
    }, []);

    const resolveVariantContent = useCallback((variantId: string): string => {
        if (variantId === 'original') {
            if (activeVariantIdRef.current === 'original') {
                return stripAudioEmbedsFromRichContent(currentContentRef.current);
            }
            return stripAudioEmbedsFromRichContent(existingNote?.content || '');
        }
        const draft = improvementDraftsRef.current[variantId];
        if (typeof draft === 'string') {
            return stripAudioEmbedsFromRichContent(draft);
        }
        const improvement = noteImprovements.find((imp) => imp.id === variantId);
        return stripAudioEmbedsFromRichContent(improvement?.content || '');
    }, [existingNote?.content, noteImprovements]);

    const resolveOriginalNoteContentForPersistence = useCallback((): string => {
        if (activeVariantIdRef.current === 'original') {
            return stripAudioEmbedsFromRichContent(currentContentRef.current);
        }
        return stripAudioEmbedsFromRichContent(lastSavedContent.current || existingNote?.content || '');
    }, [existingNote?.content]);

    const isTodoImprovementVariant = useCallback((variantId: string, baseContent: string): boolean => {
        if (variantId === 'original') return false;
        if (TODO_LIST_LINE_REGEX.test(baseContent || '') || /data-type=(["'])taskItem\1/i.test(baseContent || '')) return true;
        return noteImprovements.find((imp) => imp.id === variantId)?.option_id === 'agent_todo';
    }, [noteImprovements]);

    const buildInsertedTextForVariant = useCallback((variantId: string, baseContent: string, dictatedText: string): string => {
        const normalizedText = dictatedText.trim();
        if (!normalizedText) return baseContent;
        if (variantId === 'original') {
            return appendSnippetToContent(baseContent, normalizedText);
        }

        if (isTodoImprovementVariant(variantId, baseContent)) {
            return appendDictationToTodoContent(baseContent, normalizedText);
        }

        return appendSnippetToContent(baseContent, normalizedText);
    }, [isTodoImprovementVariant]);

    const setVariantContentWithOptions = useCallback(async (
        variantId: string,
        newText: string,
        options?: {
            persist?: boolean;
            updateHistory?: boolean;
        }
    ): Promise<boolean> => {
        const sanitizedText = stripAudioEmbedsFromRichContent(newText);
        const persist = options?.persist ?? true;
        const updateHistoryState = options?.updateHistory ?? true;
        const currentVariantContent = resolveVariantContent(variantId);

        if (areTextsEquivalent(sanitizedText, currentVariantContent)) {
            return false;
        }

        if (variantId === 'original') {
            if (activeVariantIdRef.current === 'original') {
                setContent(sanitizedText);
                currentContentRef.current = sanitizedText;
                if (editMode === 'visual') {
                    editorRef.current?.setContent(sanitizedText);
                }
            }
            if (updateHistoryState) {
                updateHistoryImmediate(currentTitleRef.current, sanitizedText, 'original');
            }
            if (persist && localNoteIdRef.current) {
                await updateNote(localNoteIdRef.current, { content: sanitizedText });
                lastSavedContent.current = sanitizedText;
            }
            return true;
        }

        if (activeVariantIdRef.current === variantId) {
            setContent(sanitizedText);
            currentContentRef.current = sanitizedText;
            if (editMode === 'visual') {
                editorRef.current?.setContent(sanitizedText);
            }
        }
        improvementDraftsRef.current[variantId] = sanitizedText;
        if (updateHistoryState) {
            updateHistoryImmediate(resolveImprovementVariantTitle(variantId), sanitizedText, variantId);
        }
        if (persist && localNoteIdRef.current) {
            try {
                await updateImprovement(localNoteIdRef.current, variantId, { content: sanitizedText });
                improvementSavedRef.current[variantId] = sanitizedText;
            } catch (error) {
                console.error('Failed to save variant content update:', error);
            }
        }
        return true;
    }, [editMode, resolveImprovementVariantTitle, resolveVariantContent, updateHistoryImmediate, updateImprovement, updateNote]);

    const resolvePendingInsertionContext = useCallback((
        variantId: string,
        recordingId?: string
    ) => {
        const currentVariantContent = resolveVariantContent(variantId);
        if (!recordingId) {
            return {
                pending: null as PendingVoiceInsertion | null,
                contentWithoutPending: currentVariantContent,
                dictationContent: currentVariantContent,
            };
        }

        const pending = pendingVoiceInsertionsRef.current.get(recordingId);
        if (!pending || pending.variantId !== variantId) {
            return {
                pending: null as PendingVoiceInsertion | null,
                contentWithoutPending: currentVariantContent,
                dictationContent: currentVariantContent,
            };
        }

        return {
            pending,
            contentWithoutPending: currentVariantContent,
            dictationContent: appendSnippetToContent(currentVariantContent, pending.dictationContent.startsWith(pending.baseContent) ? pending.dictationContent.slice(pending.baseContent.length) : pending.dictationContent),
        };
    }, [resolveVariantContent]);

    // Removed the stale processing marker auto-cleanup useEffect since there are no more markers

    const insertPendingTranscriptionToVariant = useCallback(async (
        variantId: string,
        recordingId: string,
        dictatedText: string
    ): Promise<boolean> => {
        const normalizedText = dictatedText.trim();
        if (!normalizedText) return false;

        const baseContent = resolveVariantContent(variantId);
        const dictationContent = buildInsertedTextForVariant(variantId, baseContent, normalizedText);
        const pending: PendingVoiceInsertion = {
            recordingId,
            variantId,
            baseContent,
            dictationContent,
        };

        // Register pending so we know where to append when finished
        pendingVoiceInsertionsRef.current.set(recordingId, pending);
        return true;
    }, [buildInsertedTextForVariant, resolveVariantContent, setVariantContentWithOptions]);

    const applyPlainTextToVariant = useCallback(async (
        variantId: string,
        dictatedText: string
    ): Promise<boolean> => {
        const normalizedText = dictatedText.trim();
        if (!normalizedText) return false;

        const baseContent = resolveVariantContent(variantId);
        const newText = buildInsertedTextForVariant(variantId, baseContent, normalizedText);
        return await setVariantContentWithOptions(variantId, newText, {
            persist: true,
            updateHistory: true,
        });
    }, [buildInsertedTextForVariant, resolveVariantContent, setVariantContentWithOptions]);

    const finalizePendingInsertionAsDictation = useCallback(async (
        variantId: string,
        recordingId?: string,
        fallbackText?: string
    ): Promise<boolean> => {
        const { pending, dictationContent, contentWithoutPending } = resolvePendingInsertionContext(variantId, recordingId);
        if (recordingId && pending) {
            pendingVoiceInsertionsRef.current.delete(recordingId);
            return await setVariantContentWithOptions(variantId, dictationContent, {
                persist: true,
                updateHistory: true,
            });
        }

        const textToInsert = (fallbackText || '').trim();
        if (!textToInsert) return false;
        const textWithFallback = buildInsertedTextForVariant(variantId, contentWithoutPending, textToInsert);
        return await setVariantContentWithOptions(variantId, textWithFallback, {
            persist: true,
            updateHistory: true,
        });
    }, [buildInsertedTextForVariant, resolvePendingInsertionContext, setVariantContentWithOptions]);

    const navigateBackToList = useCallback(() => {
        if (navigation.canGoBack()) {
            navigation.goBack();
        } else {
            navigation.reset({
                index: 0,
                routes: [{ name: 'NotesList' as never }],
            });
        }
    }, [navigation]);

    // Debounced save
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const saveNoteRef = useRef<(() => Promise<void>) | null>(null);



    const handleUndo = () => {
        const variantHistory = variantHistories.current[activeVariantId];
        if (!variantHistory || variantHistory.index <= 0) return;

        const prevIndex = variantHistory.index - 1;
        const prevState = variantHistory.history[prevIndex];

        syncVisibleTitle(prevState.title);
        syncVisibleContent(prevState.content);

        if (activeVariantId !== 'original') {
            improvementDraftsRef.current[activeVariantId] = prevState.content;
            improvementTitleDraftsRef.current[activeVariantId] = prevState.title;
        }

        variantHistories.current[activeVariantId] = {
            ...variantHistory,
            index: prevIndex
        };
        setReparseTrigger(prev => prev + 1);
    };

    const handleRedo = () => {
        const variantHistory = variantHistories.current[activeVariantId];
        if (!variantHistory || variantHistory.index >= variantHistory.history.length - 1) return;

        const nextIndex = variantHistory.index + 1;
        const nextState = variantHistory.history[nextIndex];

        syncVisibleTitle(nextState.title);
        syncVisibleContent(nextState.content);

        if (activeVariantId !== 'original') {
            improvementDraftsRef.current[activeVariantId] = nextState.content;
            improvementTitleDraftsRef.current[activeVariantId] = nextState.title;
        }

        variantHistories.current[activeVariantId] = {
            ...variantHistory,
            index: nextIndex
        };
        setReparseTrigger(prev => prev + 1);
    };

    const resolveAudioUri = useCallback(async (
        path: string,
        tempPrefix: string = 'temp'
    ): Promise<string | null> => {
        try {
            return await AudioService.readAudioFile(path, tempPrefix);
        } catch (error: any) {
            if (error?.message?.includes('ENOENT') || error?.code === 'ENOENT' || error?.message?.includes('No such file')) {
                console.log('[Audio] File not found (deleted?):', path);
                showToast('Audio file not found');
            } else {
                console.error('Failed to load audio:', error);
            }
            return null;
        }
    }, []);

    const clearRecordingsPreview = useCallback(() => {
        setRecordingsPreviewUri(null);
        setRecordingsPreviewDuration(0);
        setPlayingRecordingId(null);
    }, []);

    const renderInlineEditorAudioState = useCallback((payload: {
        path: string;
        duration?: number;
        position?: number;
        isPlaying?: boolean;
        playbackSpeed?: number;
        isLoading?: boolean;
    }) => {
        editorRef.current?.setAudioEmbedState({
            path: payload.path,
            duration: payload.duration ?? 0,
            position: payload.position ?? 0,
            isPlaying: payload.isPlaying ?? false,
            playbackSpeed: payload.playbackSpeed ?? 1,
            isLoading: payload.isLoading ?? false,
        });
    }, []);

    const pushInlineEditorAudioState = useCallback(() => {
        const controller = inlineEditorAudioRef.current;
        if (!controller.path) {
            return;
        }

        renderInlineEditorAudioState({
            path: controller.path,
            duration: controller.duration,
            position: controller.position,
            isPlaying: controller.isPlaying,
            playbackSpeed: controller.playbackSpeed,
            isLoading: controller.isLoading,
        });
    }, [renderInlineEditorAudioState]);

    const resetInlineEditorAudioState = useCallback((path: string, duration: number = 0) => {
        renderInlineEditorAudioState({
            path,
            duration,
            position: 0,
            isPlaying: false,
            playbackSpeed: 1,
            isLoading: false,
        });
    }, [renderInlineEditorAudioState]);

    const clearInlineEditorAudio = useCallback(async () => {
        const controller = inlineEditorAudioRef.current;
        const previousPath = controller.path;
        const previousDuration = controller.duration;
        const previousSound = controller.sound;

        controller.path = null;
        controller.sound = null;
        controller.duration = 0;
        controller.position = 0;
        controller.isPlaying = false;
        controller.playbackSpeed = 1;
        controller.isLoading = false;

        if (previousSound) {
            try {
                await previousSound.unloadAsync();
            } catch (error) {
                console.warn('Failed to unload inline editor audio:', error);
            }
        }

        if (previousPath) {
            resetInlineEditorAudioState(previousPath, previousDuration);
        }

        void AudioService.cleanupTempFiles(['embed']);
    }, [resetInlineEditorAudioState]);

    const settleInlineEditorAudioForExit = useCallback(async () => {
        try {
            await Promise.race([
                clearInlineEditorAudio(),
                new Promise<void>((resolve) => {
                    setTimeout(resolve, 500);
                }),
            ]);
        } catch (error) {
            console.warn('Failed to settle inline editor audio before exit:', error);
        }
    }, [clearInlineEditorAudio]);

    const closeRecordingsList = useCallback(() => {
        clearRecordingsPreview();
        setShowRecordingsList(false);
    }, [clearRecordingsPreview]);

    const handlePreviewRecording = useCallback(async (recording: VoiceRecording) => {
        await clearInlineEditorAudio();

        if (playingRecordingId === recording.id && recordingsPreviewUri) {
            clearRecordingsPreview();
            return;
        }

        setPlayingRecordingId(recording.id);
        const uri = await resolveAudioUri(recording.file_path);
        if (!uri) {
            setPlayingRecordingId(null);
            return;
        }

        setRecordingsPreviewUri(uri);
        setRecordingsPreviewDuration(recording.duration);
    }, [clearInlineEditorAudio, clearRecordingsPreview, playingRecordingId, recordingsPreviewUri, resolveAudioUri]);

    const handleInlineEditorPlaybackStatus = useCallback((status: any) => {
        if (!status?.isLoaded) {
            return;
        }

        const controller = inlineEditorAudioRef.current;
        controller.position = (status.positionMillis ?? 0) / 1000;
        controller.duration = status.durationMillis
            ? status.durationMillis / 1000
            : controller.duration;
        controller.isPlaying = !!status.isPlaying;
        controller.isLoading = false;

        if (status.didJustFinish) {
            controller.isPlaying = false;
            controller.position = controller.duration;
        }

        pushInlineEditorAudioState();
    }, [pushInlineEditorAudioState]);

    const ensureInlineEditorAudioSound = useCallback(async (path: string, duration: number = 0) => {
        const normalizedPath = normalizeAttachedAudioPath(path);
        if (!normalizedPath) {
            return null;
        }

        const controller = inlineEditorAudioRef.current;
        if (controller.path === normalizedPath && controller.sound) {
            return controller.sound;
        }

        const isSamePath = controller.path === normalizedPath;
        if (controller.path && !isSamePath) {
            await clearInlineEditorAudio();
        }

        controller.path = normalizedPath;
        controller.duration = duration > 0 ? duration : controller.duration;
        controller.position = 0;
        controller.isPlaying = false;
        if (!isSamePath) {
            controller.playbackSpeed = 1;
        }
        controller.isLoading = true;
        pushInlineEditorAudioState();

        const uri = await resolveAudioUri(normalizedPath, 'embed');
        if (!uri) {
            controller.isLoading = false;
            await clearInlineEditorAudio();
            return null;
        }

        try {
            const { sound, status } = await Sound.createAsync(
                { uri },
                {
                    shouldPlay: false,
                    progressUpdateIntervalMillis: 250,
                    rate: controller.playbackSpeed,
                },
                handleInlineEditorPlaybackStatus
            );

            controller.sound = sound;
            controller.isLoading = false;
            controller.position = status.isLoaded ? (status.positionMillis ?? 0) / 1000 : 0;
            controller.duration = status.isLoaded && status.durationMillis
                ? status.durationMillis / 1000
                : controller.duration;
            controller.isPlaying = status.isLoaded ? !!status.isPlaying : false;
            pushInlineEditorAudioState();
            return sound;
        } catch (error) {
            console.error('Failed to create inline editor audio:', error);
            await clearInlineEditorAudio();
            return null;
        }
    }, [clearInlineEditorAudio, handleInlineEditorPlaybackStatus, pushInlineEditorAudioState, resolveAudioUri]);

    const handleAudioActionFromEditor = useCallback(async (payload: AudioEmbedControlPayload) => {
        const targetPath = normalizeAttachedAudioPath(payload.path);
        if (!targetPath) {
            return;
        }

        const embedDuration = typeof payload.duration === 'number' && Number.isFinite(payload.duration)
            ? Math.max(0, payload.duration)
            : 0;

        Keyboard.dismiss();
        editorRef.current?.blur();
        visualEditorFocusedRef.current = false;
        closeRecordingsList();

        const controller = inlineEditorAudioRef.current;

        if (payload.action === 'speed') {
            if (controller.path !== targetPath) {
                await clearInlineEditorAudio();
                controller.path = targetPath;
                controller.duration = embedDuration;
                controller.position = 0;
                controller.isPlaying = false;
                controller.isLoading = false;
                controller.playbackSpeed = 1;
            }

            const speeds = [1, 1.5, 2];
            const currentIndex = speeds.indexOf(controller.playbackSpeed);
            controller.playbackSpeed = speeds[(currentIndex + 1) % speeds.length];
            if (controller.sound) {
                await controller.sound.setRateAsync(controller.playbackSpeed, true);
            }
            pushInlineEditorAudioState();
            return;
        }

        const sound = await ensureInlineEditorAudioSound(targetPath, embedDuration);
        if (!sound) {
            return;
        }

        if (payload.action === 'seek') {
            const seekRatio = typeof payload.seekRatio === 'number'
                ? Math.max(0, Math.min(1, payload.seekRatio))
                : 0;
            const activeDuration = inlineEditorAudioRef.current.duration || embedDuration;
            const nextPosition = activeDuration > 0 ? activeDuration * seekRatio : 0;
            inlineEditorAudioRef.current.position = nextPosition;
            inlineEditorAudioRef.current.isLoading = false;
            pushInlineEditorAudioState();
            await sound.setPositionAsync(nextPosition * 1000);
            return;
        }

        if (inlineEditorAudioRef.current.isPlaying) {
            await sound.pauseAsync();
            inlineEditorAudioRef.current.isPlaying = false;
        } else {
            const activeDuration = inlineEditorAudioRef.current.duration || embedDuration;
            if (activeDuration > 0 && inlineEditorAudioRef.current.position >= Math.max(0, activeDuration - 0.25)) {
                inlineEditorAudioRef.current.position = 0;
                await sound.setPositionAsync(0);
            }
            await sound.playAsync();
            inlineEditorAudioRef.current.isPlaying = true;
            inlineEditorAudioRef.current.isLoading = false;
        }

        pushInlineEditorAudioState();
    }, [clearInlineEditorAudio, closeRecordingsList, ensureInlineEditorAudioSound, pushInlineEditorAudioState]);

    useEffect(() => {
        const activePath = normalizeAttachedAudioPath(inlineEditorAudioRef.current.path);
        if (!activePath) {
            return;
        }

        if (!embeddedAudioPaths.some((path) => normalizeAttachedAudioPath(path) === activePath)) {
            void clearInlineEditorAudio();
        }
    }, [clearInlineEditorAudio, embeddedAudioPaths]);


    const appendAudioEmbedToVariant = useCallback(async (
        variantId: string,
        filePath: string,
        duration: number
    ): Promise<boolean> => {
        const targetPath = normalizeAttachedAudioPath(filePath);
        if (!targetPath) {
            return false;
        }

        const currentVariantContent = resolveVariantContent(variantId);
        if (extractEmbeddedAudioPaths(currentVariantContent).includes(targetPath)) {
            return false;
        }

        const nextContent = insertBlockAtSelection(
            currentVariantContent,
            isRichHtmlContent(currentVariantContent)
                ? buildAudioEmbedHtml({ path: targetPath, duration })
                : `![audio](${targetPath})`,
            {
                start: currentVariantContent.length,
                end: currentVariantContent.length,
            }
        );

        return await setVariantContentWithOptions(variantId, nextContent, {
            persist: true,
            updateHistory: true,
        });
    }, [resolveVariantContent, setVariantContentWithOptions]);

    const removeAudioEmbedsForRecording = useCallback(async (filePath: string): Promise<boolean> => {
        const targetPath = normalizeAttachedAudioPath(filePath);
        if (!targetPath) {
            return false;
        }

        let changedAny = false;

        if (normalizeAttachedAudioPath(inlineEditorAudioRef.current.path) === targetPath) {
            await clearInlineEditorAudio();
        }

        const variantIds = ['original', ...noteImprovements.map((improvement) => improvement.id)];
        for (const variantId of variantIds) {
            const currentVariantContent = resolveVariantContent(variantId);
            const nextVariantContent = removeAudioFromRichContent(currentVariantContent, targetPath);
            const changed = await setVariantContentWithOptions(variantId, nextVariantContent, {
                persist: true,
                updateHistory: false,
            });

            if (changed) {
                changedAny = true;
                scrubAudioFromVariantHistory(variantId, targetPath);
            }
        }

        if (changedAny) {
            setReparseTrigger(prev => prev + 1);
        }

        return changedAny;
    }, [
        clearInlineEditorAudio,
        noteImprovements,
        resolveVariantContent,
        scrubAudioFromVariantHistory,
        setVariantContentWithOptions,
    ]);

    const handleInsertRecordingIntoNote = useCallback(async (recording: VoiceRecording) => {
        const targetPath = normalizeAttachedAudioPath(recording.file_path);
        if (!targetPath) {
            return;
        }

        const transcript = recording.transcription?.trim() || '';
        if (transcript) {
            const variantId = activeVariantIdRef.current;
            const currentVariantContent = resolveVariantContent(variantId);
            const nextContent = buildInsertedTextForVariant(
                variantId,
                removeAudioFromRichContent(currentVariantContent, targetPath),
                transcript
            );
            const changed = await setVariantContentWithOptions(variantId, nextContent, {
                persist: true,
                updateHistory: true,
            });

            if (changed) {
                registerTranscribedInsertion(transcript);
                scrubAudioFromVariantHistory(variantId, targetPath);
                setReparseTrigger(prev => prev + 1);
                setIsEditing(true);
                closeRecordingsList();
                showToast('Transcript inserted');
                return;
            }

            closeRecordingsList();
            showToast('Transcript already in note');
            return;
        }

        const currentVariantContent = resolveVariantContent(activeVariantIdRef.current);
        if (extractEmbeddedAudioPaths(currentVariantContent).includes(targetPath)) {
            closeRecordingsList();
            showToast('Player already inserted');
            return;
        }

        if (editMode === 'visual' && editorRef.current) {
            editorRef.current.insertAudioEmbed({
                path: targetPath,
                duration: recording.duration,
                selection: visualSelectionRef.current,
            });
            setIsEditing(true);
            closeRecordingsList();
            showToast('Player inserted');
            return;
        }

        let changed = false;

        if (editMode !== 'visual') {
            const variantId = activeVariantIdRef.current;
            // rawSelection indexes the Markdown on screen, not the stored HTML.
            const nextContent = insertBlockAtSelection(
                rawMarkdownRef.current,
                `![audio](${targetPath})`,
                rawSelection
            );

            changed = await setVariantContentWithOptions(variantId, nextContent, {
                persist: true,
                updateHistory: true,
            });
        }

        if (changed) {
            setIsEditing(true);
            closeRecordingsList();
            showToast('Player inserted');
            return;
        }

        Alert.alert(t('common.errorTitle', 'Error'), t('alerts.insertAudioFailed', 'Could not add the audio player to the note.'));
    }, [
        buildInsertedTextForVariant,
        closeRecordingsList,
        editMode,
        rawSelection,
        registerTranscribedInsertion,
        resolveVariantContent,
        scrubAudioFromVariantHistory,
        setVariantContentWithOptions,
        showToast,
    ]);

    const saveImprovementDraft = useCallback(async () => {
        if (activeVariantId === 'original' || !localNoteId) {
            return;
        }
        const draft = improvementDraftsRef.current[activeVariantId] ?? '';
        const saved = improvementSavedRef.current[activeVariantId] ?? '';
        const fallbackTitle = resolveImprovementVariantTitle(activeVariantId);
        const draftTitle = improvementTitleDraftsRef.current[activeVariantId] ?? currentTitleRef.current ?? fallbackTitle;
        const savedTitle = improvementTitleSavedRef.current[activeVariantId] ?? fallbackTitle;
        const hasContentChanges = draft !== saved;
        const hasTitleChanges = draftTitle !== savedTitle;
        if (!hasContentChanges && !hasTitleChanges) {
            return;
        }
        if (isMounted.current) {
            setIsSaving(true);
        }
        try {
            const updates: {
                content?: string;
                title?: string;
                label?: string;
            } = {};
            if (hasContentChanges) {
                updates.content = draft;
            }
            if (hasTitleChanges) {
                // Only the title changes: `label` names the step and syncs unencrypted.
                updates.title = draftTitle;
            }
            await updateImprovement(localNoteId, activeVariantId, updates);
            if (hasContentChanges) {
                improvementSavedRef.current[activeVariantId] = draft;
            }
            if (hasTitleChanges) {
                improvementTitleSavedRef.current[activeVariantId] = draftTitle;
            }
        } catch (error) {
            console.error('Failed to save improvement:', error);
        } finally {
            if (isMounted.current) {
                setIsSaving(false);
            }
        }
    }, [activeVariantId, localNoteId, resolveImprovementVariantTitle, updateImprovement]);

    const saveNote = useCallback(async () => {
        await flushVisualEditorContent();

        const activeVariant = activeVariantIdRef.current;
        if (activeVariant !== 'original') {
            await saveImprovementDraft();
            return;
        }

        const noteId = localNoteIdRef.current;
        const currentTitle = currentTitleRef.current;
        const currentContent = stripAudioEmbedsFromRichContent(currentContentRef.current);
        currentContentRef.current = currentContent;
        if (activeVariantIdRef.current === 'original') {
            setContent(currentContent);
        } else {
            improvementDraftsRef.current[activeVariantIdRef.current] = currentContent;
        }

        // CREATION LOCK: Prevent double-creation if already in progress
        if (isCreatingNote.current) {
            console.log('[NoteEditScreen] Save skipped: Creation already in progress. Marking pending update.');
            pendingSaveAfterCreate.current = true;
            return;
        }

        // Correct source of truth for audio presence is the current list of recordings
        const hasAudio = voiceRecordingsRef.current.length > 0;
        const hasImprovements = noteImprovements.length > 0;
        const isContentEmpty = !currentTitle.trim() && !hasMeaningfulRichContent(currentContent);

        if (isContentEmpty && !hasAudio && !hasImprovements) {
            if (noteId) {
                try {
                    await deleteNote(noteId);
                    if (isMounted.current) {
                        setLocalNoteId(undefined);
                    }
                    lastSavedTitle.current = '';
                    lastSavedContent.current = '';
                } catch (error) {
                    console.error('Failed to delete empty note:', error);
                }
            }
            return;
        }

        // Avoid duplicate save if nothing changed
        // NOTE: We check refs vs refs to avoid stale closures if this runs delayed
        if (noteId && currentTitle === lastSavedTitle.current && currentContent === lastSavedContent.current) {
            return;
        }

        if (isMounted.current) {
            setIsSaving(true);
        }
        try {
            if (noteId) {
                await updateNote(noteId, {
                    title: currentTitle,
                    content: currentContent,
                    has_audio: hasAudio, // Explicitly sync has_audio state
                    storage_scope: storageScope,
                    is_protected: isProtectedRef.current,
                    privacy,
                });
            } else {
                // LOCK CREATION
                isCreatingNote.current = true;
                pendingSaveAfterCreate.current = false; // Reset flag

                try {
                    const newNote = await createNote({
                        title: currentTitle,
                        content: currentContent,
                        storage_scope: storageScope,
                        is_protected: isProtectedRef.current,
                        privacy,
                        // Note: createNote signature takes audio object, not has_audio flag directly.
                        // But if we have no audio object here, it defaults to false.
                        // If we needed to create with audio, we should likely be in handleRecordingFinish.
                    });

                    // Update ID immediately
                    if (isMounted.current) {
                        setLocalNoteId(newNote.id);
                        localNoteIdRef.current = newNote.id; // Immediate ref update for other async flows
                        syncTrackedProcessingToNote(newNote.id);
                        bindCreatedDraftToRoute(newNote.id);
                    }

                    await handleCreatedNoteAutoScale(newNote.id, currentContent);

                    // CHECK FOR PENDING UPDATES (Race condition fix)
                    // If user typed more while creation was in flight, or pending flag was set
                    const latestContent = currentContentRef.current;
                    const latestTitle = currentTitleRef.current;

                    // currentTitleRef and currentContentRef hold the very latest state from the component
                    // We check if it differs from what we *just* created.
                    const contentChanged = latestContent !== currentContent;
                    const titleChanged = latestTitle !== currentTitle;

                    if (pendingSaveAfterCreate.current || contentChanged || titleChanged) {
                        console.log('[NoteEditScreen] Identifying pending changes after creation, triggering update...', { pending: pendingSaveAfterCreate.current, contentChanged, titleChanged });
                        await updateNote(newNote.id, {
                            title: latestTitle,
                            content: latestContent,
                            has_audio: hasAudio,
                            storage_scope: storageScope,
                            is_protected: isProtectedRef.current,
                            privacy,
                        });
                        // Update "last saved" to the LATEST values we just pushed
                        lastSavedTitle.current = latestTitle;
                        lastSavedContent.current = stripAudioEmbedsFromRichContent(latestContent);
                        // Return here so we don't overwrite lastSaved with stale closure values below
                        return;
                    }
                } finally {
                    isCreatingNote.current = false;
                }
            }
            lastSavedTitle.current = currentTitle;
            lastSavedContent.current = stripAudioEmbedsFromRichContent(currentContent);
        } catch (error) {
            console.error('Failed to save note:', error);
            throw error;
        } finally {
            if (isMounted.current) {
                setIsSaving(false);
            }
        }
    }, [bindCreatedDraftToRoute, createNote, deleteNote, flushVisualEditorContent, handleCreatedNoteAutoScale, noteImprovements.length, privacy, saveImprovementDraft, storageScope, syncTrackedProcessingToNote, updateNote]);

    useEffect(() => {
        saveNoteRef.current = saveNote;
    }, [saveNote]);

    const debouncedSave = useCallback((_newContent: string, _newTitle: string) => {
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => {
            saveNoteRef.current?.().catch(error => {
                console.error('Failed during debounced auto-save:', error);
            });
        }, 500); // Reduced from 2000ms to 500ms for faster auto-save
    }, []);

    const handleTitleChange = useCallback((text: string) => {
        const variantId = activeVariantIdRef.current;

        setTitle(text);
        currentTitleRef.current = text;

        if (variantId === 'original' && text.trim().length > 0) {
            titleLockRef.current = true;
        }
        if (variantId !== 'original') {
            improvementTitleDraftsRef.current[variantId] = text;
        }

        updateHistory(text, currentContentRef.current, variantId);
        if (localNoteIdRef.current) {
            debouncedSave(currentContentRef.current, text);
        }
    }, [debouncedSave]);

    const noteTitleRef = useRef(noteTitle);
    noteTitleRef.current = noteTitle;
    // updateNote is not memoized in useNotes; a ref keeps the callbacks below stable
    // so their unmount-only cleanup does not fire on every provider render.
    const updateNoteRef = useRef(updateNote);
    updateNoteRef.current = updateNote;
    /** Trimmed title this screen last wrote, to tell our own echo from a foreign rename. */
    const noteTitleSavedByScreenRef = useRef<string | null>(null);

    const flushNoteTitleSave = useCallback(() => {
        if (!noteTitleSaveTimerRef.current) return;
        clearTimeout(noteTitleSaveTimerRef.current);
        noteTitleSaveTimerRef.current = null;
        const noteId = localNoteIdRef.current;
        if (!noteId) return;
        const text = noteTitleRef.current;
        lastSavedTitle.current = text;
        noteTitleSavedByScreenRef.current = text.trim();
        void updateNoteRef.current(noteId, { title: text }).catch((error: unknown) => {
            console.error('Failed to save note title', error);
        });
    }, []);

    /** Editing the header while a version is open renames the note itself. */
    const handleNoteTitleEditOnVariant = useCallback((text: string) => {
        setNoteTitle(text);
        noteTitleRef.current = text;
        if (text.trim()) titleLockRef.current = true;
        if (noteTitleSaveTimerRef.current) clearTimeout(noteTitleSaveTimerRef.current);
        noteTitleSaveTimerRef.current = setTimeout(flushNoteTitleSave, 600);
    }, [flushNoteTitleSave]);

    useEffect(() => {
        if (activeVariantId === 'original') {
            setNoteTitle(title);
        }
    }, [activeVariantId, title]);

    useEffect(() => {
        if (activeVariantId === 'original' || noteTitleSaveTimerRef.current) return;
        const stored = existingNote?.title || '';
        // Our own save comes back trimmed; adopting it would eat a trailing space
        // (and characters typed meanwhile). Only a rename from elsewhere is applied.
        if (stored.trim() === (noteTitleSavedByScreenRef.current ?? '') || stored.trim() === noteTitleRef.current.trim()) return;
        setNoteTitle(stored);
    }, [activeVariantId, existingNote?.title]);

    useEffect(() => () => flushNoteTitleSave(), [flushNoteTitleSave]);

    const handleContentChange = useCallback((text: string) => {
        const sanitizedText = stripAudioEmbedsFromRichContent(text);
        const variantId = activeVariantIdRef.current;
        const currentTitle = currentTitleRef.current;

        stageOriginalCreationAutoScale(variantId, sanitizedText);
        setContent(sanitizedText);
        currentContentRef.current = sanitizedText;

        if (variantId !== 'original') {
            improvementDraftsRef.current[variantId] = sanitizedText;
        }

        if (localNoteIdRef.current) {
            debouncedSave(sanitizedText, currentTitle);
        }

        updateHistory(currentTitle, sanitizedText, variantId);
    }, [debouncedSave, stageOriginalCreationAutoScale]);
    handleContentChangeRef.current = handleContentChange;

    const currentNoteMarkdown = useCallback(async (): Promise<string> => {
        if (editMode === 'raw') return rawMarkdownRef.current;
        return richContentToMarkdown(await flushVisualEditorContent());
    }, [editMode, flushVisualEditorContent]);

    // Bumped when a search starts or the sheet closes, so a late answer cannot reopen it.
    const tasksRequestRef = useRef(0);
    const closeTasksSheet = useCallback(() => {
        tasksRequestRef.current += 1;
        setTasksSheet((prev) => ({ ...prev, visible: false, loading: false }));
    }, []);

    const runFindTasks = useCallback(async () => {
        const request = ++tasksRequestRef.current;
        setTasksSheet({ visible: true, loading: true, error: null, tasks: [] });
        try {
            const markdown = (await currentNoteMarkdown()).replace(/^\s*!\[audio\]\([^)]+\)\s*$/gm, '').trim();
            const found = markdown ? await extractTasks(markdown) : [];
            if (request !== tasksRequestRef.current) return;
            const existing = checklistTitlesFromMarkdown(markdown);
            setTasksSheet({
                visible: true,
                loading: false,
                error: null,
                tasks: found.map((task) => ({ ...task, inNote: isTaskInNote(task, existing) })),
            });
        } catch (error) {
            if (request !== tasksRequestRef.current) return;
            if (getErrorMessage(error, '').toLowerCase().includes('usage limit')) {
                // The limit modal takes over.
                setTasksSheet((prev) => ({ ...prev, visible: false, loading: false }));
                return;
            }
            setTasksSheet({
                visible: true,
                loading: false,
                error: t('edit.tasks.failed', 'Could not look for tasks. Check your connection and try again.'),
                tasks: [],
            });
        }
    }, [currentNoteMarkdown, t]);

    const handleFindTasks = () => {
        setShowMenu(false);
        void handleAiAccess(() => { void runFindTasks(); });
    };

    const formatTaskDue = useCallback((task: ExtractedTask): string => {
        if (!task.date) return '';
        const [year, month, day] = task.date.split('-').map(Number);
        let label = task.date;
        try {
            label = new Date(year, month - 1, day).toLocaleDateString(i18n.language, { weekday: 'short', month: 'short', day: 'numeric' });
        } catch {
            // Intl without this locale: keep the ISO date
        }
        return task.time ? `${label}, ${task.time}` : label;
    }, [i18n.language]);

    const handleAddTasksToNote = useCallback(async (tasks: ExtractedTask[]) => {
        if (tasks.length === 0) return;
        haptics.success();
        const checklist = tasksToChecklistMarkdown(tasks, formatTaskDue);
        const base = editMode === 'raw' ? currentContentRef.current : await flushVisualEditorContent();
        const next = isRichHtmlContent(base) || !base.trim()
            ? `${base}${markdownToTiptapHtml(checklist)}`
            : `${base.replace(/\s+$/, '')}\n\n${checklist}`;
        closeTasksSheet();
        syncVisibleContent(next);
        handleContentChange(next);
        showToast(t('edit.tasks.added', 'Tasks added to the note: {{count}}', { count: tasks.length }));
    }, [closeTasksSheet, editMode, flushVisualEditorContent, formatTaskDue, handleContentChange, syncVisibleContent, t]);

    const handleAddTaskToCalendar = useCallback(async (task: ExtractedTask): Promise<boolean> => {
        const event = taskToCalendarEvent(task);
        const details = (noteTitle || title || '').trim();
        try {
            const Calendar = require('expo-calendar/legacy') as typeof import('expo-calendar/legacy');
            const result = await Calendar.createEventInCalendarAsync({
                title: event.title,
                startDate: event.startDate,
                endDate: event.endDate,
                allDay: event.allDay,
                notes: details || undefined,
            });
            return result?.action !== 'canceled';
        } catch (error) {
            // Builds without the native calendar module: the web editor still works.
            console.warn('[Tasks] Native calendar unavailable, using web fallback:', getErrorMessage(error, ''));
            try {
                await Linking.openURL(googleCalendarUrl(event, details));
                return true;
            } catch {
                showToast(t('edit.tasks.calendarFailed', 'Could not open the calendar'));
                return false;
            }
        }
    }, [noteTitle, t, title]);

    // Content replaced from elsewhere while the raw view is open (variant
    // switch, undo, inserted recording): re-derive the Markdown shown.
    useEffect(() => {
        if (editMode !== 'raw' || content === rawSourceContentRef.current) {
            return;
        }
        showRawMarkdown(richContentToMarkdown(content), content);
    }, [content, editMode, showRawMarkdown]);

    const handleVariantSelect = useCallback(async (variantId: string) => {
        if (variantId === activeVariantId) {
            return;
        }
        try {
            // Save current content before switching
            await saveNote();

            // Update is_active flags in database
            if (localNoteId) {
                await setActiveVariant(
                    localNoteId,
                    variantId === 'original' ? null : variantId
                );
            }
        } catch (error) {
            console.error('Failed to save before switching variant:', error);
        }

        // Initialize history for new variant if needed
        if (!variantHistories.current[variantId]) {
            const content = variantId === 'original'
                ? stripAudioEmbedsFromRichContent(existingNote?.content || '')
                : stripAudioEmbedsFromRichContent(
                    improvementDraftsRef.current[variantId] || noteImprovements.find(i => i.id === variantId)?.content || ''
                );
            const variantTitle = variantId === 'original'
                ? existingNote?.title || ''
                : resolveImprovementVariantTitle(variantId);

            variantHistories.current[variantId] = {
                history: [{ title: variantTitle, content }],
                index: 0
            };
        }

        setActiveVariantId(variantId);
        activeVariantIdRef.current = variantId;
        optimisticActiveVariant.current = variantId;
        if (variantId === 'original') {
            // noteTitleRef is current even when a just-flushed rename has not
            // refreshed existingNote yet; the stale prop would undo the rename.
            flushNoteTitleSave();
            // Only reached from a version (same-id selects return early above).
            syncVisibleTitle(noteTitleRef.current);
            syncVisibleContent(stripAudioEmbedsFromRichContent(existingNote?.content || ''));
        } else {
            syncVisibleTitle(resolveImprovementVariantTitle(variantId));
            const draft = improvementDraftsRef.current[variantId];
            if (draft !== undefined) {
                syncVisibleContent(stripAudioEmbedsFromRichContent(draft));
            } else {
                const imp = noteImprovements.find(i => i.id === variantId);
                syncVisibleContent(stripAudioEmbedsFromRichContent(imp?.content || ''));
            }
        }
        setReparseTrigger(prev => prev + 1);
    }, [activeVariantId, existingNote?.content, existingNote?.title, flushNoteTitleSave, noteImprovements, resolveImprovementVariantTitle, saveNote, localNoteId, setActiveVariant, syncVisibleContent, syncVisibleTitle]);

    // ---- Versions: undoable delete, promote, copy, swipe -------------------------

    const finalizePendingVariantDelete = useCallback(() => {
        const pending = pendingVariantDeleteRef.current;
        if (!pending) return;
        clearTimeout(pending.timer);
        pendingVariantDeleteRef.current = null;
        setUndoMessage(null);
        Object.keys(derivedVariantBySourceRef.current).forEach((source) => {
            if (source === pending.id || derivedVariantBySourceRef.current[source] === pending.id) {
                delete derivedVariantBySourceRef.current[source];
            }
        });
        void deleteImprovement(pending.noteId, pending.id)
            .then(() => {
                delete improvementDraftsRef.current[pending.id];
                delete improvementSavedRef.current[pending.id];
                delete improvementTitleDraftsRef.current[pending.id];
                delete improvementTitleSavedRef.current[pending.id];
            })
            .catch((error: unknown) => {
                console.error('Failed to delete improvement', error);
                setHiddenVariantIds(prev => prev.filter(id => id !== pending.id));
            });
    }, [deleteImprovement]);

    // Leaving the note must not resurrect a version the user already removed.
    useEffect(() => () => finalizePendingVariantDelete(), [finalizePendingVariantDelete]);

    const requestDeleteVariant = useCallback(async (improvementId: string) => {
        const noteId = localNoteIdRef.current;
        if (!noteId) return;
        // One undo at a time: an earlier pending delete becomes final now.
        finalizePendingVariantDelete();
        if (activeVariantIdRef.current === improvementId) {
            await handleVariantSelect('original');
        }
        setHiddenVariantIds(prev => (prev.includes(improvementId) ? prev : [...prev, improvementId]));
        const timer = setTimeout(finalizePendingVariantDelete, 5000);
        pendingVariantDeleteRef.current = { id: improvementId, noteId, timer };
        setUndoMessage(t('edit.versions.deleted', 'Version deleted'));
    }, [finalizePendingVariantDelete, handleVariantSelect, t]);

    const undoVariantDelete = useCallback(() => {
        const pending = pendingVariantDeleteRef.current;
        if (!pending) return;
        clearTimeout(pending.timer);
        pendingVariantDeleteRef.current = null;
        setUndoMessage(null);
        setHiddenVariantIds(prev => prev.filter(id => id !== pending.id));
    }, []);

    const handleMakeVariantMain = useCallback((improvementId: string) => {
        Alert.alert(
            t('edit.versions.makeMainConfirmTitle', 'Use this version as the main text?'),
            t('edit.versions.makeMainConfirmBody', 'The current original is kept as a separate version, so nothing is lost.'),
            [
                { text: t('common.cancel', 'Cancel'), style: 'cancel' },
                {
                    text: t('edit.versions.makeMain', 'Use as main text'),
                    onPress: () => {
                        void (async () => {
                            const noteId = localNoteIdRef.current;
                            if (!noteId) return;
                            try {
                                const versionContent = resolveVariantContent(improvementId);
                                if (activeVariantIdRef.current !== 'original') {
                                    await handleVariantSelect('original');
                                }
                                const previousContent = resolveVariantContent('original');
                                if (areTextsEquivalent(previousContent, versionContent)) {
                                    showToast(t('edit.versions.madeMain', 'This version is now the main text'));
                                    return;
                                }
                                const previousTitle = currentTitleRef.current || existingNote?.title || '';
                                const previous = await createImprovement(noteId, {
                                    content: previousContent,
                                    title: previousTitle,
                                    label: englishStepName({ id: PREVIOUS_ORIGINAL_OPTION_ID }),
                                    optionId: PREVIOUS_ORIGINAL_OPTION_ID,
                                });
                                improvementDraftsRef.current[previous.id] = previousContent;
                                improvementSavedRef.current[previous.id] = previousContent;
                                improvementTitleDraftsRef.current[previous.id] = previousTitle;
                                improvementTitleSavedRef.current[previous.id] = previousTitle;
                                await setVariantContentWithOptions('original', versionContent, {
                                    persist: true,
                                    updateHistory: true,
                                });
                                // The promoted text now is the original; keeping it as a
                                // version too would just duplicate it. Hide it now and delete
                                // it a moment later: the sync started by switching to the
                                // original can still write the server copy back over an
                                // immediate delete.
                                finalizePendingVariantDelete();
                                setHiddenVariantIds(prev => (prev.includes(improvementId) ? prev : [...prev, improvementId]));
                                pendingVariantDeleteRef.current = {
                                    id: improvementId,
                                    noteId,
                                    timer: setTimeout(finalizePendingVariantDelete, 3000),
                                };
                                setReparseTrigger(prev => prev + 1);
                                showToast(t('edit.versions.madeMain', 'This version is now the main text'));
                            } catch (error) {
                                console.error('Failed to promote version', error);
                                Alert.alert(t('common.errorTitle', 'Error'), getErrorMessage(error, ''));
                            }
                        })();
                    },
                },
            ]
        );
    }, [createImprovement, existingNote?.title, finalizePendingVariantDelete, handleVariantSelect, resolveVariantContent, setVariantContentWithOptions, showToast, t]);

    const handleCopyVariantToNewNote = useCallback(async (improvementId: string) => {
        try {
            await createNote({
                title: noteTitle || existingNote?.title || '',
                content: resolveVariantContent(improvementId),
                storage_scope: storageScope,
                is_protected: isProtectedRef.current,
                privacy,
            });
            showToast(t('edit.versions.copied', 'Copied to a new note'));
        } catch (error) {
            console.error('Failed to copy version to a new note', error);
            Alert.alert(t('common.errorTitle', 'Error'), getErrorMessage(error, ''));
        }
    }, [createNote, existingNote?.title, noteTitle, privacy, resolveVariantContent, showToast, storageScope, t]);

    const variantOrder = useMemo(
        () => ['original', ...visibleImprovements.map((imp: any) => imp.id)],
        [visibleImprovements]
    );

    const switchVariantBySwipeRef = useRef<(direction: 1 | -1) => void>(() => undefined);

    const openRenameVersion = useCallback((improvementId: string) => {
        setRenameTarget({ id: improvementId, value: variantDisplayLabels[improvementId] || '' });
    }, [variantDisplayLabels]);

    const saveRenameVersion = useCallback(async () => {
        const target = renameTarget;
        setRenameTarget(null);
        const noteId = localNoteIdRef.current;
        if (!target || !noteId) return;
        const improvement = noteImprovements.find((imp: any) => imp.id === target.id);
        const aiTitle = plainVariantTitle(improvementTitleDraftsRef.current[target.id] ?? improvement?.title ?? '');
        // An empty name goes back to the step label; the AI title is kept either way.
        const nextTitle = target.value.trim()
            ? markUserVariantName(target.value)
            : (userVariantName(improvement?.title) ? aiTitle : (improvement?.title || ''));
        try {
            await updateImprovement(noteId, target.id, { title: nextTitle });
            improvementTitleDraftsRef.current[target.id] = nextTitle;
            improvementTitleSavedRef.current[target.id] = nextTitle;
        } catch (error) {
            console.error('Failed to rename version', error);
            Alert.alert(t('common.errorTitle', 'Error'), getErrorMessage(error, ''));
        }
    }, [noteImprovements, renameTarget, t, updateImprovement]);

    // Swiping is invisible until someone tells you: show it once, the first time a
    // note has versions.
    useEffect(() => {
        if (visibleImprovements.length === 0 || showSwipeHint) return;
        let cancelled = false;
        void getVersionSwipeHintSeen().then((seen) => {
            if (!cancelled && !seen) setShowSwipeHint(true);
        });
        return () => { cancelled = true; };
    }, [showSwipeHint, visibleImprovements.length]);

    const dismissSwipeHint = useCallback(() => {
        setShowSwipeHint(false);
        void setVersionSwipeHintSeen();
    }, []);

    const openVersionsSheet = useCallback(() => {
        Keyboard.dismiss();
        setShowVersionsSheet(true);
    }, []);

    // A second swipe can arrive before the first switch lands (it saves first), so
    // step from the version being switched to, not the one still on screen.
    const swipeTargetRef = useRef<string | null>(null);
    const switchVariantBySwipe = useCallback((direction: 1 | -1) => {
        const from = swipeTargetRef.current ?? activeVariantIdRef.current;
        const index = variantOrder.indexOf(from);
        const next = variantOrder[(index < 0 ? variantOrder.indexOf(activeVariantIdRef.current) : index) + direction];
        if (!next) return;
        swipeTargetRef.current = next;
        void Haptics.selectionAsync().catch(() => undefined);
        if (showSwipeHint) dismissSwipeHint();
        void handleVariantSelect(next).finally(() => {
            if (swipeTargetRef.current === next) swipeTargetRef.current = null;
        });
    }, [dismissSwipeHint, handleVariantSelect, showSwipeHint, variantOrder]);
    switchVariantBySwipeRef.current = switchVariantBySwipe;
    // Stable identity for the memoized editor; reads the latest state via the ref.
    const handleEditorHorizontalSwipe = useCallback((direction: 1 | -1) => {
        switchVariantBySwipeRef.current(direction);
    }, []);

    const versionListItems = useMemo<VersionListItem[]>(() => {
        if (!showVersionsSheet) return [];
        const snippetOf = (rich: string) => richContentToPlainText(rich).replace(/\s+/g, ' ').trim().slice(0, 160);
        const timeOf = (iso?: string) => {
            if (!iso) return undefined;
            const date = new Date(iso);
            if (Number.isNaN(date.getTime())) return undefined;
            return date.toLocaleString(i18n.language, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        };
        return [
            {
                id: 'original',
                label: t('edit.original', 'Original'),
                icon: 'article',
                title: noteTitle || undefined,
                snippet: snippetOf(resolveVariantContent('original')),
            },
            ...visibleImprovements.map((imp: any, index: number) => ({
                id: imp.id,
                label: variantDisplayLabels[imp.id] || `${t('edit.improvement')} ${index + 1}`,
                icon: variantIconFor(imp, improvementOptionIcons),
                title: sanitizeDisplayLabel(plainVariantTitle(imp.title)) || undefined,
                snippet: snippetOf(resolveVariantContent(imp.id)),
                timeLabel: timeOf(imp.created_at),
            })),
        ];
    }, [i18n.language, improvementOptionIcons, noteTitle, resolveVariantContent, showVersionsSheet, t, variantDisplayLabels, visibleImprovements]);

    useEffect(() => {
        const unsubscribe = navigation.addListener('beforeRemove', (event) => {
            if (skipAutoSaveRef.current) {
                skipAutoSaveRef.current = false;
                return;
            }

            event.preventDefault();

            const saveAndExit = async () => {
                const finishNavigation = () => {
                    skipAutoSaveRef.current = true;

                    const isGoBack = event.data.action?.type === 'GO_BACK';
                    const canGoBack = navigation.canGoBack();
                    if (isGoBack && !canGoBack) {
                        navigation.reset({
                            index: 0,
                            routes: [{ name: 'NotesList' as never }],
                        });
                        return;
                    }

                    navigation.dispatch(event.data.action);
                };

                await settleInlineEditorAudioForExit();

                try {
                    await prepareEditorSnapshotForExit();
                } catch (error) {
                    console.error('Error during navigation snapshot:', error);
                    finishNavigation();
                    return;
                }

                const latestTitle = currentTitleRef.current;
                const latestContent = currentContentRef.current;
                const variantId = activeVariantIdRef.current;
                const nothingToSave = !latestTitle.trim() && !hasMeaningfulRichContent(latestContent);
                const unchanged = latestTitle === lastSavedTitle.current && latestContent === lastSavedContent.current;
                const improvementDraft = improvementDraftsRef.current[variantId] ?? '';
                const improvementSaved = improvementSavedRef.current[variantId] ?? '';
                const improvementTitleDraft = improvementTitleDraftsRef.current[variantId] ?? latestTitle;
                const improvementTitleSaved = improvementTitleSavedRef.current[variantId] ?? resolveImprovementVariantTitle(variantId);
                const hasChanges = variantId === 'original'
                    ? !(nothingToSave || unchanged)
                    : improvementDraft !== improvementSaved || improvementTitleDraft !== improvementTitleSaved;

                if (!hasChanges) {
                    finishNavigation();
                    return;
                }

                try {
                    await saveNote();
                } catch (error) {
                    console.error('Error during navigation auto-save:', error);
                    finishNavigation();
                    return;
                }

                finishNavigation();
            };

            saveAndExit();
        });

        return unsubscribe;
    }, [clearAgentSessionState, navigation, prepareEditorSnapshotForExit, resolveImprovementVariantTitle, saveNote, settleInlineEditorAudioForExit]);

    useFocusEffect(
        useCallback(() => {
            return () => {
                // We do NOT clear session state on blur/unmount here to allow background/navigation processing to continue totally uninterrupted.
                // clearAgentSessionState();
            };
        }, [clearAgentSessionState])
    );

    // Auto-save on app state changes
    useEffect(() => {
        const subscription = AppState.addEventListener('change', (nextAppState) => {
            if (nextAppState === 'background') {
                // Do not clear agent session state on background to allow queue processing to continue
            }
            if (nextAppState === 'background' || nextAppState === 'inactive') {
                // Critical: clear temporary decrypted playback files on app backgrounding.
                void AudioService.cleanupTempFiles();
                // Clear any pending debounced save to prevent duplicate
                if (saveTimeoutRef.current) {
                    clearTimeout(saveTimeoutRef.current);
                    saveTimeoutRef.current = null;
                }
                // Save immediately when app goes to background
                saveNote().catch(error => {
                    console.error('Error during background auto-save:', error);
                });
            }
        });

        return () => {
            subscription.remove();
        };
    }, [clearAgentSessionState, saveNote]);

    const handleBack = async () => {
        await settleInlineEditorAudioForExit();

        try {
            await prepareEditorSnapshotForExit();
        } catch (error) {
            console.error('Error during back snapshot:', error);
        }

        // Check if note is effectively empty
        const isViewingOriginal = activeVariantIdRef.current === 'original';
        const latestTitle = currentTitleRef.current;
        const latestContent = currentContentRef.current;
        const isContentEmpty =
            isViewingOriginal &&
            !latestTitle.trim() &&
            !hasMeaningfulRichContent(latestContent);
        const hasNoAudio = !existingNote?.has_audio && voiceRecordings.length === 0;

        if (isContentEmpty && hasNoAudio && localNoteId) {
            skipAutoSaveRef.current = true;
            navigateBackToList();
            // Auto-delete empty notes to keep list clean
            console.log('[AutoClean] Deleting empty note on exit');
            deleteNote(localNoteId).catch(error => {
                console.error('[AutoClean] Error deleting empty note:', error);
            });
        } else {
            try {
                await saveNote();
            } catch (error) {
                console.error('Error during back navigation save:', error);
            }

            skipAutoSaveRef.current = true;
            navigateBackToList();
        }
    };

    const handleDelete = async () => {
        if (!localNoteId) return;
        setShowMenu(false);
        setIsDeletingNote(true);
    };

    const confirmDeleteNote = async () => {
        if (!localNoteId) return;
        setIsDeletingNote(false);
        haptics.warning();
        skipAutoSaveRef.current = true;
        navigateBackToList();
        try {
            await deleteNote(localNoteId);
        } catch (error) {
            console.error('Failed to delete note:', error);
        }
    };

    const openVoiceRecorderForMode = useCallback((mode: MicInputMode) => {
        setPendingMicInputMode(mode);
        pendingMicInputModeRef.current = mode;
        setShowVoiceRecorder(true);
    }, []);

    const handleMicPress = async () => {
        if (micLongPressHandledRef.current) {
            micLongPressHandledRef.current = false;
            return;
        }
        openVoiceRecorderForMode('agent');
    };

    const handleMicLongPress = () => {
        micLongPressHandledRef.current = true;
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
        openVoiceRecorderForMode('force_text');
    };

    const handlePrivacyAccept = () => {
        setShowPrivacyWarning(false);
        setShowVoiceRecorder(true);
    };



    // Process transcribed text queue strictly sequentially
    const processAgentQueue = async () => {
        if (isProcessingQueue.current) return;
        isProcessingQueue.current = true;

        try {
            while (agentQueue.current.length > 0) {
                // Peek first item
                const firstTask = agentQueue.current[0];
                if (!firstTask) {
                    agentQueue.current.shift();
                    continue;
                }

                // Gather batch of tasks with same key
                const batch: AgentQueueTask[] = [];
                const batchKey = getTaskKey(firstTask);
                while (agentQueue.current.length > 0) {
                    const next = agentQueue.current[0];
                    if (!next || getTaskKey(next) !== batchKey) break;
                    batch.push(agentQueue.current.shift()!);
                }

                // Filter out stale tasks and empty text from batch
                const validBatch = batch.filter(task => {
                    const isStale = task.sessionId !== agentSessionIdRef.current || task.noteId !== localNoteIdRef.current;
                    const isEmpty = !task.transcribedText?.trim();
                    if (isStale || isEmpty) {
                        if (isStale) console.log(`[NoteEditScreen] Skipping stale task ${task.id} (sess: ${task.sessionId}/${agentSessionIdRef.current})`);
                        if (task.recordingId) {
                            pendingVoiceInsertionsRef.current.delete(task.recordingId);
                        }
                        setRecordingOutcomeStatus(task.recordingId, 'Saved recording');
                        return false;
                    }
                    return true;
                });

                if (validBatch.length === 0) {
                    refreshTrackedQueueLength();
                    continue;
                }

                activeAgentTasksRef.current = validBatch;
                // Treat the first task in the batch as the representative for target settings
                const task = validBatch[0];
                const taskVariantId = resolveTaskTargetVariantId(task);
                const normalizedTaskText = validBatch.map(t => t.transcribedText.trim()).filter(Boolean).join('\n\n');
                const representativeRecordingId = getRepresentativeRecordingId(task);
                if (taskVariantId !== (task.targetVariantId || 'original')) {
                    validBatch.forEach(batchTask => {
                        getTaskRecordingIds(batchTask).forEach(recordingId => {
                            const pending = pendingVoiceInsertionsRef.current.get(recordingId);
                            if (pending && pending.variantId !== taskVariantId) {
                                pendingVoiceInsertionsRef.current.delete(recordingId);
                            }
                        });
                    });
                }
                const pendingContextAtStart = resolvePendingInsertionContext(taskVariantId, representativeRecordingId);
                const shouldUseTaskProvidedContext =
                    validBatch.every(t => !!t.dictationAlreadyApplied) &&
                    !pendingContextAtStart.pending &&
                    typeof task.agentContextContent === 'string';
                const contextContent = shouldUseTaskProvidedContext
                    ? (task.agentContextContent || '')
                    : pendingContextAtStart.contentWithoutPending;
                const allRecordingIds = validBatch.flatMap(t => getTaskRecordingIds(t));
                // If every task in the batch already had dictation applied, we can skip dictation
                const shouldSkipDictationApply = validBatch.every(t => !!t.dictationAlreadyApplied) && !pendingContextAtStart.pending;
                let dictationFinalized = false;
                let shouldFallbackToDictationOnError = true;

                console.log(`[NoteEditScreen] Processing agent batch of ${validBatch.length} tasks (queue=${getPendingTaskCount(agentQueue.current)})`);

                const finalizeAsDictation = async (fallbackText?: string, options?: { silent?: boolean }) => {
                    if (dictationFinalized) return false;
                    if (shouldSkipDictationApply) {
                        dictationFinalized = true;
                        return true;
                    }
                    const allRecordingIds = validBatch.flatMap(t => getTaskRecordingIds(t));
                    let appliedOnce = false;
                    if (allRecordingIds.length > 0) {
                        for (const recId of allRecordingIds) {
                            const applied = await finalizePendingInsertionAsDictation(
                                taskVariantId,
                                recId,
                                fallbackText || normalizedTaskText
                            );
                            appliedOnce = appliedOnce || applied;
                        }
                    } else {
                        appliedOnce = await finalizePendingInsertionAsDictation(
                            taskVariantId,
                            task.recordingId,
                            fallbackText || normalizedTaskText
                        );
                    }
                    if (!appliedOnce) return false;
                    dictationFinalized = true;
                    if (!options?.silent) {
                        const status = taskVariantId === 'original'
                            ? t('edit.agent.addedToOriginal')
                            : t('edit.agent.addedToImproved');
                        allRecordingIds.forEach(id => {
                            setRecordingOutcomeStatus(id, status);
                            showVoiceResultStatus(status, id);
                        });
                    }
                    return true;
                };

                try {
                    setTrackedIsAIProcessing(true);

                    // Process the note
                    const agentResult = await Promise.race([
                        processVoiceNote(
                            '',
                            undefined,
                            contextContent,
                            normalizedTaskText,
                            requestHistoryRef.current
                        ),
                        new Promise<never>((_, reject) => {
                            setTimeout(() => reject(new Error('Agent task timeout')), AGENT_TASK_TIMEOUT_MS);
                        })
                    ]) as Awaited<ReturnType<typeof processVoiceNote>>;

                    // Check session again after async op
                    if (task.sessionId !== agentSessionIdRef.current || task.noteId !== localNoteIdRef.current) {
                        console.log(`[NoteEditScreen] Task finished but session stale, discarding result for batch`);
                        // Resolved before the loop: the callback parameter shadows `t`.
                        const savedRecordingStatus = t('edit.agent.savedRecording');
                        validBatch.forEach(t => {
                            if (t.recordingId) {
                                pendingVoiceInsertionsRef.current.delete(t.recordingId);
                                setRecordingOutcomeStatus(t.recordingId, savedRecordingStatus);
                            }
                        });
                        // We still shift below
                    } else if (agentResult.success) {
                        // Refresh profile to update balance in UI after deduction
                        refreshProfile?.().catch(() => {});

                        // SUCCESS HANDLER
                        if (normalizedTaskText) {
                            setRequestHistory(prev => {
                                const newHistory = [...prev, normalizedTaskText];
                                return newHistory.slice(-AGENT_HISTORY_LIMIT);
                            });
                        }

                        const originalText = (agentResult.originalText || normalizedTaskText || '').trim();
                        // Model-authored titles land in a plain TextInput and a chip.
                        const explicitTitle = sanitizeDisplayLabel(agentResult.titleValue || '');
                        const pendingContext = resolvePendingInsertionContext(taskVariantId, representativeRecordingId);
                        const commandBaseContent = pendingContext.contentWithoutPending;
                        const hasPendingDraft = validBatch.some(t => t.recordingId && pendingContext.pending);
                        const shouldPreserveDictationInOriginal =
                            taskVariantId === 'original' &&
                            hasPendingDraft &&
                            !hasMeaningfulRichContent(commandBaseContent);
                        const originalContentAfterCommand = shouldPreserveDictationInOriginal
                            ? pendingContext.dictationContent
                            : commandBaseContent;
                        const processedText = typeof agentResult.processedText === 'string'
                            ? agentResult.processedText.trim()
                            : '';
                        // The original note is never written by the agent: instructions
                        // targeting it produce a separate improvement variant instead.
                        // See the hasApplicableInstruction branch below.
                        const hasProcessedPayload =
                            typeof agentResult.processedText === 'string' &&
                            (agentResult.mode === 'edit_content' || processedText.length > 0);
                        const hasApplicableInstruction =
                            agentResult.hasInstruction &&
                            hasProcessedPayload &&
                            !areTextsEquivalent(processedText, originalText);
                        const checklistMentionFallback = transcriptDirectlyMentionsChecklistItem(
                            commandBaseContent,
                            originalText || normalizedTaskText
                        );


                        if (agentResult.titleAction === 'set' && explicitTitle && localNoteIdRef.current) {
                            clearTranscribedInsertionExpectation();
                            if (hasPendingDraft) {
                                validBatch.forEach(t => {
                                    if (t.recordingId) pendingVoiceInsertionsRef.current.delete(t.recordingId);
                                });
                                replaceCurrentHistoryState(
                                    taskVariantId,
                                    resolveImprovementVariantTitle(taskVariantId),
                                    commandBaseContent
                                );
                            }
                            await setVariantContentWithOptions(taskVariantId, commandBaseContent, {
                                persist: true,
                                updateHistory: false,
                            });
                            try {
                                if (taskVariantId === 'original') {
                                    await updateNote(localNoteIdRef.current, { title: explicitTitle });
                                    setTitle(explicitTitle);
                                    currentTitleRef.current = explicitTitle;
                                    lastSavedTitle.current = explicitTitle;
                                    titleLockRef.current = true;
                                } else {
                                    await updateImprovement(localNoteIdRef.current, taskVariantId, {
                                        title: explicitTitle,
                                    });
                                    improvementTitleDraftsRef.current[taskVariantId] = explicitTitle;
                                    improvementTitleSavedRef.current[taskVariantId] = explicitTitle;
                                    if (activeVariantIdRef.current === taskVariantId) {
                                        setTitle(explicitTitle);
                                        currentTitleRef.current = explicitTitle;
                                    }
                                }
                                updateHistoryImmediate(explicitTitle, commandBaseContent, taskVariantId);
                            } catch (titleError) {
                                console.error('[NoteEditScreen] Failed to apply explicit agent title', titleError);
                            }
                            const titleStatus = t('edit.agent.updatedTitle');
                            allRecordingIds.forEach(id => {
                                setRecordingOutcomeStatus(id, titleStatus);
                                showVoiceResultStatus(titleStatus, id);
                            });
                            // Explicit title command should not mutate note content.
                            continue;
                        }

                        const agentTitle = sanitizeDisplayLabel(agentResult.suggestedTitle || '');
                        const suggestedTitleRaw = titleMatchesContextScript(
                            agentTitle,
                            `${contextContent || ''}\n${normalizedTaskText || ''}`
                        ) ? agentTitle : '';
                        const suggestedTitle = suggestedTitleRaw || deriveTitleFromText(
                            processedText || contextContent || originalText
                        );
                        const hasStableTitle =
                            !!currentTitleRef.current.trim() ||
                            !!lastSavedTitle.current.trim() ||
                            !!(existingNote?.title || '').trim();

                        if (
                            taskVariantId === 'original' &&
                            !hasApplicableInstruction &&
                            !titleLockRef.current &&
                            !hasStableTitle &&
                            suggestedTitle &&
                            localNoteIdRef.current
                        ) {
                            try {
                                await updateNote(localNoteIdRef.current, { title: suggestedTitle });
                                setTitle(suggestedTitle);
                                currentTitleRef.current = suggestedTitle;
                                lastSavedTitle.current = suggestedTitle;
                                titleLockRef.current = true;
                            } catch (titleError) {
                                console.error('[NoteEditScreen] Failed to auto-apply agent title', titleError);
                            }
                        }

                        if (hasApplicableInstruction) {
                            // The server decides append-vs-replace; guessing it from content
                            // length used to silently wipe short notes when a list was dictated.
                            const contentAction = agentResult.contentAction
                                ?? (agentResult.mode === 'edit_content' ? 'replace' : 'append');

                            let newText: string | null = null;
                            if (contentAction === 'replace') {
                                newText = processedText;
                            } else if (contentAction === 'none') {
                                newText = commandBaseContent;
                            } else {
                                const isListResult = agentResult.mode === 'todo' || agentResult.mode === 'list';
                                const duplicatesExistingStructuredBlock =
                                    isListResult &&
                                    contentAlreadyContainsStructuredListBlock(commandBaseContent, processedText);
                                // A note created by voice already holds the raw dictation. When
                                // that dictation is the whole note and the agent turns it into a
                                // list, the list replaces it instead of repeating it underneath.
                                const noteIsOnlyThisDictation =
                                    isListResult &&
                                    !!originalText &&
                                    areTextsEquivalent(richContentToPlainText(commandBaseContent), originalText);
                                newText = duplicatesExistingStructuredBlock
                                    ? commandBaseContent
                                    : noteIsOnlyThisDictation
                                        ? processedText
                                        : appendSnippetToContent(commandBaseContent, processedText);
                            }

                            if (newText !== null && !areTextsEquivalent(newText, commandBaseContent)) {
                                // Destructive results must be confirmed before anything is written.
                                if (agentResult.needsConfirmation) {
                                    const approved = await confirmAgentChange(
                                        agentResult.confirmationKind,
                                        agentResult.confirmationMessage
                                    );
                                    if (!approved) {
                                        clearTranscribedInsertionExpectation();
                                        if (hasPendingDraft) {
                                            validBatch.forEach(t => {
                                                if (t.recordingId) pendingVoiceInsertionsRef.current.delete(t.recordingId);
                                            });
                                        }
                                        await setVariantContentWithOptions(taskVariantId, commandBaseContent, {
                                            persist: true,
                                            updateHistory: false,
                                        });
                                        dictationFinalized = true;
                                        shouldFallbackToDictationOnError = false;
                                        const cancelledStatus = t('edit.agent.cancelled');
                                        allRecordingIds.forEach(id => {
                                            setRecordingOutcomeStatus(id, cancelledStatus);
                                            showVoiceResultStatus(cancelledStatus, id);
                                        });
                                        continue;
                                    }
                                }

                                clearTranscribedInsertionExpectation();
                                // Original note must never be overwritten by agent instructions:
                                // a destructive result becomes a separate improvement instead.
                                if (taskVariantId === 'original') {
                                    if (hasPendingDraft) {
                                        validBatch.forEach(t => {
                                            if (t.recordingId) pendingVoiceInsertionsRef.current.delete(t.recordingId);
                                        });
                                        replaceCurrentHistoryState(
                                            taskVariantId,
                                            resolveImprovementVariantTitle(taskVariantId),
                                            originalContentAfterCommand
                                        );
                                    }

                                    // Command phrase should not stay in original content.
                                    await setVariantContentWithOptions(taskVariantId, originalContentAfterCommand, {
                                        persist: true,
                                        updateHistory: false,
                                    });
                                    dictationFinalized = true;
                                    shouldFallbackToDictationOnError = false;

                                    const targetNoteId = localNoteIdRef.current;
                                    if (!targetNoteId) {
                                        throw new Error('Failed to resolve note ID for agent improvement');
                                    }

                                    const generatedLabel = buildAgentImprovementLabel(
                                        suggestedTitle,
                                        currentTitleRef.current || title || (existingNote?.title || ''),
                                    );
                                    const improvementTitle = generatedLabel || (existingNote?.title || '');
                                    const agentOptionId = agentOptionIdForMode(agentResult.mode);
                                    const improvement = await createImprovement(targetNoteId, {
                                        content: newText,
                                        title: improvementTitle,
                                        label: englishStepName({ id: agentOptionId }),
                                        optionId: agentOptionId,
                                    });
                                    derivedVariantBySourceRef.current[task.targetVariantId || 'original'] = improvement.id;

                                    improvementDraftsRef.current[improvement.id] = newText;
                                    improvementSavedRef.current[improvement.id] = newText;
                                    improvementTitleDraftsRef.current[improvement.id] = improvementTitle;
                                    improvementTitleSavedRef.current[improvement.id] = improvementTitle;
                                    variantHistories.current[improvement.id] = {
                                        history: [{ title: improvementTitle, content: newText }],
                                        index: 0,
                                    };

                                    // Optionally keep user on Original even when instruction produced an improvement.
                                    const shouldStayOnOriginal = !!task.preserveOriginalOnInstruction;
                                    if (activeVariantIdRef.current === 'original' && !shouldStayOnOriginal) {
                                        setActiveVariantId(improvement.id);
                                        activeVariantIdRef.current = improvement.id;
                                        optimisticActiveVariant.current = improvement.id;
                                        setTitle(improvementTitle);
                                        setContent(newText);
                                        currentContentRef.current = newText;
                                        await setActiveVariant(targetNoteId, improvement.id);
                                    }

                                    const status = t(buildAgentStatusKey(agentResult.mode, 'created'));
                                    allRecordingIds.forEach(id => {
                                        setRecordingOutcomeStatus(id, status);
                                        showVoiceResultStatus(status, id);
                                    });
                                } else {
                                    if (hasPendingDraft) {
                                        validBatch.forEach(t => {
                                            if (t.recordingId) pendingVoiceInsertionsRef.current.delete(t.recordingId);
                                        });
                                        replaceCurrentHistoryState(
                                            taskVariantId,
                                            resolveImprovementVariantTitle(taskVariantId),
                                            commandBaseContent
                                        );
                                    }
                                    const nextVariantTitle = suggestedTitle || resolveImprovementVariantTitle(taskVariantId);
                                    if (localNoteIdRef.current && nextVariantTitle) {
                                        await updateImprovement(localNoteIdRef.current, taskVariantId, {
                                            title: nextVariantTitle,
                                        });
                                        improvementTitleDraftsRef.current[taskVariantId] = nextVariantTitle;
                                        improvementTitleSavedRef.current[taskVariantId] = nextVariantTitle;
                                        if (activeVariantIdRef.current === taskVariantId) {
                                            setTitle(nextVariantTitle);
                                            currentTitleRef.current = nextVariantTitle;
                                        }
                                    }
                                    await setVariantContentWithOptions(taskVariantId, newText, {
                                        persist: true,
                                        updateHistory: true,
                                    });
                                    const status = t(buildAgentStatusKey(agentResult.mode, 'updated'));
                                    allRecordingIds.forEach(id => {
                                        setRecordingOutcomeStatus(id, status);
                                        showVoiceResultStatus(status, id);
                                    });
                                }
                            } else {
                                // Command was recognized but resulted in no effective content diff.
                                // Keep command out of the note and only clear pending marker.
                                clearTranscribedInsertionExpectation();
                                const contentAfterCommand = originalContentAfterCommand;
                                if (hasPendingDraft) {
                                    validBatch.forEach(t => {
                                        if (t.recordingId) pendingVoiceInsertionsRef.current.delete(t.recordingId);
                                    });
                                    replaceCurrentHistoryState(
                                        taskVariantId,
                                        resolveImprovementVariantTitle(taskVariantId),
                                        contentAfterCommand
                                    );
                                }
                                await setVariantContentWithOptions(taskVariantId, contentAfterCommand, {
                                    persist: true,
                                    updateHistory: false,
                                });
                                dictationFinalized = true;
                                const noChangeStatus = t('edit.agent.updatedNote');
                                allRecordingIds.forEach(id => {
                                    setRecordingOutcomeStatus(id, noChangeStatus);
                                    showVoiceResultStatus(noChangeStatus, id);
                                });
                            }
                        } else {
                            const localChecklistFallbackText = checklistMentionFallback
                                ? resolveDirectChecklistCheckFallback(
                                    commandBaseContent,
                                    originalText || normalizedTaskText
                                )
                                : null;
                            if (localChecklistFallbackText && !areTextsEquivalent(localChecklistFallbackText, commandBaseContent)) {
                                clearTranscribedInsertionExpectation();
                                if (hasPendingDraft) {
                                    validBatch.forEach(t => {
                                        if (t.recordingId) pendingVoiceInsertionsRef.current.delete(t.recordingId);
                                    });
                                    replaceCurrentHistoryState(
                                        taskVariantId,
                                        resolveImprovementVariantTitle(taskVariantId),
                                        commandBaseContent
                                    );
                                }
                                await setVariantContentWithOptions(taskVariantId, localChecklistFallbackText, {
                                    persist: true,
                                    updateHistory: true,
                                });
                                dictationFinalized = true;
                                shouldFallbackToDictationOnError = false;
                                const checklistStatus = t('edit.agent.updatedChecklist');
                                allRecordingIds.forEach(id => {
                                    setRecordingOutcomeStatus(id, checklistStatus);
                                    showVoiceResultStatus(checklistStatus, id);
                                });
                            } else {
                                await finalizeAsDictation(originalText || normalizedTaskText);
                            }
                        }
                    } else {
                        // LOGIC FAIL (e.g. backend error)
                        console.error('[NoteEditScreen] Agent processing returned fail:', agentResult.error);
                        await finalizeAsDictation(normalizedTaskText);
                        showPrettyQuotaNotification(
                            agentResult.error,
                            getErrorMessage(agentResult.error, 'Agent processing failed')
                        );
                    }
                } catch (error) {
                    console.error('[NoteEditScreen] Agent flow exception:', error);
                    if (shouldFallbackToDictationOnError) {
                        await finalizeAsDictation(normalizedTaskText);
                    }
                    showPrettyQuotaNotification(
                        error,
                        getErrorMessage(error, 'An error occurred during agent processing')
                    );
                } finally {
                    activeAgentTasksRef.current = [];
                    // ALWAYS move to next task - handled by batch shift earlier
                    refreshTrackedQueueLength();
                }
            }
        } catch (outerError) {
            console.error('[NoteEditScreen] Critical queue process error:', outerError);
        } finally {
            activeAgentTasksRef.current = [];
            isProcessingQueue.current = false;
            setTrackedIsAIProcessing(false);
            refreshTrackedQueueLength();
        }
    };

    const cancelAgentTask = useCallback(async (taskId: string) => {
        const isActiveTask = activeAgentTasksRef.current.some(t => t.id === taskId);
        const queuedIndex = agentQueue.current.findIndex(t => t.id === taskId);

        if (!isActiveTask && queuedIndex === -1) {
            return; // Task not found
        }

        let taskToCancel: AgentQueueTask;

        if (isActiveTask) {
            taskToCancel = activeAgentTasksRef.current.find(t => t.id === taskId)!;

            // Remove the cancelled task from the batch
            const remainingActiveTasks = activeAgentTasksRef.current.filter(t => t.id !== taskId);

            // Re-queue the remaining items to let them process after we interrupt the active session
            const remainingQueueTasks = [...agentQueue.current];

            // Invalidate current in-flight session and clear queue immediately.
            agentSessionIdRef.current += 1;
            setRequestHistory([]);
            requestHistoryRef.current = [];
            agentQueue.current = [];
            activeAgentTasksRef.current = [];
            refreshTrackedQueueLength();
            setTrackedIsAIProcessing(false);

            // Push the remaining tasks back into the queue so they aren't lost
            if (remainingActiveTasks.length > 0 || remainingQueueTasks.length > 0) {
                // Wait a tiny bit for React state to settle before restarting the queue
                setTimeout(() => {
                    agentQueue.current = [...remainingActiveTasks, ...remainingQueueTasks];
                    refreshTrackedQueueLength();
                    processAgentQueue();
                }, 100);
            }
        } else {
            // Task is just sitting in the queue, hasn't started yet. 
            // Just splice it out.
            const removed = agentQueue.current.splice(queuedIndex, 1);
            taskToCancel = removed[0];
            refreshTrackedQueueLength();
        }

        // Apply dictation for the cancelled task
        const normalizedTaskText = taskToCancel.transcribedText?.trim() || '';
        if (normalizedTaskText && (!taskToCancel.noteId || taskToCancel.noteId === localNoteIdRef.current)) {
            const taskVariantId = resolveTaskTargetVariantId(taskToCancel);
            const pendingContext = resolvePendingInsertionContext(taskVariantId, taskToCancel.recordingId);
            const shouldSkipDictationApply = !!taskToCancel.dictationAlreadyApplied && !pendingContext.pending;

            if (!shouldSkipDictationApply) {
                try {
                    const inserted = await finalizePendingInsertionAsDictation(
                        taskVariantId,
                        taskToCancel.recordingId,
                        normalizedTaskText
                    );
                    if (inserted) {
                        const status = taskVariantId === 'original' ? 'Added to Original' : 'Added to Improved';
                        setRecordingOutcomeStatus(taskToCancel.recordingId, status);
                        showVoiceResultStatus(status, taskToCancel.recordingId);
                    }
                } catch (error) {
                    console.error('[NoteEditScreen] Failed to finalize dictation after individual task cancel', error);
                }
            }
        }
    }, [
        finalizePendingInsertionAsDictation,
        processAgentQueue,
        refreshTrackedQueueLength,
        resolveTaskTargetVariantId,
        resolvePendingInsertionContext,
        setRecordingOutcomeStatus,
        setTrackedIsAIProcessing,
        showVoiceResultStatus,
    ]);

    const shouldUseAgentModeGlobally = useCallback(
        async (agentModeOverride?: boolean): Promise<boolean> => {
            if (typeof agentModeOverride === 'boolean') {
                return agentModeOverride;
            }
            return await getAgentModeEnabled();
        },
        [],
    );

    useFocusEffect(
        useCallback(() => {
            let active = true;
            void (async () => {
                const [enabled, provider] = await Promise.all([
                    shouldUseAgentModeGlobally(),
                    getAIProvider(),
                ]);
                if (active) {
                    setAgentModeIndicatorEnabled(enabled);
                    setCurrentAIProvider(provider);
                }
            })();
            return () => {
                active = false;
            };
        }, [shouldUseAgentModeGlobally]),
    );

    const executeAgentFlow = async (
        transcribedText: string,
        options?: {
            isBackground?: boolean;
            targetVariantId?: string;
            recordingId?: string;
            micMode?: MicInputMode;
            agentContextContent?: string;
            preserveOriginalOnInstruction?: boolean;
            dictationAlreadyApplied?: boolean;
        }
    ) => {
        const shouldUseAgentMode = await shouldUseAgentModeGlobally();
        const targetVariantId = options?.targetVariantId ?? activeVariantIdRef.current;
        const normalizedText = transcribedText.trim();

        if (!normalizedText) {
            return;
        }

        if (!shouldUseAgentMode) {
            const inserted = await finalizePendingInsertionAsDictation(
                targetVariantId,
                options?.recordingId,
                normalizedText
            );
            if (inserted) {
                const status = targetVariantId === 'original' ? 'Added to Original' : 'Added to Improved';
                setRecordingOutcomeStatus(options?.recordingId, status);
                showVoiceResultStatus(status, options?.recordingId);
            }
            return;
        }

        const hasPendingAgentWork =
            isProcessingQueue.current ||
            activeAgentTasksRef.current.length > 0 ||
            agentQueue.current.length > 0;
        if (!hasPendingAgentWork) {
            derivedVariantBySourceRef.current = {};
        }

        const taskId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const newTask: AgentQueueTask = {
            id: taskId,
            transcribedText: normalizedText,
            sessionId: agentSessionIdRef.current,
            noteId: localNoteIdRef.current,
            targetVariantId,
            agentContextContent: options?.agentContextContent,
            followLatestDerivedVariant: hasPendingAgentWork,
            micMode: options?.micMode ?? 'agent',
            recordingId: options?.recordingId,
            recordingIds: options?.recordingId ? [options?.recordingId] : undefined,
            isBackground: options?.isBackground ?? false,
            preserveOriginalOnInstruction: options?.preserveOriginalOnInstruction ?? false,
            dictationAlreadyApplied: options?.dictationAlreadyApplied ?? false,
        };
        agentQueue.current.push(newTask);
        console.log(`[NoteEditScreen] Enqueued agent task ${taskId} (queue=${getPendingTaskCount(agentQueue.current)})`);

        refreshTrackedQueueLength();
        void processAgentQueue();
    };


    const handleRecordingFinish = async (
        recording: AudioRecording,
        transcribe: boolean = true,
        micMode: MicInputMode = 'agent',
        agentModeEnabled?: boolean
    ) => {
        setShowVoiceRecorder(false);
        setIsRecordingFlowActive(true);
        try {
            const targetVariantId = activeVariantIdRef.current;
            const wasNewNoteCreation = !localNoteIdRef.current;
            const targetVariantContentAtStart = resolveVariantContent(targetVariantId);
            const provider = await getAIProvider();
            const onDeviceTranscription = await isOnDeviceTranscriptionActive();
            const isUserTranscriptionRestricted = (!isAuthenticated || isGuest) && provider === 'vaulto_ai' && !onDeviceTranscription && !isProtectedRef.current;
            const protectedNote = isProtectedRef.current;
            // The agent sends the text to the server: never for a protected note.
            const onDeviceProvider = provider === 'local' || provider === 'local_llm' || provider === 'local_whisper';
            const shouldUseAgentModeForThisRecording =
                !protectedNote && !onDeviceProvider && micMode !== 'force_text' && await shouldUseAgentModeGlobally(agentModeEnabled);
            let shouldTranscribe = transcribe;
            if (isUserTranscriptionRestricted && shouldTranscribe) {
                // Anonymous users can't transcribe; keep audio flow intact.
                shouldTranscribe = false;
                // Offer the free on-device route instead of only asking to sign in.
                if (LOCAL_WHISPER_ENABLED) {
                    setTimeout(() => { void offerOnDeviceTranscription('guest'); }, 900);
                } else if (micMode === 'force_text') {
                    setShowTranscriptionAuthModal(true);
                }
            }
            if (shouldTranscribe && !onDeviceTranscription && !protectedNote) {
                const consentGranted = await requestPrivateAIConsent();
                if (!consentGranted) {
                    shouldTranscribe = false;
                }
            }

            let transcription: { success: boolean; text: string; error?: string } = { success: false, text: '' };
            let isTranscriptionSuccess = false;
            let transcribedText = '';
            const voiceId = Date.now().toString() + Math.random().toString(36).substring(2);
            let insertedPlainTextEarly = false;
            let insertedPendingEarly = false;

            // 1. TRY TO TRANSCRIBE (But don't fail if it doesn't work)
            try {
                if (!shouldTranscribe) {
                    // Skip transcription if user opted out
                    console.log('[NoteEditScreen] Transcription skipped (Toggle OFF)');
                    transcription = { success: false, text: '', error: 'Transcription disabled' };
                } else {
                    setTrackedIsTranscribing(true);
                    transcription = await transcribeAudio(recording.uri, undefined, { onDeviceOnly: protectedNote });
                    if (transcription.error === ON_DEVICE_MODEL_REQUIRED) {
                        promptOnDeviceModelForProtected();
                    }
                }
            } catch (err) {
                console.error('[NoteEditScreen] Transcription unexpected error:', err);
                transcription = { success: false, text: '', error: 'Unexpected transcription error' };
            } finally {
                setTrackedIsTranscribing(false);
            }

            isTranscriptionSuccess = transcription.success && !!transcription.text;
            transcribedText = isTranscriptionSuccess ? transcription.text : '';

            // Refresh profile to update balance in UI after deduction
            if (isTranscriptionSuccess) {
                refreshProfile?.().catch(() => {});
                if (!onDeviceTranscription && !protectedNote) {
                    void incrementRecordingsCount().then((count) => {
                        if (count >= 3) {
                            setTimeout(() => { void offerOnDeviceTranscription('suggest'); }, 1500);
                        }
                    });
                }
            }

            const shouldBypassAgentForThisRecording = micMode === 'force_text';
            if (isTranscriptionSuccess) {
                if (shouldBypassAgentForThisRecording || !shouldUseAgentModeForThisRecording) {
                    insertedPlainTextEarly = await applyPlainTextToVariant(targetVariantId, transcribedText);
                    if (insertedPlainTextEarly) {
                        registerTranscribedInsertion(transcribedText);
                    }
                }
            }

            // Show informative message if transcription failed (but don't block saving)
            if (!isTranscriptionSuccess) {
                const errorMsg = transcription.error ? getErrorMessage(transcription.error, '') : '';
                const errorMsgLower = errorMsg.toLowerCase();
                const rawErrorLower = (transcription.error || '').toLowerCase();
                // Auto-insert audio player when there is no transcription (e.g., failed, disabled, or due to limits).
                const isAuthOrQuotaError =
                    isUserTranscriptionRestricted ||
                    errorMsgLower.includes('sign in') ||
                    errorMsgLower.includes('trial limit') ||
                    errorMsgLower.includes('authentication') ||
                    errorMsgLower.includes('quota') ||
                    errorMsgLower.includes('credit') ||
                    errorMsgLower.includes('403') ||
                    rawErrorLower.includes('403') ||
                    rawErrorLower.includes('insufficient_quota') ||
                    rawErrorLower.includes('quota') ||
                    rawErrorLower.includes('trial') ||
                    rawErrorLower === 'transcription disabled' ||
                    errorMsgLower === 'transcription disabled' ||
                    // Protected note without the on-device model: its own prompt explains.
                    transcription.error === ON_DEVICE_MODEL_REQUIRED;

                if (isAuthOrQuotaError) {
                    // Silent failure for auth/guest errors - audio is still saved
                    console.log('[Transparency] Transcription skipped due to auth/guest status');
                } else if (errorMsg) {
                    console.warn('[Transcription] Failed but audio will be saved:', errorMsg);
                    showPrettyQuotaNotification(transcription.error, 'Transcription Failed');
                }
            }

            // Wait for any pending creation to finish
            while (isCreatingNote.current) {
                await new Promise(r => setTimeout(r, 100));
            }

            let currentNoteId = localNoteIdRef.current;

            // 2. SAVE AUDIO (ALWAYS)
            const savedPath = await AudioService.saveAudioFile(
                recording.uri,
                true
            );
            const recordingTranscription = transcribedText || undefined;

            // Ensure Note Exists (Create if not)
            if (!currentNoteId) {
                try {
                    const titleToUse = currentTitleRef.current.trim();
                    const newNote = await createNote({
                        title: titleToUse,
                        content: currentContentRef.current,
                        audio: {
                            filePath: savedPath,
                            duration: recording.duration,
                            transcription: recordingTranscription,
                        },
                        storage_scope: storageScope,
                        is_protected: isProtectedRef.current,
                        privacy,
                    });
                    setLocalNoteId(newNote.id);
                    localNoteIdRef.current = newNote.id;
                    syncTrackedProcessingToNote(newNote.id);
                    bindCreatedDraftToRoute(newNote.id);
                    currentNoteId = newNote.id;
                    lastSavedTitle.current = currentTitleRef.current;
                    lastSavedContent.current = stripAudioEmbedsFromRichContent(currentContentRef.current);
                    await handleCreatedNoteAutoScale(newNote.id, currentContentRef.current);
                } catch (e) {
                    console.error('Failed to create note for voice:', e);
                    // Critical: avoid orphan ciphertext files when note creation fails.
                    await AudioService.deleteAudioFile(savedPath).catch(() => undefined);
                    setErrorMessage('Failed to save note');
                    setErrorShowSettingsAction(false);
                    setErrorModalVisible(true);
                    return;
                }
            }

            // Save Metadata to DB
            const voiceRecording: VoiceRecording = {
                id: voiceId,
                note_id: currentNoteId,
                file_path: savedPath,
                duration: recording.duration,
                transcription: recordingTranscription,
                created_at: new Date().toISOString(),
            }
            if (userId) {
                await saveVoiceRecordingLocal(userId, voiceRecording);
            } else {
                console.warn('[NoteEditScreen] No user ID, strictly local recording might be lost on exit');
            }

            // Reload from DB to ensure consistency and correct order
            const updatedRecs = userId ? await getVoiceRecordingsLocal(userId, currentNoteId) : [];
            setVoiceRecordings(updatedRecs);

            // ALWAYS update the parent note to indicate it has audio
            // This ensures the microphone icon appears in the list view
            await updateNote(currentNoteId, {
                content: resolveOriginalNoteContentForPersistence(),
                has_audio: true,
                ...(transcribedText ? { encrypted_transcription: transcribedText } : {})
            });
            setPlayingRecordingId(null);

            // 4. STOP IF NO TEXT
            if (!isTranscriptionSuccess) {
                await appendAudioEmbedToVariant(targetVariantId, savedPath, recording.duration);
                const status = 'Saved recording (no text)';
                setRecordingOutcomeStatus(voiceId, status);
                showVoiceResultStatus(status, voiceId);
                return;
            }

            if (wasNewNoteCreation && targetVariantId === 'original' && !shouldBypassAgentForThisRecording && shouldUseAgentModeForThisRecording) {
                const inserted = insertedPlainTextEarly
                    ? true
                    : await applyPlainTextToVariant('original', transcribedText);

                const status = inserted ? 'Added to Original' : 'Saved recording';
                setRecordingOutcomeStatus(voiceId, status);
                showVoiceResultStatus(status, voiceId);
                setRecordingOutcomeStatus(voiceId, 'Processing...');
                await executeAgentFlow(transcribedText, {
                    isBackground: true,
                    targetVariantId: 'original',
                    recordingId: voiceId,
                    micMode,
                    agentContextContent: targetVariantContentAtStart,
                    dictationAlreadyApplied: inserted,
                });
                return;
            }

            const normalizedTranscript = normalizeTextForComparison(transcribedText);
            if (normalizedTranscript && (shouldBypassAgentForThisRecording || !shouldUseAgentModeForThisRecording)) {
                const initialPlainText = normalizeTextForComparison(
                    richContentToPlainText(targetVariantContentAtStart)
                );
                const currentPlainText = normalizeTextForComparison(
                    richContentToPlainText(resolveVariantContent(targetVariantId))
                );
                const initialOccurrences = countNormalizedOccurrences(initialPlainText, normalizedTranscript);
                const currentOccurrences = countNormalizedOccurrences(currentPlainText, normalizedTranscript);

                if (currentOccurrences <= initialOccurrences) {
                    const insertedAfterSave = await applyPlainTextToVariant(targetVariantId, transcribedText);
                    if (insertedAfterSave) {
                        insertedPlainTextEarly = true;
                        registerTranscribedInsertion(transcribedText);
                    }
                }
            }

            if (shouldBypassAgentForThisRecording || !shouldUseAgentModeForThisRecording) {
                const inserted = insertedPlainTextEarly
                    ? true
                    : await applyPlainTextToVariant(targetVariantId, transcribedText);
                if (inserted) {
                    if (!insertedPlainTextEarly) {
                        registerTranscribedInsertion(transcribedText);
                    }
                    const status = targetVariantId === 'original' ? 'Added to Original' : 'Added to Improved';
                    setRecordingOutcomeStatus(voiceId, status);
                    showVoiceResultStatus(status, voiceId);
                } else {
                    const status = 'Saved recording';
                    setRecordingOutcomeStatus(voiceId, status);
                    showVoiceResultStatus(status, voiceId);
                }
                return;
            }

            if (!insertedPendingEarly && !insertedPlainTextEarly) {
                insertedPendingEarly = await insertPendingTranscriptionToVariant(targetVariantId, voiceId, transcribedText);
            }

            setRecordingOutcomeStatus(voiceId, 'Processing...');
            await executeAgentFlow(transcribedText, {
                isBackground: true,
                targetVariantId,
                recordingId: voiceId,
                micMode,
                dictationAlreadyApplied: false,
            });
        } finally {
            setIsRecordingFlowActive(false);
        }
    };

    const handleInstructionRecordingFinish = async (recording: AudioRecording) => {
        setShowVoiceRecorder(false);
        // Don't close AI modal, just fill the input

        // Show local loading state if needed, or re-use isTranscribing but that shows a global spinner
        // Let's use isAIProcessing to block interaction while transcribing instruction
        const provider = await getAIProvider();
        if ((!isAuthenticated || isGuest) && provider === 'vaulto_ai') {
            setShowTranscriptionAuthModal(true);
            await AudioService.deleteAudioFile(recording.uri).catch(() => undefined);
            setIsRecordingInstruction(false);
            return;
        }
        setTrackedIsAIProcessing(true);

        try {
            const consentGranted = await requestPrivateAIConsent();
            if (!consentGranted) {
                return;
            }
            const transcription = await transcribeAudio(recording.uri, undefined, { onDeviceOnly: isProtectedRef.current });
            await AudioService.deleteAudioFile(recording.uri);

            if (transcription.success && transcription.text) {
                setCustomInstruction(transcription.text);
            } else {
                showPrettyQuotaNotification(
                    transcription.error,
                    getErrorMessage(transcription.error, 'Could not recognize speech')
                );
            }
        } catch (error) {
            console.error('Instruction transcription failed:', error);
            showPrettyQuotaNotification(error, 'Failed to transcribe instruction');
        } finally {
            setTrackedIsAIProcessing(false);
            setIsRecordingInstruction(false);
        }
    };

    const handleApplyCustomInstruction = () => {
        if (!customInstruction.trim()) return;

        const customOption: AIImprovementOption = {
            id: 'custom_instruction',
            label: 'Custom Instruction',
            icon: 'edit',
            prompt: ensureTemplateHasPlaceholder(customInstruction),
            isCustom: true
        };

        handleAIImprovement(customOption);
    };

    const handleVoiceInstructionStart = async () => {
        const provider = await getAIProvider();
        if ((!isAuthenticated || isGuest) && provider === 'vaulto_ai') {
            setShowTranscriptionAuthModal(true);
            return;
        }
        setIsRecordingInstruction(true);
        setShowCustomInput(true);
        setShowVoiceRecorder(true);
    };

    const openRecordingTextView = (recording: VoiceRecording) => {
        setSelectedRecordingForText(recording);
        setShowRecordingTextModal(true);
    };

    const handleInsertSelectedRecordingText = useCallback(async () => {
        const selected = selectedRecordingForText;
        const recognizedText = selected?.transcription?.trim() || '';
        if (!selected || !recognizedText) {
            Alert.alert(t('alerts.noTranscriptTitle', 'No text yet'), t('alerts.noTranscriptText', 'This recording has not been transcribed yet.'));
            return;
        }

        const targetVariant = activeVariantIdRef.current;

        const inserted = await applyPlainTextToVariant(targetVariant, recognizedText);
        if (!inserted) return;

        const status = targetVariant === 'original' ? 'Added to Original' : 'Added to Improved';
        setRecordingOutcomeStatus(selected.id, status);
        showVoiceResultStatus(status, selected.id);
        setReparseTrigger(prev => prev + 1);
        setShowRecordingTextModal(false);
    }, [applyPlainTextToVariant, selectedRecordingForText, setRecordingOutcomeStatus, showVoiceResultStatus]);

    const handleCopySelectedRecordingText = useCallback(async () => {
        const selected = selectedRecordingForText;
        const recognizedText = selected?.transcription?.trim() || '';
        if (!recognizedText) {
            Alert.alert(t('alerts.noTranscriptTitle', 'No text yet'), t('alerts.noTranscriptText', 'This recording has not been transcribed yet.'));
            return;
        }
        await Clipboard.setStringAsync(recognizedText);
        showVoiceResultStatus('Copied transcript', selected?.id);
    }, [selectedRecordingForText, showVoiceResultStatus]);

    /**
     * Ends the current dictation session. Whisper re-emits the whole transcript on
     * every update, so only the final one is written to the note.
     */
    const stopRealtimeDictation = useCallback(async (persist: boolean) => {
        const stop = realtimeDictationStopRef.current;
        const session = dictationSessionRef.current;
        if (!stop && !session) {
            return;
        }

        realtimeDictationStopRef.current = null;
        dictationSessionRef.current = null;
        setIsRealtimeDictating(false);

        if (stop) {
            await stop().catch(() => undefined);
        }

        if (persist && session?.latestTranscript) {
            await setVariantContentWithOptions(
                session.variantId,
                composeDictatedContent(session.baseText, session.latestTranscript),
                { persist: true },
            );
        }
    }, [setVariantContentWithOptions]);

    const startRealtimeDictationSession = useCallback(async () => {
        const hasPermission = await AudioService.requestPermissions();
        if (!hasPermission) {
            Alert.alert(
                t('common.errorTitle'),
                t('edit.dictation.permissionDenied', 'Microphone access is required for dictation.'),
            );
            return;
        }

        const variantId = activeVariantIdRef.current;
        const session = {
            variantId,
            baseText: resolveVariantContent(variantId) || '',
            latestTranscript: '',
        };
        dictationSessionRef.current = session;
        // Record the text as it was before dictating, so Undo can take the
        // dictated words back out (dictation writes once, when it stops).
        const history = variantHistories.current[variantId];
        if (!history || history.history[history.index]?.content !== session.baseText) {
            updateHistoryImmediate(currentTitleRef.current, session.baseText, variantId);
        }
        setIsRealtimeDictating(true);

        try {
            const storedLanguage = await getTranscriptionLanguage();
            const job = await startRealtimeDictation({
                language: storedLanguage,
                onTranscript: (text) => {
                    const current = dictationSessionRef.current;
                    if (current !== session) return;
                    session.latestTranscript = text;
                    // Live preview only: the note is written once, when dictation stops.
                    void setVariantContentWithOptions(
                        session.variantId,
                        composeDictatedContent(session.baseText, text),
                        { persist: false, updateHistory: false },
                    );
                },
                onEnd: (error) => {
                    void stopRealtimeDictation(true);
                    if (error) {
                        Alert.alert(
                            t('edit.dictation.errorTitle', 'Dictation Error'),
                            error,
                        );
                    }
                },
            });
            if (dictationSessionRef.current !== session) {
                // Stopped while the engine was still starting up - do not leave the mic on.
                void job.stop();
                return;
            }
            realtimeDictationStopRef.current = job.stop;
        } catch (e: any) {
            dictationSessionRef.current = null;
            setIsRealtimeDictating(false);
            const msg = e?.message || '';
            if (msg.includes('is not downloaded') || msg.includes('download')) {
                setShowLocalWhisperModal(true);
            } else {
                Alert.alert(
                    t('edit.dictation.errorTitle', 'Dictation Error'),
                    msg || t('edit.dictation.startFailed', 'Failed to start dictation'),
                );
            }
        }
    }, [resolveVariantContent, setVariantContentWithOptions, stopRealtimeDictation, t]);

    // The rich editor is memoised, so these have to keep a stable identity;
    // inline arrows here would re-render the WebView host on every screen render.
    const handleVisualSelectionChange = useCallback((selection: { start: number; end: number }) => {
        visualSelectionRef.current = selection;
    }, []);

    // Tiptap refocuses the editor while applying a checkbox toggle, and that
    // focus report can arrive after the idle-toggle signal below.
    const ignoreEditorFocusUntilRef = useRef(0);
    const handleVisualEditorFocus = useCallback(() => {
        if (Date.now() < ignoreEditorFocusUntilRef.current) {
            editorRef.current?.blur();
            return;
        }
        visualEditorFocusedRef.current = true;
        setIsEditing(true);
    }, []);

    const handleVisualEditorBlur = useCallback(() => {
        visualEditorFocusedRef.current = false;
    }, []);

    // Ticking a checkbox while reading is not a request to start editing.
    const handleChecklistToggledWhileIdle = useCallback(() => {
        ignoreEditorFocusUntilRef.current = Date.now() + 600;
        visualEditorFocusedRef.current = false;
        Keyboard.dismiss();
        setIsEditing(false);
    }, []);

    const handleFormat = useCallback(async (type: MarkdownFormatType) => {
        if (type === 'dictate') {
            if (!LOCAL_WHISPER_ENABLED) return;

            if (isRealtimeDictating) {
                await stopRealtimeDictation(true);
            } else {
                await startRealtimeDictationSession();
            }
            return;
        }
        editorRef.current?.handleFormat(type);
    }, [isRealtimeDictating, startRealtimeDictationSession, stopRealtimeDictation]);

    // Leaving the screen must not leave the microphone and the Whisper job running.
    useEffect(() => {
        return () => {
            void realtimeDictationStopRef.current?.();
            realtimeDictationStopRef.current = null;
            dictationSessionRef.current = null;
        };
    }, []);

    const handleCheckPress = useCallback(() => {
        setIsColorPickerVisible(false);
        setIsEditing(false);

        prepareEditorSnapshotForExit()
            .then(() => saveNote())
            .catch(error => {
                console.error('Error during manual save:', error);
            });
    }, [prepareEditorSnapshotForExit, saveNote]);

    /**
     * Runs one improvement request and returns the text to apply, or null when the
     * model reports nothing worth changing. Does not touch the note.
     */
    const generateImprovement = useCallback(async (
        option: AIImprovementOption,
        sourceText: string,
    ): Promise<string | null> => {
        const improvedText = await improveText(sourceText, option);

        if (optionExpectsJson(option)) {
            try {
                let jsonString = improvedText;
                const jsonStart = improvedText.indexOf('{');
                const jsonEnd = improvedText.lastIndexOf('}');
                if (jsonStart !== -1 && jsonEnd !== -1) {
                    jsonString = improvedText.substring(jsonStart, jsonEnd + 1);
                }
                const jsonRes = JSON.parse(jsonString);

                if (jsonRes.is_correct) {
                    return null;
                }
                // `corrected_text` covers models that hallucinate the older key name.
                const fixed = jsonRes.fixed_text || jsonRes.corrected_text;
                if (typeof fixed === 'string' && fixed.trim()) {
                    return areTextsEquivalent(sourceText, fixed) ? null : fixed;
                }
                return null;
            } catch (e) {
                // Not JSON after all. Only reuse the raw answer when it actually
                // differs from the source, so chatty replies cannot corrupt the note.
                console.warn('Failed to parse grammar correction JSON', e);
                return areTextsEquivalent(sourceText, improvedText) ? null : improvedText;
            }
        }

        return areTextsEquivalent(sourceText, improvedText) ? null : improvedText;
    }, []);

    const handleAIImprovement = async (option: AIImprovementOption) => {
        setShowAIModal(false);
        setTrackedIsAIProcessing(true);
        setActiveImprovementTask({
            id: 'improvement-' + Date.now(),
            text: getLocalizedPresetLabel(option, t) || t('edit.improvePreview.working'),
            isTranscribing: false,
        });
        // The version the preset runs on: the original unless the user chose the open version.
        const variantAtRequestStart = activeVariantIdRef.current !== 'original' && improveSource === 'current'
            ? activeVariantIdRef.current
            : 'original';
        try {
            const consentGranted = await requestPrivateAIConsent();
            if (!consentGranted) {
                return;
            }
            const sourceRichText = variantAtRequestStart === activeVariantIdRef.current
                ? content
                : resolveVariantContent(variantAtRequestStart);
            const sourceText = richContentToPlainText(sourceRichText).trim();
            if (!sourceText) {
                Alert.alert(t('edit.improvePreview.title'), t('edit.improvePreview.emptyText'));
                return;
            }

            const finalText = await generateImprovement(option, sourceText);
            if (finalText === null) {
                showToast(
                    optionExpectsJson(option)
                        ? `✨ ${t('edit.improvePreview.grammarPerfect')}`
                        : t('edit.improvePreview.noChanges'),
                    3000
                );
                return;
            }

            // Nothing is written yet: the user reviews the result and decides.
            setImprovementPreview({
                option,
                sourceText,
                resultText: finalText,
                variantId: variantAtRequestStart,
            });
        } catch (error: any) {
            const prettyMessage = getErrorMessage(error, 'Failed to improve text. Check AI settings.');
            showPrettyQuotaNotification(error, prettyMessage);
        } finally {
            setTrackedIsAIProcessing(false);
            setActiveImprovementTask(null);
        }
    };

    /** Persists an improvement the user accepted in the preview. */
    const commitImprovement = async (
        option: AIImprovementOption,
        finalText: string,
        variantAtRequestStart: string,
    ) => {
        finalText = normalizeModelMarkdownForEditor(finalText);
        setTrackedIsAIProcessing(true);
        try {
            // Wait for any pending creation to finish
            while (isCreatingNote.current) {
                await new Promise(r => setTimeout(r, 100));
            }

            let targetNoteId = localNoteId;
            if (!targetNoteId) {
                const newNote = await createNote({
                    title,
                    content: content,
                    storage_scope: storageScope,
                    is_protected: isProtectedRef.current,
                    privacy,
                });
                targetNoteId = newNote.id;
                setLocalNoteId(newNote.id);
                localNoteIdRef.current = newNote.id;
                syncTrackedProcessingToNote(newNote.id);
                bindCreatedDraftToRoute(newNote.id);
                lastSavedTitle.current = title;
                lastSavedContent.current = stripAudioEmbedsFromRichContent(content);
                await handleCreatedNoteAutoScale(newNote.id, content);
            } else if (activeVariantIdRef.current === 'original') {
                await saveNote();
            } else {
                await saveImprovementDraft();
            }

            if (!targetNoteId) {
                throw new Error('Failed to resolve note ID for improvement');
            }

            // Check if we're on the original note or a child variant
            console.log('[NoteEditScreen] Applying improvement');

            // Every accepted result becomes a new version; the source is never overwritten.
            const improvementTitle = (deriveTitleFromText(finalText) || title || existingNote?.title || '').trim();
            const sourceStepLabel = variantAtRequestStart === 'original'
                ? ''
                : storedStepLabelOf(noteImprovements.find((imp) => imp.id === variantAtRequestStart), aiOptionsById);
            const improvementLabel = buildLineageLabel(sourceStepLabel, englishStepName(option));
            const improvement = await createImprovement(targetNoteId, {
                content: finalText,
                title: improvementTitle,
                label: improvementLabel || undefined,
                optionId: option.id,
            });
            improvementDraftsRef.current[improvement.id] = finalText;
            improvementSavedRef.current[improvement.id] = finalText;
            improvementTitleDraftsRef.current[improvement.id] = improvementTitle;
            improvementTitleSavedRef.current[improvement.id] = improvementTitle;
            variantHistories.current[improvement.id] = {
                history: [{ title: improvementTitle, content: finalText }],
                index: 0
            };

            setActiveVariantId(improvement.id);
            activeVariantIdRef.current = improvement.id;
            optimisticActiveVariant.current = improvement.id;
            setTitle(improvementTitle);
            setContent(finalText);
            currentContentRef.current = finalText;
            setReparseTrigger(prev => prev + 1);
            // Persist active variant asynchronously after optimistic switch to avoid UI fallback flicker.
            await setActiveVariant(targetNoteId, improvement.id);

            // Refresh profile to update balance in UI after deduction
            refreshProfile?.().catch(() => {});
        } catch (error: any) {
            const prettyMessage = getErrorMessage(error, 'Failed to improve text. Check AI settings.');
            showPrettyQuotaNotification(error, prettyMessage);
        } finally {
            setTrackedIsAIProcessing(false);
            setActiveImprovementTask(null);
        }
    };

    // Deliberately not memoized: commitImprovement closes over note state that can
    // change while the preview is open, and a stale closure would write the wrong note.
    const handlePreviewAccept = async () => {
        const preview = improvementPreview;
        if (!preview) return;
        setImprovementPreview(null);
        await commitImprovement(preview.option, preview.resultText, preview.variantId);
    };

    const handlePreviewDiscard = useCallback(() => {
        setImprovementPreview(null);
    }, []);

    const handlePreviewRetry = useCallback(async () => {
        const preview = improvementPreview;
        if (!preview) return;

        setIsPreviewRegenerating(true);
        try {
            const nextText = await generateImprovement(preview.option, preview.sourceText);
            if (nextText === null) {
                setImprovementPreview(null);
                showToast(t('edit.improvePreview.noChanges'), 3000);
                return;
            }
            setImprovementPreview({ ...preview, resultText: nextText });
            refreshProfile?.().catch(() => {});
        } catch (error: any) {
            showPrettyQuotaNotification(
                error,
                getErrorMessage(error, 'Failed to improve text. Check AI settings.')
            );
        } finally {
            setIsPreviewRegenerating(false);
        }
    }, [improvementPreview, generateImprovement, refreshProfile, t]);

    const handleReorderEnd = async (data: AIImprovementOption[]) => {
        setAiOptions(data);
        await saveImprovementOptions(data);
    };

    const handleDeletePrompt = (id: string) => {
        Alert.alert(
            t('alerts.deletePromptTitle', 'Delete this prompt?'),
            t('alerts.deletePromptText', 'It will be removed from your list.'),
            [
                { text: t('common.cancel', 'Cancel'), style: 'cancel' },
                {
                    text: t('common.delete', 'Delete'),
                    style: 'destructive',
                    onPress: async () => {
                        const updated = aiOptions.filter(opt => opt.id !== id);
                        setAiOptions(updated);
                        await saveImprovementOptions(updated);
                    }
                }
            ]
        );
    };

    const handleCreatePrompt = async () => {
        if (!newPromptTitle.trim() || !newPromptTemplate.trim()) {
            return;
        }

        const preparedTemplate = ensureTemplateHasPlaceholder(newPromptTemplate.trim());

        const newOption: AIImprovementOption = {
            id: `custom-${Date.now()}`,
            label: newPromptTitle.trim(),
            prompt: preparedTemplate,
            icon: newPromptIcon,
            isCustom: true,
        };

        const updated = [...aiOptions, newOption];
        setAiOptions(updated);
        await saveImprovementOptions(updated);
        closePromptBuilder();
    };

    const templateWithPlaceholder = useMemo(
        () => ensureTemplateHasPlaceholder(newPromptTemplate),
        [newPromptTemplate]
    );

    const renderTemplateWithPlaceholder = (template: string) => {
        if (!template.trim()) {
            return <Text style={styles.promptPreviewPlaceholder}>{t('edit.promptTextPlaceholder', 'Prompt text')}</Text>;
        }

        const normalized = ensureTemplateHasPlaceholder(template);
        if (normalized.includes('{text}')) {
            const segments = normalized.split(/{text}/gi);
            return (
                <Text style={styles.promptPreviewText}>
                    {segments.map((segment, index) => (
                        <React.Fragment key={`${segment} - ${index} `}>
                            {segment.length > 0 && <Text style={styles.promptPreviewText}>{segment}</Text>}
                            {index < segments.length - 1 && (
                                <Text style={styles.promptPlaceholderToken}>{'{text}'}</Text>
                            )}
                        </React.Fragment>
                    ))}
                </Text>
            );
        }

        return <Text style={styles.promptPreviewText}>{normalized}</Text>;
    };

    const renderPromptPreview = () => renderTemplateWithPlaceholder(templateWithPlaceholder);
    const renderOptionPrompt = (prompt: string) => {
        const normalized = ensureTemplateHasPlaceholder(prompt);
        const segments = normalized.split(/{text}/gi);
        return (
            <Text style={styles.aiOptionPrompt} numberOfLines={1}>
                {segments.map((segment, index) => (
                    <React.Fragment key={`${segment} - ${index} `}>
                        {segment.length > 0 && <Text style={styles.aiOptionPrompt}>{segment}</Text>}
                        {index < segments.length - 1 && <Text style={styles.promptPlaceholderToken}>{'{text}'}</Text>}
                    </React.Fragment>
                ))}
            </Text>
        );
    };

    const closePromptBuilder = () => {
        setShowPromptBuilder(false);
        setNewPromptTemplate('');
        setNewPromptTitle('');
        setNewPromptIcon(ICON_CHOICES[0]);
    };

    // Format date for display
    const dateStr = existingNote?.updated_at
        ? new Date(existingNote.updated_at).toLocaleString(i18n.language, {
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        })
        : new Date().toLocaleString(i18n.language, {
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });

    const plainContent = editMode === 'visual' ? visualPlainText : richContentToPlainText(content);
    // Same rule NoteCard uses for untitled notes.
    const autoTitle = useMemo(() => deriveAutoTitleFromPlainText(plainContent), [plainContent]);
    // With a version open, an untitled note still hints the title the list shows.
    const originalAutoTitle = useMemo(
        () => (activeVariantId === 'original' ? '' : deriveAutoTitleFromPlainText(richContentToPlainText(existingNote?.content || ''))),
        [activeVariantId, existingNote?.content]
    );
    const charCount = plainContent.replace(/\r?\n/g, '').length;
    const canUseAI = plainContent.length > 0;
    const effectiveStorageScope: StorageScope = normalizeScope(storageScope);
    const canShareOrExport = effectiveStorageScope !== 'local_only' && !isProtected;
    const micHintText = t('edit.micHintHold', 'Hold: no agent');
    const floatingMicBottomOffset = editMode === 'visual' && (keyboardVisibleState || isColorPickerVisible)
        ? (keyboardVisibleState ? keyboardHeight : insets.bottom) + FLOATING_MIC_TOOLBAR_HEIGHT + FLOATING_MIC_KEYBOARD_GAP
        : FLOATING_MIC_BASE_BOTTOM_OFFSET;
    // Reserve scroll room below the content so the last line can always be
    // scrolled into view. The editor WebView/TextInput stays full-height while the
    // keyboard overlays it (edge-to-edge + adjustResize is a no-op on Android 15),
    // so when the keyboard is open we must add its height plus the docked toolbar
    // height; when it's closed we only need to clear the Android nav bar.
    // Visual mode owns the WebView padding on both platforms (the CSS wins over
    // Tentap's inline keyboard padding), so iOS visual also needs the keyboard
    // height. iOS raw mode is lifted by KeyboardAvoidingView, so only the
    // toolbar clearance is reserved there.
    const editorKeyboardInset = Platform.OS === 'android' || editMode === 'visual'
        ? keyboardHeight
        : 0;
    const editorContentBottomPadding = Math.round(
        keyboardVisibleState
            ? editorKeyboardInset
                + FLOATING_MIC_TOOLBAR_HEIGHT
                + EDITOR_CONTENT_BOTTOM_GAP
            : insets.bottom
                + (isColorPickerVisible ? FLOATING_MIC_TOOLBAR_HEIGHT : 0)
                + EDITOR_CONTENT_BOTTOM_GAP
    );
    const selectedRecordingText = selectedRecordingForText?.transcription?.trim() || '';
    const aiIndicatorVisible = isAIProcessing || queueLength > 0 || isTranscribing;

    // Handle initial recording passed from navigation
    useEffect(() => {
        if (route.params?.initialRecording) {
            handleRecordingFinish(route.params.initialRecording, route.params.initialTranscribe ?? true);
            // Clear the params to prevent double execution (e.g. from StrictMode or navigation updates)
            updateRouteParamsIfCurrent({ initialRecording: undefined, initialTranscribe: undefined });
        }
    }, [handleRecordingFinish, route.params?.initialRecording, route.params?.initialTranscribe, updateRouteParamsIfCurrent]);

    useEffect(() => {
        const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
        const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

        const showSub = Keyboard.addListener(showEvent, (event) => {
            if (visualKeyboardHideTimeoutRef.current) {
                clearTimeout(visualKeyboardHideTimeoutRef.current);
                visualKeyboardHideTimeoutRef.current = null;
            }

            const keyboardFrame = event.endCoordinates;
            const screenHeight = Dimensions.get('screen').height;
            const measuredKeyboardHeight = Platform.OS === 'android' && typeof keyboardFrame?.screenY === 'number'
                ? Math.max(0, screenHeight - keyboardFrame.screenY)
                : (keyboardFrame?.height || 0);

            keyboardVisibleRef.current = true;
            setKeyboardVisibleState(true);
            setKeyboardHeight(measuredKeyboardHeight);
            setIsEditing(true);
        });
        const hideSub = Keyboard.addListener(hideEvent, () => {
            keyboardVisibleRef.current = false;
            setKeyboardVisibleState(false);
            setKeyboardHeight(0);

            if (visualKeyboardHideTimeoutRef.current) {
                clearTimeout(visualKeyboardHideTimeoutRef.current);
            }

            if (editMode === 'visual') {
                visualKeyboardHideTimeoutRef.current = setTimeout(() => {
                    visualKeyboardHideTimeoutRef.current = null;
                    if (!keyboardVisibleRef.current && !isColorPickerVisible && !visualEditorFocusedRef.current) {
                        setIsEditing(false);
                    }
                }, 120);
                return;
            }

            if (!isColorPickerVisible) {
                setIsEditing(false);
            }
        });

        return () => {
            if (visualKeyboardHideTimeoutRef.current) {
                clearTimeout(visualKeyboardHideTimeoutRef.current);
                visualKeyboardHideTimeoutRef.current = null;
            }
            showSub.remove();
            hideSub.remove();
        };
    }, [editMode, isColorPickerVisible]);

    const handleRetryTranscription = async (recording?: VoiceRecording) => {
        const targetRecording = recording
            || voiceRecordings.find((rec) => rec.id === playingRecordingId)
            || voiceRecordings[0];
        if (!targetRecording) return;
        const provider = await getAIProvider();
        if ((!isAuthenticated || isGuest) && provider !== 'local_whisper') {
            setShowTranscriptionAuthModal(true);
            return;
        }
        const consentGranted = await requestPrivateAIConsent();
        if (!consentGranted) return;
        const shouldUseAgentModeForRetry = await shouldUseAgentModeGlobally();

        setTrackedIsTranscribing(true);
        setTranscribingRecordingId(targetRecording.id);
        setRecordingOutcomeStatus(targetRecording.id, 'Transcribing...');
        try {
            const sourceUri = await AudioService.readAudioFile(targetRecording.file_path);
            const transcription = await transcribeAudio(sourceUri);

            if (!transcription.success || !transcription.text) {
                setRecordingOutcomeStatus(targetRecording.id, 'Saved recording');
                showPrettyQuotaNotification(
                    transcription.error,
                    getErrorMessage(transcription.error, 'Check internet connection')
                );
                return;
            }

            const text = transcription.text.trim();
            if (!text) {
                setRecordingOutcomeStatus(targetRecording.id, 'Saved recording');
                setErrorMessage('Recognition returned empty text');
                setErrorShowSettingsAction(false);
                setErrorModalVisible(true);
                return;
            }

            const targetVariantId = activeVariantIdRef.current;
            const insertedEarly = !shouldUseAgentModeForRetry
                ? await applyPlainTextToVariant(targetVariantId, text)
                : await insertPendingTranscriptionToVariant(targetVariantId, targetRecording.id, text);
            if (insertedEarly && !shouldUseAgentModeForRetry) {
                registerTranscribedInsertion(text);
            }

            if (userId) {
                await saveVoiceRecordingLocal(userId, {
                    ...targetRecording,
                    transcription: text,
                });
                if (localNoteId) {
                    const refreshed = await getVoiceRecordingsLocal(userId, localNoteId);
                    setVoiceRecordings(refreshed);
                    if (selectedRecordingForText?.id) {
                        const refreshedSelected = refreshed.find((rec) => rec.id === selectedRecordingForText.id) || null;
                        setSelectedRecordingForText(refreshedSelected);
                    }
                }
            }

            if (localNoteId) {
                await updateNote(localNoteId, {
                    encrypted_transcription: text
                });
            }

            await removeAudioEmbedsForRecording(targetRecording.file_path);

            if (!shouldUseAgentModeForRetry) {
                const inserted = insertedEarly
                    ? true
                    : await applyPlainTextToVariant(targetVariantId, text);
                const status = inserted
                    ? (targetVariantId === 'original' ? 'Added to Original' : 'Added to Improved')
                    : 'Saved recording';
                setRecordingOutcomeStatus(targetRecording.id, status);
                showVoiceResultStatus(status, targetRecording.id);
                if (inserted && !insertedEarly) {
                    registerTranscribedInsertion(text);
                }
                return;
            }

            if (!insertedEarly) {
                await insertPendingTranscriptionToVariant(targetVariantId, targetRecording.id, text);
            }

            setRecordingOutcomeStatus(targetRecording.id, 'Processing...');
            await executeAgentFlow(text, {
                isBackground: false,
                targetVariantId,
                micMode: 'agent',
                recordingId: targetRecording.id,
            });

        } catch (error: any) {
            setRecordingOutcomeStatus(targetRecording.id, 'Saved recording');
            showPrettyQuotaNotification(error, 'Failed to retry transcription');
        } finally {
            setTrackedIsTranscribing(false);
            setTranscribingRecordingId(null);
        }
    };



    const formatDuration = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s < 10 ? '0' : ''}${s} `;
    };

    const handleDeleteRecording = async (id: string, path: string) => {
        setRecordingToDelete({ id, path });
    };

    const confirmDeleteRecording = async () => {
        if (!recordingToDelete) return;
        const { id, path } = recordingToDelete;
        setRecordingToDelete(null);

        // 1. Cancel any pending auto-saves to prevent race condition overwriting our changes
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        if (userId) {
            await deleteVoiceRecordingLocal(userId, id);
        }
        await AudioService.deleteAudioFile(path);

        // Calculate new list state
        const remaining = voiceRecordings.filter(r => r.id !== id);
        setVoiceRecordings(remaining);
        if (selectedRecordingForText?.id === id) {
            setSelectedRecordingForText(null);
            setShowRecordingTextModal(false);
        }

        if (remaining.length === 0) {
            clearRecordingsPreview();
        } else if (playingRecordingId === id) {
            clearRecordingsPreview();
        } else if (recordingsPreviewUri && (recordingsPreviewUri.includes(path) || path.includes(recordingsPreviewUri))) {
            clearRecordingsPreview();
        }

        if (normalizeAttachedAudioPath(inlineEditorAudioRef.current.path) === normalizeAttachedAudioPath(path)) {
            await clearInlineEditorAudio();
        }

        const variantIds = ['original', ...noteImprovements.map((improvement) => improvement.id)];
        for (const variantId of variantIds) {
            const currentVariantContent = resolveVariantContent(variantId);
            const nextVariantContent = removeAudioFromRichContent(currentVariantContent, path);
            const changed = await setVariantContentWithOptions(variantId, nextVariantContent, {
                persist: true,
                updateHistory: false,
            });

            if (changed) {
                scrubAudioFromVariantHistory(variantId, path);
            }
        }
        setReparseTrigger(prev => prev + 1);

        // 3. Update DB state if no recordings left
        if (remaining.length === 0 && localNoteId) {
            await updateNote(localNoteId, {
                has_audio: false,
                audio_file_path: '',
                audio_duration: 0,
            });

            // 4. Auto-delete check (Deferred to handleBack)
            const latestContent = currentContentRef.current;
            const isContentEmpty = !title.trim() && !hasMeaningfulRichContent(latestContent);
            if (isContentEmpty) {
                console.log('[AutoClean] Note came empty after deleting last audio. Will be auto-deleted on exit if left empty.');
            }
        } else {
            if (localNoteId) {
                await updateNote(localNoteId, {
                    audio_file_path: '',
                    audio_duration: 0,
                    has_audio: true,
                });
            }
            const latestContent = currentContentRef.current;
            updateHistory(title, latestContent);
            debouncedSave(latestContent, title);
        }
    };

    const editorHeader = useMemo(() => (
        <View>
            <HeaderTitle
                title={activeVariantId === 'original' ? title : noteTitle}
                onChange={activeVariantId === 'original' ? handleTitleChange : handleNoteTitleEditOnVariant}
                onFocus={() => setIsEditing(true)}
                inputRef={titleInputRef}
                autoTitle={activeVariantId === 'original' ? autoTitle : originalAutoTitle}
            />

            <HeaderMeta
                dateStr={dateStr}
                charCount={charCount}
            />

            <MemoizedImprovementChips
                noteImprovements={visibleImprovements}
                activeVariantId={activeVariantId}
                handleVariantSelect={handleVariantSelect}
                onRequestDelete={requestDeleteVariant}
                onOpenAllVersions={openVersionsSheet}
                optionIcons={improvementOptionIcons}
                displayLabels={variantDisplayLabels}
            />
            {showSwipeHint && visibleImprovements.length > 0 && (
                <View style={styles.swipeHint}>
                    <MaterialIcons name="swipe" size={16} color={colors.primary} />
                    <Text style={styles.swipeHintText}>{t('edit.versions.swipeHint', 'Swipe the text left or right to switch versions')}</Text>
                    <TouchableOpacity
                        onPress={dismissSwipeHint}
                        style={styles.swipeHintClose}
                        accessibilityRole="button"
                        accessibilityLabel={t('a11y.close', 'Close')}
                    >
                        <MaterialIcons name="close" size={20} color={colors.textSecondary} />
                    </TouchableOpacity>
                </View>
            )}
        </View>
    ), [
        activeVariantId,
        autoTitle,
        charCount,
        dateStr,
        handleNoteTitleEditOnVariant,
        originalAutoTitle,
        handleTitleChange,
        handleVariantSelect,
        improvementOptionIcons,
        noteTitle,
        openVersionsSheet,
        requestDeleteVariant,
        dismissSwipeHint,
        showSwipeHint,
        title,
        variantDisplayLabels,
        visibleImprovements,
    ]);

    return (
        <ScreenContainer>

            <View style={styles.header}>
                <TouchableOpacity onPress={handleBack} style={[styles.iconButton, styles.headerEdgeLeft]} accessibilityRole="button" accessibilityLabel={t("a11y.back", "Back")}>
                    <MaterialIcons name="arrow-back" size={28} color={colors.text} style={rtlFlip} />
                </TouchableOpacity>
                <View style={styles.headerRight}>
                    {/* Text Appearance Button */}
                    <TouchableOpacity
                        onPress={() => setShowAppearanceModal(true)}
                        style={styles.iconButton}
                        accessibilityRole="button" accessibilityLabel={t("a11y.textAppearance", "Text appearance")}
                    >
                        <MaterialIcons name="text-fields" size={24} color={colors.text} />
                    </TouchableOpacity>
                    {/* AI Improvement Button */}
                    <TouchableOpacity
                        onPress={() => { void handleAiAccess(() => { setImproveSource('original'); setShowAIModal(true); }); }}
                        style={[styles.iconButton, (!canUseAI || isAIProcessing || isProtected) && styles.disabledIcon]}
                        disabled={isAIProcessing || !canUseAI}
                        accessibilityRole="button" accessibilityLabel={t("a11y.improveWithAI", "Improve with AI")}
                        accessibilityState={{ disabled: isAIProcessing || !canUseAI, busy: isAIProcessing }}
                    >
                        {isAIProcessing ? (
                            <ActivityIndicator size="small" color={colors.primary} />
                        ) : (
                            <MaterialIcons
                                name="auto-awesome"
                                size={24}
                                color={canUseAI ? colors.primary : colors.textMuted}
                            />
                        )}
                    </TouchableOpacity>

                    {/* Voice Recordings List Button - Only show if recordings exist */}
                    {voiceRecordings.length > 0 && (
                        <TouchableOpacity
                            onPress={() => {
                                void clearInlineEditorAudio();
                                setShowRecordingsList(true);
                            }}
                            style={styles.iconButton}
                            accessibilityRole="button" accessibilityLabel={t("a11y.recordVoice", "Voice recordings")}
                        >
                            <MaterialIcons name="mic" size={24} color={colors.text} />
                        </TouchableOpacity>
                    )}



                    {/* Redo/Undo Buttons - Visible if there is history to navigate */}
                    {((variantHistories.current[activeVariantId]?.index > 0) || (variantHistories.current[activeVariantId]?.index < (variantHistories.current[activeVariantId]?.history?.length || 0) - 1)) && (
                        <>
                            <TouchableOpacity
                                onPress={handleUndo}
                                style={styles.iconButton}
                                accessibilityRole="button" accessibilityLabel={t("a11y.undo", "Undo")}
                                disabled={!variantHistories.current[activeVariantId] || variantHistories.current[activeVariantId].index === 0}
                            >
                                <MaterialIcons
                                    name="undo"
                                    size={24}
                                    color={(!variantHistories.current[activeVariantId] || variantHistories.current[activeVariantId].index === 0) ? colors.textMuted : colors.text}
                                />
                            </TouchableOpacity>
                            <TouchableOpacity
                                onPress={handleRedo}
                                style={styles.iconButton}
                                accessibilityRole="button" accessibilityLabel={t("a11y.redo", "Redo")}
                                disabled={!variantHistories.current[activeVariantId] || variantHistories.current[activeVariantId].index === (variantHistories.current[activeVariantId].history.length - 1)}
                            >
                                <MaterialIcons
                                    name="redo"
                                    size={24}
                                    color={(!variantHistories.current[activeVariantId] || variantHistories.current[activeVariantId].index === (variantHistories.current[activeVariantId].history.length - 1)) ? colors.textMuted : colors.text}
                                />
                            </TouchableOpacity>
                        </>
                    )}

                    {isEditing ? (
                        <>
                            <TouchableOpacity onPress={handleCheckPress} style={styles.iconButton} accessibilityRole="button" accessibilityLabel={t("a11y.done", "Done editing")}>
                                <MaterialIcons name="check" size={24} color={colors.text} />
                            </TouchableOpacity>
                        </>
                    ) : (
                        <TouchableOpacity onPress={() => setShowMenu(true)} style={styles.iconButton} accessibilityRole="button" accessibilityLabel={t("a11y.moreOptions", "More options")}>
                            <MaterialIcons name="more-vert" size={24} color={colors.text} />
                        </TouchableOpacity>
                    )}
                </View>
            </View>

            {/* AI result preview: review before anything is written to the note */}
            <Modal
                visible={!!improvementPreview}
                transparent
                animationType="slide"
                onRequestClose={handlePreviewDiscard}
            >
                <TouchableWithoutFeedback onPress={handlePreviewDiscard}>
                    <View style={styles.modalOverlay}>
                        <TouchableWithoutFeedback onPress={() => { }}>
                            <View style={[styles.aiModalContent, { paddingBottom: Math.max(insets.bottom, 0) + 16 }]}>
                                <View style={styles.aiModalHeader}>
                                    <Text style={[styles.aiModalTitle, styles.aiModalTitleInline]} numberOfLines={1}>
                                        {getLocalizedPresetLabel(improvementPreview?.option, t) || t('edit.improvePreview.title')}
                                    </Text>
                                    <TouchableOpacity onPress={handlePreviewDiscard} hitSlop={8} accessibilityRole="button" accessibilityLabel={t("a11y.close", "Close")}>
                                        <MaterialIcons name="close" size={22} color={colors.textSecondary} />
                                    </TouchableOpacity>
                                </View>

                                <Text style={styles.previewSectionLabel}>{t('edit.improvePreview.result')}</Text>
                                <ScrollView style={styles.previewBody} keyboardShouldPersistTaps="handled">
                                    <MarkdownPreview
                                        content={improvementPreview?.resultText || ''}
                                        fontSize={fontSize}
                                        selectable
                                    />
                                </ScrollView>

                                {isPreviewRegenerating && (
                                    <View style={styles.previewLoadingRow}>
                                        <ActivityIndicator size="small" color={colors.primary} />
                                        <Text style={styles.previewLoadingText}>{t('edit.improvePreview.working')}</Text>
                                    </View>
                                )}

                                <View style={styles.previewActions}>
                                    <TouchableOpacity
                                        style={[styles.previewButton, styles.previewButtonSecondary]}
                                        onPress={handlePreviewDiscard}
                                        disabled={isPreviewRegenerating}
                                    >
                                        <MaterialIcons name="close" size={18} color={colors.textSecondary} />
                                        <Text style={styles.previewButtonSecondaryText}>
                                            {t('edit.improvePreview.discard')}
                                        </Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[styles.previewButton, styles.previewButtonSecondary]}
                                        onPress={handlePreviewRetry}
                                        disabled={isPreviewRegenerating}
                                    >
                                        <MaterialIcons name="refresh" size={18} color={colors.textSecondary} />
                                        <Text style={styles.previewButtonSecondaryText}>
                                            {t('edit.improvePreview.retry')}
                                        </Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[styles.previewButton, styles.previewButtonPrimary]}
                                        onPress={handlePreviewAccept}
                                        disabled={isPreviewRegenerating}
                                    >
                                        <MaterialIcons name="check" size={18} color={colors.onPrimary} />
                                        <Text style={styles.previewButtonPrimaryText}>
                                            {t('edit.improvePreview.accept')}
                                        </Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        </TouchableWithoutFeedback>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>

            {/* AI Options Modal */}
            <Modal
                visible={showAIModal}
                transparent
                animationType="slide"
                onRequestClose={() => setShowAIModal(false)}
            >
                <GestureHandlerRootView style={{ flex: 1 }}>
                    <TouchableWithoutFeedback onPress={() => setShowAIModal(false)}>
                        <View style={styles.modalOverlay}>
                            <TouchableWithoutFeedback onPress={() => { }}>
                                <View style={[styles.aiModalContent, { paddingBottom: Math.max(insets.bottom, 0) + 16 }]}>
                                    <View style={styles.aiModalHeader}>
                                        <Text style={[styles.aiModalTitle, styles.aiModalTitleInline]}>{t("edit.improveText", "Improve Text with AI")}</Text>
                                        <View style={styles.aiActions}>
                                            <TouchableOpacity
                                                style={styles.aiActionButton}
                                                onPress={() => setShowPromptBuilder(true)}
                                            >
                                                <MaterialIcons name="add" size={18} color={colors.primary} />
                                                <Text style={styles.aiActionText}>{t("edit.create", "Create")}</Text>
                                            </TouchableOpacity>
                                        </View>
                                    </View>

                                    {activeVariantId !== 'original' && (
                                        // With a version open, choose what the preset runs on. The
                                        // result is always saved as a new version either way.
                                        <View style={styles.improveSourceRow}>
                                            <Text style={styles.improveSourceLabel}>{t('edit.versions.improveFrom', 'Improve')}</Text>
                                            <View style={styles.improveSourceSegments}>
                                                {(['original', 'current'] as const).map((source) => {
                                                    const selected = improveSource === source;
                                                    return (
                                                        <TouchableOpacity
                                                            key={source}
                                                            style={[styles.improveSourceSegment, selected && styles.improveSourceSegmentActive]}
                                                            onPress={() => setImproveSource(source)}
                                                            accessibilityRole="radio"
                                                            accessibilityState={{ selected }}
                                                        >
                                                            <Text
                                                                style={[styles.improveSourceSegmentText, selected && styles.improveSourceSegmentTextActive]}
                                                                numberOfLines={1}
                                                            >
                                                                {source === 'original'
                                                                    ? t('edit.original', 'Original')
                                                                    : (variantDisplayLabels[activeVariantId] || t('edit.versions.thisVersion', 'This version'))}
                                                            </Text>
                                                        </TouchableOpacity>
                                                    );
                                                })}
                                            </View>
                                        </View>
                                    )}

                                    {/* Custom Instruction Box */}
                                    <View style={styles.customInstructionBox}>
                                        <View style={styles.customHeaderRow}>
                                            <TouchableOpacity
                                                style={styles.customLabelContainer}
                                                onPress={() => setShowCustomInput(!showCustomInput)}
                                            >
                                                <MaterialIcons
                                                    name={showCustomInput ? "expand-less" : "expand-more"}
                                                    size={24}
                                                    color={colors.text}
                                                />
                                                <Text style={styles.customBoxLabel}>{t("edit.customInstruction", "Custom Instruction")}</Text>
                                            </TouchableOpacity>

                                            <TouchableOpacity
                                                style={styles.customMicHeaderButton}
                                                onPress={handleVoiceInstructionStart}
                                            >
                                                <MaterialIcons name="mic" size={24} color={colors.primary} />
                                            </TouchableOpacity>
                                        </View>

                                        {showCustomInput && (
                                            <View style={styles.customExpandedContent}>
                                                <View style={styles.customInputRow}>
                                                    <TextInput
                                                        style={styles.customInstructionInput}
                                                        placeholder="e.g. 'Make it funnier' or 'Translate to Spanish'"
                                                        placeholderTextColor={colors.textMuted}
                                                        value={customInstruction}
                                                        onChangeText={setCustomInstruction}
                                                        multiline
                                                        maxLength={200}
                                                    />
                                                </View>
                                                <TouchableOpacity
                                                    style={[
                                                        styles.runCustomButton,
                                                        !customInstruction.trim() && styles.runCustomButtonDisabled
                                                    ]}
                                                    onPress={handleApplyCustomInstruction}
                                                    disabled={!customInstruction.trim() || isAIProcessing}
                                                >
                                                    <Text style={styles.runCustomButtonText}>{t("edit.applyInstruction", "Apply Instruction")}</Text>
                                                    <MaterialIcons name="arrow-forward" size={16} color="white" style={rtlFlip} />
                                                </TouchableOpacity>
                                            </View>
                                        )}
                                    </View>

                                    <View style={styles.divider} />
                                    <View style={styles.aiScrollableArea}>
                                        {aiOptionsLoading ? (
                                            <View style={styles.aiLoader}>
                                                <ActivityIndicator color={colors.primary} />
                                            </View>
                                        ) : (
                                            <DraggableFlatList
                                                style={styles.aiList}
                                                contentContainerStyle={styles.aiListContent}
                                                data={aiOptions.length > 0 ? aiOptions : DEFAULT_IMPROVEMENT_OPTIONS}
                                                keyExtractor={(item) => item.id}
                                                onDragEnd={({ data }) => handleReorderEnd(data)}
                                                showsVerticalScrollIndicator
                                                scrollIndicatorInsets={{ right: 1 }}
                                                nestedScrollEnabled
                                                keyboardShouldPersistTaps="handled"
                                                renderItem={({ item, drag, isActive }: RenderItemParams<AIImprovementOption>) => (
                                                    <ScaleDecorator>
                                                        <TouchableOpacity
                                                            style={[
                                                                styles.aiOptionItem,
                                                                styles.aiReorderItem,
                                                                isActive && styles.aiOptionActive
                                                            ]}
                                                            onPress={() => {
                                                                if (!isActive) handleAIImprovement(item);
                                                            }}
                                                            onLongPress={() => {
                                                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                                                drag();
                                                            }}
                                                            disabled={isActive}
                                                            activeOpacity={0.7}
                                                        >
                                                            <View style={styles.aiOptionIconContainer}>
                                                                <MaterialIcons name={item.icon as any} size={24} color={colors.primary} />
                                                            </View>
                                                            <View style={styles.aiOptionTextWrapper}>
                                                                <Text style={styles.aiOptionLabel}>{getLocalizedPresetLabel(item, t)}</Text>
                                                                {(() => {
                                                                    const description = getLocalizedPresetDescription(item, t);
                                                                    return description != null
                                                                        ? <Text style={styles.aiOptionPrompt} numberOfLines={2}>{description}</Text>
                                                                        : renderOptionPrompt(item.prompt);
                                                                })()}
                                                            </View>
                                                            {item.isCustom && (
                                                                <TouchableOpacity
                                                                    onPress={() => handleDeletePrompt(item.id)}
                                                                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                                                    style={{ padding: 8, marginRight: 4 }}
                                                                >
                                                                    <MaterialIcons name="delete-outline" size={22} color={colors.error} />
                                                                </TouchableOpacity>
                                                            )}
                                                            <MaterialIcons name="drag-handle" size={22} color={colors.textMuted} />
                                                        </TouchableOpacity>
                                                    </ScaleDecorator>
                                                )}
                                            />
                                        )}
                                    </View>
                                    <TouchableOpacity
                                        style={styles.aiCloseButton}
                                        onPress={() => setShowAIModal(false)}
                                    >
                                        <Text style={styles.aiCloseButtonText}>{t('common.cancel', 'Cancel')}</Text>
                                    </TouchableOpacity>
                                </View>
                            </TouchableWithoutFeedback>
                        </View>
                    </TouchableWithoutFeedback>
                </GestureHandlerRootView>
            </Modal>

            {/* Prompt Builder Modal */}
            <Modal
                visible={showPromptBuilder}
                transparent
                animationType="fade"
                onRequestClose={closePromptBuilder}
            >
                <TouchableWithoutFeedback onPress={closePromptBuilder}>
                    <GestureHandlerRootView style={styles.modalOverlay}>
                        <TouchableWithoutFeedback>
                            <KeyboardAvoidingView
                                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                                style={styles.promptBuilderWrapper}
                            >
                                <View style={[styles.promptBuilderContent, { paddingBottom: insets.bottom + spacing.m }]}>
                                    <Text style={styles.aiModalTitle}>{t("edit.newPrompt", "New Prompt")}</Text>
                                    <View>
                                        <Text style={styles.promptHelper}>{t('alerts.promptIcon', 'Icon')}</Text>
                                        <ScrollView
                                            horizontal
                                            showsHorizontalScrollIndicator={false}
                                            contentContainerStyle={styles.iconPickerRow}
                                        >
                                            {ICON_CHOICES.map((icon) => {
                                                const selected = newPromptIcon === icon;
                                                return (
                                                    <TouchableOpacity
                                                        key={icon}
                                                        style={[
                                                            styles.iconChoice,
                                                            selected && styles.iconChoiceSelected,
                                                        ]}
                                                        onPress={() => setNewPromptIcon(icon)}
                                                    >
                                                        <MaterialIcons
                                                            name={icon as any}
                                                            size={22}
                                                            color={selected ? colors.onPrimary : colors.text}
                                                        />
                                                    </TouchableOpacity>
                                                );
                                            })}
                                        </ScrollView>
                                    </View>
                                    <TextInput
                                        style={styles.promptInput}
                                        placeholder={t('edit.promptNamePlaceholder', 'Prompt name')}
                                        placeholderTextColor={colors.textMuted}
                                        value={newPromptTitle}
                                        onChangeText={setNewPromptTitle}
                                    />
                                    <TextInput
                                        style={[styles.promptInput, styles.promptTextarea]}
                                        placeholder={t('edit.promptTextPlaceholder', 'Prompt text')}
                                        placeholderTextColor={colors.textMuted}
                                        value={newPromptTemplate}
                                        onChangeText={setNewPromptTemplate}
                                        multiline
                                        textAlignVertical="top"
                                    />
                                    <Text style={styles.promptHint}>
                                        {t('alerts.promptHelper', 'Write {text} where the note text should go.')}
                                    </Text>
                                    <View style={styles.promptPreviewBox}>
                                        <Text style={styles.promptPreviewLabel}>{t("edit.preview", "Preview")}</Text>
                                        {renderPromptPreview()}
                                    </View>

                                    <View style={styles.promptActions}>
                                        <TouchableOpacity
                                            style={styles.promptCancel}
                                            onPress={closePromptBuilder}
                                        >
                                            <Text style={styles.aiCloseButtonText}>{t('common.cancel', 'Cancel')}</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={[
                                                styles.savePromptButton,
                                                (!newPromptTitle.trim() || !newPromptTemplate.trim()) && styles.savePromptDisabled,
                                            ]}
                                            disabled={!newPromptTitle.trim() || !newPromptTemplate.trim()}
                                            onPress={handleCreatePrompt}
                                        >
                                            <Text style={styles.savePromptText}>{t('common.save', 'Save')}</Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            </KeyboardAvoidingView>
                        </TouchableWithoutFeedback>
                    </GestureHandlerRootView>
                </TouchableWithoutFeedback>
            </Modal>

            {/* Dropdown Menu */}
            <Modal
                visible={showMenu}
                transparent
                animationType="fade"
                onRequestClose={() => setShowMenu(false)}
            >
                <TouchableWithoutFeedback onPress={() => setShowMenu(false)}>
                    <View style={styles.menuOverlay}>
                        <View style={styles.menuContainer}>
                            <View style={styles.menuSectionHeader}>
                                <Text style={styles.menuSectionTitle}>{t("edit.editorMode", "EDITOR MODE")}</Text>
                            </View>
                            <TouchableOpacity onPress={() => { setEditMode('visual'); setShowMenu(false); setIsEditing(true); }} style={styles.menuItem}>
                                <MaterialIcons name="view-quilt" size={20} color={editMode === 'visual' ? colors.primary : colors.text} style={{ marginRight: 12 }} />
                                <Text style={[styles.menuItemText, editMode === 'visual' && { color: colors.primary, fontWeight: 'bold' }]}>{t("edit.visualEditor", "Visual Editor")}</Text>
                                {editMode === 'visual' && <MaterialIcons name="check" size={16} color={colors.primary} style={{ marginLeft: 'auto' }} />}
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => { void enterRawMode(); }} style={styles.menuItem}>
                                <MaterialIcons name="code" size={20} color={editMode === 'raw' ? colors.primary : colors.text} style={{ marginRight: 12 }} />
                                <Text style={[styles.menuItemText, editMode === 'raw' && { color: colors.primary, fontWeight: 'bold' }]}>{t("edit.rawMarkdown", "Raw Markdown")}</Text>
                                {editMode === 'raw' && <MaterialIcons name="check" size={16} color={colors.primary} style={{ marginLeft: 'auto' }} />}
                            </TouchableOpacity>

                            <View style={styles.menuDivider} />

                            <View style={styles.menuSectionHeader}>
                                <Text style={styles.menuSectionTitle}>{t("edit.copy", "COPY")}</Text>
                            </View>
                            <TouchableOpacity onPress={handleCopyPlainText} style={styles.menuItem}>
                                <MaterialIcons name="content-copy" size={20} color={colors.text} style={{ marginRight: 12 }} />
                                <Text style={styles.menuItemText}>{t("edit.copyPlainText", "Copy Plain Text")}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={handleCopyMarkdown} style={styles.menuItem}>
                                <MaterialIcons name="code" size={20} color={colors.text} style={{ marginRight: 12 }} />
                                <Text style={styles.menuItemText}>{t("edit.copyMarkdown", "Copy Markdown")}</Text>
                            </TouchableOpacity>

                            {!isProtected && (
                                <>
                                    <View style={styles.menuDivider} />
                                    <TouchableOpacity onPress={handleFindTasks} style={styles.menuItem}>
                                        <MaterialIcons name="task-alt" size={20} color={colors.primary} style={{ marginRight: 12 }} />
                                        <Text style={styles.menuItemText}>{t("edit.tasks.find", "Find tasks")}</Text>
                                    </TouchableOpacity>
                                </>
                            )}
                            {visibleImprovements.length > 0 && (
                                <>
                                    <View style={styles.menuDivider} />
                                    <View style={styles.menuSectionHeader}>
                                        <Text style={styles.menuSectionTitle}>{t("edit.versions.menuSection", "VERSIONS")}</Text>
                                    </View>
                                    <TouchableOpacity
                                        onPress={() => { setShowMenu(false); openVersionsSheet(); }}
                                        style={styles.menuItem}
                                    >
                                        <MaterialIcons name="view-list" size={20} color={colors.text} style={{ marginRight: 12 }} />
                                        <Text style={styles.menuItemText}>{t("edit.versions.all", "All versions")}</Text>
                                    </TouchableOpacity>
                                    {activeVariantId !== 'original' && (
                                        <TouchableOpacity
                                            onPress={() => {
                                                setShowMenu(false);
                                                void flushVisualEditorContent().finally(() => setShowCompareVersions(true));
                                            }}
                                            style={styles.menuItem}
                                        >
                                            <MaterialIcons name="compare-arrows" size={20} color={colors.text} style={{ marginRight: 12 }} />
                                            <Text style={styles.menuItemText}>{t("edit.versions.compare", "Compare with Original")}</Text>
                                        </TouchableOpacity>
                                    )}
                                </>
                            )}

                            {canShareOrExport ? (
                                <>
                                    <View style={styles.menuDivider} />

                                    <View style={styles.menuSectionHeader}>
                                        <Text style={styles.menuSectionTitle}>{t("edit.shareExport", "SHARE & EXPORT")}</Text>
                                    </View>
                                    <TouchableOpacity onPress={handleShareText} style={styles.menuItem}>
                                        <MaterialIcons name="share" size={20} color={colors.text} style={{ marginRight: 12 }} />
                                        <Text style={styles.menuItemText}>{t("edit.shareText", "Share Text")}</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity onPress={handleExportMarkdownFile} style={styles.menuItem}>
                                        <MaterialIcons name="file-present" size={20} color={colors.text} style={{ marginRight: 12 }} />
                                        <Text style={styles.menuItemText}>{t("edit.exportMarkdown", "Export Markdown File")}</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity onPress={handleExportImage} style={styles.menuItem}>
                                        <MaterialIcons name="image" size={20} color={colors.text} style={{ marginRight: 12 }} />
                                        <Text style={styles.menuItemText}>{t("edit.exportImage", "Export as Image")}</Text>
                                    </TouchableOpacity>
                                </>
                            ) : (
                                <>
                                    <View style={styles.menuDivider} />

                                    <View style={styles.menuSectionHeader}>
                                        <Text style={styles.menuSectionTitle}>{t("edit.shareExport", "SHARE & EXPORT")}</Text>
                                    </View>
                                    <View style={styles.menuItem}>
                                        <MaterialIcons name="privacy-tip" size={20} color={colors.textSecondary} style={{ marginRight: 12 }} />
                                        <Text style={[styles.menuItemText, { color: colors.textSecondary }]}>
                                            {isProtected
                                                ? t('edit.protected.shareDisabled', 'Off for protected notes')
                                                : t('edit.disabledPrivate', 'Disabled for private notes')}
                                        </Text>
                                    </View>
                                </>
                            )}

                            <View style={styles.menuDivider} />

                            <View style={styles.menuSectionHeader}>
                                <Text style={styles.menuSectionTitle}>{t("edit.security", "SECURITY")}</Text>
                            </View>
                            <TouchableOpacity
                                onPress={() => {
                                    setShowMenu(false);
                                    void (isProtected ? handleUnprotectNote() : handleProtectNote());
                                }}
                                style={styles.menuItem}
                            >
                                <MaterialIcons
                                    name={isProtected ? 'remove-moderator' : 'shield'}
                                    size={20}
                                    color={isProtected ? colors.text : colors.primary}
                                    style={{ marginRight: 12 }}
                                />
                                <Text style={styles.menuItemText}>
                                    {isProtected ? t('edit.protected.unprotect', 'Remove protection') : t('edit.protected.protectNote', 'Protect note')}
                                </Text>
                            </TouchableOpacity>
                            {isProtected && (
                                <TouchableOpacity
                                    onPress={() => {
                                        setShowMenu(false);
                                        void handleProtectedSyncToggle();
                                    }}
                                    style={styles.menuItem}
                                >
                                    <MaterialIcons
                                        name={effectiveStorageScope === 'sync' ? (accountEncrypted ? 'cloud-done' : 'cloud-queue') : 'cloud-off'}
                                        size={20}
                                        color={colors.text}
                                        style={{ marginRight: 12 }}
                                    />
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.menuItemText}>
                                            {effectiveStorageScope === 'sync'
                                                ? t('edit.protected.syncOn', 'Sync: on')
                                                : t('edit.protected.syncOffLabel', 'Sync: off')}
                                        </Text>
                                        <Text style={styles.menuItemHint}>
                                            {effectiveStorageScope !== 'sync'
                                                ? t('edit.protected.hintLocal', 'Only on this phone')
                                                : accountEncrypted
                                                    ? t('edit.protected.hintEncrypted', 'End-to-end encrypted')
                                                    : t('edit.protected.hintWaiting', 'Waits for end-to-end encryption')}
                                        </Text>
                                    </View>
                                </TouchableOpacity>
                            )}
                            <View style={styles.menuDivider} />

                            <TouchableOpacity onPress={handleDelete} style={styles.menuItem}>
                                <MaterialIcons name="delete-outline" size={20} color={colors.error} style={{ marginRight: 12 }} />
                                <Text style={[styles.menuItemText, { color: colors.error }]}>{t("edit.deleteNote", "Delete Note")}</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>

            {/* Custom Toast */}
            <Animated.View style={[styles.toastContainer, { opacity: toastOpacity }]} pointerEvents="none">
                <View style={styles.toastContent}>
                    <MaterialIcons name="check-circle" size={20} color={colors.background} style={{ marginRight: 8 }} />
                    <Text style={styles.toastText}>{toastMessage}</Text>
                </View>
            </Animated.View>


            {/* Main Content Area */}
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' && editMode === 'raw' ? 'padding' : undefined}
                enabled={Platform.OS === 'ios' && editMode === 'raw'} // Visual mode uses Tentap's own keyboard handling
                keyboardVerticalOffset={Platform.OS === 'ios' ? 72 : 0}
                style={{ flex: 1 }}
            >
                <View
                    ref={viewShotRef}
                    collapsable={false}
                    // A readable column on tablets; phones are narrower than the cap.
                    style={{ flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center', backgroundColor: colors.background }}
                >
                    {editorHeader}

                    {!appearanceReady || !noteViewReady || (routeNoteId !== undefined && routeNoteId !== localNoteId) ? (
                        <View style={styles.editorLoading}>
                            <ActivityIndicator size="small" color={colors.primary} />
                        </View>
                    ) : editMode === 'raw' ? (
                        // Raw Markdown Editor
                        <TextInput
                            ref={rawEditorRef}
                            style={[
                                styles.rawInput,
                                {
                                    fontSize: fontSize,
                                    lineHeight: fontSize * 1.5,
                                    color: colors.text,
                                    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
                                    paddingBottom: editorContentBottomPadding,
                                }
                            ]}
                            multiline
                            onFocus={() => setIsEditing(true)}
                            value={rawMarkdown}
                            onSelectionChange={(event) => {
                                setRawSelection(event.nativeEvent.selection);
                            }}
                            // Direct update for raw mode, bypassing auto-list logic
                            onChangeText={handleRawTextChange}
                            placeholder={t('edit.placeholderMarkdown', 'Start typing markdown...')}
                            placeholderTextColor={colors.textMuted}
                            textAlignVertical="top"
                            autoCapitalize="sentences"
                        />
                    ) : (
                        <RichTextEditor
                            ref={editorRef}
                            initialContent={content}
                            reparseTrigger={reparseTrigger}
                            baseFontSize={fontSize}
                            autoScalingEnabled={shouldUseCreationAutoScalePreview}
                            lockedChecklistScaleFactor={activeVariantChecklistScaleFactor}
                            showToolbar={false}
                            contentBottomPadding={editorContentBottomPadding}
                            onChange={handleContentChange}
                            onPlainTextChange={setVisualPlainText}
                            onSelectionChange={handleVisualSelectionChange}
                            onActiveStylesChange={setActiveFormats}
                            onFocus={handleVisualEditorFocus}
                            onBlur={handleVisualEditorBlur}
                            onChecklistToggledWhileIdle={handleChecklistToggledWhileIdle}
                            onHorizontalSwipe={handleEditorHorizontalSwipe}
                            placeholder={t('edit.placeholderVisual', 'Start typing...')}
                            onAudioAction={handleAudioActionFromEditor}
                        />
                    )}
                </View>
            </KeyboardAvoidingView>

            {editMode === 'visual' && (keyboardVisibleState || isColorPickerVisible) && (
                <View
                    pointerEvents="box-none"
                    style={[
                        styles.toolbarKeyboardDock,
                        { bottom: keyboardVisibleState ? keyboardHeight : insets.bottom },
                    ]}
                >
                    <View pointerEvents="auto" style={styles.toolbarKeyboardInner}>
                        <MarkdownToolbar
                            onFormat={handleFormat}
                            showDictate={LOCAL_WHISPER_ENABLED}
                            activeFormats={isRealtimeDictating ? [...activeFormats, 'dictate'] : activeFormats}
                            onColorPickerToggle={(visible) => {
                                setIsColorPickerVisible(visible);
                                if (!visible && !keyboardVisibleRef.current) {
                                    editorRef.current?.blur();
                                    setIsEditing(false);
                                }
                            }}
                        />
                    </View>
                </View>
            )}

            {/* Floating Mic Button */}
            {
                !showVoiceRecorder && (
                    <View style={[styles.micFloatingContainer, { bottom: floatingMicBottomOffset }]}>
                        <TouchableOpacity
                            style={styles.micButton}
                            onPress={handleMicPress}
                            onLongPress={handleMicLongPress}
                            delayLongPress={250}
                            activeOpacity={0.8}
                            accessibilityRole="button"
                            accessibilityLabel={t("a11y.recordVoice", "Record voice note")}
                            accessibilityHint={agentModeIndicatorEnabled ? micHintText : undefined}
                        >
                            <MaterialIcons name="mic" size={28} color="white" />
                            {/* The agent is on: a small badge instead of curved 8px text. */}
                            {agentModeIndicatorEnabled && (
                                <View style={styles.micAgentBadge} pointerEvents="none">
                                    <MaterialIcons name="auto-awesome" size={12} color={colors.primary} />
                                </View>
                            )}
                        </TouchableOpacity>
                    </View>
                )
            }

            <PrivacyWarningModal
                visible={showPrivacyWarning}
                onAccept={handlePrivacyAccept}
                onCancel={() => setShowPrivacyWarning(false)}
            />

            <TasksSheet
                visible={tasksSheet.visible}
                loading={tasksSheet.loading}
                error={tasksSheet.error}
                tasks={tasksSheet.tasks}
                formatDue={formatTaskDue}
                onClose={closeTasksSheet}
                onRetry={() => { void runFindTasks(); }}
                onAddToNote={(tasks) => { void handleAddTasksToNote(tasks); }}
                onAddToCalendar={handleAddTaskToCalendar}
            />

            <VersionsSheet
                visible={showVersionsSheet}
                items={versionListItems}
                activeId={activeVariantId}
                onClose={() => setShowVersionsSheet(false)}
                onSelect={(id) => { void handleVariantSelect(id); }}
                onDelete={(id) => { void requestDeleteVariant(id); }}
                onMakeMain={handleMakeVariantMain}
                onCopyToNewNote={(id) => { void handleCopyVariantToNewNote(id); }}
                onRename={openRenameVersion}
            />

            <Modal
                visible={renameTarget !== null}
                transparent
                animationType="fade"
                onRequestClose={() => setRenameTarget(null)}
            >
                <View style={styles.renameOverlay}>
                    <View style={styles.renameCard}>
                        <Text style={styles.renameTitle}>{t('edit.versions.renameTitle', 'Rename version')}</Text>
                        <TextInput
                            value={renameTarget?.value ?? ''}
                            onChangeText={(value) => setRenameTarget(prev => (prev ? { ...prev, value } : prev))}
                            placeholder={t('edit.versions.renamePlaceholder', 'Version name')}
                            placeholderTextColor={colors.textMuted}
                            style={styles.renameInput}
                            autoFocus
                            maxLength={60}
                            returnKeyType="done"
                            onSubmitEditing={() => { void saveRenameVersion(); }}
                        />
                        <View style={styles.renameActions}>
                            <TouchableOpacity onPress={() => setRenameTarget(null)} style={styles.renameButton}>
                                <Text style={styles.renameCancelText}>{t('common.cancel', 'Cancel')}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => { void saveRenameVersion(); }} style={styles.renameButton}>
                                <Text style={styles.renameSaveText}>{t('common.save', 'Save')}</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            <CompareVersionsModal
                visible={showCompareVersions}
                versionLabel={variantDisplayLabels[activeVariantId] || ''}
                originalText={showCompareVersions ? richContentToPlainText(resolveVariantContent('original')) : ''}
                versionText={showCompareVersions ? richContentToPlainText(content) : ''}
                onClose={() => setShowCompareVersions(false)}
            />

            <UndoSnackbar message={undoMessage} onUndo={undoVariantDelete} />

            <DeleteConfirmationDialog
                visible={recordingToDelete !== null}
                title={t('edit.deleteRecordingTitle', 'Delete Recording?')}
                message={t('edit.deleteRecordingDesc', 'Are you sure you want to delete this recording?')}
                onCancel={() => setRecordingToDelete(null)}
                onConfirm={confirmDeleteRecording}
            />

            <DeleteConfirmationDialog
                visible={isDeletingNote}
                title={t('edit.deleteNote', 'Delete Note')}
                message={t('edit.deleteNoteDesc', 'Are you sure you want to delete this note?')}
                onCancel={() => setIsDeletingNote(false)}
                onConfirm={confirmDeleteNote}
            />

            <ErrorModal
                visible={errorModalVisible}
                title={errorTitle}
                message={errorMessage}
                secondaryActionLabel={errorShowSettingsAction ? t('common.openSettings', 'Open Settings') : undefined}
                onSecondaryAction={() => {
                    setErrorModalVisible(false);
                    setErrorTitle(undefined);
                    setErrorShowSettingsAction(false);
                    navigation.navigate('Settings');
                }}
                onClose={() => {
                    setErrorModalVisible(false);
                    setErrorTitle(undefined);
                    setErrorShowSettingsAction(false);
                }}
            />

            <SignInRequiredModal
                visible={showTranscriptionAuthModal}
                title={t('voice.signInRequired', 'Sign in required')}
                message={t('voice.transcriptionAuthMessage', 'Transcription is available after you create an account.')}
                onClose={() => setShowTranscriptionAuthModal(false)}
                onSignIn={() => {
                    setShowTranscriptionAuthModal(false);
                    navigation.navigate('SignIn');
                }}
            />

            <LimitModal />

            {
                (() => {
                    const indicatorTasks: AIActiveTask[] = [];
                    if (activeImprovementTask) {
                        indicatorTasks.push(activeImprovementTask as AIActiveTask);
                    }
                    indicatorTasks.push(...activeAITasks);

                    return (
                        <AIProcessingIndicator
                            visible={aiIndicatorVisible}
                            tasks={indicatorTasks}
                            onCancelTask={(taskId) => {
                                void cancelAgentTask(taskId);
                            }}
                        />
                    );
                })()
            }

            <VoiceRecorder
                visible={showVoiceRecorder}
                // Tap and long-press only choose the mode (micMode); both start
                // recording at once. Passing the long-press ref here left a plain
                // tap with an idle panel whose every control was disabled.
                autoStart
                micMode={pendingMicInputMode}
                isMainScreen={false}
                onFinish={(rec, transcribe, agentEnabled) => {
                    if (isRecordingInstruction) {
                        handleInstructionRecordingFinish(rec);
                    } else {
                        handleRecordingFinish(rec, transcribe, pendingMicInputModeRef.current, agentEnabled);
                    }
                    setPendingMicInputMode('agent');
                    pendingMicInputModeRef.current = 'agent';
                }}
                onCancel={() => {
                    setShowVoiceRecorder(false);
                    setIsRecordingInstruction(false);
                    setPendingMicInputMode('agent');
                    pendingMicInputModeRef.current = 'agent';
                }}
            />

            <LocalWhisperDownloadModal
                visible={showLocalWhisperModal}
                onClose={() => { setShowLocalWhisperModal(false); setWhisperModalPurpose('dictate'); }}
                onDownloadComplete={() => {
                    setShowLocalWhisperModal(false);
                    if (whisperModalPurpose === 'enable') {
                        setWhisperModalPurpose('dictate');
                        void setOnDeviceTranscription(true);
                        showToast(t('edit.onDeviceOffer.enabled', 'Recordings are now transcribed on this phone'));
                        return;
                    }
                    if (whisperModalPurpose === 'protected') {
                        // Opened for a protected recording: nothing to start.
                        setWhisperModalPurpose('dictate');
                        showToast(t('edit.protected.modelReady', 'Speech model ready'));
                        return;
                    }
                    handleFormat('dictate'); // Auto-start after download
                }}
            />

            <TranscriptionIndicator visible={isTranscribing} />

            {/* Recordings List Modal */}
            <Modal
                visible={showRecordingsList}
                transparent
                animationType="slide"
                onRequestClose={closeRecordingsList}
            >
                <TouchableWithoutFeedback onPress={closeRecordingsList}>
                    <GestureHandlerRootView style={styles.modalOverlay}>
                        <TouchableWithoutFeedback>
                            <View style={styles.aiModalContent}>
                                <Text style={styles.aiModalTitle}>{t("edit.voiceRecordings", "Voice Recordings")}</Text>

                                {!!recordingsPreviewUri && (
                                    <View style={{ marginBottom: spacing.m, width: '100%', alignSelf: 'stretch' }}>
                                        <AudioPlayer
                                            key={recordingsPreviewUri}
                                            audioUri={recordingsPreviewUri}
                                            duration={recordingsPreviewDuration}
                                            onClose={clearRecordingsPreview}
                                            onDelete={clearRecordingsPreview}
                                        />
                                    </View>
                                )}

                                <ScrollView style={{ maxHeight: 400 }} contentContainerStyle={{ paddingBottom: spacing.l }}>


                                    {voiceRecordings.length === 0 ? (
                                        <Text style={{ textAlign: 'center', color: colors.textMuted, marginTop: spacing.m }}>
                                            {t('alerts.recordingsEmpty', 'No recordings yet.')}
                                        </Text>
                                    ) : (
                                        voiceRecordings.map((rec) => {
                                            const isPlaying = playingRecordingId === rec.id;
                                            const isAttachedToNote = embeddedAudioPaths.includes(rec.file_path);
                                            const hasRecognizedText = !!rec.transcription?.trim();
                                            const isInsertActionDisabled = !hasRecognizedText && isAttachedToNote;
                                            const insertActionLabel = hasRecognizedText
                                                ? t('edit.recordings.addText', 'Add text')
                                                : (isAttachedToNote ? t('edit.recordings.inNote', 'In note') : t('edit.recordings.add', 'Add'));
                                            const insertActionIcon = hasRecognizedText ? 'notes' : 'add';
                                            // Decoupled from transcriptionEnabled per user request
                                            const canTranscribeThisRecording = true;
                                            const isAnyTranscribing = !!transcribingRecordingId;
                                            const isTranscribingThisRecording = transcribingRecordingId === rec.id;

                                            return (
                                                <TouchableOpacity
                                                    key={rec.id}
                                                    style={[
                                                        styles.recordingItem,
                                                        isPlaying && {
                                                            backgroundColor: colors.backgroundSecondary,
                                                            borderColor: colors.border,
                                                            borderWidth: 1
                                                        }
                                                    ]}
                                                    onPress={() => {
                                                        void handlePreviewRecording(rec);
                                                    }}
                                                >
                                                    {/* Actions wrap under the duration when they do not fit beside it. */}
                                                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', rowGap: spacing.s }}>
                                                        <View style={[
                                                            styles.recordingIconContainer,
                                                            isPlaying && { backgroundColor: colors.primary + '10' }
                                                        ]}>
                                                            <MaterialIcons
                                                                name={isPlaying ? "graphic-eq" : "mic"}
                                                                size={20}
                                                                color={isPlaying ? colors.primary : colors.textSecondary}
                                                            />
                                                        </View>

                                                        <View style={{ flex: 1, minWidth: 110, marginRight: spacing.s }}>
                                                            <Text style={[styles.recordingTitle, isPlaying && { color: colors.primary }]} numberOfLines={1}>
                                                                {formatDuration(rec.duration)}
                                                            </Text>
                                                            <Text style={styles.recordingSubtitle} numberOfLines={1}>
                                                                {new Date(rec.created_at).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' })}
                                                            </Text>
                                                        </View>

                                                        <View style={styles.recordingCompactActions}>
                                                            <TouchableOpacity
                                                                style={[styles.recordingActionChip, isInsertActionDisabled && styles.recordingActionDisabled]}
                                                                disabled={isInsertActionDisabled}
                                                                onPress={() => {
                                                                    void handleInsertRecordingIntoNote(rec);
                                                                }}
                                                            >
                                                                <MaterialIcons name={insertActionIcon} size={14} color={isInsertActionDisabled ? colors.textMuted : colors.primary} />
                                                                <Text style={[styles.recordingActionChipText, isInsertActionDisabled && { color: colors.textMuted }]}>
                                                                    {insertActionLabel}
                                                                </Text>
                                                            </TouchableOpacity>

                                                            {canTranscribeThisRecording && !hasRecognizedText && (
                                                                <TouchableOpacity
                                                                    style={styles.recordingActionChip}
                                                                    disabled={isAnyTranscribing}
                                                                    onPress={() => {
                                                                        void handleRetryTranscription(rec);
                                                                    }}
                                                                >
                                                                    {isTranscribingThisRecording ? (
                                                                        <ActivityIndicator size="small" color={colors.primary} />
                                                                    ) : (
                                                                        <>
                                                                            <MaterialIcons name="auto-awesome" size={12} color={colors.primary} />
                                                                            <Text style={styles.recordingActionChipText}>{t('edit.recordings.transcribe', 'Transcribe')}</Text>
                                                                        </>
                                                                    )}
                                                                </TouchableOpacity>
                                                            )}

                                                            {hasRecognizedText && (
                                                                <TouchableOpacity
                                                                    style={[styles.recordingActionChip, { backgroundColor: colors.backgroundSecondary }]}
                                                                    onPress={() => openRecordingTextView(rec)}
                                                                >
                                                                    <MaterialIcons name="visibility" size={14} color={colors.textSecondary} />
                                                                    <Text style={[styles.recordingActionChipText, { color: colors.textSecondary }]}>{t('edit.recordings.view', 'View')}</Text>
                                                                </TouchableOpacity>
                                                            )}

                                                            <TouchableOpacity
                                                                style={styles.recordingDeleteIcon}
                                                                onPress={() => handleDeleteRecording(rec.id, rec.file_path)}
                                                                accessibilityRole="button"
                                                                accessibilityLabel={t('common.delete', 'Delete')}
                                                            >
                                                                <MaterialIcons name="delete-outline" size={18} color={colors.error} />
                                                            </TouchableOpacity>
                                                        </View>
                                                    </View>
                                                </TouchableOpacity>
                                            );
                                        })
                                    )}
                                </ScrollView>

                            </View>
                        </TouchableWithoutFeedback>
                    </GestureHandlerRootView>
                </TouchableWithoutFeedback>
            </Modal>

            <Modal
                visible={showRecordingTextModal}
                transparent
                animationType="slide"
                onRequestClose={() => setShowRecordingTextModal(false)}
            >
                <TouchableWithoutFeedback onPress={() => setShowRecordingTextModal(false)}>
                    <GestureHandlerRootView style={styles.modalOverlay}>
                        <TouchableWithoutFeedback>
                            <View
                                style={[
                                    styles.recordingTextModalContent,
                                    { paddingBottom: (Platform.OS === 'android' ? spacing.xxl : spacing.l) + insets.bottom },
                                ]}
                            >
                                <Text style={styles.aiModalTitle}>{t("edit.recognizedText", "Recognized text")}</Text>
                                <ScrollView style={styles.recordingTextBody}>
                                    <Text style={styles.recordingTextValue}>
                                        {selectedRecordingText || 'No recognized text for this recording yet.'}
                                    </Text>
                                </ScrollView>

                                <TouchableOpacity
                                    style={[styles.recordingActionButton, !selectedRecordingText && styles.recordingActionDisabled]}
                                    disabled={!selectedRecordingText}
                                    onPress={() => {
                                        void handleInsertSelectedRecordingText();
                                    }}
                                >
                                    <Text style={styles.recordingActionText}>{t("edit.insert", "Insert")}</Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={[styles.recordingSecondaryAction, !selectedRecordingText && styles.recordingActionDisabled]}
                                    disabled={!selectedRecordingText}
                                    onPress={() => {
                                        void handleCopySelectedRecordingText();
                                    }}
                                >
                                    <Text style={styles.recordingSecondaryText}>{t('common.copy', 'Copy')}</Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={styles.recordingCloseAction}
                                    onPress={() => setShowRecordingTextModal(false)}
                                >
                                    <Text style={styles.recordingCloseText}>{t("common.close", "Close")}</Text>
                                </TouchableOpacity>
                            </View>
                        </TouchableWithoutFeedback>
                    </GestureHandlerRootView>
                </TouchableWithoutFeedback>
            </Modal>

            <TextAppearanceModal
                visible={showAppearanceModal}
                onClose={() => setShowAppearanceModal(false)}
                fontSize={fontSize}
                onFontSizeChange={handleFontSizeChange}
                autoScalingEnabled={autoScalingEnabled}
                onAutoScalingChange={handleAutoScalingChange}
            />

        </ScreenContainer >
    );
};

const styles = createStyles(() => ({
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: spacing.s,
        marginBottom: spacing.xs,
        marginTop: 0,
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: spacing.s,
        marginBottom: spacing.xs,
        marginTop: 0,
    },
    headerRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
        // Icons line up with the text edge while their 48dp boxes overhang it.
        marginRight: -12,
    },
    headerEdgeLeft: {
        marginLeft: -12,
    },
    // 48dp: the Android minimum touch target (Apple asks for 44pt).
    iconButton: {
        width: 48,
        height: 48,
        alignItems: 'center',
        justifyContent: 'center',
    },
    disabledIcon: {
        opacity: 0.3,
    },
    disabledText: {
        color: colors.textMuted,
    },
    menuOverlay: {
        flex: 1,
        backgroundColor: 'transparent',
    },
    menuContainer: {
        position: 'absolute',
        top: 80,
        right: spacing.m,
        backgroundColor: colors.surfaceElevated,
        borderRadius: 14,
        borderWidth: isDarkScheme() ? 1 : 0,
        borderColor: colors.border,
        padding: spacing.xs,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 5,
        minWidth: 200,
    },
    menuItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: spacing.s + 4,
        paddingHorizontal: spacing.m,
    },
    menuSectionHeader: {
        paddingHorizontal: spacing.m,
        paddingTop: spacing.s + 4,
        paddingBottom: spacing.s,
    },
    menuSectionTitle: {
        fontSize: 11,
        color: colors.textMuted,
        fontWeight: '600',
        letterSpacing: 0.5,
    },
    menuDivider: {
        height: 1,
        backgroundColor: colors.border,
        marginVertical: 4,
    },
    menuItemHint: {
        fontSize: 12,
        color: colors.textSecondary,
        marginTop: 2,
    },
    menuItemText: {
        fontSize: 16,
        color: colors.text,
    },
    toastContainer: {
        position: 'absolute',
        bottom: 180, // Moved up from 100
        left: 0,
        right: 0,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
    },
    toastContent: {
        backgroundColor: colors.text, // High contrast
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 25,
        shadowColor: "#000",
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
        elevation: 5,
    },
    toastText: {
        color: colors.background,
        fontSize: 14,
        fontWeight: '600',
    },
    content: {
        flex: 1,
    },

    titleInput: {
        fontSize: 24,
        fontWeight: '400',
        color: colors.text,
        marginBottom: spacing.xs,
        padding: 0,
    },
    metaInfo: {
        marginBottom: spacing.l,
    },
    metaText: {
        fontSize: 12,
        color: colors.textTertiary,
    },
    securityBadgeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        marginTop: spacing.s,
        flexWrap: 'wrap',
    },
    securityBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 999,
        paddingHorizontal: spacing.s,
        paddingVertical: 4,
        backgroundColor: colors.surface,
    },
    securityBadgeText: {
        ...typography.caption,
        color: colors.textSecondary,
        fontWeight: '600',
    },
    variantContainer: {
        marginBottom: spacing.m,
    },
    variantRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    swipeHint: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
        marginTop: -spacing.s,
        marginBottom: spacing.m,
        paddingVertical: 8,
        paddingHorizontal: spacing.m,
        borderRadius: 10,
        backgroundColor: colors.primaryLight,
    },
    swipeHintClose: {
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
        marginVertical: -8,
        marginRight: -12,
    },
    swipeHintText: {
        flex: 1,
        fontSize: 13,
        color: colors.text,
    },
    renameOverlay: {
        flex: 1,
        backgroundColor: colors.overlay,
        justifyContent: 'center',
        padding: spacing.l,
    },
    renameCard: {
        backgroundColor: colors.surface,
        borderRadius: 16,
        padding: spacing.m,
    },
    renameTitle: {
        fontSize: 17,
        fontWeight: '700',
        color: colors.text,
        marginBottom: spacing.m,
    },
    renameInput: {
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 10,
        paddingHorizontal: spacing.m,
        paddingVertical: 10,
        fontSize: 16,
        color: colors.text,
    },
    renameActions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: spacing.s,
        marginTop: spacing.m,
    },
    renameButton: {
        paddingVertical: 8,
        paddingHorizontal: spacing.m,
    },
    renameCancelText: {
        fontSize: 15,
        color: colors.textSecondary,
        fontWeight: '600',
    },
    renameSaveText: {
        fontSize: 15,
        color: colors.primary,
        fontWeight: '700',
    },
    improveSourceRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: spacing.m,
        gap: spacing.s,
    },
    improveSourceLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.textSecondary,
    },
    improveSourceSegments: {
        flex: 1,
        flexDirection: 'row',
        backgroundColor: colors.backgroundSecondary,
        borderRadius: 10,
        padding: 3,
    },
    improveSourceSegment: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: 7,
        paddingHorizontal: spacing.s,
        borderRadius: 8,
    },
    improveSourceSegmentActive: {
        backgroundColor: colors.surface,
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowRadius: 3,
        shadowOffset: { width: 0, height: 1 },
        elevation: 1,
    },
    improveSourceSegmentText: {
        fontSize: 13,
        fontWeight: '500',
        color: colors.textSecondary,
    },
    improveSourceSegmentTextActive: {
        color: colors.text,
        fontWeight: '600',
    },
    variantOriginalChip: {
        marginRight: spacing.xs,
    },
    variantScroll: {
        flex: 1,
    },
    variantAllButton: {
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: spacing.xs,
        minHeight: 40,
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 20,
        backgroundColor: colors.primaryLight,
    },
    variantAllCount: {
        marginLeft: 4,
        fontSize: 13,
        fontWeight: '600',
        color: colors.primary,
    },
    variantScrollContent: {
        alignItems: 'center',
        paddingVertical: spacing.xs,
    },
    variantChipWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        marginRight: spacing.xs,
    },
    variantChip: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 20,
        minHeight: 40,
        paddingVertical: 6,
        paddingHorizontal: spacing.m,
        backgroundColor: colors.surface,
    },
    variantChipActive: {
        backgroundColor: colors.primary,
        borderColor: colors.primary,
    },
    variantChipText: {
        fontSize: 13,
        color: colors.textSecondary,
        fontWeight: '500',
        // A long AI title must not stretch one chip across the whole row.
        maxWidth: 150,
    },
    variantChipTextActive: {
        color: colors.onPrimary,
    },
    variantChipIcon: {
        marginRight: 6,
    },
    variantDeleteButton: {
        width: 36,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
        marginHorizontal: -4,
    },
    contentInput: {
        fontSize: 16,
        lineHeight: 24,
        color: colors.text,
        minHeight: 200,
        padding: 0,
    },
    micFloatingContainer: {
        position: 'absolute',
        right: spacing.xl,
        bottom: spacing.xxl + 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    // micHintBubble and micHintText removed
    micAgentBadge: {
        position: 'absolute',
        top: -2,
        right: -2,
        width: 22,
        height: 22,
        borderRadius: 11,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.surface,
        borderWidth: 1.5,
        borderColor: colors.primaryLight,
    },
    micButton: {
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: colors.primary,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: colors.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 8,
    },
    transcribingContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: spacing.m,
        backgroundColor: colors.surface,
        borderRadius: 8,
        marginBottom: spacing.m,
        gap: spacing.s,
    },
    transcribingText: {
        ...typography.caption,
        color: colors.primary,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    aiModalContent: {
        backgroundColor: colors.surface,
        borderTopLeftRadius: 24,
        width: '100%',
        maxWidth: 640,
        alignSelf: 'center',
        borderTopRightRadius: 24,
        padding: spacing.l,
        maxHeight: '82%',
    },
    aiModalTitle: {
        ...typography.h3,
        marginBottom: spacing.l,
        textAlign: 'center',
    },
    aiModalTitleInline: {
        marginBottom: 0,
        flexShrink: 1,
    },
    previewSectionLabel: {
        ...typography.caption,
        color: colors.textMuted,
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        marginBottom: spacing.xs,
    },
    previewBody: {
        // The sheet itself is capped at 82%, so let the result use the room it
        // has instead of scrolling a long suggestion inside a 280pt window.
        maxHeight: Math.round(Dimensions.get('window').height * 0.45),
        backgroundColor: colors.background,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        paddingHorizontal: spacing.m,
        paddingVertical: spacing.s,
    },
    previewLoadingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
        marginTop: spacing.s,
    },
    previewLoadingText: {
        ...typography.caption,
        color: colors.primary,
    },
    previewActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
        marginTop: spacing.l,
    },
    previewButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        paddingVertical: spacing.m,
        borderRadius: 12,
    },
    previewButtonSecondary: {
        backgroundColor: colors.background,
        borderWidth: 1,
        borderColor: colors.border,
    },
    previewButtonSecondaryText: {
        ...typography.caption,
        color: colors.textSecondary,
    },
    previewButtonPrimary: {
        backgroundColor: colors.primary,
    },
    previewButtonPrimaryText: {
        ...typography.caption,
        color: colors.onPrimary,
        fontWeight: '600',
    },
    aiModalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: spacing.m,
    },
    aiActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
    },
    aiActionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.m,
        paddingVertical: spacing.s,
        borderRadius: 12,
        backgroundColor: colors.background,
        gap: spacing.xs,
        borderWidth: 1,
        borderColor: colors.border,
    },
    aiActionText: {
        ...typography.body,
        fontWeight: '600',
        color: colors.primary,
        fontSize: 15,
    },
    aiLoader: {
        paddingVertical: spacing.xl,
        alignItems: 'center',
        justifyContent: 'center',
    },
    aiScrollableArea: {
        maxHeight: 360,
    },
    aiList: {
        flexGrow: 0,
    },
    aiListContent: {
        paddingBottom: spacing.s,
        paddingRight: spacing.s,
    },
    aiOptionItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: spacing.m,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    aiOptionIconContainer: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: colors.background,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: spacing.m,
    },
    aiOptionLabel: {
        flex: 1,
        ...typography.body,
        fontWeight: '500',
    },
    aiOptionTextWrapper: {
        flex: 1,
        gap: 4,
    },
    aiOptionPrompt: {
        ...typography.caption,
        // textMuted was too faint to read on white.
        color: colors.textSecondary,
    },
    aiReorderItem: {
        paddingVertical: spacing.s,
    },
    aiOptionActive: {
        backgroundColor: colors.background,
        borderRadius: 12,
    },
    aiCloseButton: {
        minHeight: 48,
        justifyContent: 'center',
        marginTop: spacing.m,
        paddingTop: spacing.s,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        paddingVertical: spacing.xs,
        alignItems: 'center',
    },
    aiCloseButtonText: {
        ...typography.body,
        fontWeight: '600',
        color: colors.primary,
    },
    promptBuilderWrapper: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    promptBuilderContent: {
        backgroundColor: colors.surface,
        borderTopLeftRadius: 24,
        width: '100%',
        maxWidth: 640,
        alignSelf: 'center',
        borderTopRightRadius: 24,
        padding: spacing.m,
        gap: spacing.m,
    },
    promptHelper: {
        ...typography.caption,
        color: colors.textSecondary,
    },
    promptHint: {
        ...typography.caption,
        color: colors.textSecondary,
        marginTop: -spacing.xs,
        marginBottom: spacing.s,
    },
    promptInput: {
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        paddingHorizontal: spacing.m,
        paddingVertical: spacing.s,
        ...typography.body,
        color: colors.text,
    },
    promptTextarea: {
        minHeight: 120,
        textAlignVertical: 'top',
    },
    promptPreviewBox: {
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        padding: spacing.m,
        backgroundColor: colors.background,
        gap: spacing.s,
    },
    promptPreviewLabel: {
        ...typography.caption,
        color: colors.textMuted,
    },
    promptPreviewText: {
        ...typography.body,
        color: colors.text,
    },
    promptPlaceholderToken: {
        ...typography.body,
        color: colors.primary,
        fontWeight: '600',
    },
    promptPreviewPlaceholder: {
        ...typography.body,
        color: colors.textMuted,
    },
    promptActions: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: spacing.m,
    },
    promptCancel: {
        paddingVertical: spacing.s,
        paddingHorizontal: spacing.m,
    },
    savePromptButton: {
        flex: 1,
        paddingVertical: spacing.s,
        paddingHorizontal: spacing.m,
        backgroundColor: colors.primary,
        borderRadius: 12,
        alignItems: 'center',
    },
    savePromptDisabled: {
        opacity: 0.5,
    },
    savePromptText: {
        ...typography.body,
        color: colors.onPrimary,
        fontWeight: '600',
    },
    customInstructionBox: {
        marginBottom: spacing.l,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 16,
        padding: spacing.s,
        backgroundColor: colors.background,
        marginHorizontal: spacing.s,
    },
    customHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 0,
    },
    customLabelContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
    },
    customMicHeaderButton: {
        padding: spacing.s,
        backgroundColor: colors.surface,
        borderRadius: 20,
        // borderWidth: 1,
        // borderColor: colors.border,
        alignItems: 'center',
        justifyContent: 'center',
    },
    customBoxLabel: {
        ...typography.body,
        fontWeight: '500',
        color: colors.text,
    },
    customExpandedContent: {
        marginTop: spacing.m,
    },
    customInputRow: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        backgroundColor: colors.surface,
        paddingHorizontal: spacing.s,
        marginBottom: spacing.s,
        minHeight: 60,
    },
    customInstructionInput: {
        flex: 1,
        paddingVertical: 12,
        paddingHorizontal: 8,
        ...typography.body,
        fontSize: 15,
        color: colors.text,
        maxHeight: 80,
    },

    runCustomButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.primary,
        paddingVertical: 12,
        borderRadius: 12,
        gap: spacing.s,
    },
    runCustomButtonDisabled: {
        opacity: 0.5,
        backgroundColor: colors.textMuted,
    },
    runCustomButtonText: {
        ...typography.body,
        fontWeight: '600',
        color: colors.onPrimary,
    },
    divider: {
        height: 1,
        backgroundColor: colors.border,
        marginHorizontal: -spacing.l,
        marginBottom: 0,
    },
    iconPickerRow: {
        gap: spacing.s,
        paddingVertical: spacing.xs,
    },
    iconChoice: {
        width: 40,
        height: 40,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.surface,
    },
    iconChoiceSelected: {
        backgroundColor: colors.primary,
        borderColor: colors.primary,
    },
    rawInput: {
        flex: 1,
        padding: spacing.m,
        paddingTop: spacing.l,
        textAlignVertical: 'top',
    },
    editorLoading: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.background,
    },
    toolbarKeyboardDock: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 80,
        elevation: 80,
    },
    toolbarKeyboardInner: {
        backgroundColor: colors.surface,
    },
    retryTranscriptionButton: {
        marginTop: spacing.s,
        marginBottom: spacing.m,
        backgroundColor: colors.primary,
        paddingVertical: 14,
        paddingHorizontal: spacing.l,
        borderRadius: 24,
        alignSelf: 'stretch',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: colors.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 4,
    },
    retryTranscriptionText: {
        color: colors.onPrimary,
        fontSize: 14,
        fontWeight: '600',
    },
    recordingsList: {
        marginTop: spacing.s,
        marginBottom: spacing.m,
        padding: spacing.s,
        backgroundColor: colors.surface,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
    },
    recordingsListTitle: {
        fontSize: 12,
        fontWeight: '600',
        color: colors.textSecondary,
        marginBottom: spacing.s,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    recordingItem: {
        paddingVertical: 12,
        paddingHorizontal: spacing.m,
        marginBottom: spacing.s,
        borderRadius: 16,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
    },
    recordingItemActive: {
        borderColor: colors.primary,
        backgroundColor: colors.primaryLight,
        borderWidth: 1.5,
        shadowColor: colors.primary,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
    },
    recordingIconContainer: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: colors.backgroundSecondary,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: spacing.s,
    },
    recordingIconContainerActive: {
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: 'rgba(0, 102, 255, 0.2)',
    },
    recordingInfo: {
        flex: 1,
        justifyContent: 'center',
    },
    recordingTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: colors.text,
    },
    recordingSubtitle: {
        fontSize: 11,
        color: colors.textMuted,
    },
    recordingCompactActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    recordingActionChip: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.primaryLight,
        minHeight: 40,
        paddingHorizontal: 12,
        borderRadius: 12,
        gap: 4,
    },
    recordingActionChipText: {
        ...typography.captionBold,
        color: colors.primary,
        fontSize: 13,
    },
    recordingDeleteIcon: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    recordingDeleteButton: {
        padding: spacing.s,
        marginLeft: spacing.s,
    },
    recordingActionBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: spacing.xs,
        paddingTop: spacing.s,
        borderTopWidth: 1,
        borderTopColor: colors.border + '40',
    },
    recordingActionLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
    },
    recordingActionBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.backgroundSecondary,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 12,
        gap: 6,
    },
    recordingActionBtnText: {
        ...typography.captionBold,
        color: colors.primary,
        fontSize: 12,
    },
    recordingActionDelete: {
        padding: 8,
        borderRadius: 10,
        backgroundColor: colors.error + '10',
    },
    recordingBadge: {
        backgroundColor: colors.backgroundSecondary,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 8,
    },
    recordingBadgeText: {
        fontSize: 10,
        fontWeight: '700',
        color: colors.textSecondary,
        textTransform: 'uppercase',
    },
    recordingActionsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
    },
    recordingActionSmall: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.background,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: colors.border,
        gap: 4,
    },
    recordingActionSmallText: {
        ...typography.captionBold,
        color: colors.primary,
        fontSize: 11,
    },
    recordingViewButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: spacing.s,
        paddingVertical: 6,
        borderRadius: 999,
        backgroundColor: colors.background,
        borderWidth: 1,
        borderColor: colors.border,
    },
    recordingViewButtonText: {
        ...typography.caption,
        color: colors.primary,
        fontWeight: '600',
    },
    recordingTextModalContent: {
        backgroundColor: colors.surface,
        borderTopLeftRadius: 24,
        width: '100%',
        maxWidth: 640,
        alignSelf: 'center',
        borderTopRightRadius: 24,
        padding: spacing.l,
        maxHeight: '80%',
    },
    recordingTextBody: {
        maxHeight: 280,
        marginBottom: spacing.m,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        padding: spacing.m,
        backgroundColor: colors.background,
    },
    recordingTextValue: {
        ...typography.body,
        color: colors.text,
        lineHeight: 22,
    },
    recordingActionButton: {
        backgroundColor: colors.primary,
        borderRadius: 14,
        height: 50,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: spacing.s,
        shadowColor: colors.cardShadow,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.2,
        shadowRadius: 10,
        elevation: 4,
    },
    recordingActionText: {
        ...typography.button,
        color: colors.onPrimary,
    },
    recordingSecondaryAction: {
        borderRadius: 12,
        height: 46,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: colors.border,
        marginBottom: spacing.xs,
        backgroundColor: colors.surface,
    },
    recordingSecondaryText: {
        ...typography.captionBold,
        color: colors.text,
    },
    recordingCloseAction: {
        alignItems: 'center',
        justifyContent: 'center',
        height: 46,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        marginTop: spacing.xs,
    },
    recordingCloseText: {
        ...typography.captionBold,
        color: colors.textSecondary,
    },
    recordingActionDisabled: {
        opacity: 0.45,
    },
}));
