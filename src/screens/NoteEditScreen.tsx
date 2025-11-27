import React, { useState, useEffect, useRef } from 'react';
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
} from 'react-native';
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
import { improveText, IMPROVEMENT_OPTIONS, AIImprovementOption } from '../services/AIService';

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
    const { createNote, updateNote, deleteNote, notes } = useNotesContext();

    const [localNoteId, setLocalNoteId] = useState(route.params?.noteId);
    const existingNote = notes.find(n => n.id === localNoteId);

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

    const [showAudioPlayer, setShowAudioPlayer] = useState(false);

    // AI State
    const [showAIModal, setShowAIModal] = useState(false);
    const [isAIProcessing, setIsAIProcessing] = useState(false);

    useEffect(() => {
        if (existingNote) {
            // Only update if we haven't modified it locally (basic conflict avoidance)
            if (lastSavedTitle.current === title) setTitle(existingNote.title || '');
            if (lastSavedContent.current === content) setContent(existingNote.content || '');

            // Load audio if exists
            if (existingNote.has_audio && existingNote.audio_file_path && !audioUri) {
                loadAudio(existingNote.audio_file_path);
                setAudioDuration(existingNote.audio_duration || 0);
            }
        }
    }, [existingNote]);

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
        updateHistory(text, content);
    };

    const handleContentChange = (text: string) => {
        setContent(text);
        updateHistory(title, text);
    };

    const handleUndo = () => {
        if (historyIndex > 0) {
            const prevIndex = historyIndex - 1;
            const prevState = history[prevIndex];
            setTitle(prevState.title);
            setContent(prevState.content);
            setHistoryIndex(prevIndex);
        }
    };

    const handleRedo = () => {
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

    const saveNote = async () => {
        if ((!title.trim() && !content.trim()) || (title === lastSavedTitle.current && content === lastSavedContent.current)) {
            return;
        }

        setIsSaving(true);
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
                setLocalNoteId(newNote.id);
            }
            lastSavedTitle.current = title;
            lastSavedContent.current = content;
        } catch (error) {
            console.error('Failed to save note:', error);
        } finally {
            setIsSaving(false);
        }
    };

    const handleBack = async () => {
        Keyboard.dismiss();
        // Attempt to save, but don't block navigation indefinitely
        try {
            const savePromise = saveNote();
            // Wait max 500ms for save check/execution before navigating
            // If save is actually running (network), it will continue in background
            // If it's just the early return check, it will be instant
            const timeoutPromise = new Promise(resolve => setTimeout(resolve, 500));
            await Promise.race([savePromise, timeoutPromise]);
        } catch (error) {
            console.error('Error during back navigation save:', error);
        }
        navigation.goBack();
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
                        navigation.goBack();
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
                Alert.alert('Транскрибация не удалась', transcription.error || 'Неизвестная ошибка');
                if (localNoteId) {
                    await updateNote(localNoteId, {
                        audio_file_path: savedPath,
                        audio_duration: recording.duration,
                        has_audio: true
                    });
                } else {
                    // Create new note with audio but no transcription
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
            Alert.alert('Ошибка', 'Не удалось сохранить запись');
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
            const improvedText = await improveText(content, option.id);
            setContent(improvedText);
            updateHistory(title, improvedText);
        } catch (error) {
            Alert.alert('Ошибка', 'Не удалось улучшить текст. Проверьте API ключ.');
        } finally {
            setIsAIProcessing(false);
        }
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

    return (
        <ScreenContainer>
            <View style={styles.header}>
                <TouchableOpacity onPress={handleBack} style={styles.iconButton}>
                    <MaterialIcons name="arrow-back" size={28} color={colors.text} />
                </TouchableOpacity>
                <View style={styles.headerRight}>
                    {/* AI Improvement Button */}
                    {isEditing && content.length > 0 && (
                        <TouchableOpacity
                            onPress={() => setShowAIModal(true)}
                            style={styles.iconButton}
                            disabled={isAIProcessing}
                        >
                            {isAIProcessing ? (
                                <ActivityIndicator size="small" color={colors.primary} />
                            ) : (
                                <MaterialIcons name="auto-awesome" size={24} color={colors.primary} />
                            )}
                        </TouchableOpacity>
                    )}

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
                    <View style={styles.modalOverlay}>
                        <TouchableWithoutFeedback>
                            <View style={styles.aiModalContent}>
                                <Text style={styles.aiModalTitle}>Улучшить текст с AI</Text>
                                <ScrollView showsVerticalScrollIndicator={false}>
                                    {IMPROVEMENT_OPTIONS.map((option) => (
                                        <TouchableOpacity
                                            key={option.id}
                                            style={styles.aiOptionItem}
                                            onPress={() => handleAIImprovement(option)}
                                        >
                                            <View style={styles.aiOptionIconContainer}>
                                                <MaterialIcons name={option.icon as any} size={24} color={colors.primary} />
                                            </View>
                                            <Text style={styles.aiOptionLabel}>{option.label}</Text>
                                            <MaterialIcons name="chevron-right" size={20} color={colors.textMuted} />
                                        </TouchableOpacity>
                                    ))}
                                </ScrollView>
                                <TouchableOpacity
                                    style={styles.aiCloseButton}
                                    onPress={() => setShowAIModal(false)}
                                >
                                    <Text style={styles.aiCloseButtonText}>Отмена</Text>
                                </TouchableOpacity>
                            </View>
                        </TouchableWithoutFeedback>
                    </View>
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
                            <Text style={styles.transcribingText}>Транскрибация...</Text>
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
    aiCloseButton: {
        marginTop: spacing.l,
        paddingVertical: spacing.m,
        alignItems: 'center',
    },
    aiCloseButtonText: {
        ...typography.body,
        color: colors.textMuted,
    },
});
