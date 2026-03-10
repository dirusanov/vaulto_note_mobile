import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
    View,
    TextInput,
    StyleSheet,
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
    Share,
    Animated,
    AppState,
} from 'react-native';
import Svg, { Path, Text as SvgText, TextPath, Defs } from 'react-native-svg';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import { captureRef } from 'react-native-view-shot';
import { GestureHandlerRootView, ScrollView as GestureHandlerScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { RichTextEditor, RichTextEditorHandle } from '../components/RichTextEditor';
import { useFocusEffect, useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialIcons } from '@expo/vector-icons';
import { RootStackParamList } from '../navigation/types';
import { useNotesContext } from '../contexts/NotesContext';
import { useAuth } from '../hooks/useAuth';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { VoiceRecorder } from '../components/VoiceRecorder';
import { AudioPlayer } from '../components/AudioPlayer';
import { PrivacyWarningModal } from '../components/PrivacyWarningModal';
import { DeleteConfirmationDialog } from '../components/DeleteConfirmationDialog';

import { AudioService, AudioRecording } from '../services/AudioService';
import { transcribeAudio, processVoiceNote } from '../services/TranscriptionService';
import { saveVoiceRecordingLocal, getVoiceRecordingsLocal, deleteVoiceRecordingLocal } from '../services/DatabaseService';
import { NotePrivacy, StorageScope, VoiceRecording } from '../api/notes';
import * as Haptics from 'expo-haptics';

import {
    improveText,
    loadImprovementOptions,
    saveImprovementOptions,
    AIImprovementOption,
    DEFAULT_IMPROVEMENT_OPTIONS,
    ensureTemplateHasPlaceholder,
} from '../services/AIService';
import {
    getAgentModeEnabled,
    getTranscriptionEnabled,
    getAIProvider,
    getFontSize,
    setFontSize,
    getAutoScalingEnabled,
    setAutoScalingEnabled,
    getLocalOnlyWarningDismissed,
    setLocalOnlyWarningDismissed,
    getPrivateAIAllowed,
    setPrivateAIAllowed,
} from '../utils/storage';
import { MarkdownToolbar, MarkdownFormatType } from '../components/MarkdownToolbar';
import { TextAppearanceModal } from '../components/TextAppearanceModal';
import { AIProcessingIndicator, AIActiveTask } from '../components/AIProcessingIndicator';
import { TranscriptionIndicator } from '../components/TranscriptionIndicator';
import { LimitModal } from '../components/LimitModal';
import { ErrorModal } from '../components/ErrorModal';
import { SignInRequiredModal } from '../components/SignInRequiredModal';
import { getErrorMessage } from '../utils/errorMessage';
import { stripMarkdownSyntax } from '../utils/markdownUtils';

type NoteEditScreenRouteProp = RouteProp<RootStackParamList, 'NoteEdit'>;
type NoteEditScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'NoteEdit'>;
const CUSTOM_AI_UNIVERSAL_ERROR = 'Unable to connect to your Custom AI provider. Check provider API key and provider settings.';

const normalizeTextForComparison = (value: string): string =>
    value.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();

const areTextsEquivalent = (a: string, b: string): boolean =>
    normalizeTextForComparison(a) === normalizeTextForComparison(b);

const appendSnippetToContent = (base: string, snippet: string): string => {
    const normalizedBase = (base || '').replace(/\s+$/g, '');
    const normalizedSnippet = (snippet || '').trim();

    if (!normalizedSnippet) return normalizedBase;
    if (!normalizedBase) return normalizedSnippet;
    if (normalizedBase.endsWith('\n')) return `${normalizedBase}${normalizedSnippet}`;
    return `${normalizedBase}\n${normalizedSnippet}`;
};

const escapeRegExp = (value: string): string =>
    value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildAudioMarkdownTag = (audioPath: string): string =>
    `![audio](${audioPath})`;

const hasAudioTagInContent = (content: string, audioPath: string): boolean => {
    const normalizedPath = (audioPath || '').trim();
    if (!normalizedPath) return false;

    const normalizedContent = content || '';
    const exactPathRegex = new RegExp(`!\\[audio\\]\\(${escapeRegExp(normalizedPath)}\\)`);
    if (exactPathRegex.test(normalizedContent)) {
        return true;
    }

    const filename = normalizedPath.split('/').pop();
    if (!filename) return false;

    const filenameRegex = new RegExp(`!\\[audio\\]\\([^)]*${escapeRegExp(filename)}\\)`);
    return filenameRegex.test(normalizedContent);
};

const deriveTitleFromText = (text: string): string => {
    const cleaned = (text || '')
        .replace(/!\[audio\]\([^)]+\)/g, ' ')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/^\s*[-*]\s+\[[ xX]\]\s+/gm, '')
        .replace(/^\s*[-*]\s+/gm, '')
        .replace(/^\s*\d+[\.\)]\s+/gm, '')
        .replace(/\s+/g, ' ')
        .trim();

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

const TODO_LIST_LINE_REGEX = /^\s*-\s+\[[ xX]\]\s+/m;
const TODO_LABEL_REGEX = /(todo|task|checklist|to-do|список|дела|чеклист)/i;

const stripListMarker = (value: string): string =>
    value
        .replace(/^\s*[-*]\s+/, '')
        .replace(/^\s*\d+[\.\)]\s+/, '')
        .trim();

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

const buildAgentStatusMessage = (mode?: string | null, action: 'created' | 'updated' = 'updated'): string => {
    const normalizedMode = (mode || '').toLowerCase();
    if (normalizedMode === 'todo' || normalizedMode === 'list') {
        return action === 'created' ? 'Created checklist' : 'Updated checklist';
    }
    if (normalizedMode === 'format') {
        return action === 'created' ? 'Created improved view' : 'Updated formatting';
    }
    if (normalizedMode === 'edit_content') {
        return action === 'created' ? 'Created improved view' : 'Updated Improved';
    }
    return action === 'created' ? 'Created improved view' : 'Updated Improved';
};

