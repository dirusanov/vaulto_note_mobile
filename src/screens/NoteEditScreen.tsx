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
// import DraggableFlatList, { RenderItemParams } from 'react-native-draggable-flatlist';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
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
import { transcribeAudio } from '../services/TranscriptionService';
import { getPrivacyWarningDismissed } from '../utils/storage';
import {
    improveText,
    loadImprovementOptions,
    saveImprovementOptions,
    AIImprovementOption,
    DEFAULT_IMPROVEMENT_OPTIONS,
    ensureTemplateHasPlaceholder,
} from '../services/AIService';

type NoteEditScreenRouteProp = RouteProp<RootStackParamList, 'NoteEdit'>;
type NoteEditScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'NoteEdit'>;

// Simple history stack implementation
interface HistoryState {
    content: string;
    title: string;
}

export const NoteEditScreen = () => {
    const navigation = useNavigation<NoteEditScreenNavigationProp>();
    const route = useRoute<NoteEditScreenRouteProp>();
    const {
        createNote,
        updateNote,
        deleteNote,
        notes,
        createImprovement,
        updateImprovement,
        deleteImprovement,
    } = useNotesContext();
    const ICON_CHOICES = ['translate', 'spellcheck', 'bolt', 'lightbulb', 'auto-awesome', 'text-fields', 'chat', 'edit'];

    const [localNoteId, setLocalNoteId] = useState(route.params?.noteId);
    const existingNote = notes.find(n => n.id === localNoteId);
    const noteImprovements = useMemo(() => existingNote?.improvements ?? [], [existingNote?.improvements]);

    const [title, setTitle] = useState(existingNote?.title || '');
    const [content, setContent] = useState(existingNote?.content || '');
    const [isSaving, setIsSaving] = useState(false);
    const [showMenu, setShowMenu] = useState(false);
    const [isEditing, setIsEditing] = useState(false);

    // History for Undo/Redo
    const [history, setHistory] = useState<HistoryState[]>([{ title: existingNote?.title || '', content: existingNote?.content || '' }]);
    const [historyIndex, setHistoryIndex] = useState(0);
    const historyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
    const [activeVariantId, setActiveVariantId] = useState<string>('original');
    const improvementDraftsRef = useRef<Record<string, string>>({});
    const improvementSavedRef = useRef<Record<string, string>>({});

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

    // Handle history updates
    const updateHistory = (newTitle: string, newContent: string) => {
        // Clear existing timeout to debounce history updates
        if (historyTimeoutRef.current) {
            clearTimeout(historyTimeoutRef.current);
        }

        historyTimeoutRef.current = setTimeout(() => {
            setHistory(prev => {
                const newHistory = prev.slice(0, historyIndex + 1);
                newHistory.push({ title: newTitle, content: newContent });
                // Limit history size if needed, e.g., 50 items
                return newHistory;
            });
            setHistoryIndex(prev => prev + 1);
        }, 500); // 500ms debounce
    };

    const handleTitleChange = (text: string) => {
        setTitle(text);
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

    const handleContentChange = (text: string) => {
        setContent(text);
        if (activeVariantId === 'original') {
            updateHistory(title, text);
        } else {
            improvementDraftsRef.current[activeVariantId] = text;
        }
    };

    const handleDeleteImprovementVariant = useCallback(async (improvementId: string) => {
        if (!localNoteId) return;
        try {
            await deleteImprovement(localNoteId, improvementId);
            delete improvementDraftsRef.current[improvementId];
            delete improvementSavedRef.current[improvementId];
            if (activeVariantId === improvementId) {
                setActiveVariantId('original');
                setContent(existingNote?.content || '');
            }
        } catch (error) {
            console.error('Failed to delete improvement', error);
            Alert.alert('Error', 'Failed to delete improvement');
        }
    }, [activeVariantId, deleteImprovement, existingNote?.content, localNoteId]);

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
        if (activeVariantId !== 'original') return;
        if (historyIndex > 0) {
            const prevIndex = historyIndex - 1;
            const prevState = history[prevIndex];
            setTitle(prevState.title);
            setContent(prevState.content);
            setHistoryIndex(prevIndex);
        }
    };

    const handleRedo = () => {
        if (activeVariantId !== 'original') return;
        if (historyIndex < history.length - 1) {
            const nextIndex = historyIndex + 1;
            const nextState = history[nextIndex];
            setTitle(nextState.title);
            setContent(nextState.content);
            setHistoryIndex(nextIndex);
        }
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
        const emptyText = !title.trim() && !content.trim();
        if (emptyText && !hasAudio) {
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
    }, [activeVariantId, audioUri, content, createNote, deleteNote, existingNote?.has_audio, localNoteId, saveImprovementDraft, title, updateNote]);

    const handleVariantSelect = useCallback(async (variantId: string) => {
        if (variantId === activeVariantId) {
            return;
        }
        try {
            await saveNote();
        } catch (error) {
            console.error('Failed to save before switching variant:', error);
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
    }, [activeVariantId, existingNote?.content, noteImprovements, saveNote]);

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
        if (activeVariantId !== 'original') {
            Alert.alert('Switch to Original', 'Voice recording is only available for the original version of the note.');
            return;
        }
        const dismissed = await getPrivacyWarningDismissed();
        if (dismissed) {
            setShowVoiceRecorder(true);
        } else {
            setShowPrivacyWarning(true);
        }
    };

    const handlePrivacyAccept = () => {
        setShowPrivacyWarning(false);
        setShowVoiceRecorder(true);
    };

    const handleRecordingFinish = async (recording: AudioRecording) => {
        if (activeVariantId !== 'original') {
            Alert.alert('Switch to Original', 'Voice notes can only be attached to the original text.');
            return;
        }
        setShowVoiceRecorder(false);

        try {
            const savedPath = await AudioService.saveAudioFile(recording.uri, false);
            const playbackUri = await AudioService.readAudioFile(savedPath);
            setAudioUri(playbackUri);
            setAudioDuration(recording.duration);
            setShowAudioPlayer(true); // Show player after recording

            setIsTranscribing(true);
            const transcription = await transcribeAudio(recording.uri);
            setIsTranscribing(false);

            await AudioService.deleteAudioFile(recording.uri);

            if (transcription.success && transcription.text) {
                const newContent = content + (content ? '\n\n' : '') + transcription.text;
                setContent(newContent);
                updateHistory(title, newContent);

                if (localNoteId) {
                    await updateNote(localNoteId, {
                        content: newContent,
                        audio_file_path: savedPath,
                        audio_duration: recording.duration,
                        has_audio: true,
                        encrypted_transcription: transcription.text
                    });
                } else {
                    // Create new note if it doesn't exist
                    const newNote = await createNote({
                        title,
                        content: newContent,
                        audio: {
                            filePath: savedPath,
                            duration: recording.duration,
                            transcription: transcription.text
                        }
                    });
                    setLocalNoteId(newNote.id);
                    lastSavedTitle.current = title;
                    lastSavedContent.current = newContent;
                }
            } else {
                // Transcription failed

                // Check if we should discard this recording
                // If it's a new note AND has no text content, we shouldn't create a "phantom" note
                const isNewNote = !localNoteId;
                const isEmptyNote = !title.trim() && !content.trim();

                if (isNewNote && isEmptyNote) {
                    // Cleanup the saved audio file since we aren't keeping the note
                    await AudioService.deleteAudioFile(savedPath);
                    Alert.alert(
                        'Transcription Failed',
                        'Note was not created because transcription failed.'
                    );
                    setIsTranscribing(false);
                    return;
                }

                Alert.alert('Transcription Failed', transcription.error || 'Unknown error');
                if (localNoteId) {
                    await updateNote(localNoteId, {
                        audio_file_path: savedPath,
                        audio_duration: recording.duration,
                        has_audio: true
                    });
                } else {
                    // Create new note with audio but no transcription (only if it has other content)
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

        } catch (error) {
            console.error('Error processing recording:', error);
            Alert.alert('Error', 'Failed to save recording');
            setIsTranscribing(false);
        }
    };

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

            const improvement = await createImprovement(targetNoteId, {
                content: improvedText,
                label: option.label,
                optionId: option.id,
            });
            improvementDraftsRef.current[improvement.id] = improvedText;
            improvementSavedRef.current[improvement.id] = improvedText;
            setActiveVariantId(improvement.id);
            setContent(improvedText);
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
            return <Text style={styles.promptPreviewPlaceholder}>Start typing prompt text</Text>;
        }

        const normalized = ensureTemplateHasPlaceholder(template);
        if (normalized.includes('{text}')) {
            const segments = normalized.split(/{text}/gi);
            return (
                <Text style={styles.promptPreviewText}>
                    {segments.map((segment, index) => (
                        <React.Fragment key={`${segment}-${index}`}>
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
                    <React.Fragment key={`${segment}-${index}`}>
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

    return (
        <ScreenContainer>
            <View style={styles.header}>
                <TouchableOpacity onPress={handleBack} style={styles.iconButton}>
                    <MaterialIcons name="arrow-back" size={28} color={colors.text} />
                </TouchableOpacity>
                <View style={styles.headerRight}>
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
                            <TouchableOpacity
                                onPress={handleUndo}
                                style={[styles.iconButton, historyIndex === 0 && styles.disabledIcon]}
                                disabled={historyIndex === 0}
                            >
                                <MaterialIcons name="undo" size={24} color={historyIndex === 0 ? colors.textMuted : colors.text} />
                            </TouchableOpacity>
                            <TouchableOpacity
                                onPress={handleRedo}
                                style={[styles.iconButton, historyIndex === history.length - 1 && styles.disabledIcon]}
                                disabled={historyIndex === history.length - 1}
                            >
                                <MaterialIcons name="redo" size={24} color={historyIndex === history.length - 1 ? colors.textMuted : colors.text} />
                            </TouchableOpacity>
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
                                <View style={styles.promptBuilderContent}>
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
                style={{ flex: 1 }}
            >
                <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
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

                    <View style={styles.variantContainer}>
                        <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={styles.variantScrollContent}
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

                            {noteImprovements.map((imp) => (
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

                    <TextInput
                        style={styles.contentInput}
                        placeholder="Start typing..."
                        placeholderTextColor={colors.textMuted}
                        value={content}
                        onChangeText={handleContentChange}
                        onFocus={() => setIsEditing(true)}
                        multiline
                        textAlignVertical="top"
                    />
                    <View style={{ height: 100 }} />
                </ScrollView>
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
            )}

            <PrivacyWarningModal
                visible={showPrivacyWarning}
                onAccept={handlePrivacyAccept}
                onCancel={() => setShowPrivacyWarning(false)}
            />

            <VoiceRecorder
                visible={showVoiceRecorder}
                onFinish={handleRecordingFinish}
                onCancel={() => setShowVoiceRecorder(false)}
                autoStart={true}
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
        marginBottom: spacing.s,
        marginTop: spacing.xl,
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
        paddingHorizontal: spacing.s,
        paddingVertical: spacing.xs,
        borderRadius: 8,
        backgroundColor: colors.background,
        gap: spacing.xs,
    },
    aiActionText: {
        ...typography.caption,
        color: colors.primary,
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
        marginTop: spacing.l,
        paddingVertical: spacing.m,
        alignItems: 'center',
    },
    aiCloseButtonText: {
        ...typography.body,
        color: colors.textMuted,
    },
    promptBuilderWrapper: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    promptBuilderContent: {
        backgroundColor: colors.surface,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        padding: spacing.l,
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
});
