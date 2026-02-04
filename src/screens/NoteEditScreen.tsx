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
} from 'react-native';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import { captureRef } from 'react-native-view-shot';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
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
import { AudioService, AudioRecording } from '../services/AudioService';
import { transcribeAudio, processVoiceNote } from '../services/TranscriptionService';
import { saveVoiceRecordingLocal, getVoiceRecordingsLocal, deleteVoiceRecordingLocal } from '../services/DatabaseService';
import { VoiceRecording } from '../api/notes';
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
    setAutoScalingEnabled
} from '../utils/storage';
import { MarkdownToolbar, MarkdownFormatType } from '../components/MarkdownToolbar';
import { TextAppearanceModal } from '../components/TextAppearanceModal';
import { AIProcessingIndicator } from '../components/AIProcessingIndicator';

import { ErrorModal } from '../components/ErrorModal';
import { getErrorMessage } from '../utils/errorMessage';
import { stripMarkdownSyntax } from '../utils/markdownUtils';

type NoteEditScreenRouteProp = RouteProp<RootStackParamList, 'NoteEdit'>;
type NoteEditScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'NoteEdit'>;

const normalizeTextForComparison = (value: string): string =>
    value.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();

const areTextsEquivalent = (a: string, b: string): boolean =>
    normalizeTextForComparison(a) === normalizeTextForComparison(b);

// History stack implementation - separate history for each variant
interface HistoryState {
    content: string;
    title: string;
}

interface VariantHistory {
    history: HistoryState[];
    index: number;
}