const buildAgentImprovementLabel = (
    primaryTitle?: string | null,
    fallbackTitle?: string | null,
): string => {
    const normalizeTitleLabel = (value: string): string =>
        (value || '')
            .replace(/\s+/g, ' ')
            .trim();

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

type QuotaLimitKind = 'trial_minutes' | 'pro_minutes' | 'llm_tokens';

interface ParsedQuotaLimit {
    kind: QuotaLimitKind;
    message: string;
}

interface AgentQueueTask {
    id: string;
    transcribedText: string;
    sessionId: number;
    noteId: string | undefined;
    targetVariantId: string;
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
    const AGENT_HISTORY_LIMIT = 5;
    const AGENT_TASK_TIMEOUT_MS = 60000;
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
        updateNoteStorageScope,
    } = useNotesContext();
    const { isAuthenticated, isGuest, userId, user } = useAuth();
    const [allowPrivateAI, setAllowPrivateAI] = useState(false);
    const ICON_CHOICES = ['translate', 'spellcheck', 'bolt', 'lightbulb', 'auto-awesome', 'text-fields', 'chat', 'edit'];
    const normalizePrivacy = (value?: NotePrivacy): NotePrivacy => {
        if (value === 'hidden') return value;
        return 'normal';
    };
    const normalizeScope = (value?: StorageScope): StorageScope => {
        return value === 'local_only' ? 'local_only' : 'sync';
    };

    const [localNoteId, setLocalNoteId] = useState(route.params?.noteId);
    const localNoteIdRef = useRef(localNoteId);


    useEffect(() => {
        localNoteIdRef.current = localNoteId;
    }, [localNoteId]);

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
    const [improvementToDelete, setImprovementToDelete] = useState<string | null>(null);
    const [isDeletingNote, setIsDeletingNote] = useState<boolean>(false);
    const [recordingToDelete, setRecordingToDelete] = useState<{ id: string, path: string } | null>(null);
    const [content, setContent] = useState(() => {
        const initialId = getInitialActiveVariantId();
        if (initialId === 'original') return existingNote?.content || '';
        const imp = existingNote?.improvements?.find(i => i.id === initialId);
        return imp?.content || existingNote?.content || '';
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
        return effectiveScope === 'local_only';
    };

    const ensurePrivateShareAllowed = (): boolean => {
        if (!isPrivateContent()) {
            return true;
        }
        Alert.alert(
            'Sharing disabled for private notes',
            'To prevent leaks, share and export are blocked for local-only notes.'
        );
        return false;
    };

    // Export & Share Refs and Handlers
    const viewShotRef = useRef<View>(null);

    const handleCopyPlainText = async () => {
        setShowMenu(false);
        const fullText = `${title}\n\n${content}`;
        const plainText = stripMarkdownSyntax(fullText);
        await Clipboard.setStringAsync(plainText.trim());
        showToast('Text copied to clipboard');
    };

    const handleCopyMarkdown = async () => {
        setShowMenu(false);
        // Strip audio tags (broken local links) but keep other markdown
        const contentWithoutAudio = content
            .replace(/!\[audio\]\([^)]+\)/g, '')
            .replace(/\n{3,}/g, '\n\n') // Normalize extra newlines left by removal
            .trim();

        const fullText = `${title ? '# ' + title + '\n\n' : ''}${contentWithoutAudio}`;
        await Clipboard.setStringAsync(fullText);
        showToast('Markdown copied to clipboard');
    };

    const handleShareText = async () => {
        setShowMenu(false);
        if (!ensurePrivateShareAllowed()) return;
        // Also strip audio for sharing text
        const contentWithoutAudio = content
            .replace(/!\[audio\]\([^)]+\)/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        const fullText = `${title}\n\n${contentWithoutAudio}`;
        try {
            await Share.share({
                message: fullText,
                title: title || 'Note',
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
            const safeTitle = (title || 'note').replace(/[^a-z0-9а-яё]/gi, '_').toLowerCase();
            const filename = `${safeTitle}_${dateStr}.md`;

            const fileUri = `${FileSystem.documentDirectory}${filename} `;
            const fullText = `${title ? '# ' + title + '\n\n' : ''}${content} `;

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
                Alert.alert('Error', 'Sharing is not available');
            }
        } catch (error) {
            console.error('Error exporting markdown:', error);
            Alert.alert('Error', 'Failed to export markdown file');
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
                    Alert.alert('Error', 'Sharing is not available on this device');
                }
            } else {
                Alert.alert('Error', 'Could not capture view');
            }
        } catch (error) {
            console.error('Error exporting image:', error);
            Alert.alert('Error', 'Failed to export image');
        }
    };

    // History for Undo/Redo - separate for each variant
    const variantHistories = useRef<Record<string, VariantHistory>>({});
    const historyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Initialize history for original variant
    if (!variantHistories.current['original']) {
        variantHistories.current['original'] = {
            history: [{ title: existingNote?.title || '', content: existingNote?.content || '' }],
            index: 0
        };
    }

    // Audio state
    const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
    const [showPrivacyWarning, setShowPrivacyWarning] = useState(false);
    const [audioUri, setAudioUri] = useState<string | null>(null);
    const [audioDuration, setAudioDuration] = useState<number>(0);
    const [isTranscribing, setIsTranscribingState] = useState(false);
    const [isRecordingFlowActive, setIsRecordingFlowActive] = useState(false);

    const lastSavedTitle = useRef(existingNote?.title || '');
    const lastSavedContent = useRef(existingNote?.content || '');
    const skipAutoSaveRef = useRef(false);
    const isColorPickerOpen = useRef(false);
    const isMounted = useRef(true);
    const hasAutoOpenedRecordings = useRef(false);

    const [showAudioPlayer, setShowAudioPlayer] = useState(false);

    const [playingRecordingId, setPlayingRecordingId] = useState<string | null>(null);
    const [transcribingRecordingId, setTranscribingRecordingId] = useState<string | null>(null);
    const [transcriptionEnabled, setTranscriptionEnabled] = useState(true);
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
            return;
        }

        if (route.params?.initialPrivacy || route.params?.initialStorageScope) {
            const nextPrivacy = normalizePrivacy(route.params?.initialPrivacy);
            const nextScope = normalizeScope(route.params?.initialStorageScope);
            setPrivacy(nextPrivacy);
            setStorageScope(nextScope);
        }
    }, [existingNote?.id, existingNote?.privacy, existingNote?.storage_scope, route.params?.initialPrivacy, route.params?.initialStorageScope]);

    // Force re-render on history update to show undo/redo arrows

    // AI State
    const [showAIModal, setShowAIModal] = useState(false);
    const [isAIProcessing, setIsAIProcessingState] = useState(false);
    const [aiOptions, setAiOptions] = useState<AIImprovementOption[]>(DEFAULT_IMPROVEMENT_OPTIONS);
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
    const pendingMicInputModeRef = useRef<MicInputMode>('agent');
    const micLongPressHandledRef = useRef(false);

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
            getVoiceRecordingsLocal(userId, localNoteId).then(async (recs) => {
                setVoiceRecordings(recs);

                // Auto-select the latest recording (first in list)
                if (recs.length > 0) {
                    const latest = recs[0];
                    setPlayingRecordingId(latest.id);
                    try {
                        const uri = await AudioService.readAudioFile(latest.file_path);
                        setAudioUri(uri);
                        setAudioDuration(latest.duration);
                        setShowAudioPlayer(true);
                    } catch (e) {
                        console.error('[NoteEditScreen] Failed to auto-load recording', e);
                    }
                }
            });
        }
    }, [showRecordingsList, localNoteId]);

    // Custom Instruction State
    const [customInstruction, setCustomInstruction] = useState('');
    const [isRecordingInstruction, setIsRecordingInstruction] = useState(false);
    const [showCustomInput, setShowCustomInput] = useState(false);

    // Error Modal State
    const [errorModalVisible, setErrorModalVisible] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [errorTitle, setErrorTitle] = useState<string | undefined>(undefined);
    const [errorShowSettingsAction, setErrorShowSettingsAction] = useState(false);
    const [currentAIProvider, setCurrentAIProvider] = useState<'vaulto_ai' | 'openai'>('vaulto_ai');
    const [showTranscriptionAuthModal, setShowTranscriptionAuthModal] = useState(false);
    const [activeImprovementTask, setActiveImprovementTask] = useState<AIActiveTask | null>(null);
    const showPrettyQuotaNotification = useCallback((errorValue: unknown, fallback: string): boolean => {
        const raw = getErrorMessage(errorValue, '').toLowerCase();

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

        if (currentAIProvider === 'openai') {
            setErrorTitle('Custom AI Error');
            setErrorMessage(CUSTOM_AI_UNIVERSAL_ERROR);
            setErrorShowSettingsAction(true);
            setErrorModalVisible(true);
            return false;
        }

        setErrorTitle(undefined);
        setErrorMessage(fallback || raw || 'An error occurred');
        setErrorShowSettingsAction(false);
        setErrorModalVisible(true);
        return false;
    }, [currentAIProvider]);

    const requestPrivateAIConsent = useCallback(async (): Promise<boolean> => {
        const isPrivate = normalizeScope(storageScope) === 'local_only';
        if (!isPrivate || allowPrivateAI) {
            return true;
        }

        return await new Promise<boolean>((resolve) => {
            Alert.alert(
                'Private note protection',
                'AI processing can send note text to an external service. Allow for this private note?',
                [
                    { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                    { text: 'Allow Once', onPress: () => resolve(true) },
                    {
                        text: 'Always Allow for Private Notes',
                        onPress: async () => {
                            await setPrivateAIAllowed(true);
                            await setAllowPrivateAI(true);
                            resolve(true);
                        },
                    },
                ]
            );
        });
    }, [allowPrivateAI, privacy, setAllowPrivateAI, storageScope]);

    const handleAiAccess = async (callback: () => void) => {
        if (isGuest) {
            Alert.alert(
                'AI Features Locked',
                'AI features are available only for signed-in users.',
                [
                    { text: 'Cancel', style: 'cancel' },
                    {
                        text: 'Sign In',
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



    const confirmLocalOnlyWarning = useCallback(async (): Promise<boolean> => {
        const dismissed = await getLocalOnlyWarningDismissed();
        if (dismissed) {
            return true;
        }

        return await new Promise<boolean>((resolve) => {
            Alert.alert(
                'Local-only note',
                'This note will not sync, and it cannot be recovered after app reinstall or device loss.',
                [
                    { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                    {
                        text: 'Do not show again',
                        onPress: async () => {
                            await setLocalOnlyWarningDismissed(true);
                            resolve(true);
                        },
                    },
                    { text: 'I Understand', onPress: () => resolve(true) },
                ]
            );
        });
    }, []);

    const applyStorageScope = useCallback(async (nextScope: StorageScope) => {
        const normalizedScope = normalizeScope(nextScope);

        if (normalizedScope === 'local_only') {
            const warningAccepted = await confirmLocalOnlyWarning();
            if (!warningAccepted) return;
            if (existingNote && normalizeScope(existingNote.storage_scope) === 'sync') {
                const confirmed = await new Promise<boolean>((resolve) => {
                    Alert.alert(
                        'Move to Local-Only',
                        'Server copy will be deleted from sync.',
                        [
                            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                            { text: 'Move', style: 'destructive', onPress: () => resolve(true) },
                        ]
                    );
                });
                if (!confirmed) return;
            }
        } else if (normalizeScope(storageScope) === 'local_only') {
            const confirmed = await new Promise<boolean>((resolve) => {
                Alert.alert(
                    'Enable sync for note',
                    'This note content will be sent to server (encrypted).',
                    [
                        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                        { text: 'Enable Sync', onPress: () => resolve(true) },
                    ]
                );
            });
            if (!confirmed) return;
        }

        if (localNoteId) {
            await updateNoteStorageScope(localNoteId, normalizedScope);
        }
        setStorageScope(normalizedScope);
    }, [confirmLocalOnlyWarning, existingNote, localNoteId, storageScope, updateNoteStorageScope]);

    // Text Appearance State
    const [fontSize, setFontSizeState] = useState(16);
    const [autoScalingEnabled, setAutoScalingEnabledState] = useState(true);
    const [showAppearanceModal, setShowAppearanceModal] = useState(false);

    // AI Request History (Session based)
    const [requestHistory, setRequestHistory] = useState<string[]>([]);
    const requestHistoryRef = useRef<string[]>([]);

    const [activeFormats, setActiveFormats] = useState<MarkdownFormatType[]>([]);
    const editorRef = useRef<RichTextEditorHandle>(null);

    const improvementDraftsRef = useRef<Record<string, string>>({});
    const improvementSavedRef = useRef<Record<string, string>>({});
    const improvementTitleDraftsRef = useRef<Record<string, string>>({});
    const improvementTitleSavedRef = useRef<Record<string, string>>({});

    const resolveImprovementVariantTitle = useCallback((variantId: string): string => {
        const draftTitle = improvementTitleDraftsRef.current[variantId];
        if (typeof draftTitle === 'string') {
            return draftTitle;
        }
        const improvement = noteImprovements.find((imp) => imp.id === variantId);
        const improvementTitle = (improvement?.title || '').trim();
        if (improvementTitle) {
            return improvementTitle;
        }
        const improvementLabel = (improvement?.label || '').trim();
        if (improvementLabel) {
            return improvementLabel;
        }
        return existingNote?.title || '';
    }, [existingNote?.title, noteImprovements]);

    // Queue for transcribed text tasks to ensure strict sequential agent processing
    const agentQueue = useRef<AgentQueueTask[]>([]);
    const activeAgentTasksRef = useRef<AgentQueueTask[]>([]);
    const isCancelingAgentRef = useRef(false);
    const pendingVoiceInsertionsRef = useRef<Map<string, PendingVoiceInsertion>>(new Map());
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
        refreshTrackedQueueLength();
    }, [refreshTrackedQueueLength]);

    const loadSettings = async () => {
        const [size, scaling, privateAIAllowed] = await Promise.all([
            getFontSize(),
            getAutoScalingEnabled(),
            getPrivateAIAllowed(),
        ]);
        setFontSizeState(size);
        setAutoScalingEnabledState(scaling);
        setAllowPrivateAI(privateAIAllowed);
    };


    useEffect(() => {
        if (localNoteId && userId) {
            getVoiceRecordingsLocal(userId, localNoteId).then(async (recs) => {
                setVoiceRecordings(recs);

                // Auto-load player if note is empty but has recordings (unprocessed voice note)
                if (!hasAutoOpenedRecordings.current && recs.length > 0 && existingNote) {
                    const isEmpty = !existingNote.title && (!existingNote.content || existingNote.content.trim().length === 0);
                    const hasNoTx = !existingNote.encrypted_transcription && !existingNote.transcription;

                    if (isEmpty && hasNoTx) {
                        // Load the latest recording
                        const latest = recs[0];
                        try {
                            const uri = await AudioService.readAudioFile(latest.file_path);
                            setAudioUri(uri);
                            setAudioDuration(latest.duration);
                            setShowAudioPlayer(true);
                            hasAutoOpenedRecordings.current = true;
                        } catch (e) {
                            console.error('Failed to auto-load empty note audio', e);
                        }
                    }
                }
            });
        }
    }, [localNoteId, existingNote]);

    const handleFontSizeChange = (size: number) => {
        setFontSizeState(size);
        setFontSize(size);
    };

    const handleAutoScalingChange = (enabled: boolean) => {
        setAutoScalingEnabledState(enabled);
        setAutoScalingEnabled(enabled);
    };

    useFocusEffect(
        useCallback(() => {
            loadSettings();
        }, [])
    );

    useEffect(() => {
        if (!existingNote) {
            return;
        }

        // Initialize history with loaded content if it was empty (fixes Undo wiping content)
        const currentOriginalHist = variantHistories.current['original'];
        if (currentOriginalHist && currentOriginalHist.history.length === 1 && currentOriginalHist.index === 0) {
            const firstState = currentOriginalHist.history[0];
            if (!firstState.title && !firstState.content && (existingNote.title || existingNote.content)) {
                variantHistories.current['original'] = {
                    history: [{
                        title: existingNote.title || '',
                        content: existingNote.content || ''
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
                const contentValue = imp.content ?? '';
                const titleValue = (imp.title || imp.label || '').trim();

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

                if (activeVariantId === imp.id && drafts[imp.id] !== undefined) {
                    setContent(drafts[imp.id]);
                    setTitle(titleDrafts[imp.id] ?? titleValue);
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

        if (activeVariantId === 'original') {
            if (lastSavedTitle.current === title) {
                const nextTitle = existingNote.title || '';
                // Avoid regressing non-empty in-memory title to transient empty value from stale refresh.
                if (nextTitle.trim().length > 0 || !title.trim()) {
                    setTitle(nextTitle);
                }
            }
            if (lastSavedContent.current === content) {
                setContent(existingNote.content || '');
            }
        } else {
            const nextTitle = resolveImprovementVariantTitle(activeVariantId);
            if (nextTitle !== title) {
                setTitle(nextTitle);
            }
        }

        // Load audio if exists
        // Load audio if exists
        if (existingNote.has_audio && existingNote.audio_file_path && !audioUri) {
            loadAudio(existingNote.audio_file_path);
            setAudioDuration(existingNote.audio_duration || 0);
            setShowAudioPlayer(true);
        }

        lastSavedTitle.current = existingNote.title || '';
        lastSavedContent.current = existingNote.content || '';
    }, [existingNote, noteImprovements, activeVariantId, title, content, audioUri, resolveImprovementVariantTitle]);

    // Restore active variant from is_active flags when note loads
    useEffect(() => {
        if (!existingNote) return;

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
                    setTitle(nextTitle);
                }
                setContent(existingNote.content || '');
            } else {
                const improvement = existingNote.improvements?.find(i => i.id === correctActiveVariantId);
                if (improvement) {
                    const improvementContent = improvement.content || '';
                    const improvementTitle =
                        improvementTitleDraftsRef.current[correctActiveVariantId] ??
                        (improvement.title || improvement.label || existingNote.title || '');
                    setContent(improvementContent);
                    setTitle(improvementTitle);
                    improvementDraftsRef.current[correctActiveVariantId] = improvementContent;
                    improvementSavedRef.current[correctActiveVariantId] = improvementContent;
                    improvementTitleDraftsRef.current[correctActiveVariantId] = improvementTitle;
                    improvementTitleSavedRef.current[correctActiveVariantId] = improvementTitle;
                }
            }
        }
    }, [existingNote?.id, existingNote?.is_active, JSON.stringify(existingNote?.improvements?.map(i => ({ id: i.id, is_active: i.is_active })))]);

    useEffect(() => {
        const loadSettings = async () => {
            if (!isAuthenticated || isGuest) {
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
        if (activeVariantId === 'original') {
            setTitle(existingNote?.title || '');
            setContent(existingNote?.content || '');
        } else {
            setTitle(resolveImprovementVariantTitle(activeVariantId));
            setContent(improvementDraftsRef.current[activeVariantId] ?? '');
        }
    }, [activeVariantId, existingNote?.content, existingNote?.title, resolveImprovementVariantTitle]);

    useEffect(() => {
        isMounted.current = true;
        return () => {
            isMounted.current = false;
        };
    }, []);

    useEffect(() => {
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
                setTitle(existingNote?.title || '');
                setContent(existingNote?.content || '');
            }
        }
    }, [activeVariantId, noteImprovements, existingNote?.content, existingNote?.title]);

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

    const resolveVariantContent = useCallback((variantId: string): string => {
        if (variantId === 'original') {
            if (activeVariantIdRef.current === 'original') {
                return currentContentRef.current;
            }
            return existingNote?.content || '';
        }
        const draft = improvementDraftsRef.current[variantId];
        if (typeof draft === 'string') {
            return draft;
        }
        const improvement = noteImprovements.find((imp) => imp.id === variantId);
        return improvement?.content || '';
    }, [existingNote?.content, noteImprovements]);

    const isTodoImprovementVariant = useCallback((variantId: string, baseContent: string): boolean => {
        if (variantId === 'original') return false;
        if (TODO_LIST_LINE_REGEX.test(baseContent || '')) return true;
        const label = noteImprovements.find((imp) => imp.id === variantId)?.label || '';
        return TODO_LABEL_REGEX.test(label);
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
        const persist = options?.persist ?? true;
        const updateHistoryState = options?.updateHistory ?? true;
        const currentVariantContent = resolveVariantContent(variantId);

        if (areTextsEquivalent(newText, currentVariantContent)) {
            return false;
        }

        if (variantId === 'original') {
            if (activeVariantIdRef.current === 'original') {
                setContent(newText);
                currentContentRef.current = newText;
            }
            if (updateHistoryState) {
                updateHistoryImmediate(currentTitleRef.current, newText, 'original');
            }
            if (persist && localNoteIdRef.current) {
                await updateNote(localNoteIdRef.current, { content: newText });
                lastSavedContent.current = newText;
            }
            return true;
        }

        if (activeVariantIdRef.current === variantId) {
            setContent(newText);
            currentContentRef.current = newText;
        }
        improvementDraftsRef.current[variantId] = newText;
        if (updateHistoryState) {
            updateHistoryImmediate(resolveImprovementVariantTitle(variantId), newText, variantId);
        }
        if (persist && localNoteIdRef.current) {
            try {
                await updateImprovement(localNoteIdRef.current, variantId, { content: newText });
                improvementSavedRef.current[variantId] = newText;
            } catch (error) {
                console.error('Failed to save variant content update:', error);
            }
        }
        return true;
    }, [resolveImprovementVariantTitle, resolveVariantContent, updateHistoryImmediate, updateImprovement, updateNote]);

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
        registerTranscribedInsertion(normalizedText);
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

    const applyAudioPlayerToVariant = useCallback(async (
        variantId: string,
        audioPath: string
    ): Promise<boolean> => {
        const normalizedPath = (audioPath || '').trim();
        if (!normalizedPath) return false;

        const baseContent = resolveVariantContent(variantId);
        if (hasAudioTagInContent(baseContent, normalizedPath)) {
            return false;
        }

        const newText = appendSnippetToContent(baseContent, buildAudioMarkdownTag(normalizedPath));
        return await setVariantContentWithOptions(variantId, newText, {
            persist: true,
            updateHistory: true,
        });
    }, [resolveVariantContent, setVariantContentWithOptions]);

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

    const isAudioAlreadyInsertedInCurrentVariant = useCallback((audioPath: string): boolean => {
        const targetVariantId = activeVariantIdRef.current;
        const variantContent = resolveVariantContent(targetVariantId);
        return hasAudioTagInContent(variantContent, audioPath);
    }, [resolveVariantContent]);

    const handleTitleChange = (text: string) => {
        setTitle(text);
        if (activeVariantId === 'original' && text.trim().length > 0) {
            titleLockRef.current = true;
        }
        if (activeVariantId !== 'original') {
            improvementTitleDraftsRef.current[activeVariantId] = text;
        }
        updateHistory(text, content);
    };

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



    const handleDeleteImprovementVariant = useCallback(async (improvementId: string) => {
        if (!localNoteId) return;
        try {
            await deleteImprovement(localNoteId, improvementId);
            delete improvementDraftsRef.current[improvementId];
            delete improvementSavedRef.current[improvementId];
            delete improvementTitleDraftsRef.current[improvementId];
            delete improvementTitleSavedRef.current[improvementId];

            // If deleting active variant, switch to original
            if (activeVariantId === improvementId) {
                setActiveVariantId('original');
                activeVariantIdRef.current = 'original';
                setTitle(existingNote?.title || '');
                setContent(existingNote?.content || '');
                // Set parent as active
                await setActiveVariant(localNoteId, null);
            }
        } catch (error) {
            console.error('Failed to delete improvement', error);
            Alert.alert('Error', 'Failed to delete improvement');
        }
    }, [activeVariantId, deleteImprovement, existingNote?.content, existingNote?.title, localNoteId, setActiveVariant]);

    const confirmDeleteImprovement = (improvementId: string) => {
        setImprovementToDelete(improvementId);
    };

    const handleUndo = () => {
        const variantHistory = variantHistories.current[activeVariantId];
        if (!variantHistory || variantHistory.index <= 0) return;

        const prevIndex = variantHistory.index - 1;
        const prevState = variantHistory.history[prevIndex];

        setTitle(prevState.title);
        setContent(prevState.content);

        if (activeVariantId !== 'original') {
            improvementDraftsRef.current[activeVariantId] = prevState.content;
            improvementTitleDraftsRef.current[activeVariantId] = prevState.title;
        }

        variantHistories.current[activeVariantId] = {
            ...variantHistory,
            index: prevIndex
        };
    };

    const handleRedo = () => {
        const variantHistory = variantHistories.current[activeVariantId];
        if (!variantHistory || variantHistory.index >= variantHistory.history.length - 1) return;

        const nextIndex = variantHistory.index + 1;
        const nextState = variantHistory.history[nextIndex];

        setTitle(nextState.title);
        setContent(nextState.content);

        if (activeVariantId !== 'original') {
            improvementDraftsRef.current[activeVariantId] = nextState.content;
            improvementTitleDraftsRef.current[activeVariantId] = nextState.title;
        }

        variantHistories.current[activeVariantId] = {
            ...variantHistory,
            index: nextIndex
        };
    };

    const loadAudio = async (path: string) => {
        try {
            const uri = await AudioService.readAudioFile(path);
            setAudioUri(uri);
        } catch (error: any) {
            // Check for file not found error (ENOENT or specific message)
            if (error?.message?.includes('ENOENT') || error?.code === 'ENOENT' || error?.message?.includes('No such file')) {
                console.log('[Audio] File not found (deleted?):', path);
                showToast && showToast('Audio file not found');
            } else {
                console.error('Failed to load audio:', error);
            }
        }
    };

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
                updates.title = draftTitle;
                updates.label = buildAgentImprovementLabel(draftTitle, savedTitle) || undefined;
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
        if (activeVariantId !== 'original') {
            await saveImprovementDraft();
            return;
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
        const emptyText = !title.trim() && !content.trim();

        if (emptyText && !hasAudio && !hasImprovements) {
            if (localNoteId) {
                try {
                    await deleteNote(localNoteId);
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
        if (localNoteId && title === lastSavedTitle.current && content === lastSavedContent.current) {
            return;
        }

        if (isMounted.current) {
            setIsSaving(true);
        }
        try {
            if (localNoteId) {
                await updateNote(localNoteId, {
                    title,
                    content,
                    has_audio: hasAudio, // Explicitly sync has_audio state
                    storage_scope: storageScope,
                    privacy,
                });
            } else {
                // LOCK CREATION
                isCreatingNote.current = true;
                pendingSaveAfterCreate.current = false; // Reset flag

                try {
                    const newNote = await createNote({
                        title,
                        content,
                        storage_scope: storageScope,
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
                    }

                    // CHECK FOR PENDING UPDATES (Race condition fix)
                    // If user typed more while creation was in flight, or pending flag was set
                    const latestContent = currentContentRef.current;
                    const latestTitle = currentTitleRef.current;

                    // currentTitleRef and currentContentRef hold the very latest state from the component
                    // We check if it differs from what we *just* created (which was 'title' and 'content' from closure)
                    const contentChanged = latestContent !== content;
                    const titleChanged = latestTitle !== title;

                    if (pendingSaveAfterCreate.current || contentChanged || titleChanged) {
                        console.log('[NoteEditScreen] Identifying pending changes after creation, triggering update...', { pending: pendingSaveAfterCreate.current, contentChanged, titleChanged });
                        await updateNote(newNote.id, {
                            title: latestTitle,
                            content: latestContent,
                            has_audio: hasAudio,
                            storage_scope: storageScope,
                            privacy,
                        });
                        // Update "last saved" to the LATEST values we just pushed
                        lastSavedTitle.current = latestTitle;
                        lastSavedContent.current = latestContent;
                        // Return here so we don't overwrite lastSaved with stale closure values below
                        return;
                    }
                } finally {
                    isCreatingNote.current = false;
                }
            }
            lastSavedTitle.current = title;
            lastSavedContent.current = content;
        } catch (error) {
            console.error('Failed to save note:', error);
        } finally {
            if (isMounted.current) {
                setIsSaving(false);
            }
        }
    }, [activeVariantId, content, createNote, deleteNote, existingNote?.privacy, localNoteId, noteImprovements.length, privacy, saveImprovementDraft, storageScope, syncTrackedProcessingToNote, title, updateNote]);

    const debouncedSave = useCallback((_newContent: string, _newTitle: string) => {
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => {
            saveNote();
        }, 500); // Reduced from 2000ms to 500ms for faster auto-save
    }, [saveNote]);

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
                ? existingNote?.content || ''
                : improvementDraftsRef.current[variantId] || noteImprovements.find(i => i.id === variantId)?.content || '';
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
            setTitle(existingNote?.title || '');
            setContent(existingNote?.content || '');
        } else {
            setTitle(resolveImprovementVariantTitle(variantId));
            const draft = improvementDraftsRef.current[variantId];
            if (draft !== undefined) {
                setContent(draft);
            } else {
                const imp = noteImprovements.find(i => i.id === variantId);
                setContent(imp?.content || '');
            }
        }
    }, [activeVariantId, existingNote?.content, existingNote?.title, noteImprovements, resolveImprovementVariantTitle, saveNote, localNoteId, setActiveVariant]);

    useEffect(() => {
        const unsubscribe = navigation.addListener('beforeRemove', (event) => {
            if (skipAutoSaveRef.current) {
                skipAutoSaveRef.current = false;
                return;
            }

            const nothingToSave = !title.trim() && !content.trim();
            const unchanged = title === lastSavedTitle.current && content === lastSavedContent.current;
            const improvementDraft = improvementDraftsRef.current[activeVariantId] ?? '';
            const improvementSaved = improvementSavedRef.current[activeVariantId] ?? '';
            const improvementTitleDraft = improvementTitleDraftsRef.current[activeVariantId] ?? title;
            const improvementTitleSaved = improvementTitleSavedRef.current[activeVariantId] ?? resolveImprovementVariantTitle(activeVariantId);
            const hasChanges = activeVariantId === 'original'
                ? !(nothingToSave || unchanged)
                : improvementDraft !== improvementSaved || improvementTitleDraft !== improvementTitleSaved;

            if (!hasChanges) {
                return;
            }

            event.preventDefault();
            Keyboard.dismiss();

            const saveAndExit = async () => {
                try {
                    await saveNote();
                } catch (error) {
                    console.error('Error during navigation auto-save:', error);
                    return;
                }

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

            saveAndExit();
        });

        return unsubscribe;
    }, [clearAgentSessionState, content, navigation, resolveImprovementVariantTitle, saveNote, title]);

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
        Keyboard.dismiss();

        // Check if note is effectively empty
        const isContentEmpty = !title.trim() && !content.trim();
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
                skipAutoSaveRef.current = true;
                navigateBackToList();
            } catch (error) {
                console.error('Error during back navigation save:', error);
            }
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
                const taskVariantId = task.targetVariantId || 'original';
                const normalizedTaskText = validBatch.map(t => t.transcribedText.trim()).filter(Boolean).join('\n\n');
                const representativeRecordingId = getRepresentativeRecordingId(task);
                const pendingContextAtStart = resolvePendingInsertionContext(taskVariantId, representativeRecordingId);
                const contextContent = pendingContextAtStart.contentWithoutPending;
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
                        const status = taskVariantId === 'original' ? 'Added to Original' : 'Added to Improved';
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
                        validBatch.forEach(t => {
                            if (t.recordingId) {
                                pendingVoiceInsertionsRef.current.delete(t.recordingId);
                                setRecordingOutcomeStatus(t.recordingId, 'Saved recording');
                            }
                        });
                        // We still shift below
                    } else if (agentResult.success) {
                        // SUCCESS HANDLER
                        if (normalizedTaskText) {
                            setRequestHistory(prev => {
                                const newHistory = [...prev, normalizedTaskText];
                                return newHistory.slice(-AGENT_HISTORY_LIMIT);
                            });
                        }

                        const originalText = (agentResult.originalText || normalizedTaskText || '').trim();
                        const explicitTitle = (agentResult.titleValue || '').trim();
                        const pendingContext = resolvePendingInsertionContext(taskVariantId, representativeRecordingId);
                        const commandBaseContent = pendingContext.contentWithoutPending;
                        const dictatedContentForUndo = pendingContext.dictationContent;
                        const hasPendingDraft = validBatch.some(t => t.recordingId && pendingContext.pending);
                        const processedText = typeof agentResult.processedText === 'string'
                            ? agentResult.processedText.trim()
                            : '';
                        const hasApplicableInstruction =
                            agentResult.hasInstruction &&
                            !!processedText &&
                            !areTextsEquivalent(processedText, originalText);

                        if (agentResult.titleAction === 'set' && explicitTitle && localNoteIdRef.current) {
                            if (hasPendingDraft) {
                                validBatch.forEach(t => {
                                    if (t.recordingId) pendingVoiceInsertionsRef.current.delete(t.recordingId);
                                });
                                replaceCurrentHistoryState(
                                    taskVariantId,
                                    resolveImprovementVariantTitle(taskVariantId),
                                    dictatedContentForUndo
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
                                        label: buildAgentImprovementLabel(explicitTitle, explicitTitle) || undefined,
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
                            allRecordingIds.forEach(id => {
                                setRecordingOutcomeStatus(id, 'Updated title');
                                showVoiceResultStatus('Updated title', id);
                            });
                            // Explicit title command should not mutate note content.
                            continue;
                        }

                        const suggestedTitleRaw = (agentResult.suggestedTitle || '').trim();
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
                            let newText: string | null = null;
                            if (agentResult.mode === 'edit_content') {
                                newText = processedText;
                            } else if (agentResult.mode === 'todo' || agentResult.mode === 'list' || agentResult.mode === 'format') {
                                const looksLikeFullDocument =
                                    processedText.includes('\n') &&
                                    processedText.length >= Math.max(40, Math.floor(commandBaseContent.length * 0.5));
                                newText = looksLikeFullDocument
                                    ? processedText
                                    : appendSnippetToContent(commandBaseContent, processedText);
                            } else {
                                newText = appendSnippetToContent(commandBaseContent, processedText);
                            }

                            if (newText && !areTextsEquivalent(newText, commandBaseContent)) {
                                // Original must keep only raw dictation; AI transformation is stored as improvement.
                                if (taskVariantId === 'original') {
                                    const shouldPreserveDictationInOriginal = !commandBaseContent.trim();
                                    const originalContentAfterCommand = shouldPreserveDictationInOriginal
                                        ? dictatedContentForUndo
                                        : commandBaseContent;

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
                                    const improvement = await createImprovement(targetNoteId, {
                                        content: newText,
                                        title: improvementTitle,
                                        label: generatedLabel || undefined,
                                    });

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

                                    const status = buildAgentStatusMessage(agentResult.mode, 'created');
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
                                            dictatedContentForUndo
                                        );
                                    }
                                    const nextVariantTitle = suggestedTitle || resolveImprovementVariantTitle(taskVariantId);
                                    if (localNoteIdRef.current && nextVariantTitle) {
                                        await updateImprovement(localNoteIdRef.current, taskVariantId, {
                                            title: nextVariantTitle,
                                            label: buildAgentImprovementLabel(nextVariantTitle, nextVariantTitle) || undefined,
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
                                    const status = buildAgentStatusMessage(agentResult.mode, 'updated');
                                    allRecordingIds.forEach(id => {
                                        setRecordingOutcomeStatus(id, status);
                                        showVoiceResultStatus(status, id);
                                    });
                                }
                            } else {
                                // Command was recognized but resulted in no effective content diff.
                                // Keep command out of the note and only clear pending marker.
                                const shouldPreserveDictationInOriginal =
                                    taskVariantId === 'original' && !commandBaseContent.trim();
                                const originalContentAfterCommand = shouldPreserveDictationInOriginal
                                    ? dictatedContentForUndo
                                    : commandBaseContent;
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
                                await setVariantContentWithOptions(taskVariantId, originalContentAfterCommand, {
                                    persist: true,
                                    updateHistory: false,
                                });
                                dictationFinalized = true;
                                allRecordingIds.forEach(id => {
                                    setRecordingOutcomeStatus(id, 'No changes');
                                    showVoiceResultStatus('No changes', id);
                                });
                            }
                        } else {
                            await finalizeAsDictation(originalText || normalizedTaskText);
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

    const cancelAgentProcessing = useCallback(async () => {
        if (isCancelingAgentRef.current) return;
        isCancelingAgentRef.current = true;

        try {
            const snapshot = [...activeAgentTasksRef.current, ...agentQueue.current]
                .filter((task): task is AgentQueueTask => !!task);
            const uniqueTasks: AgentQueueTask[] = [];
            const seenTaskIds = new Set<string>();
            snapshot.forEach((task) => {
                if (seenTaskIds.has(task.id)) return;
                seenTaskIds.add(task.id);
                uniqueTasks.push(task);
            });

            // Invalidate current in-flight session and clear queue immediately.
            agentSessionIdRef.current += 1;
            setRequestHistory([]);
            requestHistoryRef.current = [];
            agentQueue.current = [];
            activeAgentTasksRef.current = [];
            refreshTrackedQueueLength();
            setTrackedIsAIProcessing(false);

            for (const task of uniqueTasks) {
                const normalizedTaskText = task.transcribedText?.trim() || '';
                if (!normalizedTaskText) continue;
                if (task.noteId && task.noteId !== localNoteIdRef.current) continue;

                const taskVariantId = task.targetVariantId || 'original';
                const pendingContext = resolvePendingInsertionContext(taskVariantId, task.recordingId);
                const shouldSkipDictationApply =
                    !!task.dictationAlreadyApplied && !pendingContext.pending;
                if (shouldSkipDictationApply) continue;

                try {
                    const inserted = await finalizePendingInsertionAsDictation(
                        taskVariantId,
                        task.recordingId,
                        normalizedTaskText
                    );
                    if (!inserted) continue;
                    const status = taskVariantId === 'original' ? 'Added to Original' : 'Added to Improved';
                    setRecordingOutcomeStatus(task.recordingId, status);
                    showVoiceResultStatus(status, task.recordingId);
                } catch (error) {
                    console.error('[NoteEditScreen] Failed to finalize dictation after agent cancel', error);
                }
            }
        } finally {
            isCancelingAgentRef.current = false;
        }
    }, [
        finalizePendingInsertionAsDictation,
        refreshTrackedQueueLength,
        resolvePendingInsertionContext,
        setRecordingOutcomeStatus,
        setTrackedIsAIProcessing,
        showVoiceResultStatus,
    ]);

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
            const taskVariantId = taskToCancel.targetVariantId || 'original';
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
        resolvePendingInsertionContext,
        setRecordingOutcomeStatus,
        setTrackedIsAIProcessing,
        showVoiceResultStatus,
    ]);

    const shouldUseAgentModeGlobally = useCallback(
        async (agentModeOverride?: boolean): Promise<boolean> => {
            const provider = await getAIProvider();
            if (provider !== 'vaulto_ai') {
                return false;
            }
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

        const taskId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const newTask: AgentQueueTask = {
            id: taskId,
            transcribedText: normalizedText,
            sessionId: agentSessionIdRef.current,
            noteId: localNoteIdRef.current,
            targetVariantId,
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
            const isUserTranscriptionRestricted = !isAuthenticated || isGuest;
            const shouldUseAgentModeForThisRecording =
                micMode !== 'force_text' && await shouldUseAgentModeGlobally(agentModeEnabled);
            let shouldTranscribe = transcribe;
            let shouldAutoInsertAudioPlayer = false;
            if (isUserTranscriptionRestricted && shouldTranscribe) {
                // Anonymous users can't transcribe; keep audio flow intact.
                shouldTranscribe = false;
                if (micMode === 'force_text') {
                    setShowTranscriptionAuthModal(true);
                }
            }
            if (shouldTranscribe) {
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
                    transcription = await transcribeAudio(recording.uri);
                }
            } catch (err) {
                console.error('[NoteEditScreen] Transcription unexpected error:', err);
                transcription = { success: false, text: '', error: 'Unexpected transcription error' };
            } finally {
                setTrackedIsTranscribing(false);
            }

            isTranscriptionSuccess = transcription.success && !!transcription.text;
            transcribedText = isTranscriptionSuccess ? transcription.text : '';

            const shouldBypassAgentForThisRecording = micMode === 'force_text';
            if (isTranscriptionSuccess) {
                if (shouldBypassAgentForThisRecording || !shouldUseAgentModeForThisRecording) {
                    insertedPlainTextEarly = await applyPlainTextToVariant(targetVariantId, transcribedText);
                    if (insertedPlainTextEarly) {
                        registerTranscribedInsertion(transcribedText);
                    }
                } else if (wasNewNoteCreation && targetVariantId === 'original') {
                    insertedPlainTextEarly = await applyPlainTextToVariant('original', transcribedText);
                    if (insertedPlainTextEarly) {
                        registerTranscribedInsertion(transcribedText);
                    }
                } else {
                    insertedPendingEarly = await insertPendingTranscriptionToVariant(targetVariantId, voiceId, transcribedText);
                }
            }

            // Show informative message if transcription failed (but don't block saving)
            if (!isTranscriptionSuccess) {
                const errorMsg = transcription.error ? getErrorMessage(transcription.error, '') : '';
                const errorMsgLower = errorMsg.toLowerCase();
                const rawErrorLower = (transcription.error || '').toLowerCase();
                // Auto-insert audio player only when transcription is unavailable due to auth/quota limits.
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
                    rawErrorLower.includes('trial');
                shouldAutoInsertAudioPlayer = isAuthOrQuotaError;

                if (isAuthOrQuotaError) {
                    // Silent failure for auth/guest errors - audio is still saved
                    console.log('[Transparency] Transcription skipped due to auth/guest status');
                } else if (errorMsg) {
                    console.warn('[Transcription] Failed but audio will be saved:', errorMsg);
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
                    const titleToUse = title.trim();
                    const newNote = await createNote({
                        title: titleToUse,
                        content: currentContentRef.current,
                        storage_scope: storageScope,
                        privacy,
                        audio: {
                            filePath: savedPath,
                            duration: recording.duration,
                            transcription: transcribedText
                        }
                    });
                    setLocalNoteId(newNote.id);
                    localNoteIdRef.current = newNote.id;
                    syncTrackedProcessingToNote(newNote.id);
                    currentNoteId = newNote.id;
                    lastSavedTitle.current = title;
                    lastSavedContent.current = content;
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
                has_audio: true,
                audio_file_path: savedPath, // Update "primary" audio path to latest
                audio_duration: recording.duration,
                ...(transcribedText ? { encrypted_transcription: transcribedText } : {})
            });

            const playbackUri = await AudioService.readAudioFile(savedPath);
            setAudioUri(playbackUri);
            setAudioDuration(recording.duration);
            setShowAudioPlayer(true);
            setPlayingRecordingId(voiceId);

            if (targetVariantId === 'original' && shouldAutoInsertAudioPlayer) {
                await applyAudioPlayerToVariant('original', savedPath);
            }

            // 4. STOP IF NO TEXT
            if (!isTranscriptionSuccess) {
                const status = 'Saved recording (no text)';
                setRecordingOutcomeStatus(voiceId, status);
                showVoiceResultStatus(status, voiceId);
                return;
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

            // For the very first dictation that creates the note:
            // keep plain transcription in Original, skip processing marker,
            // then run Agent in background to create improvement when applicable.
            if (wasNewNoteCreation && targetVariantId === 'original') {
                const inserted = insertedPlainTextEarly
                    ? true
                    : await applyPlainTextToVariant('original', transcribedText);
                const status = inserted ? 'Added to Original' : 'Saved recording';
                setRecordingOutcomeStatus(voiceId, status);
                showVoiceResultStatus(status, voiceId);
                if (inserted) {
                    if (!insertedPlainTextEarly) {
                        registerTranscribedInsertion(transcribedText);
                    }
                }

                setRecordingOutcomeStatus(voiceId, 'Processing...');
                await executeAgentFlow(transcribedText, {
                    isBackground: true,
                    targetVariantId: 'original',
                    recordingId: voiceId,
                    micMode,
                    dictationAlreadyApplied: true,
                });
                return;
            }

            if (!insertedPendingEarly) {
                await insertPendingTranscriptionToVariant(targetVariantId, voiceId, transcribedText);
            }

            setRecordingOutcomeStatus(voiceId, 'Processing...');
            await executeAgentFlow(transcribedText, {
                isBackground: true,
                targetVariantId,
                recordingId: voiceId,
                micMode,
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
        if (!isAuthenticated || isGuest) {
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
            const transcription = await transcribeAudio(recording.uri);
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
        if (!isAuthenticated || isGuest) {
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

    const handleInsertRecordingAudioPlayer = useCallback(async (recording: VoiceRecording) => {
        const targetVariant = activeVariantIdRef.current;
        const inserted = await applyAudioPlayerToVariant(targetVariant, recording.file_path);
        if (!inserted) {
            return;
        }

        setRecordingOutcomeStatus(recording.id, 'Inserted audio player');
    }, [applyAudioPlayerToVariant, setRecordingOutcomeStatus]);

    const handleInsertSelectedRecordingText = useCallback(async () => {
        const selected = selectedRecordingForText;
        const recognizedText = selected?.transcription?.trim() || '';
        if (!selected || !recognizedText) {
            Alert.alert('No recognized text', 'This recording has no saved transcript yet.');
            return;
        }

        const targetVariant = activeVariantIdRef.current;

        const inserted = await applyPlainTextToVariant(targetVariant, recognizedText);
        if (!inserted) return;

        const status = targetVariant === 'original' ? 'Added to Original' : 'Added to Improved';
        setRecordingOutcomeStatus(selected.id, status);
        showVoiceResultStatus(status, selected.id);
        setShowRecordingTextModal(false);
    }, [applyPlainTextToVariant, selectedRecordingForText, setRecordingOutcomeStatus, showVoiceResultStatus]);

    const handleCopySelectedRecordingText = useCallback(async () => {
        const selected = selectedRecordingForText;
        const recognizedText = selected?.transcription?.trim() || '';
        if (!recognizedText) {
            Alert.alert('No recognized text', 'This recording has no saved transcript yet.');
            return;
        }
        await Clipboard.setStringAsync(recognizedText);
        showVoiceResultStatus('Copied transcript', selected?.id);
    }, [selectedRecordingForText, showVoiceResultStatus]);



    const handleFormat = useCallback((type: MarkdownFormatType) => {
        editorRef.current?.handleFormat(type);
    }, []);


    const handleCheckPress = () => {
        Keyboard.dismiss();
        setIsEditing(false); // Go to Preview Mode
        setReparseTrigger(prev => prev + 1);
        saveNote();
    };

    const handleAIImprovement = async (option: AIImprovementOption) => {
        setShowAIModal(false);
        setTrackedIsAIProcessing(true);
        setActiveImprovementTask({
            id: 'improvement-' + Date.now(),
            text: option.label || 'Improving text...',
            isTranscribing: false,
        });
        const variantAtRequestStart = activeVariantIdRef.current;
        try {
            const consentGranted = await requestPrivateAIConsent();
            if (!consentGranted) {
                return;
            }
            const sourceText = content.trim();
            if (!sourceText) {
                Alert.alert('Empty Text', 'Enter some text before requesting an improvement.');
                return;
            }
            const improvedText = await improveText(sourceText, option);

            let finalText = improvedText;

            if (option.id === 'grammar') {
                try {
                    let jsonString = improvedText;
                    const jsonStart = improvedText.indexOf('{');
                    const jsonEnd = improvedText.lastIndexOf('}');
                    if (jsonStart !== -1 && jsonEnd !== -1) {
                        jsonString = improvedText.substring(jsonStart, jsonEnd + 1);
                    }
                    const jsonRes = JSON.parse(jsonString);

                    // If the AI says it's correct, we stop here.
                    if (jsonRes.is_correct) {
                        showToast('✨ Perfect! No grammar errors found.', 3000);
                        setTrackedIsAIProcessing(false);
                        return;
                    }

                    // Otherwise, we expect fixed_text
                    if (jsonRes.fixed_text) {
                        finalText = jsonRes.fixed_text;
                    } else if (jsonRes.corrected_text) {
                        // Fallback in case AI hallucinates the old key
                        finalText = jsonRes.corrected_text;
                    }
                } catch (e) {
                    // Use warn instead of error to avoid RedBox in development
                    console.warn('Failed to parse grammar correction JSON', e);


                    // Fallback: if the response looks like just the corrected text (no JSON structure), use it
                    // But for grammar, we expect JSON. If parsing failed, it might be a chatty response.
                    // If it's chatty, we probably shouldn't blindly use it. 
                    // However, we verify if it matches source text to avoid false positives.
                    if (areTextsEquivalent(sourceText, improvedText)) {
                        showToast('✨ Perfect! No grammar errors found.', 3000);
                        setTrackedIsAIProcessing(false);
                        return;
                    }
                }
            } else if (areTextsEquivalent(sourceText, improvedText)) {
                Alert.alert('No changes', 'The text remains unchanged.');
                setTrackedIsAIProcessing(false);
                return;
            }

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
                    privacy,
                });
                targetNoteId = newNote.id;
                setLocalNoteId(newNote.id);
                localNoteIdRef.current = newNote.id;
                syncTrackedProcessingToNote(newNote.id);
                lastSavedTitle.current = title;
                lastSavedContent.current = content;
            } else if (variantAtRequestStart === 'original') {
                await saveNote();
            } else {
                await saveImprovementDraft();
            }

            if (!targetNoteId) {
                throw new Error('Failed to resolve note ID for improvement');
            }

            // Check if we're on the original note or a child variant
            console.log('[NoteEditScreen] Applying improvement');

            if (variantAtRequestStart === 'original') {
                // Create new child variant from parent
                console.log('[NoteEditScreen] Creating new improvement variant');
                const improvementTitle = (deriveTitleFromText(finalText) || title || existingNote?.title || '').trim();
                const improvementLabel = buildAgentImprovementLabel(improvementTitle, option.label || '');
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

                // Initialize history for new variant
                variantHistories.current[improvement.id] = {
                    history: [{ title: improvementTitle, content: finalText }],
                    index: 0
                };
                // No need to call setHistoryUpdateCount because index 0 means no undo yet, which is correct for new "file"

                const shouldSwitchToNewImprovement = activeVariantIdRef.current === 'original';
                if (shouldSwitchToNewImprovement) {
                    setActiveVariantId(improvement.id);
                    activeVariantIdRef.current = improvement.id;
                    optimisticActiveVariant.current = improvement.id;
                    setTitle(improvementTitle);
                    setContent(finalText);
                    currentContentRef.current = finalText;
                    // Persist active variant asynchronously after optimistic switch to avoid UI fallback flicker.
                    await setActiveVariant(targetNoteId, improvement.id);
                }
            } else {
                // Update existing child variant in-place (no new children from children)
                console.log('[NoteEditScreen] Updating existing improvement in-place');
                const variantTitleBase = activeVariantIdRef.current === variantAtRequestStart
                    ? currentTitleRef.current
                    : resolveImprovementVariantTitle(variantAtRequestStart);
                const nextVariantTitle = (variantTitleBase || deriveTitleFromText(finalText)).trim();
                const nextVariantLabel = buildAgentImprovementLabel(nextVariantTitle, option.label || '');
                await updateImprovement(targetNoteId, variantAtRequestStart, {
                    content: finalText,
                    title: nextVariantTitle,
                    label: nextVariantLabel || undefined,
                    optionId: option.id,
                });

                console.log('[NoteEditScreen] Improvement updated successfully');

                // Update refs and UI with new content
                improvementDraftsRef.current[variantAtRequestStart] = finalText;
                improvementSavedRef.current[variantAtRequestStart] = finalText;
                improvementTitleDraftsRef.current[variantAtRequestStart] = nextVariantTitle;
                improvementTitleSavedRef.current[variantAtRequestStart] = nextVariantTitle;
                if (activeVariantIdRef.current === variantAtRequestStart) {
                    setTitle(nextVariantTitle);
                    setContent(finalText);
                    currentContentRef.current = finalText;
                }

                // Update history for this variant
                updateHistoryImmediate(nextVariantTitle, finalText, variantAtRequestStart);
            }
        } catch (error: any) {
            const prettyMessage = getErrorMessage(error, 'Failed to improve text. Check AI settings.');
            showPrettyQuotaNotification(error, prettyMessage);
        } finally {
            setTrackedIsAIProcessing(false);
            setActiveImprovementTask(null);
        }
    };

    const handleReorderEnd = async (data: AIImprovementOption[]) => {
        setAiOptions(data);
        await saveImprovementOptions(data);
    };

    const handleDeletePrompt = (id: string) => {
        Alert.alert(
            'Delete Prompt',
            'Are you sure you want to delete this prompt?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
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
            id: `custom - ${Date.now()} `,
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
            return <Text style={styles.promptPreviewPlaceholder}>Start typing prompt text</Text>;
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
        ? new Date(existingNote.updated_at).toLocaleString('en-US', {
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        })
        : new Date().toLocaleString('en-US', {
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });

    const charCount = content.length;
    const canUseAI = content.trim().length > 0;
    const effectiveStorageScope: StorageScope = normalizeScope(storageScope);
    const canShareOrExport = effectiveStorageScope !== 'local_only';
    const micHintText = 'Hold: no agent';
    const selectedRecordingText = selectedRecordingForText?.transcription?.trim() || '';
    const agentProcessingActive =
        agentModeIndicatorEnabled && (isAIProcessing || queueLength > 0);
    const aiIndicatorVisible = isAIProcessing || queueLength > 0 || isTranscribing;
    const aiIndicatorCanCancel = agentProcessingActive && !isTranscribing;

    // Handle initial recording passed from navigation
    useEffect(() => {
        if (route.params?.initialRecording) {
            handleRecordingFinish(route.params.initialRecording, route.params.initialTranscribe ?? true);
        }
    }, [route.params?.initialRecording]);

    // Track keyboard visibility to handle color picker interactions
    const isKeyboardVisible = useRef(false);

    useEffect(() => {
        const showSub = Keyboard.addListener('keyboardDidShow', () => {
            setIsEditing(true);
            isKeyboardVisible.current = true;
        });
        const hideSub = Keyboard.addListener('keyboardDidHide', () => {
            isKeyboardVisible.current = false;
            editorRef.current?.blur();
            if (!isColorPickerOpen.current) {
                setIsEditing(false);
            }
        });

        return () => {
            showSub.remove();
            hideSub.remove();
        };
    }, []);

    const handleRetryTranscription = async (recording?: VoiceRecording) => {
        const targetRecording = recording
            || voiceRecordings.find((rec) => rec.id === playingRecordingId)
            || voiceRecordings[0];
        if (!targetRecording) return;
        if (!isAuthenticated || isGuest) {
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

        // 1. Close player if playing deleted file OR if no recordings left
        if (remaining.length === 0) {
            setShowAudioPlayer(false);
            setAudioUri(null);
            setPlayingRecordingId(null);
        } else if (playingRecordingId === id) {
            // Precise match via ID
            setShowAudioPlayer(false);
            setAudioUri(null);
            setPlayingRecordingId(null);
        } else if (audioUri && (audioUri.includes(path) || path.includes(audioUri))) {
            // Fallback fuzzy match
            setShowAudioPlayer(false);
            setAudioUri(null);
            setPlayingRecordingId(null);
        }

        // 2. Remove the specific audio markdown tag from content
        // Check if we can use the Editor's native block removal (Proper Solution)
        if (editMode === 'visual' && editorRef.current) {
            console.log('[NoteEditScreen] Removing audio block via Editor API');
            editorRef.current.removeAudioBlock(path);
            // NOTE: Editor will trigger onChange -> handleContentChange -> setContent & debouncedSave
        } else {
            // Fallback: Raw String Manipulation (for Raw Mode or if Ref missing)
            const currentContent = currentContentRef.current;
            let newContent = currentContent;

            const filename = path.split('/').pop();
            if (filename) {
                const escapedFilename = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const audioTagRegex = new RegExp(`\\s*!\\[audio\\]\\([^)]*${escapedFilename}\\)\\s*`, 'g');
                newContent = newContent.replace(audioTagRegex, '');
                newContent = newContent.replace(/\n{3,}/g, '\n\n').trim();
            } else {
                const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const audioTagRegex = new RegExp(`\\s*!\\[audio\\]\\(${escapedPath}\\)\\s*`, 'g');
                newContent = newContent.replace(audioTagRegex, '');
                newContent = newContent.replace(/\n{3,}/g, '\n\n').trim();
            }

            setContent(newContent);
            currentContentRef.current = newContent;

            // Save immediately for Raw mode
            if (localNoteId) {
                await updateNote(localNoteId, { content: newContent });
            }

            // Trigger reparse just in case if we switch back to visual
            setReparseTrigger(prev => prev + 1);
        }

        // 3. Update DB state if no recordings left
        if (remaining.length === 0 && localNoteId) {
            await updateNote(localNoteId, { has_audio: false });

            // 4. Auto-delete check (Deferred to handleBack)
            const latestContent = currentContentRef.current;
            const isContentEmpty = !title.trim() && !latestContent.trim();
            if (isContentEmpty) {
                console.log('[AutoClean] Note came empty after deleting last audio. Will be auto-deleted on exit if left empty.');
            }
        } else {
            const latestContent = currentContentRef.current;
            updateHistory(title, latestContent);
            debouncedSave(latestContent, title);
        }
    };

    const renderHeader = () => (
        <View>
            <TextInput
                style={styles.titleInput}
                placeholder="Title"
                placeholderTextColor={colors.textMuted}
                value={title}
                onChangeText={handleTitleChange}
                onFocus={() => setIsEditing(true)}
                maxLength={100}
                multiline
            />

            <View style={styles.metaInfo}>
                <Text style={styles.metaText}>{dateStr}  |  {charCount} characters</Text>
            </View>

            {noteImprovements.length > 0 && (
                <View style={styles.variantContainer}>
                    <GestureHandlerScrollView
                        horizontal
                        nestedScrollEnabled
                        directionalLockEnabled
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.variantScrollContent}
                        keyboardShouldPersistTaps="always"
                    >
                        <TouchableOpacity
                            style={[styles.variantChip, activeVariantId === 'original' && styles.variantChipActive]}
                            onPress={() => handleVariantSelect('original')}
                        >
                            <MaterialIcons
                                name="lock"
                                size={14}
                                color={activeVariantId === 'original' ? colors.background : colors.textSecondary}
                                style={styles.variantChipIcon}
                            />
                            <Text
                                style={[
                                    styles.variantChipText,
                                    activeVariantId === 'original' && styles.variantChipTextActive,
                                ]}
                            >
                                Original
                            </Text>
                        </TouchableOpacity>

                        {noteImprovements.map((imp: any) => (
                            <View style={styles.variantChipWrapper} key={imp.id}>
                                <TouchableOpacity
                                    style={[
                                        styles.variantChip,
                                        activeVariantId === imp.id && styles.variantChipActive,
                                    ]}
                                    onPress={() => handleVariantSelect(imp.id)}
                                >
                                    <MaterialIcons
                                        name="auto-awesome"
                                        size={14}
                                        color={activeVariantId === imp.id ? colors.background : colors.textSecondary}
                                        style={styles.variantChipIcon}
                                    />
                                    <Text
                                        numberOfLines={1}
                                        style={[
                                            styles.variantChipText,
                                            activeVariantId === imp.id && styles.variantChipTextActive,
                                        ]}
                                    >
                                        {imp.label || 'Improvement'}
                                    </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={styles.variantDeleteButton}
                                    onPress={() => confirmDeleteImprovement(imp.id)}
                                >
                                    <MaterialIcons name="close" size={14} color={colors.textMuted} />
                                </TouchableOpacity>
                            </View>
                        ))}
                    </GestureHandlerScrollView>
                </View>
            )}



            {/* Inline Player for Empty Voice Notes */}
            {voiceRecordings.length > 0 && !title && (!content || content.trim().length === 0) && !isTranscribing && !isRecordingFlowActive && transcriptionEnabled && (
                <View style={{ marginBottom: spacing.m, marginTop: spacing.s }}>
                    {showAudioPlayer && audioUri && (
                        <AudioPlayer
                            audioUri={audioUri}
                            duration={audioDuration}
                            onClose={() => setShowAudioPlayer(false)}
                        />
                    )}
                </View>
            )}


        </View>
    );

    return (
        <ScreenContainer>
            <View style={styles.header}>
                <TouchableOpacity onPress={handleBack} style={styles.iconButton}>
                    <MaterialIcons name="arrow-back" size={28} color={colors.text} />
                </TouchableOpacity>
                <View style={styles.headerRight}>
                    {/* Text Appearance Button */}
                    <TouchableOpacity
                        onPress={() => setShowAppearanceModal(true)}
                        style={styles.iconButton}
                    >
                        <MaterialIcons name="text-fields" size={24} color={colors.text} />
                    </TouchableOpacity>
                    {/* AI Improvement Button */}
                    <TouchableOpacity
                        onPress={() => { void handleAiAccess(() => setShowAIModal(true)); }}
                        style={[styles.iconButton, (!canUseAI || isAIProcessing) && styles.disabledIcon]}
                        disabled={isAIProcessing || !canUseAI}
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
                            onPress={() => setShowRecordingsList(true)}
                            style={styles.iconButton}
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
                            <TouchableOpacity onPress={handleCheckPress} style={styles.iconButton}>
                                <MaterialIcons name="check" size={24} color={colors.text} />
                            </TouchableOpacity>
                        </>
                    ) : (
                        <TouchableOpacity onPress={() => setShowMenu(true)} style={styles.iconButton}>
                            <MaterialIcons name="more-vert" size={24} color={colors.text} />
                        </TouchableOpacity>
                    )}
                </View>
            </View>

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
                                        <Text style={[styles.aiModalTitle, styles.aiModalTitleInline]}>Improve Text with AI</Text>
                                        <View style={styles.aiActions}>
                                            <TouchableOpacity
                                                style={styles.aiActionButton}
                                                onPress={() => setShowPromptBuilder(true)}
                                            >
                                                <MaterialIcons name="add" size={18} color={colors.primary} />
                                                <Text style={styles.aiActionText}>Create</Text>
                                            </TouchableOpacity>
                                        </View>
                                    </View>

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
                                                <Text style={styles.customBoxLabel}>Custom Instruction</Text>
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
                                                    <Text style={styles.runCustomButtonText}>Apply Instruction</Text>
                                                    <MaterialIcons name="arrow-forward" size={16} color="white" />
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
                                                                <Text style={styles.aiOptionLabel}>{item.label}</Text>
                                                                {renderOptionPrompt(item.prompt)}
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
                                        <Text style={styles.aiCloseButtonText}>Cancel</Text>
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
                                    <Text style={styles.aiModalTitle}>New Prompt</Text>
                                    <Text style={styles.promptHelper}>
                                        Use {'{text}'} to indicate where to insert note text.
                                    </Text>
                                    <View>
                                        <Text style={styles.promptHelper}>Icon</Text>
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
                                                            color={selected ? colors.surface : colors.text}
                                                        />
                                                    </TouchableOpacity>
                                                );
                                            })}
                                        </ScrollView>
                                    </View>
                                    <TextInput
                                        style={styles.promptInput}
                                        placeholder="Prompt name"
                                        placeholderTextColor={colors.textMuted}
                                        value={newPromptTitle}
                                        onChangeText={setNewPromptTitle}
                                    />
                                    <TextInput
                                        style={[styles.promptInput, styles.promptTextarea]}
                                        placeholder="Prompt text"
                                        placeholderTextColor={colors.textMuted}
                                        value={newPromptTemplate}
                                        onChangeText={setNewPromptTemplate}
                                        multiline
                                        textAlignVertical="top"
                                    />
                                    <View style={styles.promptPreviewBox}>
                                        <Text style={styles.promptPreviewLabel}>Preview</Text>
                                        {renderPromptPreview()}
                                    </View>

                                    <View style={styles.promptActions}>
                                        <TouchableOpacity
                                            style={styles.promptCancel}
                                            onPress={closePromptBuilder}
                                        >
                                            <Text style={styles.aiCloseButtonText}>Cancel</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={[
                                                styles.savePromptButton,
                                                (!newPromptTitle.trim() || !newPromptTemplate.trim()) && styles.savePromptDisabled,
                                            ]}
                                            disabled={!newPromptTitle.trim() || !newPromptTemplate.trim()}
                                            onPress={handleCreatePrompt}
                                        >
                                            <Text style={styles.savePromptText}>Save</Text>
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
                                <Text style={styles.menuSectionTitle}>EDITOR MODE</Text>
                            </View>
                            <TouchableOpacity onPress={() => { setEditMode('visual'); setShowMenu(false); setIsEditing(true); }} style={styles.menuItem}>
                                <MaterialIcons name="view-quilt" size={20} color={editMode === 'visual' ? colors.primary : colors.text} style={{ marginRight: 12 }} />
                                <Text style={[styles.menuItemText, editMode === 'visual' && { color: colors.primary, fontWeight: 'bold' }]}>Visual Editor</Text>
                                {editMode === 'visual' && <MaterialIcons name="check" size={16} color={colors.primary} style={{ marginLeft: 'auto' }} />}
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => { setEditMode('raw'); setShowMenu(false); setIsEditing(false); }} style={styles.menuItem}>
                                <MaterialIcons name="code" size={20} color={editMode === 'raw' ? colors.primary : colors.text} style={{ marginRight: 12 }} />
                                <Text style={[styles.menuItemText, editMode === 'raw' && { color: colors.primary, fontWeight: 'bold' }]}>Raw Markdown</Text>
                                {editMode === 'raw' && <MaterialIcons name="check" size={16} color={colors.primary} style={{ marginLeft: 'auto' }} />}
                            </TouchableOpacity>

                            <View style={styles.menuDivider} />

                            <View style={styles.menuSectionHeader}>
                                <Text style={styles.menuSectionTitle}>COPY</Text>
                            </View>
                            <TouchableOpacity onPress={handleCopyPlainText} style={styles.menuItem}>
                                <MaterialIcons name="content-copy" size={20} color={colors.text} style={{ marginRight: 12 }} />
                                <Text style={styles.menuItemText}>Copy Plain Text</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={handleCopyMarkdown} style={styles.menuItem}>
                                <MaterialIcons name="code" size={20} color={colors.text} style={{ marginRight: 12 }} />
                                <Text style={styles.menuItemText}>Copy Markdown</Text>
                            </TouchableOpacity>

                            {canShareOrExport ? (
                                <>
                                    <View style={styles.menuDivider} />

                                    <View style={styles.menuSectionHeader}>
                                        <Text style={styles.menuSectionTitle}>SHARE & EXPORT</Text>
                                    </View>
                                    <TouchableOpacity onPress={handleShareText} style={styles.menuItem}>
                                        <MaterialIcons name="share" size={20} color={colors.text} style={{ marginRight: 12 }} />
                                        <Text style={styles.menuItemText}>Share Text</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity onPress={handleExportMarkdownFile} style={styles.menuItem}>
                                        <MaterialIcons name="file-present" size={20} color={colors.text} style={{ marginRight: 12 }} />
                                        <Text style={styles.menuItemText}>Export Markdown File</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity onPress={handleExportImage} style={styles.menuItem}>
                                        <MaterialIcons name="image" size={20} color={colors.text} style={{ marginRight: 12 }} />
                                        <Text style={styles.menuItemText}>Export as Image</Text>
                                    </TouchableOpacity>
                                </>
                            ) : (
                                <>
                                    <View style={styles.menuDivider} />

                                    <View style={styles.menuSectionHeader}>
                                        <Text style={styles.menuSectionTitle}>SHARE & EXPORT</Text>
                                    </View>
                                    <View style={styles.menuItem}>
                                        <MaterialIcons name="privacy-tip" size={20} color={colors.textSecondary} style={{ marginRight: 12 }} />
                                        <Text style={[styles.menuItemText, { color: colors.textSecondary }]}>
                                            Disabled for private notes
                                        </Text>
                                    </View>
                                </>
                            )}

                            <View style={styles.menuDivider} />

                            <View style={styles.menuSectionHeader}>
                                <Text style={styles.menuSectionTitle}>SECURITY</Text>
                            </View>
                            <TouchableOpacity
                                onPress={() => {
                                    setShowMenu(false);
                                    void applyStorageScope(
                                        effectiveStorageScope === 'local_only' ? 'sync' : 'local_only'
                                    );
                                }}
                                style={styles.menuItem}
                            >
                                <MaterialIcons
                                    name={effectiveStorageScope === 'local_only' ? 'cloud-upload' : 'smartphone'}
                                    size={20}
                                    color={colors.text}
                                    style={{ marginRight: 12 }}
                                />
                                <Text style={styles.menuItemText}>
                                    {effectiveStorageScope === 'local_only' ? 'Make Sync' : 'Make Local-Only'}
                                </Text>
                            </TouchableOpacity>
                            <View style={styles.menuDivider} />

                            <TouchableOpacity onPress={handleDelete} style={styles.menuItem}>
                                <MaterialIcons name="delete-outline" size={20} color={colors.error} style={{ marginRight: 12 }} />
                                <Text style={[styles.menuItemText, { color: colors.error }]}>Delete Note</Text>
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
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 72 : 36}
                style={{ flex: 1 }}
            >
                <View
                    ref={viewShotRef}
                    collapsable={false}
                    style={{ flex: 1, backgroundColor: colors.background }}
                >
                    {editMode === 'raw' ? (
                        // Raw Markdown Editor
                        <TextInput
                            style={[
                                styles.rawInput,
                                {
                                    fontSize: fontSize,
                                    lineHeight: fontSize * 1.5,
                                    color: colors.text,
                                    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace'
                                }
                            ]}
                            multiline
                            onFocus={() => setIsEditing(true)}
                            value={content}
                            onChangeText={(text) => {
                                // Direct update for raw mode, bypassing auto-list logic
                                setContent(text);
                                if (existingNote) debouncedSave(text, title);
                                if (activeVariantId === 'original') {
                                    updateHistory(title, text);
                                } else {
                                    improvementDraftsRef.current[activeVariantId] = text;
                                    updateHistory(title, text);
                                }
                            }}
                            placeholder="Start typing markdown..."
                            placeholderTextColor={colors.textMuted}
                            textAlignVertical="top"
                            autoCapitalize="sentences"
                        />
                    ) : (
                        // Visual Rich Editor - Handles both Viewing and Editing
                        <RichTextEditor
                            ref={editorRef}
                            initialContent={content}
                            reparseTrigger={reparseTrigger}
                            baseFontSize={fontSize}
                            autoScalingEnabled={autoScalingEnabled}
                            onChange={(text) => {
                                setContent(text);
                                if (existingNote) debouncedSave(text, title);
                                if (activeVariantId === 'original') {
                                    updateHistory(title, text);
                                } else {
                                    improvementDraftsRef.current[activeVariantId] = text;
                                    updateHistory(title, text);
                                }
                            }}
                            onActiveStylesChange={setActiveFormats}
                            onFocus={() => setIsEditing(true)}
                            placeholder="Start typing..."
                            ListHeaderComponent={renderHeader()}
                        />
                    )}
                </View>

                {/* Formatting Toolbar - Show only in Visual Edit Mode */}
                {isEditing && editMode === 'visual' && (
                    <View style={styles.toolbarContainer}>
                        <MarkdownToolbar
                            onFormat={handleFormat}
                            activeFormats={activeFormats}
                            onColorPickerToggle={(visible) => {
                                isColorPickerOpen.current = visible;
                                if (!visible && !isKeyboardVisible.current) {
                                    setIsEditing(false);
                                }
                            }}
                        />
                    </View>
                )}
            </KeyboardAvoidingView>

            {/* Floating Mic Button */}
            {
                !isEditing && !showVoiceRecorder && (
                    <View style={styles.micFloatingContainer}>
                        <View style={{ position: 'absolute', width: 120, height: 120, justifyContent: 'center', alignItems: 'center', pointerEvents: 'none', top: -32 }}>
                            <Svg height="120" width="120" viewBox="0 0 120 120">
                                <Defs>
                                    <Path
                                        id="micCurve"
                                        d="M 20,60 A 40,40 0 0 0 100,60"
                                    />
                                </Defs>
                                <SvgText fill={colors.textSecondary} fontSize="8" fontWeight="bold" textAnchor="middle" letterSpacing={2}>
                                    <TextPath href="#micCurve" startOffset="50%">
                                        {micHintText.toUpperCase()}
                                    </TextPath>
                                </SvgText>
                            </Svg>
                        </View>
                        <TouchableOpacity
                            style={styles.micButton}
                            onPress={handleMicPress}
                            onLongPress={handleMicLongPress}
                            delayLongPress={250}
                            activeOpacity={0.8}
                        >
                            <MaterialIcons name="mic" size={28} color="white" />
                        </TouchableOpacity>
                    </View>
                )
            }

            <PrivacyWarningModal
                visible={showPrivacyWarning}
                onAccept={handlePrivacyAccept}
                onCancel={() => setShowPrivacyWarning(false)}
            />

            <DeleteConfirmationDialog
                visible={improvementToDelete !== null}
                title="Delete Improvement?"
                message="This version will be removed. You can always regenerate it later."
                onCancel={() => setImprovementToDelete(null)}
                onConfirm={() => {
                    if (improvementToDelete) {
                        handleDeleteImprovementVariant(improvementToDelete);
                        setImprovementToDelete(null);
                    }
                }}
            />

            <DeleteConfirmationDialog
                visible={recordingToDelete !== null}
                title="Delete Recording?"
                message="Are you sure you want to delete this recording?"
                onCancel={() => setRecordingToDelete(null)}
                onConfirm={confirmDeleteRecording}
            />

            <DeleteConfirmationDialog
                visible={isDeletingNote}
                title="Delete Note"
                message="Are you sure you want to delete this note?"
                onCancel={() => setIsDeletingNote(false)}
                onConfirm={confirmDeleteNote}
            />

            <ErrorModal
                visible={errorModalVisible}
                title={errorTitle}
                message={errorMessage}
                secondaryActionLabel={errorShowSettingsAction ? 'Open Settings' : undefined}
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
                title="Sign in required"
                message="Transcription is available after you create an account."
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
                micMode={pendingMicInputMode}
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
                autoStart={true}
            />

            <TranscriptionIndicator visible={isTranscribing} />

            {/* Recordings List Modal */}
            <Modal
                visible={showRecordingsList}
                transparent
                animationType="slide"
                onRequestClose={() => setShowRecordingsList(false)}
            >
                <TouchableWithoutFeedback onPress={() => setShowRecordingsList(false)}>
                    <GestureHandlerRootView style={styles.modalOverlay}>
                        <TouchableWithoutFeedback>
                            <View style={styles.aiModalContent}>
                                <Text style={styles.aiModalTitle}>Voice Recordings</Text>

                                {showAudioPlayer && !!audioUri && (
                                    <View style={{ marginBottom: spacing.m }}>
                                        <AudioPlayer
                                            audioUri={audioUri as string}
                                            duration={audioDuration}
                                            onClose={() => {
                                                setShowAudioPlayer(false);
                                                setPlayingRecordingId(null);
                                            }}
                                        />
                                    </View>
                                )}

                                <ScrollView style={{ maxHeight: 400 }} contentContainerStyle={{ paddingBottom: spacing.l }}>
                                    {voiceRecordings.length === 0 ? (
                                        <Text style={{ textAlign: 'center', color: colors.textMuted, marginTop: spacing.m }}>
                                            No recordings yet.
                                        </Text>
                                    ) : (
                                        voiceRecordings.map((rec) => {
                                            const isPlaying = playingRecordingId === rec.id;
                                            const hasRecognizedText = !!rec.transcription?.trim();
                                            const hasAudioPlayerInCurrentVariant = isAudioAlreadyInsertedInCurrentVariant(rec.file_path);
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
                                                            backgroundColor: '#F3F4F6', // More subtle, cleaner grey
                                                            borderColor: colors.border,
                                                            borderWidth: 1
                                                        }
                                                    ]}
                                                    onPress={async () => {
                                                        setPlayingRecordingId(rec.id);

                                                        try {
                                                            const uri = await AudioService.readAudioFile(rec.file_path);
                                                            setAudioUri(uri);
                                                            setAudioDuration(rec.duration);
                                                            setShowAudioPlayer(true);
                                                        } catch (e) {
                                                            console.error('Failed to play audio:', e);
                                                            setPlayingRecordingId(null);
                                                        }
                                                    }}
                                                >
                                                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
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

                                                        <View style={{ flex: 1, marginRight: spacing.s }}>
                                                            <Text style={[styles.recordingTitle, isPlaying && { color: colors.primary }]}>
                                                                {formatDuration(rec.duration)}
                                                            </Text>
                                                            <Text style={styles.recordingSubtitle} numberOfLines={1}>
                                                                {new Date(rec.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                                                            </Text>
                                                        </View>

                                                        <View style={styles.recordingCompactActions}>
                                                            <TouchableOpacity
                                                                style={[styles.recordingActionChip, hasAudioPlayerInCurrentVariant && styles.recordingActionDisabled]}
                                                                disabled={hasAudioPlayerInCurrentVariant}
                                                                onPress={() => {
                                                                    void handleInsertRecordingAudioPlayer(rec);
                                                                }}
                                                            >
                                                                <MaterialIcons name="headset" size={14} color={hasAudioPlayerInCurrentVariant ? colors.textMuted : colors.primary} />
                                                                <Text style={[styles.recordingActionChipText, hasAudioPlayerInCurrentVariant && { color: colors.textMuted }]}>Insert</Text>
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
                                                                            <Text style={styles.recordingActionChipText}>AI</Text>
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
                                                                    <Text style={[styles.recordingActionChipText, { color: colors.textSecondary }]}>View</Text>
                                                                </TouchableOpacity>
                                                            )}

                                                            <TouchableOpacity
                                                                style={{ padding: 6 }}
                                                                onPress={() => handleDeleteRecording(rec.id, rec.file_path)}
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
                                <Text style={styles.aiModalTitle}>Recognized text</Text>
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
                                    <Text style={styles.recordingActionText}>Insert</Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={[styles.recordingSecondaryAction, !selectedRecordingText && styles.recordingActionDisabled]}
                                    disabled={!selectedRecordingText}
                                    onPress={() => {
                                        void handleCopySelectedRecordingText();
                                    }}
                                >
                                    <Text style={styles.recordingSecondaryText}>Copy</Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={styles.recordingCloseAction}
                                    onPress={() => setShowRecordingTextModal(false)}
                                >
                                    <Text style={styles.recordingCloseText}>Close</Text>
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

const styles = StyleSheet.create({
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: spacing.m,
        marginBottom: spacing.xs,
        marginTop: 0,
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: spacing.m,
        marginBottom: spacing.xs,
        marginTop: 0,
    },
    headerRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.m,
    },
    iconButton: {
        padding: spacing.xs,
        minWidth: 40,
        alignItems: 'center',
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
        backgroundColor: colors.surface,
        borderRadius: 8,
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
        borderRadius: 18,
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
    },
    variantChipTextActive: {
        color: colors.background,
    },
    variantChipIcon: {
        marginRight: 6,
    },
    variantDeleteButton: {
        paddingHorizontal: 4,
        paddingVertical: 4,
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
        color: colors.textMuted,
    },
    aiReorderItem: {
        paddingVertical: spacing.s,
    },
    aiOptionActive: {
        backgroundColor: colors.background,
        borderRadius: 12,
    },
    aiCloseButton: {
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
        borderTopRightRadius: 24,
        padding: spacing.m,
        gap: spacing.m,
    },
    promptHelper: {
        ...typography.caption,
        color: colors.textMuted,
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
        color: colors.surface,
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
        color: colors.surface,
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
    toolbarContainer: {
        width: '100%',
        backgroundColor: colors.surface,
        // paddingBottom removed to bring closer to keyboard
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
        color: colors.background,
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
        backgroundColor: '#E6F0FF', // Distinct light blue tint
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
        backgroundColor: colors.primary + '10',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
        gap: 4,
    },
    recordingActionChipText: {
        ...typography.captionBold,
        color: colors.primary,
        fontSize: 10,
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
        color: colors.surface,
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
});
