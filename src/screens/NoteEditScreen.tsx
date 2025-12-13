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
    Vibration,
    FlatList,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
// import DraggableFlatList, { RenderItemParams } from 'react-native-draggable-flatlist';
import { RichTextEditor, RichTextEditorHandle } from '../components/RichTextEditor';
import { useFocusEffect, useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialIcons } from '@expo/vector-icons';
import { RootStackParamList } from '../navigation/types';
import { useNotesContext } from '../contexts/NotesContext';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { VoiceRecorder } from '../components/VoiceRecorder';
import { AudioPlayer } from '../components/AudioPlayer';
import { PrivacyWarningModal } from '../components/PrivacyWarningModal';
import { AudioService, AudioRecording } from '../services/AudioService';
import { transcribeAudio, processVoiceNote } from '../services/TranscriptionService';
import { getPrivacyWarningDismissed } from '../utils/storage';
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
    getFontSize,
    setFontSize,
    getAutoScalingEnabled,
    setAutoScalingEnabled
} from '../utils/storage';
import { MarkdownToolbar, MarkdownFormatType } from '../components/MarkdownToolbar';
import { TextAppearanceModal } from '../components/TextAppearanceModal';

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
    const ICON_CHOICES = ['translate', 'spellcheck', 'bolt', 'lightbulb', 'auto-awesome', 'text-fields', 'chat', 'edit'];

    const [localNoteId, setLocalNoteId] = useState(route.params?.noteId);
    const existingNote = notes.find(n => n.id === localNoteId);
    const noteImprovements = useMemo(() => existingNote?.improvements ?? [], [existingNote?.improvements]);

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
    const [isSaving, setIsSaving] = useState(false);
    const [showMenu, setShowMenu] = useState(false);
    const [isEditing, setIsEditing] = useState(false);

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
    const isMounted = useRef(true);

    const [showAudioPlayer, setShowAudioPlayer] = useState(false);

    // AI State
    const [showAIModal, setShowAIModal] = useState(false);
    const [isAIProcessing, setIsAIProcessing] = useState(false);
    const [aiOptions, setAiOptions] = useState<AIImprovementOption[]>(DEFAULT_IMPROVEMENT_OPTIONS);
    const [aiOptionsLoading, setAiOptionsLoading] = useState(false);
    const [showPromptBuilder, setShowPromptBuilder] = useState(false);
    const [newPromptTitle, setNewPromptTitle] = useState('');
    const [newPromptTemplate, setNewPromptTemplate] = useState('');
    const [newPromptIcon, setNewPromptIcon] = useState<string>(ICON_CHOICES[0]);

    // Custom Instruction State
    const [customInstruction, setCustomInstruction] = useState('');
    const [isRecordingInstruction, setIsRecordingInstruction] = useState(false);
    const [showCustomInput, setShowCustomInput] = useState(false);

    // Determine initial active variant based on is_active flags



    const [agentModeEnabled, setAgentModeEnabled] = useState(true);

    // Text Appearance State
    const [fontSize, setFontSizeState] = useState(16);
    const [autoScalingEnabled, setAutoScalingEnabledState] = useState(true);
    const [showAppearanceModal, setShowAppearanceModal] = useState(false);

    const [activeFormats, setActiveFormats] = useState<MarkdownFormatType[]>([]);
    const [selection, setSelection] = useState({ start: 0, end: 0 });
    const editorRef = useRef<RichTextEditorHandle>(null);
    const contentInputRef = useRef<TextInput>(null);
    const improvementDraftsRef = useRef<Record<string, string>>({});
    const improvementSavedRef = useRef<Record<string, string>>({});

    const loadSettings = async () => {
        const enabled = await getAgentModeEnabled();
        setAgentModeEnabled(enabled);
        const size = await getFontSize();
        setFontSizeState(size);
        const scaling = await getAutoScalingEnabled();
        setAutoScalingEnabledState(scaling);
    };

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
        if (existingNote.has_audio && existingNote.audio_file_path && !audioUri) {
            loadAudio(existingNote.audio_file_path);
            setAudioDuration(existingNote.audio_duration || 0);
        }

        lastSavedTitle.current = existingNote.title || '';
        lastSavedContent.current = existingNote.content || '';
    }, [existingNote, noteImprovements, activeVariantId, title, content, audioUri]);

    // Restore active variant from is_active flags when note loads
    useEffect(() => {
        if (!existingNote) return;

        const correctActiveVariantId = getInitialActiveVariantId();
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
        }, 500); // 500ms debounce
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

    const handleContentChange = (text: string) => {
        let newContent = text;

        // Auto-continuation logic for lists:
        // Detect if a newline was inserted
        if (text.length > content.length && selection.start !== undefined) {
            // Heuristic: check if we added a newline compared to old content
            // Identifying exact insertion index is ideal but tricky with just 'text' and 'content'
            // We'll rely on finding the first diff.
            let i = 0;
            while (i < content.length && text[i] === content[i]) i++;

            const inserted = text.slice(i, i + (text.length - content.length));

            if (inserted.includes('\n')) {
                const textBefore = text.slice(0, i);
                const lines = textBefore.split('\n');
                const lastLine = lines[lines.length - 1]; // This is the line *before* the newline

                // Check if it's a list item
                const todoMatch = lastLine.match(/^(\s*-\s\[[ xX]?\]\s)(.*)$/);
                const listMatch = lastLine.match(/^(\s*-\s)(.*)$/);

                let prefix = '';
                let isEmptyItem = false;

                if (todoMatch) {
                    prefix = todoMatch[1]; // e.g. "- [ ] "
                    if (todoMatch[2].trim() === '') isEmptyItem = true;
                } else if (listMatch) {
                    prefix = listMatch[1]; // e.g. "- "
                    if (listMatch[2].trim() === '') isEmptyItem = true;
                }

                if (prefix) {
                    if (isEmptyItem) {
                        // Enter on empty list item -> Remove the bucket/prefix (Exit list)
                        // Remove `prefix` from `textBefore`.
                        const lineStart = textBefore.lastIndexOf(prefix);
                        if (lineStart !== -1) {
                            const newTextBefore = textBefore.slice(0, lineStart) + textBefore.slice(lineStart + prefix.length);
                            const textAfter = text.slice(i + inserted.length);
                            // New content: textBefore (without prefix) + inserted (\n) + textAfter.
                            newContent = newTextBefore + inserted + textAfter;
                        }
                    } else {
                        // Enter on populated list item -> Continue list
                        // Insert prefix on new line.
                        const nextPrefix = todoMatch ? prefix.replace(/\[[ xX]\]/, '[ ]') : prefix; // ensure unchecked
                        const textAfter = text.slice(i + inserted.length);
                        newContent = textBefore + inserted + nextPrefix + textAfter;
                    }
                }
            }
        }

        setContent(newContent);
        if (existingNote) debouncedSave(newContent, title);
        if (activeVariantId === 'original') {
            updateHistory(title, newContent);
        } else {
            improvementDraftsRef.current[activeVariantId] = newContent;
            // Update history for improvements too
            updateHistory(title, newContent); // Using title for consistency, though variants share parent title
        }
    };

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
        } catch (error) {
            console.error('Failed to load audio:', error);
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
	        const hasAudio = !!audioUri || existingNote?.has_audio;
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
                });
            } else {
                const newNote = await createNote({
                    title,
                    content,
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
	    }, [activeVariantId, audioUri, content, createNote, deleteNote, existingNote?.has_audio, localNoteId, noteImprovements.length, saveImprovementDraft, title, updateNote]);

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
        // Skip the beforeRemove check since we're handling save here
        skipAutoSaveRef.current = true;
        // Navigate immediately without waiting for save to complete
        navigateBackToList();
        // Save in background (fire-and-forget)
        saveNote().catch(error => {
            console.error('Error during back navigation save:', error);
        });
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

    const handleRecordingFinish = async (recording: AudioRecording) => {
        setShowVoiceRecorder(false);

        // ---------------------------------------------------------
        // 1. SIMPLE MODE (Agent disabled)
        // ---------------------------------------------------------
        if (!agentModeEnabled) {
            setIsTranscribing(true);
            const transcription = await transcribeAudio(recording.uri);
            setIsTranscribing(false);

            // Save audio file if it is an original note (to keep record)
            // Or delete if it's transient?
            // The logic below for "original" saved the audio file.
            // For improvements, it deleted it.
            // Let's standardise: if it works, append text.

            // If it's a new "original" note, we need to create it.
            if (activeVariantId === 'original') {
                const savedPath = await AudioService.saveAudioFile(recording.uri, false);
                if (transcription.success && transcription.text) {
                    const newOriginalContent = content + (content ? '\n\n' : '') + transcription.text;
                    setContent(newOriginalContent);
                    updateHistory(title, newOriginalContent);

                    if (localNoteId) {
                        await updateNote(localNoteId, {
                            content: newOriginalContent,
                            audio_file_path: savedPath,
                            audio_duration: recording.duration,
                            has_audio: true,
                            encrypted_transcription: transcription.text
                        });
                    } else {
                        const newNote = await createNote({
                            title,
                            content: newOriginalContent,
                            audio: {
                                filePath: savedPath,
                                duration: recording.duration,
                                transcription: transcription.text
                            }
                        });
                        setLocalNoteId(newNote.id);
                        lastSavedTitle.current = title;
                        lastSavedContent.current = newOriginalContent;
                    }
                } else {
                    // Transcription failed
                    await AudioService.deleteAudioFile(savedPath);
                    Alert.alert('Transcription Failed', transcription.error || 'Unknown error');
                }
                // Set audio for playback
                const playbackUri = await AudioService.readAudioFile(savedPath);
                setAudioUri(playbackUri);
                setAudioDuration(recording.duration);
                setShowAudioPlayer(true);
            } else {
                // Improvement / Variant: Just append text and delete audio
                await AudioService.deleteAudioFile(recording.uri);
                if (transcription.success && transcription.text) {
                    const newContent = content + (content ? '\n\n' : '') + transcription.text;
                    setContent(newContent);
                    improvementDraftsRef.current[activeVariantId] = newContent;
                    updateHistory('', newContent);
                    if (localNoteId) {
                        try {
                            await updateImprovement(localNoteId, activeVariantId, { content: newContent });
                            improvementSavedRef.current[activeVariantId] = newContent;
                        } catch (error) {
                            console.error('Failed to save improvement:', error);
                        }
                    }
                } else {
                    Alert.alert('Transcription Failed', transcription.error || 'Unknown error');
                }
            }
            return;
        }

        // ---------------------------------------------------------
        // 2. AGENT MODE (Intelligent Processing)
        // ---------------------------------------------------------

        try {
            // If it's the original note, we use the Smart Agent flow
            if (activeVariantId === 'original') {
                const savedPath = await AudioService.saveAudioFile(recording.uri, false);
                const playbackUri = await AudioService.readAudioFile(savedPath);
                setAudioUri(playbackUri);
                setAudioDuration(recording.duration);
                setShowAudioPlayer(true);

                setIsTranscribing(true);
                // Call the Smart Agent
                const agentResult = await processVoiceNote(recording.uri);
                setIsTranscribing(false);

                // Clean up temp file
                await AudioService.deleteAudioFile(recording.uri);

                if (agentResult.success) {
                    const originalText = agentResult.originalText;
                    const newOriginalContent = content + (content ? '\n\n' : '') + originalText;

                    // 1. Update Original Note
                    setContent(newOriginalContent);
                    updateHistory(title, newOriginalContent);

                    let noteId = localNoteId;

                    if (noteId) {
                        await updateNote(noteId, {
                            content: newOriginalContent,
                            audio_file_path: savedPath,
                            audio_duration: recording.duration,
                            has_audio: true,
                            encrypted_transcription: originalText
                        });
                    } else {
                        // Create new note
                        const newNote = await createNote({
                            title,
                            content: newOriginalContent,
                            audio: {
                                filePath: savedPath,
                                duration: recording.duration,
                                transcription: originalText
                            }
                        });
                        setLocalNoteId(newNote.id);
                        noteId = newNote.id;
                        lastSavedTitle.current = title;
                        lastSavedContent.current = newOriginalContent;
	                    }
	
	                    // 2. Handle Instruction (Create Improvement)
	                    const shouldCreateVoiceImprovement =
	                        agentResult.hasInstruction &&
	                        typeof agentResult.processedText === 'string' &&
	                        agentResult.processedText.trim().length > 0 &&
	                        !!noteId &&
	                        !areTextsEquivalent(agentResult.processedText, originalText) &&
	                        !areTextsEquivalent(agentResult.processedText, newOriginalContent);

	                    if (shouldCreateVoiceImprovement && noteId) {
	                        try {
	                            setIsAIProcessing(true);
	                            // Determine label for new tab
	                            const label = agentResult.mode
	                                ? `AI (${agentResult.mode})`
                                : 'AI Improvement';

                            // Create the improvement
                            const newImprovement = await createImprovement(noteId, {
                                content: agentResult.processedText!,
                                label: label,
                                optionId: 'voice_instruction'
                            });

                            // Setup drafts/history for new variant
                            improvementDraftsRef.current[newImprovement.id] = agentResult.processedText!;
                            improvementSavedRef.current[newImprovement.id] = agentResult.processedText!;
                            variantHistories.current[newImprovement.id] = {
                                history: [{ title: title || '', content: agentResult.processedText! }],
                                index: 0
                            };

                            // Switch to new variant
                            setActiveVariantId(newImprovement.id);
                            setContent(agentResult.processedText!);
                            await setActiveVariant(noteId, newImprovement.id);

                        } catch (err) {
                            console.error('Failed to create improvement from voice agent:', err);
                            Alert.alert('Error', 'Original text saved, but failed to create AI improvement.');
                        } finally {
	                            setIsAIProcessing(false);
	                        }
	                    } else if (agentResult.hasInstruction && agentResult.processedText && noteId) {
	                        console.log(
	                            '[NoteEditScreen] Skipping voice improvement creation: processed text matches original',
	                            { mode: agentResult.mode }
	                        );
	                    }
	
	                } else {
	                    // Transcription failed
	                    const isNewNote = !localNoteId;
                    const isEmptyNote = !title.trim() && !content.trim();

                    if (isNewNote && isEmptyNote) {
                        await AudioService.deleteAudioFile(savedPath);
                        Alert.alert(
                            'Transcription Failed',
                            'Note was not created because transcription failed.'
                        );
                        setIsTranscribing(false);
                        return;
                    }

                    Alert.alert('Transcription Failed', agentResult.error || 'Unknown error');
                    if (localNoteId) {
                        await updateNote(localNoteId, {
                            audio_file_path: savedPath,
                            audio_duration: recording.duration,
                            has_audio: true
                        });
                    } else {
                        const newNote = await createNote({
                            title,
                            content,
                            audio: {
                                filePath: savedPath,
                                duration: recording.duration,
                            }
                        });
                        setLocalNoteId(newNote.id);
                        lastSavedTitle.current = title;
                        lastSavedContent.current = content;
                    }
                }
            } else {
                // For improvements (and all other variants), we now use the Smart Agent too!
                // This allows for "intelligent" editing (e.g., "remove X", "format as todo").
                setIsTranscribing(true);

                // Pass the current variant's content as context
                const effectiveContent = activeVariantId === 'original'
                    ? content
                    : improvementDraftsRef.current[activeVariantId] || content;

                const agentResult = await processVoiceNote(recording.uri, 'ru', effectiveContent);
                setIsTranscribing(false);

                // Clean up temp file
                await AudioService.deleteAudioFile(recording.uri);

                if (agentResult.success) {
                    // Update content in-place with the processed result
                    // The agent returns the FULL new text in processedText (or originalText if mode is none/transcript)
                    // If mode is "edit" or "checklist", processedText contains the result.
                    // If just transcription, we might get originalText.

                    const newText = agentResult.processedText || agentResult.originalText;

                    if (newText) {
                        // If it was a pure append (no instruction), we might need to handle it.
                        // But processVoiceNote usually handles "append" by returning the full text if it was a command?
                        // Actually, if it's just transcription, we might want to append it ourselves if the agent didn't merge it.
                        // CHECK: Backend returns "improved_markdown" which SHOULD be the full text if it edited it.
                        // IF mode was 'none' (just transcription), we might need to append manually?
                        // Let's assume the Agent tries to be smart. If mode is 'none', it might just return the raw transcript?
                        // Re-reading TranscriptionService: 
                        // return { originalText: result.raw_note, processedText: result.improved_markdown, mode: result.mode ... }

                        let finalContent = newText;
                        if (!agentResult.mode || agentResult.mode === 'none') {
                            // Fallback: If agent didn't do anything special, append the raw text
                            // But wait, if we passed context, the agent usually returns the merged result?
                            // If we assume the agent is "smart enough" to return the full text if we sent context...
                            // Let's play safe: If processedText is present, use it.
                            // If NOT present (null), append originalText.
                            if (!agentResult.processedText) {
                                finalContent = effectiveContent + (effectiveContent ? '\n\n' : '') + agentResult.originalText;
                            }
                        }

                        setContent(finalContent);

                        // Update drafts and history
                        improvementDraftsRef.current[activeVariantId] = finalContent;
                        updateHistory('', finalContent);

                        // Save immediately
                        if (localNoteId) {
                            try {
                                await updateImprovement(localNoteId, activeVariantId, { content: finalContent });
                                improvementSavedRef.current[activeVariantId] = finalContent;
                            } catch (error) {
                                console.error('Failed to save improvement after voice agent:', error);
                            }
                        }
                    }
                } else {
                    Alert.alert('Voice Processing Failed', agentResult.error || 'Could not process voice command');
                }
            }

        } catch (error) {
            console.error('Error processing recording:', error);
            Alert.alert('Error', 'Failed to save recording');
            setIsTranscribing(false);
        }
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
                Alert.alert('Transcription Failed', transcription.error || 'Could not recognize speech');
            }
        } catch (error) {
            console.error('Instruction transcription failed:', error);
            Alert.alert('Error', 'Failed to transcribe instruction');
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

    const handleAddTodo = useCallback(() => {
        // Insert '- [ ] ' at cursor position or append
        const prefix = '\n- [ ] ';

        const newText =
            content.substring(0, selection.start) +
            prefix +
            content.substring(selection.end);

        handleContentChange(newText);

        // Update selection to be after the inserted text
        // Need to wait for render check?
        // Note: TextInput selection update might be tricky without ref focus
    }, [content, selection, handleContentChange]);

    const handleFormat = useCallback((type: MarkdownFormatType) => {
        editorRef.current?.handleFormat(type);
    }, []);


    const handleCheckPress = () => {
        Keyboard.dismiss();
        setIsEditing(false);
        saveNote(); // Auto-save on check press
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
                    content: improvedText,
                    label: option.label,
                    optionId: option.id,
                });
                improvementDraftsRef.current[improvement.id] = improvedText;
                improvementSavedRef.current[improvement.id] = improvedText;

                // Set this improvement as active in the database
                await setActiveVariant(targetNoteId, improvement.id);

                setActiveVariantId(improvement.id);
                setContent(improvedText);
            } else {
                // Update existing child variant in-place (no new children from children)
                console.log('[NoteEditScreen] Updating existing improvement in-place:', {
                    improvementId: activeVariantId,
                    parentNoteId: targetNoteId,
                    newLabel: option.label,
                    newOptionId: option.id
                });
                const updatedImprovement = await updateImprovement(targetNoteId, activeVariantId, {
                    content: improvedText,
                    label: option.label,
                    optionId: option.id,
                });

                console.log('[NoteEditScreen] Improvement updated successfully');

                // Update refs and UI with new content
                improvementDraftsRef.current[activeVariantId] = improvedText;
                improvementSavedRef.current[activeVariantId] = improvedText;
                setContent(improvedText);

                // Update history for this variant
                updateHistory('', improvedText);
            }
        } catch (error) {
            const message = error instanceof Error
                ? error.message
                : 'Failed to improve text. Check AI settings.';
            Alert.alert('Error', message);
        } finally {
            setIsAIProcessing(false);
        }
    };

    const handleReorderEnd = async (data: AIImprovementOption[]) => {
        setAiOptions(data);
        await saveImprovementOptions(data);
    };

    const handleCreatePrompt = async () => {
        if (!newPromptTitle.trim() || !newPromptTemplate.trim()) {
            return;
        }

        const preparedTemplate = ensureTemplateHasPlaceholder(newPromptTemplate.trim());

        const newOption: AIImprovementOption = {
            id: `custom - ${Date.now()}`,
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
                        <React.Fragment key={`${segment} - ${index}`}>
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
                    <React.Fragment key={`${segment} - ${index}`}>
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
            handleRecordingFinish(route.params.initialRecording);
        }
    }, [route.params?.initialRecording]);

    useEffect(() => {
        const showSub = Keyboard.addListener('keyboardDidShow', () => setIsEditing(true));
        const hideSub = Keyboard.addListener('keyboardDidHide', () => setIsEditing(false));

        return () => {
            showSub.remove();
            hideSub.remove();
        };
    }, []);

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

            {showAudioPlayer && audioUri && (
                <AudioPlayer
                    audioUri={audioUri}
                    duration={audioDuration}
                    onClose={() => setShowAudioPlayer(false)}
                />
            )}

            {isTranscribing && (
                <View style={styles.transcribingContainer}>
                    <ActivityIndicator color={colors.primary} />
                    <Text style={styles.transcribingText}>Transcribing...</Text>
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
                        onPress={() => setShowAIModal(true)}
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

                    {/* Cassette Button for Audio */}
                    {audioUri && (
                        <TouchableOpacity
                            onPress={() => setShowAudioPlayer(!showAudioPlayer)}
                            style={styles.iconButton}
                        >
                            <MaterialIcons name="graphic-eq" size={24} color={colors.text} />
                        </TouchableOpacity>
                    )}

                    {isEditing ? (
                        <>
                            <TouchableOpacity onPress={handleUndo} style={styles.iconButton}>
                                <MaterialIcons name="undo" size={24} color={(!variantHistories.current[activeVariantId] || variantHistories.current[activeVariantId].index === 0) ? colors.textMuted : colors.text} />
                            </TouchableOpacity>
                            <TouchableOpacity
                                onPress={handleRedo}
                                style={styles.iconButton}
                                disabled={!variantHistories.current[activeVariantId] || variantHistories.current[activeVariantId].index === variantHistories.current[activeVariantId].history.length - 1}
                            >
                                <MaterialIcons name="redo" size={24} color={(!variantHistories.current[activeVariantId] || variantHistories.current[activeVariantId].index === variantHistories.current[activeVariantId].history.length - 1) ? colors.textMuted : colors.text} />
                            </TouchableOpacity>
                            {/* Removed Checklist button here since checks are available in toolbar now. 
                                 Can keep if user wants to insert todo without toolbar? 
                                 User request implies toolbar is THE way. Clean header is better.
                             */}
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
                                    <FlatList
                                        style={styles.aiList}
                                        contentContainerStyle={styles.aiListContent}
                                        data={aiOptions}
                                        keyExtractor={(item) => item.id}
                                        renderItem={({ item }) => (
                                            <TouchableOpacity
                                                style={[styles.aiOptionItem, styles.aiReorderItem]}
                                                onPress={() => {
                                                    handleAIImprovement(item);
                                                }}
                                                activeOpacity={0.7}
                                            >
                                                <View style={styles.aiOptionIconContainer}>
                                                    <MaterialIcons name={item.icon as any} size={24} color={colors.primary} />
                                                </View>
                                                <View style={styles.aiOptionTextWrapper}>
                                                    <Text style={styles.aiOptionLabel}>{item.label}</Text>
                                                    {renderOptionPrompt(item.prompt)}
                                                </View>
                                                {/* Drag handle removed for now */}
                                                {/* <MaterialIcons name="drag-handle" size={22} color={colors.textMuted} /> */}
                                            </TouchableOpacity>
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
                            <TouchableOpacity onPress={handleDelete} style={styles.menuItem}>
                                <Text style={styles.menuItemText}>Delete</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>


            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 50}
                style={{ flex: 1 }}
            >
                <View style={{ flex: 1 }}>
                    <RichTextEditor
                        ref={editorRef}
                        initialContent={content}
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
                        placeholder="Start typing..."
                        ListHeaderComponent={renderHeader()}
                    />
                </View>

                {/* Formatting Toolbar - Show when in Edit Mode. */}
                {isEditing && (
                    <View style={styles.toolbarContainer}>
                        <MarkdownToolbar onFormat={handleFormat} activeFormats={activeFormats} />
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

            <VoiceRecorder
                visible={showVoiceRecorder}
                onFinish={(rec) => {
                    if (isRecordingInstruction) {
                        handleInstructionRecordingFinish(rec);
                    } else {
                        handleRecordingFinish(rec);
                    }
                }}
                onCancel={() => {
                    setShowVoiceRecorder(false);
                    setIsRecordingInstruction(false);
                }}
                autoStart={true}
            />

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
        minWidth: 150,
    },
    menuItem: {
        paddingVertical: spacing.s,
        paddingHorizontal: spacing.m,
    },
    menuItemText: {
        fontSize: 16,
        color: colors.text,
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
    toolbarContainer: {
        width: '100%',
        backgroundColor: colors.surface,
        paddingBottom: spacing.s,
    },
});
