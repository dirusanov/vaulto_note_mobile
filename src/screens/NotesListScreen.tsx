import React, { useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Dimensions, TextInput } from 'react-native';
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
    const [searchQuery, setSearchQuery] = React.useState('');
    const { notes, loading, fetchNotes, searchNotes } = useNotesContext();

    useEffect(() => {
        if (isFocused) {
            fetchNotes();
        }
    }, [isFocused, fetchNotes]);

    const handleSearch = (text: string) => {
        setSearchQuery(text);
        searchNotes(text);
    };

    const handleNotePress = (note: any) => {
        navigation.navigate('NoteEdit', { noteId: note.id });
    };

    const handleSettingsPress = () => {
        navigation.navigate('Settings');
    };

    const renderItem = ({ item }: { item: any }) => (
        <View style={styles.noteWrapper}>
            <NoteCard note={item} onPress={() => handleNotePress(item)} />
        </View>
    );

    // Determine number of columns based on screen width
    const { width } = Dimensions.get('window');
    let numColumns = 2;
    if (width >= 900) {
        numColumns = 4;
    } else if (width >= 600) {
        numColumns = 3;
    }

    const handleCreateNote = () => {
        navigation.navigate('NoteEdit');
    };

    return (
        <ScreenContainer>
            <View style={styles.header}>
                <View style={styles.headerTop}>
                    <Text style={styles.title}>Notes</Text>
                    <TouchableOpacity onPress={handleSettingsPress} style={styles.settingsButton}>
                        <Text style={styles.settingsIcon}>⚙️</Text>
                    </TouchableOpacity>
                </View>
                <Text style={styles.subtitle}>
                    {notes.length} {notes.length === 1 ? 'note' : 'notes'}
                </Text>
                <TextInput
                    style={styles.searchBar}
                    placeholder="Search notes..."
                    placeholderTextColor={colors.textSecondary}
                    value={searchQuery}
                    onChangeText={handleSearch}
                />
            </View>

            {loading && notes.length === 0 ? (
                <Loader />
            ) : (
                <FlatList
                    data={notes}
                    keyExtractor={(item) => String(item.id)}
                    renderItem={renderItem}
                    numColumns={numColumns}
                    key={numColumns} // Force re-render when columns change
                    contentContainerStyle={styles.list}
                    columnWrapperStyle={numColumns > 1 ? styles.row : undefined}
                    ListEmptyComponent={
                        <View style={styles.emptyContainer}>
                            <EmptyState message={searchQuery ? "No matching notes found" : "No notes yet. Tap + to create one."} />
                        </View>
                    }
                    refreshing={loading}
                    onRefresh={fetchNotes}
                    showsVerticalScrollIndicator={false}
                />
            )}

            <TouchableOpacity
                style={styles.fab}
                onPress={handleCreateNote}
                activeOpacity={0.8}
            >
                <Text style={styles.fabText}>+</Text>
            </TouchableOpacity>
        </ScreenContainer>
    );
};

const styles = StyleSheet.create({
    header: {
        paddingTop: spacing.s,
        paddingBottom: spacing.m,
        marginBottom: spacing.xs,
    },
    headerTop: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: spacing.xs,
    },
    title: {
        ...typography.h1,
        fontSize: 32,
        fontWeight: '700',
        letterSpacing: -0.5,
        color: colors.text,
    },
    settingsButton: {
        padding: spacing.xs,
        borderRadius: 8,
        backgroundColor: colors.backgroundSecondary,
    },
    settingsIcon: {
        fontSize: 24,
    },
    subtitle: {
        ...typography.bodySmall,
        fontSize: 13,
        color: colors.textSecondary,
        marginBottom: spacing.m,
    },
    searchBar: {
        backgroundColor: colors.surface,
        borderRadius: 10,
        paddingHorizontal: spacing.m,
        paddingVertical: spacing.s,
        color: colors.text,
        fontSize: 15,
        borderWidth: 1,
        borderColor: colors.border,
    },
    list: {
        paddingBottom: 100, // Space for FAB
    },
    row: {
        justifyContent: 'flex-start',
        marginBottom: spacing.xs,
    },
    noteWrapper: {
        flex: 1,
        maxWidth: `${100 / 2}%`, // Will be adjusted by numColumns
        padding: spacing.xxs,
    },
    emptyContainer: {
        flex: 1,
        width: '100%',
        marginTop: spacing.xxl,
    },
    fab: {
        position: 'absolute',
        bottom: spacing.xl,
        right: spacing.xl,
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: colors.primary,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 8,
    },
    fabText: {
        fontSize: 32,
        fontWeight: '300',
        color: '#FFFFFF',
        lineHeight: 32,
    },
});