export const NoteEditScreen = () => {
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
    } = useNotesContext();
    const { isGuest } = useAuth();
    const ICON_CHOICES = ['translate', 'spellcheck', 'bolt', 'lightbulb', 'auto-awesome', 'text-fields', 'chat', 'edit'];

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

    const [title, setTitle] = useState(existingNote?.title || '');
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

    const showToast = (message: string) => {
        setToastMessage(message);
        Animated.sequence([
            Animated.timing(toastOpacity, {
                toValue: 1,
                duration: 200,
                useNativeDriver: true,
            }),
            Animated.delay(2000),
            Animated.timing(toastOpacity, {
                toValue: 0,
                duration: 200,
                useNativeDriver: true,
            }),
        ]).start();
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
    const [isTranscribing, setIsTranscribing] = useState(false);

    const lastSavedTitle = useRef(existingNote?.title || '');
    const lastSavedContent = useRef(existingNote?.content || '');
    const skipAutoSaveRef = useRef(false);
    const isColorPickerOpen = useRef(false);
    const isMounted = useRef(true);
    const hasAutoOpenedRecordings = useRef(false);

    const [showAudioPlayer, setShowAudioPlayer] = useState(false);

    const [playingRecordingId, setPlayingRecordingId] = useState<string | null>(null);
    const [transcriptionEnabled, setTranscriptionEnabled] = useState(true);


    // Add state to track if audio holds a transcription
    const [hasTranscription, setHasTranscription] = useState(!!existingNote?.encrypted_transcription);

    // Ref to track the intentionally selected variant to avoid flickering during async updates
    const optimisticActiveVariant = useRef<string | null>(null);

    useEffect(() => {
        if (existingNote) {
            setHasTranscription(!!existingNote.encrypted_transcription);
        }
    }, [existingNote?.encrypted_transcription]);

    // Force re-render on history update to show undo/redo arrows

    // AI State
    const [showAIModal, setShowAIModal] = useState(false);
    const [isAIProcessing, setIsAIProcessing] = useState(false);
    const [aiOptions, setAiOptions] = useState<AIImprovementOption[]>(DEFAULT_IMPROVEMENT_OPTIONS);
    const [aiOptionsLoading, setAiOptionsLoading] = useState(false);
    const [showPromptBuilder, setShowPromptBuilder] = useState(false);
    const [newPromptTitle, setNewPromptTitle] = useState('');
    const [newPromptTemplate, setNewPromptTemplate] = useState('');
    const [newPromptIcon, setNewPromptIcon] = useState<string>(ICON_CHOICES[0]);

    // Voice Recordings List State
    const [showRecordingsList, setShowRecordingsList] = useState(false);

    // Refresh recordings when list modal opens
    useEffect(() => {
        if (showRecordingsList && localNoteId) {
            getVoiceRecordingsLocal(localNoteId).then(async (recs) => {
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

    const handleAiAccess = (callback: () => void) => {
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
        callback();
    };





    // Text Appearance State
    const [fontSize, setFontSizeState] = useState(16);
    const [autoScalingEnabled, setAutoScalingEnabledState] = useState(true);
    const [showAppearanceModal, setShowAppearanceModal] = useState(false);

    // AI Request History (Session based)
    const [requestHistory, setRequestHistory] = useState<string[]>([]);

    const [activeFormats, setActiveFormats] = useState<MarkdownFormatType[]>([]);
    const editorRef = useRef<RichTextEditorHandle>(null);

    const improvementDraftsRef = useRef<Record<string, string>>({});
    const improvementSavedRef = useRef<Record<string, string>>({});

    // Queue for Agent Requests to prevent race conditions
    const agentQueue = useRef<{
        recordingUri: string;
        transcribedText: string;
        isBackground?: boolean;
        intentHint?: string;
    }[]>([]);
    const [queueLength, setQueueLength] = useState(0);
    const isProcessingQueue = useRef(false);

    // Ref to hold the absolute latest content to ensure queue picks up changes from previous steps
    const currentContentRef = useRef(content);
    // Ref to track active variant for queue processing
    const activeVariantIdRef = useRef(activeVariantId);

    // Sync contentRef whenever content state changes
    useEffect(() => {
        currentContentRef.current = content;
    }, [content]);

    // Sync activeVariantIdRef
    useEffect(() => {
        activeVariantIdRef.current = activeVariantId;
    }, [activeVariantId]);

    const loadSettings = async () => {
        const [size, scaling] = await Promise.all([
            getFontSize(),
            getAutoScalingEnabled(),
        ]);
        setFontSizeState(size);
        setAutoScalingEnabledState(scaling);
    };


    useEffect(() => {
        if (localNoteId) {
            getVoiceRecordingsLocal(localNoteId).then(async (recs) => {
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
            noteImprovements.forEach(imp => {
                const value = imp.content ?? '';
                if (saved[imp.id] === undefined) {
                    drafts[imp.id] = value;
                    saved[imp.id] = value;
                } else if (saved[imp.id] === drafts[imp.id]) {
                    drafts[imp.id] = value;
                    saved[imp.id] = value;
                }
                if (activeVariantId === imp.id && drafts[imp.id] !== undefined) {
                    setContent(drafts[imp.id]);
                }
            });
            improvementDraftsRef.current = drafts;
            improvementSavedRef.current = saved;
        } else {
            improvementDraftsRef.current = {};
            improvementSavedRef.current = {};
        }

        if (activeVariantId === 'original') {
            if (lastSavedTitle.current === title) {
                setTitle(existingNote.title || '');
            }
            if (lastSavedContent.current === content) {
                setContent(existingNote.content || '');
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
    }, [existingNote, noteImprovements, activeVariantId, title, content, audioUri]);

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

            // Update content to show the correct variant
            if (correctActiveVariantId === 'original') {
                setTitle(existingNote.title || '');
                setContent(existingNote.content || '');
            } else {
                const improvement = existingNote.improvements?.find(i => i.id === correctActiveVariantId);
                if (improvement) {
                    const improvementContent = improvement.content || '';
                    setContent(improvementContent);
                    improvementDraftsRef.current[correctActiveVariantId] = improvementContent;
                    improvementSavedRef.current[correctActiveVariantId] = improvementContent;
                }
            }
        }
    }, [existingNote?.id, existingNote?.is_active, JSON.stringify(existingNote?.improvements?.map(i => ({ id: i.id, is_active: i.is_active })))]);

    useEffect(() => {
        const loadSettings = async () => {
            const transcription = await getTranscriptionEnabled();
            setTranscriptionEnabled(transcription);
        };
        loadSettings();
    }, []);

    useEffect(() => {
        const fetchAiOptions = async () => {
            setAiOptionsLoading(true);
            try {
                const options = await loadImprovementOptions();
                setAiOptions(options);
            } finally {
                setAiOptionsLoading(false);
            }
        };

        fetchAiOptions();
    }, []);

    useEffect(() => {
        if (activeVariantId === 'original') {
            setContent(existingNote?.content || '');
        } else {
            setContent(improvementDraftsRef.current[activeVariantId] ?? '');
        }
    }, [activeVariantId]);

    useEffect(() => {
        isMounted.current = true;
        return () => {
            isMounted.current = false;
        };
    }, []);

    useEffect(() => {
        if (activeVariantId !== 'original') {
            const exists = noteImprovements.some(imp => imp.id === activeVariantId);
            if (!exists) {
                setActiveVariantId('original');
                setContent(existingNote?.content || '');
            }
        }
    }, [activeVariantId, noteImprovements, existingNote?.content]);

    // Handle history updates for current variant
    const updateHistory = (newTitle: string, newContent: string) => {
        // Clear existing timeout to debounce history updates
        if (historyTimeoutRef.current) {
            clearTimeout(historyTimeoutRef.current);
        }

        historyTimeoutRef.current = setTimeout(() => {
            const variantId = activeVariantId;
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
    const updateHistoryImmediate = (newTitle: string, newContent: string) => {
        if (historyTimeoutRef.current) {
            clearTimeout(historyTimeoutRef.current);
        }

        const variantId = activeVariantId;
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

    const handleTitleChange = (text: string) => {
        setTitle(text);
        // Only original variant has a title
        if (activeVariantId === 'original') {
            updateHistory(text, content);
        }
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

            // If deleting active variant, switch to original
            if (activeVariantId === improvementId) {
                setActiveVariantId('original');
                setContent(existingNote?.content || '');
                // Set parent as active
                await setActiveVariant(localNoteId, null);
            }
        } catch (error) {
            console.error('Failed to delete improvement', error);
            Alert.alert('Error', 'Failed to delete improvement');
        }
    }, [activeVariantId, deleteImprovement, existingNote?.content, localNoteId, setActiveVariant]);

    const confirmDeleteImprovement = (improvementId: string) => {
        Alert.alert(
            'Delete Improvement',
            'This version will be removed. You can always regenerate it later.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: () => handleDeleteImprovementVariant(improvementId),
                },
            ]
        );
    };

    const handleUndo = () => {
        const variantHistory = variantHistories.current[activeVariantId];
        if (!variantHistory || variantHistory.index <= 0) return;

        const prevIndex = variantHistory.index - 1;
        const prevState = variantHistory.history[prevIndex];

        if (activeVariantId === 'original') {
            setTitle(prevState.title);
        }
        setContent(prevState.content);

        if (activeVariantId !== 'original') {
            improvementDraftsRef.current[activeVariantId] = prevState.content;
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

        if (activeVariantId === 'original') {
            setTitle(nextState.title);
        }
        setContent(nextState.content);

        if (activeVariantId !== 'original') {
            improvementDraftsRef.current[activeVariantId] = nextState.content;
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
        if (draft === saved) {
            return;
        }
        if (isMounted.current) {
            setIsSaving(true);
        }
        try {
            await updateImprovement(localNoteId, activeVariantId, { content: draft });
            improvementSavedRef.current[activeVariantId] = draft;
        } catch (error) {
            console.error('Failed to save improvement:', error);
        } finally {
            if (isMounted.current) {
                setIsSaving(false);
            }
        }
    }, [activeVariantId, localNoteId, updateImprovement]);

    const saveNote = useCallback(async () => {
        if (activeVariantId !== 'original') {
            await saveImprovementDraft();
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
        if (title === lastSavedTitle.current && content === lastSavedContent.current) {
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
                    has_audio: hasAudio // Explicitly sync has_audio state
                });
            } else {
                const newNote = await createNote({
                    title,
                    content,
                    // Note: createNote signature takes audio object, not has_audio flag directly.
                    // But if we have no audio object here, it defaults to false.
                    // If we needed to create with audio, we should likely be in handleRecordingFinish.
                });
                if (isMounted.current) {
                    setLocalNoteId(newNote.id);
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
    }, [activeVariantId, content, createNote, deleteNote, localNoteId, noteImprovements.length, saveImprovementDraft, title, updateNote]);

    const debouncedSave = useCallback((_newContent: string, _newTitle: string) => {
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => {
            saveNote();
        }, 2000);
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

            variantHistories.current[variantId] = {
                history: [{ title: existingNote?.title || '', content }],
                index: 0
            };
        }

        setActiveVariantId(variantId);
        optimisticActiveVariant.current = variantId;
        if (variantId === 'original') {
            setContent(existingNote?.content || '');
        } else {
            const draft = improvementDraftsRef.current[variantId];
            if (draft !== undefined) {
                setContent(draft);
            } else {
                const imp = noteImprovements.find(i => i.id === variantId);
                setContent(imp?.content || '');
            }
        }
    }, [activeVariantId, existingNote?.content, existingNote?.title, noteImprovements, saveNote, localNoteId, setActiveVariant]);

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
            const hasChanges = activeVariantId === 'original'
                ? !(nothingToSave || unchanged)
                : improvementDraft !== improvementSaved;

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
                } finally {
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
                }
            };

            saveAndExit();
        });

        return unsubscribe;
    }, [content, navigation, saveNote, title]);

    const handleBack = () => {
        Keyboard.dismiss();
        skipAutoSaveRef.current = true;
        navigateBackToList();

        // Check if note is effectively empty
        const isContentEmpty = !title.trim() && !content.trim();
        const hasNoAudio = !existingNote?.has_audio && voiceRecordings.length === 0;

        if (isContentEmpty && hasNoAudio && localNoteId) {
            // Auto-delete empty notes to keep list clean
            console.log('[AutoClean] Deleting empty note on exit');
            deleteNote(localNoteId).catch(error => {
                console.error('[AutoClean] Error deleting empty note:', error);
            });
        } else {
            // Save normally
            saveNote().catch(error => {
                console.error('Error during back navigation save:', error);
            });
        }
    };

    const handleDelete = async () => {
        if (!localNoteId) return;
        setShowMenu(false);

        Alert.alert(
            'Delete Note',
            'Are you sure you want to delete this note?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        // Navigate back immediately for better UX, then perform delete
                        skipAutoSaveRef.current = true;
                        navigateBackToList();
                        try {
                            await deleteNote(localNoteId);
                        } catch (error) {
                            console.error('Failed to delete note:', error);
                            // Since we already navigated back, we might want to show a toast or alert on the list screen
                            // But for now, just logging is safer than popping an alert on a different screen
                        }
                    }
                },
            ]
        );
    };

    const handleMicPress = async () => {
        // Check removed to allow recording for improvements
        // if (activeVariantId !== 'original') { ... }
        setShowVoiceRecorder(true);
    };

    const handlePrivacyAccept = () => {
        setShowPrivacyWarning(false);
        setShowVoiceRecorder(true);
    };



    // Process the queue strictly sequentially
    const processAgentQueue = async () => {
        if (isProcessingQueue.current) return;
        isProcessingQueue.current = true;

        try {
            while (agentQueue.current.length > 0) {
                // Peek first
                const task = agentQueue.current[0];


                // Get fresh context from REFS (strict chaining)
                const contextContent = currentContentRef.current;
                const currentVariantId = activeVariantIdRef.current;

                console.log('[NoteEditScreen] Processing queued task');

                try {
                    setIsAIProcessing(true);
                    // Pass the text we just got
                    const agentResult = await processVoiceNote(
                        task.recordingUri,
                        undefined,
                        contextContent,
                        task.transcribedText,
                        requestHistory
                    );

                    if (agentResult.success) {
                        // Update History
                        if (task.transcribedText.trim()) {
                            setRequestHistory(prev => {
                                const newHistory = [...prev, task.transcribedText.trim()];
                                return newHistory.slice(-7);
                            });
                        }

                        const originalText = agentResult.originalText || task.transcribedText;

                        if (currentVariantId === 'original') {
                            // Check if the agent wants to create a separate improvement
                            // ... (Same logic as before) ...
                            const shouldCreateVoiceImprovement =
                                agentResult.hasInstruction &&
                                typeof agentResult.processedText === 'string' &&
                                agentResult.processedText.trim().length > 0 &&
                                !!localNoteIdRef.current && // Use Ref for noteId
                                !areTextsEquivalent(agentResult.processedText, originalText);

                            if (shouldCreateVoiceImprovement && localNoteIdRef.current) {
                                const label = agentResult.mode
                                    ? `AI(${agentResult.mode})`
                                    : 'AI Improvement';

                                const contentToSave = agentResult.processedText?.trim();
                                if (contentToSave) {
                                    const newImprovement = await createImprovement(localNoteIdRef.current, {
                                        content: contentToSave,
                                        label: label,
                                        optionId: 'voice_instruction'
                                    });

                                    if (newImprovement?.id) {
                                        improvementDraftsRef.current[newImprovement.id] = contentToSave;
                                        improvementSavedRef.current[newImprovement.id] = contentToSave;
                                        variantHistories.current[newImprovement.id] = {
                                            history: [{ title: title || '', content: contentToSave }],
                                            index: 0
                                        };

                                        setActiveVariantId(newImprovement.id);
                                        activeVariantIdRef.current = newImprovement.id; // Immediate Ref Update
                                        optimisticActiveVariant.current = newImprovement.id;
                                        // Update Content AND Ref
                                        setContent(contentToSave);
                                        // currentContentRef is updated via useEffect, but for immediate next loop we might need it?
                                        // Actually React state update might be async, so let's update ref manually to be safe for next loop
                                        currentContentRef.current = contentToSave;

                                        await setActiveVariant(localNoteIdRef.current, newImprovement.id);
                                    }
                                }
                            }
                        } else {
                            // Variant In-Place Update
                            const newText = agentResult.processedText;
                            if (newText && !areTextsEquivalent(newText, contextContent + (contextContent ? '\n\n' : '') + task.transcribedText)) {
                                setContent(newText);
                                currentContentRef.current = newText; // Immediate Ref Update

                                updateHistoryImmediate('', newText);
                                improvementDraftsRef.current[currentVariantId] = newText;
                                if (localNoteIdRef.current) {
                                    try {
                                        await updateImprovement(localNoteIdRef.current, currentVariantId, { content: newText });
                                        improvementSavedRef.current[currentVariantId] = newText;
                                    } catch (e) {
                                        console.error('Failed to save updated improvement', e);
                                    }
                                }
                            }
                        }
                    } else {
                        setErrorMessage(getErrorMessage(agentResult.error, 'Agent processing failed'));
                        setErrorModalVisible(true);
                    }
                } catch (error) {
                    console.error('[NoteEditScreen] Agent flow error:', error);
                    setErrorMessage(getErrorMessage(error, 'An error occurred during agent processing'));
                    setErrorModalVisible(true);
                }

                // Remove finished task
                agentQueue.current.shift();
                setQueueLength(prev => Math.max(0, prev - 1));
            }
        } finally {
            isProcessingQueue.current = false;
            setIsAIProcessing(false);

        }
    };

    const executeAgentFlow = async (
        recordingUri: string,
        transcribedText: string,
        isBackground: boolean = false
    ) => {
        const [storedAgentModeEnabled, provider] = await Promise.all([
            getAgentModeEnabled(),
            getAIProvider(),
        ]);
        const shouldUseAgentMode = storedAgentModeEnabled && provider === 'secure_llm';

        if (!shouldUseAgentMode) {
            return;
        }

        agentQueue.current.push({
            recordingUri,
            transcribedText,
            isBackground
        });
        setQueueLength(prev => prev + 1);
        processAgentQueue();
    };


    const handleRecordingFinish = async (recording: AudioRecording, transcribe: boolean = true) => {
        setShowVoiceRecorder(false);

        let transcription: { success: boolean; text: string; error?: string } = { success: false, text: '' };
        let isTranscriptionSuccess = false;
        let transcribedText = '';

        // 1. TRY TO TRANSCRIBE (But don't fail if it doesn't work)
        try {
            if (isGuest || !transcribe) {
                // Skip transcription entirely for guests or if user opted out
                console.log('[NoteEditScreen] Transcription skipped (Guest or Toggle OFF)');
                console.log('[NoteEditScreen] Guest user - skipping transcription');
                transcription = { success: false, text: '', error: 'Guest user - transcription disabled' };
            } else {
                setIsTranscribing(true);
                transcription = await transcribeAudio(recording.uri);
            }
        } catch (err) {
            console.error('[NoteEditScreen] Transcription unexpected error:', err);
            transcription = { success: false, text: '', error: 'Unexpected transcription error' };
        } finally {
            setIsTranscribing(false);
        }

        isTranscriptionSuccess = transcription.success && !!transcription.text;
        transcribedText = isTranscriptionSuccess ? transcription.text : '';

        // Show informative message if transcription failed (but don't block saving)
        if (!isTranscriptionSuccess) {
            const errorMsg = transcription.error ? getErrorMessage(transcription.error, '') : '';
            // Check if error is due to authentication/trial limits
            const isAuthError = isGuest || errorMsg.toLowerCase().includes('sign in') ||
                errorMsg.toLowerCase().includes('trial limit') ||
                errorMsg.toLowerCase().includes('authentication') ||
                errorMsg.toLowerCase().includes('quota');

            if (isAuthError) {
                // Silent failure for auth/guest errors - audio is still saved
                console.log('[Transparency] Transcription skipped due to auth/guest status');
            } else if (errorMsg) {
                console.warn('[Transcription] Failed but audio will be saved:', errorMsg);
            }
        }

        let finalTranscribedContent = content; // Default to existing
        let currentNoteId = localNoteIdRef.current;

        // 2. SAVE AUDIO (ALWAYS)
        const savedPath = await AudioService.saveAudioFile(recording.uri, false);

        // Ensure Note Exists (Create if not)
        if (!currentNoteId) {
            try {
                const titleToUse = title.trim();
                const newNote = await createNote({
                    title: titleToUse,
                    content: content,
                    audio: {
                        filePath: savedPath,
                        duration: recording.duration,
                        transcription: transcribedText
                    }
                });
                setLocalNoteId(newNote.id);
                localNoteIdRef.current = newNote.id;
                currentNoteId = newNote.id;
                lastSavedTitle.current = title;
                lastSavedContent.current = content;
            } catch (e) {
                console.error('Failed to create note for voice:', e);
                setErrorMessage('Failed to save note');
                setErrorModalVisible(true);
                return;
            }
        }

        // Save Metadata to DB
        const voiceId = Date.now().toString() + Math.random().toString(36).substring(2);
        const voiceRecording: VoiceRecording = {
            id: voiceId,
            note_id: currentNoteId,
            file_path: savedPath,
            duration: recording.duration,
            transcription: transcribedText,
            created_at: new Date().toISOString(),
        }
        await saveVoiceRecordingLocal(voiceRecording);

        // Reload from DB to ensure consistency and correct order
        const updatedRecs = await getVoiceRecordingsLocal(currentNoteId);
        setVoiceRecordings(updatedRecs);

        // ALWAYS update the parent note to indicate it has audio
        // This ensures the microphone icon appears in the list view
        await updateNote(currentNoteId, {
            has_audio: true,
            audio_file_path: savedPath, // Update "primary" audio path to latest
            audio_duration: recording.duration,
            // Only update "primary" transcription if we actually have one, or if it was empty
            ...(transcribedText ? { encrypted_transcription: transcribedText } : {})
        });


        // 3. UI UPDATE & LOGIC
        if (activeVariantId === 'original') {
            // Append text immediately if we have it
            if (transcribedText) {
                // Use Ref to get the LATEST content (fixing valid overwrite race condition)
                const currentContent = currentContentRef.current;
                finalTranscribedContent = currentContent + (currentContent ? '\n\n' : '') + transcribedText;
                setContent(finalTranscribedContent);
                // Also update the Ref immediately to ensure subsequent steps use the new state
                currentContentRef.current = finalTranscribedContent;

                updateHistoryImmediate(title, finalTranscribedContent);
                // Save Content with new text
                await updateNote(currentNoteId, {
                    content: finalTranscribedContent
                });
            } else {
                // No transcription (or failed) -> Insert Audio Block
                const currentContent = currentContentRef.current;

                // Use persistent path for markdown to ensure it survives app restarts
                // The AudioPlayer component handles decryption/playback

                // Construct audio block
                // We add newlines to ensure it's on its own block
                const audioBlock = `${currentContent ? '\n' : ''} ![audio](${savedPath}) \n`;

                finalTranscribedContent = currentContent + audioBlock;
                setContent(finalTranscribedContent);
                currentContentRef.current = finalTranscribedContent;

                updateHistoryImmediate(title, finalTranscribedContent);
                await updateNote(currentNoteId, {
                    content: finalTranscribedContent
                });
            }

            // Set Player
            const playbackUri = await AudioService.readAudioFile(savedPath);
            setAudioUri(playbackUri);
            setAudioDuration(recording.duration);
            setShowAudioPlayer(true);
            setPlayingRecordingId(voiceId); // Track the ID
            setHasTranscription(!!transcribedText);

        } else {
            // Improvement Mode
            // Audio is already saved to parent and state updated.

            // If transcription failed, just show player and stop
            if (!isTranscriptionSuccess) {
                const playbackUri = await AudioService.readAudioFile(savedPath);
                setAudioUri(playbackUri);
                setAudioDuration(recording.duration);
                setShowAudioPlayer(true);
                setPlayingRecordingId(voiceId); // Track the ID
                setHasTranscription(false);
                return;
            }

            // If transcription success, we let the agent process it below
        }

        // 4. STOP IF NO TEXT
        if (!isTranscriptionSuccess) {
            return;
        }

        // 5. AGENT PROCESSING (If enabled)
        // Note: processAgentQueue uses currentContentRef internally, so we don't strictly need to pass content here,
        // but passing the updated version we just set helps consistency if that function used the arg.
        await executeAgentFlow(recording.uri, transcribedText, true);

    };

    const handleInstructionRecordingFinish = async (recording: AudioRecording) => {
        setShowVoiceRecorder(false);
        // Don't close AI modal, just fill the input

        // Show local loading state if needed, or re-use isTranscribing but that shows a global spinner
        // Let's use isAIProcessing to block interaction while transcribing instruction
        setIsAIProcessing(true);

        try {
            const transcription = await transcribeAudio(recording.uri);
            await AudioService.deleteAudioFile(recording.uri);

            if (transcription.success && transcription.text) {
                setCustomInstruction(transcription.text);
            } else {
                setErrorMessage(getErrorMessage(transcription.error, 'Could not recognize speech'));
                setErrorModalVisible(true);
            }
        } catch (error) {
            console.error('Instruction transcription failed:', error);
            setErrorMessage('Failed to transcribe instruction');
            setErrorModalVisible(true);
        } finally {
            setIsAIProcessing(false);
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
        setIsRecordingInstruction(true);
        setShowCustomInput(true);
        setShowVoiceRecorder(true);
    };

    const handleInsertAudioToNote = async (recording: VoiceRecording) => {
        try {
            // Use persistent path directly to ensure it matches what is stored in DB and used for deletion
            const uri = recording.file_path; // await AudioService.readAudioFile(recording.file_path);
            const currentContent = currentContentRef.current;
            const audioBlock = `${currentContent ? '\n' : ''} ![audio](${uri}) \n`;

            const newContent = currentContent + audioBlock;
            setContent(newContent);
            currentContentRef.current = newContent;

            if (activeVariantId === 'original') {
                updateHistoryImmediate(title, newContent);
                if (localNoteId) {
                    await updateNote(localNoteId, { content: newContent });
                }
            } else {
                improvementDraftsRef.current[activeVariantId] = newContent;
                updateHistoryImmediate(title, newContent);
            }

            setShowRecordingsList(false);
        } catch (error) {
            console.error('Failed to insert audio:', error);
            Alert.alert('Error', 'Failed to insert audio');
        }
    };



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
        setIsAIProcessing(true);
        try {
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
                        Alert.alert('✨ Perfect!', 'No grammar errors found.');
                        setIsAIProcessing(false);
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
                    console.log('Raw AI response:', improvedText);

                    // Fallback: if the response looks like just the corrected text (no JSON structure), use it
                    // But for grammar, we expect JSON. If parsing failed, it might be a chatty response.
                    // If it's chatty, we probably shouldn't blindly use it. 
                    // However, we verify if it matches source text to avoid false positives.
                    if (areTextsEquivalent(sourceText, improvedText)) {
                        Alert.alert('✨ Perfect!', 'No grammar errors found.');
                        setIsAIProcessing(false);
                        return;
                    }
                }
            } else if (areTextsEquivalent(sourceText, improvedText)) {
                Alert.alert('No changes', 'The text remains unchanged.');
                setIsAIProcessing(false);
                return;
            }

            let targetNoteId = localNoteId;
            if (!targetNoteId) {
                const newNote = await createNote({
                    title,
                    content: content,
                });
                targetNoteId = newNote.id;
                setLocalNoteId(newNote.id);
                lastSavedTitle.current = title;
                lastSavedContent.current = content;
            } else if (activeVariantId === 'original') {
                await saveNote();
            } else {
                await saveImprovementDraft();
            }

            if (!targetNoteId) {
                throw new Error('Failed to resolve note ID for improvement');
            }

            // Check if we're on the original note or a child variant
            console.log('[NoteEditScreen] Applying improvement:', {
                activeVariant: activeVariantId,
                isOriginal: activeVariantId === 'original',
                parentNoteId: targetNoteId,
                optionLabel: option.label,
                optionId: option.id
            });

            if (activeVariantId === 'original') {
                // Create new child variant from parent
                console.log('[NoteEditScreen] Creating new improvement variant');
                const improvement = await createImprovement(targetNoteId, {
                    content: finalText,
                    label: option.label,
                    optionId: option.id,
                });
                improvementDraftsRef.current[improvement.id] = finalText;
                improvementSavedRef.current[improvement.id] = finalText;

                // Initialize history for new variant
                variantHistories.current[improvement.id] = {
                    history: [{ title: title || '', content: finalText }],
                    index: 0
                };
                // No need to call setHistoryUpdateCount because index 0 means no undo yet, which is correct for new "file"

                // Set this improvement as active in the database
                await setActiveVariant(targetNoteId, improvement.id);

                setActiveVariantId(improvement.id);
                optimisticActiveVariant.current = improvement.id;
                setContent(finalText);
            } else {
                // Update existing child variant in-place (no new children from children)
                console.log('[NoteEditScreen] Updating existing improvement in-place:', {
                    improvementId: activeVariantId,
                    parentNoteId: targetNoteId,
                    newLabel: option.label,
                    newOptionId: option.id
                });
                await updateImprovement(targetNoteId, activeVariantId, {
                    content: finalText,
                    label: option.label,
                    optionId: option.id,
                });

                console.log('[NoteEditScreen] Improvement updated successfully');

                // Update refs and UI with new content
                improvementDraftsRef.current[activeVariantId] = finalText;
                improvementSavedRef.current[activeVariantId] = finalText;
                setContent(finalText);

                // Update history for this variant
                updateHistoryImmediate('', finalText);
            }
        } catch (error: any) {
            // Handle Trial Limit 403 specifically
            if (error?.message?.includes('403') || error?.status === 403 || error?.response?.status === 403) {
                setErrorMessage('Trial limit exceeded.\nTo continue AI editing and transcription, please upgrade your plan.');
                setErrorModalVisible(true);
            } else {
                const prettyMessage = getErrorMessage(error, 'Failed to improve text. Check AI settings.');
                setErrorMessage(prettyMessage);
                setErrorModalVisible(true);
            }
        } finally {
            setIsAIProcessing(false);
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

    // Handle initial recording passed from navigation
    useEffect(() => {
        if (route.params?.initialRecording) {
            handleRecordingFinish(route.params.initialRecording, route.params.initialTranscribe ?? true);
        }
    }, [route.params?.initialRecording, isGuest]);

    // Track keyboard visibility to handle color picker interactions
    const isKeyboardVisible = useRef(false);

    useEffect(() => {
        const showSub = Keyboard.addListener('keyboardDidShow', () => {
            setIsEditing(true);
            isKeyboardVisible.current = true;
        });
        const hideSub = Keyboard.addListener('keyboardDidHide', () => {
            isKeyboardVisible.current = false;
            if (!isColorPickerOpen.current) {
                setIsEditing(false);
            }
        });

        return () => {
            showSub.remove();
            hideSub.remove();
        };
    }, []);

    const handleRetryTranscription = async () => {
        if (!audioUri) return;

        // Use Ref for latest content


        setIsTranscribing(true);
        try {
            const transcription = await transcribeAudio(audioUri);

            if (!transcription.success || !transcription.text) {
                setErrorMessage(getErrorMessage(transcription.error, 'Check internet connection'));
                setErrorModalVisible(true);
                return;
            }

            const text = transcription.text;

            // Append text to LATEST content
            // Need to fetch fresh ref again in case it changed during `transcribeAudio`
            const freshContent = currentContentRef.current;
            const newContent = freshContent + (freshContent ? '\n\n' : '') + text;

            setContent(newContent);
            currentContentRef.current = newContent; // Update Ref

            updateHistoryImmediate(title, newContent);

            // Update DB
            if (localNoteId) {
                await updateNote(localNoteId, {
                    content: newContent,
                    encrypted_transcription: text
                });
            }

            setHasTranscription(true);

            // Trigger Agent Flow
            await executeAgentFlow(audioUri, text, false);

        } catch (error: any) {
            setIsTranscribing(false);
            // Handle Trial Limit 403 specifically
            if (error?.message?.includes('403') || error?.status === 403 || error?.response?.status === 403) {
                setErrorMessage('Trial limit exceeded.\nTo continue AI editing and transcription, please upgrade your plan.');
                setErrorModalVisible(true);
            } else {
                setErrorMessage('Failed to retry transcription');
                setErrorModalVisible(true);
            }
        } finally {
            setIsTranscribing(false);
        }
    };



    const formatDuration = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s < 10 ? '0' : ''}${s} `;
    };

    const handleDeleteRecording = async (id: string, path: string) => {
        Alert.alert(
            'Delete Recording',
            'Are you sure?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        // 1. Cancel any pending auto-saves to prevent race condition overwriting our changes
                        if (saveTimeoutRef.current) {
                            clearTimeout(saveTimeoutRef.current);
                        }

                        await deleteVoiceRecordingLocal(id);
                        await AudioService.deleteAudioFile(path);

                        // Calculate new list state
                        const remaining = voiceRecordings.filter(r => r.id !== id);
                        setVoiceRecordings(remaining);

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
                            // We do NOT call setReparseTrigger here, as the editor is already updated.

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
                            // We don't delete immediately anymore based on user feedback.
                            // The user might want to add more content.
                            // The empty check in handleBack will take care of cleaning up if they exit now.
                            // We need to calculate potential new content for this check
                            const latestContent = currentContentRef.current;
                            const isContentEmpty = !title.trim() && !latestContent.trim();
                            if (isContentEmpty) {
                                console.log('[AutoClean] Note came empty after deleting last audio. Will be auto-deleted on exit if left empty.');
                            }
                        } else {
                            // If not deleting note, ensure consistent history/save
                            // If visual mode, debounce save is triggered by onChange. 
                            // If raw mode, we just updated note above.
                            // But for safety:
                            const latestContent = currentContentRef.current;
                            updateHistory(title, latestContent);
                            debouncedSave(latestContent, title);
                        }
                    }
                }

            ]
        );
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
                    <ScrollView
                        horizontal
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
                    </ScrollView>
                </View>
            )}



            {/* Inline Player for Empty Voice Notes */}
            {voiceRecordings.length > 0 && !title && (!content || content.trim().length === 0) && !hasTranscription && !isTranscribing && transcriptionEnabled && (
                <View style={{ marginBottom: spacing.m, marginTop: spacing.s }}>
                    {showAudioPlayer && audioUri && (
                        <AudioPlayer
                            audioUri={audioUri}
                            duration={audioDuration}
                            onClose={() => setShowAudioPlayer(false)}
                            hasTranscription={hasTranscription}
                        />
                    )}
                    <TouchableOpacity
                        style={[styles.retryTranscriptionButton, { alignSelf: 'stretch', justifyContent: 'center', marginTop: spacing.s }]}
                        onPress={() => handleAiAccess(handleRetryTranscription)}
                    >
                        <MaterialIcons name="auto-awesome" size={18} color={colors.background} style={{ marginRight: 8 }} />
                        <Text style={styles.retryTranscriptionText}>Process Voice Note</Text>
                    </TouchableOpacity>
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
                        onPress={() => handleAiAccess(() => setShowAIModal(true))}
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
                        localNoteId && (
                            <TouchableOpacity onPress={() => setShowMenu(true)} style={styles.iconButton}>
                                <MaterialIcons name="more-vert" size={24} color={colors.text} />
                            </TouchableOpacity>
                        )
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
                <TouchableWithoutFeedback onPress={() => setShowAIModal(false)}>
                    <GestureHandlerRootView style={styles.modalOverlay}>
                        <TouchableWithoutFeedback>
                            <View style={styles.aiModalContent}>
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
                                {aiOptionsLoading ? (
                                    <View style={styles.aiLoader}>
                                        <ActivityIndicator color={colors.primary} />
                                    </View>
                                ) : (
                                    <DraggableFlatList
                                        style={styles.aiList}
                                        contentContainerStyle={styles.aiListContent}
                                        data={aiOptions}
                                        keyExtractor={(item) => item.id}
                                        onDragEnd={({ data }) => handleReorderEnd(data)}
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
                                                        <MaterialIcons name={item.icon as any} size={24} color={isActive ? colors.primary : colors.primary} />
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
                                <TouchableOpacity
                                    style={styles.aiCloseButton}
                                    onPress={() => setShowAIModal(false)}
                                >
                                    <Text style={styles.aiCloseButtonText}>Cancel</Text>
                                </TouchableOpacity>
                            </View>
                        </TouchableWithoutFeedback>
                    </GestureHandlerRootView>
                </TouchableWithoutFeedback>
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
            {!isEditing && (
                <TouchableOpacity
                    style={styles.micButton}
                    onPress={handleMicPress}
                    activeOpacity={0.8}
                >
                    <MaterialIcons name="mic" size={28} color="white" />
                </TouchableOpacity>
            )
            }

            <PrivacyWarningModal
                visible={showPrivacyWarning}
                onAccept={handlePrivacyAccept}
                onCancel={() => setShowPrivacyWarning(false)}
            />

            <ErrorModal
                visible={errorModalVisible}
                message={errorMessage}
                onClose={() => setErrorModalVisible(false)}
            />

            <AIProcessingIndicator
                visible={(isAIProcessing || queueLength > 0 || isTranscribing)}
                queueSize={queueLength}
                isTranscribing={isTranscribing}
            />

            <VoiceRecorder
                visible={showVoiceRecorder}
                onFinish={(rec, transcribe) => {
                    if (isRecordingInstruction) {
                        handleInstructionRecordingFinish(rec);
                    } else {
                        handleRecordingFinish(rec, transcribe);
                    }
                }}
                onCancel={() => {
                    setShowVoiceRecorder(false);
                    setIsRecordingInstruction(false);
                }}
                autoStart={true}
            />


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

                                {showAudioPlayer && audioUri && (
                                    <View style={{ marginBottom: spacing.m }}>
                                        <AudioPlayer
                                            audioUri={audioUri}
                                            duration={audioDuration}
                                            onClose={() => {
                                                setShowAudioPlayer(false);
                                                setPlayingRecordingId(null);
                                            }}
                                            hasTranscription={hasTranscription}
                                        />
                                        {!hasTranscription && transcriptionEnabled && (
                                            <TouchableOpacity
                                                style={styles.retryTranscriptionButton}
                                                onPress={handleRetryTranscription}
                                            >
                                                <Text style={styles.retryTranscriptionText}>Process Voice Note</Text>
                                            </TouchableOpacity>
                                        )}
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
                                                    <View style={[
                                                        styles.recordingIconContainer,
                                                        isPlaying && { backgroundColor: '#FFFFFF', borderColor: 'rgba(0,0,0,0.05)', borderWidth: 1 }
                                                    ]}>
                                                        <MaterialIcons
                                                            name={isPlaying ? "graphic-eq" : "play-arrow"}
                                                            size={24}
                                                            color={isPlaying ? colors.primary : colors.textSecondary}
                                                        />
                                                    </View>

                                                    <View style={styles.recordingInfo}>
                                                        <Text style={[
                                                            styles.recordingTitle,
                                                            isPlaying && { color: colors.text, fontWeight: '700' }
                                                        ]}>
                                                            {new Date(rec.created_at).toLocaleDateString()}
                                                        </Text>
                                                        <Text style={[
                                                            styles.recordingSubtitle,
                                                            isPlaying && { color: colors.textSecondary } // Ensure good contrast
                                                        ]}>
                                                            {new Date(rec.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {formatDuration(rec.duration)}
                                                        </Text>
                                                    </View>

                                                    <TouchableOpacity
                                                        style={[styles.recordingDeleteButton, { marginRight: 8 }]}
                                                        onPress={() => handleInsertAudioToNote(rec)}
                                                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                                    >
                                                        <MaterialIcons
                                                            name="playlist-add" // or "input" or "add-circle-outline"
                                                            size={24}
                                                            color={colors.primary}
                                                        />
                                                    </TouchableOpacity>

                                                    <TouchableOpacity
                                                        style={styles.recordingDeleteButton}
                                                        onPress={() => handleDeleteRecording(rec.id, rec.file_path)}
                                                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                                    >
                                                        <MaterialIcons
                                                            name="delete-outline"
                                                            size={22}
                                                            color={isPlaying ? colors.textSecondary : colors.textMuted}
                                                        />
                                                    </TouchableOpacity>
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

            <TextAppearanceModal
                visible={showAppearanceModal}
                onClose={() => setShowAppearanceModal(false)}
                fontSize={fontSize}
                onFontSizeChange={handleFontSizeChange}
                autoScalingEnabled={autoScalingEnabled}
                onAutoScalingChange={handleAutoScalingChange}
            />

        </ScreenContainer>
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
        bottom: 100,
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
        fontSize: 32,
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
    micButton: {
        position: 'absolute',
        bottom: spacing.xxl,
        right: spacing.xl,
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
        maxHeight: '70%',
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
    aiList: {
        maxHeight: 420,
    },
    aiListContent: {
        paddingBottom: spacing.m,
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
        marginTop: spacing.s,
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
        flexDirection: 'row',
        alignItems: 'center',
        padding: spacing.s,
        marginBottom: spacing.s,
        borderRadius: 12,
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
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: colors.background,
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
        fontWeight: '500',
        color: colors.text,
        marginBottom: 2,
    },
    recordingTitleActive: {
        color: colors.primary,
        fontWeight: '600',
    },
    recordingSubtitle: {
        fontSize: 12,
        color: colors.textMuted,
    },
    recordingDeleteButton: {
        padding: spacing.s,
        marginLeft: spacing.s,
    },
});
