import React, { useState, useEffect, useLayoutEffect, useCallback } from 'react';
import {
    View,
    TextInput,
    StyleSheet,
    TouchableOpacity,
    Text,
    Alert,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { ScreenContainer } from '../components/ScreenContainer';
import { Loader } from '../components/Loader';
import { AudioPlayer } from '../components/AudioPlayer';
import { VoiceRecorder } from '../components/VoiceRecorder';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { useNotesContext } from '../contexts/NotesContext';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AudioService, AudioRecording } from '../services/AudioService';
import { NoteAudio } from '../hooks/useNotes';

type NoteEditRouteProp = RouteProp<{ params: { noteId?: string } }, 'params'>;

export const NoteEditScreen = () => {
    const navigation = useNavigation<NativeStackNavigationProp<any>>();
    const route = useRoute<NoteEditRouteProp>();
    const { noteId } = route.params || {};

    const { notes, createNote, updateNote, deleteNote } = useNotesContext();

    const [content, setContent] = useState('');
    const [audio, setAudio] = useState<NoteAudio | null>(null);
    const [playbackUri, setPlaybackUri] = useState<string | null>(null);
    const [recorderVisible, setRecorderVisible] = useState(false);
    const [audioWorking, setAudioWorking] = useState(false);
    const [loading, setLoading] = useState(false);
    const [initialLoading, setInitialLoading] = useState(!!noteId);

    const preparePlayback = useCallback(async (filePath: string) => {
        try {
            setAudioWorking(true);
            const uri = await AudioService.readAudioFile(filePath);
            setPlaybackUri(uri);
        } catch (error) {
            console.error('[NoteEdit] Failed to load audio file', error);
            Alert.alert('Ошибка', 'Не удалось открыть аудио файл');
            setPlaybackUri(null);
        } finally {
            setAudioWorking(false);
        }
    }, []);

    const handleRecordingFinish = async (recording: AudioRecording) => {
        try {
            setAudioWorking(true);
            const filePath = await AudioService.saveAudioFile(recording.uri);
            const newAudio: NoteAudio = {
                filePath,
                duration: recording.duration,
            };
            setAudio(newAudio);
            await preparePlayback(filePath);
        } catch (error) {
            console.error('[NoteEdit] Failed to save audio', error);
            Alert.alert('Ошибка', 'Не удалось сохранить аудио');
        } finally {
            setRecorderVisible(false);
            setAudioWorking(false);
        }
    };

    const handleRecorderCancel = () => {
        setRecorderVisible(false);
    };

    const handleRemoveAudio = async () => {
        try {
            if (audio?.filePath) {
                await AudioService.deleteAudioFile(audio.filePath);
            }
            setAudio(null);
            setPlaybackUri(null);
            await AudioService.cleanupTempFiles();
        } catch (error) {
            console.error('[NoteEdit] Failed to remove audio', error);
        }
    };

    useEffect(() => {
        if (noteId) {
            const note = notes.find((n) => n.id === noteId);
            if (note) {
                setContent(note.content ?? '');
                if (note.audio_file_path) {
                    const attachedAudio: NoteAudio = {
                        filePath: note.audio_file_path,
                        duration: note.audio_duration ?? 0,
                        transcription: note.transcription,
                    };
                    setAudio(attachedAudio);
                    preparePlayback(attachedAudio.filePath);
                } else {
                    setAudio(null);
                    setPlaybackUri(null);
                }
            }
            setInitialLoading(false);
        }
    }, [noteId, notes, preparePlayback]);

    useEffect(() => {
        return () => {
            AudioService.cleanupTempFiles().catch(() => null);
        };
    }, []);



    const handleDelete = async () => {
        if (!noteId) return;

        Alert.alert(
            'Delete Note',
            'Are you sure you want to delete this note?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        setLoading(true);
                        try {
                            await deleteNote(noteId);
                            navigation.goBack();
                        } catch (error) {
                            Alert.alert('Error', 'Failed to delete note');
                            setLoading(false);
                        }
                    },
                },
            ]
        );
    };

    // Auto-save when navigating back
    useEffect(() => {
        const unsubscribe = navigation.addListener('beforeRemove', async (e) => {
            if (!content.trim() && !audio) {
                // Don't save empty notes without audio
                return;
            }

            // Prevent default behavior
            e.preventDefault();

            try {
                if (noteId) {
                    await updateNote(noteId, content, audio ?? null);
                } else {
                    await createNote(content, audio ?? undefined);
                }
                // After saving, allow navigation
                navigation.dispatch(e.data.action);
            } catch (error) {
                Alert.alert('Error', 'Failed to save note');
            }
        });

        return unsubscribe;
    }, [navigation, content, noteId, audio, createNote, updateNote]);

    useLayoutEffect(() => {
        navigation.setOptions({
            headerRight: () => (
                noteId ? (
                    <TouchableOpacity onPress={handleDelete} style={styles.headerButton}>
                        <Text style={[styles.headerButtonText, { color: colors.error }]}>Delete</Text>
                    </TouchableOpacity>
                ) : null
            ),
        });
    }, [navigation, noteId]);

    if (initialLoading) {
        return <Loader />;
    }

    return (
        <ScreenContainer>
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={styles.container}
            >
                <View style={styles.editor}>
                    <TextInput
                        style={styles.input}
                        multiline
                        placeholder="Start typing..."
                        placeholderTextColor={colors.textMuted}
                        value={content}
                        onChangeText={setContent}
                        textAlignVertical="top"
                        autoFocus={!noteId}
                    />

                    {audio && (
                        <View style={styles.audioBlock}>
                            <Text style={styles.sectionLabel}>Голосовая заметка</Text>
                            {playbackUri ? (
                                <AudioPlayer audioUri={playbackUri} duration={audio.duration} />
                            ) : (
                                <Text style={styles.audioHint}>
                                    {audioWorking ? 'Подготовка аудио...' : 'Файл ещё готовится'}
                                </Text>
                            )}
                            <View style={styles.audioActions}>
                                <TouchableOpacity
                                    style={styles.secondaryButton}
                                    onPress={handleRemoveAudio}
                                    disabled={audioWorking}
                                >
                                    <Text style={[styles.secondaryButtonText, audioWorking && styles.disabledText]}>
                                        Удалить аудио
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    )}
                </View>

                <View style={styles.micRow}>
                    <View>
                        <Text style={styles.micLabel}>Добавить голос</Text>
                        <Text style={styles.micSubLabel}>Запишите быстрый диктант к заметке</Text>
                    </View>
                    <TouchableOpacity
                        style={styles.micButton}
                        onPress={() => setRecorderVisible(true)}
                        disabled={audioWorking || loading}
                    >
                        <Text style={styles.micIcon}>🎤</Text>
                    </TouchableOpacity>
                </View>
            </KeyboardAvoidingView>
            <VoiceRecorder
                visible={recorderVisible}
                onFinish={handleRecordingFinish}
                onCancel={handleRecorderCancel}
            />
        </ScreenContainer>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    editor: {
        flex: 1,
    },
    input: {
        flex: 1,
        fontSize: 18,
        lineHeight: 28,
        color: colors.text,
        paddingTop: spacing.m,
    },
    audioBlock: {
        marginTop: spacing.m,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        padding: spacing.m,
        backgroundColor: colors.surface,
    },
    sectionLabel: {
        ...typography.caption,
        color: colors.textMuted,
        marginBottom: spacing.xs,
    },
    audioHint: {
        ...typography.body,
        color: colors.textMuted,
    },
    audioActions: {
        marginTop: spacing.s,
        flexDirection: 'row',
        justifyContent: 'flex-end',
    },
    secondaryButton: {
        paddingHorizontal: spacing.m,
        paddingVertical: spacing.s,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
    },
    secondaryButtonText: {
        ...typography.button,
        color: colors.text,
    },
    disabledText: {
        color: colors.textMuted,
    },
    micRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: spacing.m,
        borderTopWidth: 1,
        borderColor: colors.border,
        marginTop: spacing.s,
    },
    micLabel: {
        ...typography.body,
        fontWeight: '600',
    },
    micSubLabel: {
        ...typography.caption,
        color: colors.textMuted,
        marginTop: spacing.xxs,
    },
    micButton: {
        width: 52,
        height: 52,
        borderRadius: 26,
        backgroundColor: colors.primary,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: colors.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
        elevation: 6,
    },
    micIcon: {
        fontSize: 24,
    },

    headerButton: {
        marginLeft: spacing.m,
    },
    headerButtonText: {
        ...typography.button,
        color: colors.primary,
    },
});
