import React, { useState, useEffect, useLayoutEffect } from 'react';
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
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { useNotesContext } from '../contexts/NotesContext';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

type NoteEditRouteProp = RouteProp<{ params: { noteId?: string } }, 'params'>;

export const NoteEditScreen = () => {
    const navigation = useNavigation<NativeStackNavigationProp<any>>();
    const route = useRoute<NoteEditRouteProp>();
    const { noteId } = route.params || {};

    const { notes, createNote, updateNote, deleteNote } = useNotesContext();

    const [content, setContent] = useState('');
    const [loading, setLoading] = useState(false);
    const [initialLoading, setInitialLoading] = useState(!!noteId);

    useEffect(() => {
        if (noteId) {
            const note = notes.find((n) => n.id === noteId);
            if (note) {
                setContent(note.content ?? '');
            }
            setInitialLoading(false);
        }
    }, [noteId, notes]);



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
            if (!content.trim()) {
                // Don't save empty notes
                return;
            }

            // Prevent default behavior
            e.preventDefault();

            try {
                if (noteId) {
                    await updateNote(noteId, content);
                } else {
                    await createNote(content);
                }
                // After saving, allow navigation
                navigation.dispatch(e.data.action);
            } catch (error) {
                Alert.alert('Error', 'Failed to save note');
            }
        });

        return unsubscribe;
    }, [navigation, content, noteId, createNote, updateNote]);

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
            </KeyboardAvoidingView>
        </ScreenContainer>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    input: {
        flex: 1,
        fontSize: 18,
        lineHeight: 28,
        color: colors.text,
        paddingTop: spacing.m,
    },

    headerButton: {
        marginLeft: spacing.m,
    },
    headerButtonText: {
        ...typography.button,
        color: colors.primary,
    },
});
