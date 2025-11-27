import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions } from 'react-native';
import { ScreenContainer } from '../components/ScreenContainer';
import { NoteCard } from '../components/NoteCard';
import { Loader } from '../components/Loader';
import { EmptyState } from '../components/EmptyState';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { useNotesContext } from '../contexts/NotesContext';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

export const NotesListScreen = () => {
    const navigation = useNavigation<NativeStackNavigationProp<any>>();
    const isFocused = useIsFocused();
    const { notes, loading, fetchNotes } = useNotesContext();

    useEffect(() => {
        if (isFocused) {
            fetchNotes();
        }
    }, [isFocused, fetchNotes]);

    const handleNotePress = (note: any) => {
        navigation.navigate('NoteEdit', { noteId: note.id });
    };

    const handleSettingsPress = () => {
        navigation.navigate('Settings');
    };

    const handleCreateNote = () => {
        navigation.navigate('NoteEdit');
    };

    // Split notes into two columns for masonry layout
    const leftColumnNotes = notes.filter((_, index) => index % 2 === 0);
    const rightColumnNotes = notes.filter((_, index) => index % 2 !== 0);

    return (
        <ScreenContainer>
            <View style={styles.header}>
                <View style={{ flex: 1 }} />
                <TouchableOpacity onPress={handleSettingsPress} style={styles.minimalSettingsButton}>
                    <Text style={styles.settingsIcon}>⚙️</Text>
                </TouchableOpacity>
            </View>

            {loading && notes.length === 0 ? (
                <Loader />
            ) : (
                <ScrollView
                    contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator={false}
                >
                    {notes.length === 0 ? (
                        <View style={styles.emptyContainer}>
                            <EmptyState message="No notes yet. Tap + to create one." />
                        </View>
                    ) : (
                        <View style={styles.masonryContainer}>
                            <View style={styles.column}>
                                {leftColumnNotes.map(note => (
                                    <NoteCard key={note.id} note={note} onPress={() => handleNotePress(note)} />
                                ))}
                            </View>
                            <View style={styles.column}>
                                {rightColumnNotes.map(note => (
                                    <NoteCard key={note.id} note={note} onPress={() => handleNotePress(note)} />
                                ))}
                            </View>
                        </View>
                    )}
                    <View style={{ height: 100 }} />
                </ScrollView>
            )}

            <TouchableOpacity
                style={styles.fab}
                onPress={handleCreateNote}
                activeOpacity={0.9}
            >
                <Text style={styles.fabText}>+</Text>
            </TouchableOpacity>
        </ScreenContainer>
    );
};

const styles = StyleSheet.create({
    header: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        alignItems: 'center',
        paddingTop: spacing.xl, // Added extra top padding
        paddingBottom: spacing.m,
        marginBottom: spacing.s,
    },
    minimalSettingsButton: {
        padding: spacing.s,
        justifyContent: 'center',
        alignItems: 'center',
    },
    settingsIcon: {
        fontSize: 24,
        color: colors.textSecondary,
    },
    scrollContent: {
        paddingBottom: spacing.xxl,
    },
    masonryContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    column: {
        flex: 1,
        marginHorizontal: spacing.xs,
    },
    emptyContainer: {
        marginTop: spacing.xxl * 2,
    },
    fab: {
        position: 'absolute',
        bottom: spacing.xxl * 1.5, // Moved higher up
        right: spacing.xl,
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: colors.accentYellow,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: colors.accentYellow,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.4,
        shadowRadius: 12,
        elevation: 8,
    },
    fabText: {
        fontSize: 36,
        fontWeight: '300',
        color: '#FFFFFF',
        marginTop: -4,
    },
});
