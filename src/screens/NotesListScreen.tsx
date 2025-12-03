import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions, Platform, Vibration, Alert, Animated, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ScreenContainer } from '../components/ScreenContainer';
import { NoteCard } from '../components/NoteCard';
import { Loader } from '../components/Loader';
import { EmptyState } from '../components/EmptyState';
import { VoiceRecorder } from '../components/VoiceRecorder';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { useNotesContext } from '../contexts/NotesContext';
import { useNavigation, useIsFocused, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AudioRecording } from '../services/AudioService';
import { MaterialIcons } from '@expo/vector-icons';

const { width } = Dimensions.get('window');
const DOCK_PREF_KEY = 'vaulto_dock_preference';

export const NotesListScreen = () => {
    const navigation = useNavigation<NativeStackNavigationProp<any>>();
    const isFocused = useIsFocused();
    const { notes, loading, fetchNotes, searchNotes } = useNotesContext();
    const [isVoiceRecorderVisible, setIsVoiceRecorderVisible] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    // true = Mic is Center (Primary), Note is Right (Secondary)
    // false = Note is Center (Primary), Mic is Right (Secondary)
    const [isMicPrimary, setIsMicPrimary] = useState(true);

    // Search Bar Animation
    const searchBarHeight = useRef(new Animated.Value(0)).current;
    const lastScrollY = useRef(0);
    const isSearchVisible = useRef(false);

    useFocusEffect(
        React.useCallback(() => {
            fetchNotes();
        }, [fetchNotes])
    );

    // Load dock preference when screen is focused
    useEffect(() => {
        if (isFocused) {
            loadDockPreference();
        }
    }, [isFocused]);

    const loadDockPreference = async () => {
        try {
            const pref = await AsyncStorage.getItem(DOCK_PREF_KEY);
            if (pref !== null) {
                setIsMicPrimary(pref === 'true');
            }
        } catch (e) {
            console.error('Failed to load dock preference', e);
        }
    };

    const toggleDockLayout = async () => {
        const newValue = !isMicPrimary;
        setIsMicPrimary(newValue);
        Vibration.vibrate(50); // Light haptic feedback
        try {
            await AsyncStorage.setItem(DOCK_PREF_KEY, String(newValue));
        } catch (e) {
            console.error('Failed to save dock preference', e);
        }
    };

    const handleNotePress = (note: any) => {
        navigation.navigate('NoteEdit', { noteId: note.id });
    };

    const handleSettingsPress = () => {
        navigation.navigate('Settings');
    };

    const handleCreateNote = () => {
        navigation.navigate('NoteEdit');
    };

    const handleVoiceFinish = (recording: AudioRecording) => {
        setIsVoiceRecorderVisible(false);
        navigation.navigate('NoteEdit', { initialRecording: recording });
    };

    const handleSearch = (text: string) => {
        setSearchQuery(text);
        searchNotes(text);
    };

    const handleScroll = (event: any) => {
        const currentScrollY = event.nativeEvent.contentOffset.y;
        const diff = currentScrollY - lastScrollY.current;

        // Pulling down (scrolling up) or at the very top
        if (diff < -5 || currentScrollY < -20) {
            if (!isSearchVisible.current) {
                Animated.timing(searchBarHeight, {
                    toValue: 60,
                    duration: 200,
                    useNativeDriver: false,
                }).start();
                isSearchVisible.current = true;
            }
        }
        // Scrolling down
        else if (diff > 5 && currentScrollY > 0) {
            if (isSearchVisible.current && searchQuery === '') { // Only hide if empty
                Animated.timing(searchBarHeight, {
                    toValue: 0,
                    duration: 200,
                    useNativeDriver: false,
                }).start();
                isSearchVisible.current = false;
            }
        }

        lastScrollY.current = currentScrollY;
    };

    // Split notes into two columns for masonry layout
    const leftColumnNotes = notes.filter((_, index) => index % 2 === 0);
    const rightColumnNotes = notes.filter((_, index) => index % 2 !== 0);

    const PrimaryButton = () => {
        if (isMicPrimary) {
            return (
                <TouchableOpacity
                    style={styles.centerButton}
                    onPress={() => setIsVoiceRecorderVisible(true)}
                    onLongPress={toggleDockLayout}
                    delayLongPress={500}
                    activeOpacity={0.8}
                >
                    <View style={styles.centerButtonInner}>
                        <MaterialIcons name="mic" size={40} color={colors.background} />
                    </View>
                </TouchableOpacity>
            );
        } else {
            return (
                <TouchableOpacity
                    style={styles.centerButton}
                    onPress={handleCreateNote}
                    onLongPress={toggleDockLayout}
                    delayLongPress={500}
                    activeOpacity={0.8}
                >
                    <View style={styles.centerButtonInner}>
                        <MaterialIcons name="edit" size={40} color={colors.background} />
                    </View>
                </TouchableOpacity>
            );
        }
    };

    const SecondaryButton = () => {
        if (isMicPrimary) {
            return (
                <TouchableOpacity
                    style={styles.dockButton}
                    onPress={handleCreateNote}
                    onLongPress={toggleDockLayout}
                    delayLongPress={500}
                    activeOpacity={0.7}
                >
                    <MaterialIcons name="edit" size={24} color={colors.textSecondary} />
                </TouchableOpacity>
            );
        } else {
            return (
                <TouchableOpacity
                    style={styles.dockButton}
                    onPress={() => setIsVoiceRecorderVisible(true)}
                    onLongPress={toggleDockLayout}
                    delayLongPress={500}
                    activeOpacity={0.7}
                >
                    <MaterialIcons name="mic" size={24} color={colors.textSecondary} />
                </TouchableOpacity>
            );
        }
    };

    return (
        <ScreenContainer>
            <Animated.View style={[styles.searchContainer, { height: searchBarHeight, opacity: searchBarHeight.interpolate({ inputRange: [0, 60], outputRange: [0, 1] }) }]}>
                <View style={styles.searchBar}>
                    <MaterialIcons name="search" size={20} color={colors.textTertiary} />
                    <TextInput
                        style={styles.searchInput}
                        placeholder="Search notes..."
                        placeholderTextColor={colors.textTertiary}
                        value={searchQuery}
                        onChangeText={handleSearch}
                    />
                    {searchQuery.length > 0 && (
                        <TouchableOpacity onPress={() => handleSearch('')}>
                            <MaterialIcons name="close" size={20} color={colors.textTertiary} />
                        </TouchableOpacity>
                    )}
                </View>
            </Animated.View>

            {loading && notes.length === 0 ? (
                <Loader />
            ) : (
                <ScrollView
                    style={{ flex: 1 }}
                    contentContainerStyle={[styles.scrollContent, { flexGrow: 1 }]}
                    showsVerticalScrollIndicator={false}
                    onScroll={handleScroll}
                    scrollEventThrottle={16}
                >
                    {notes.length === 0 ? (
                        <View style={styles.emptyContainer}>
                            <EmptyState message={isMicPrimary ? "Tap the microphone to record" : "Tap the pencil to write"} />
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
                    <View style={{ height: 120 }} />
                </ScrollView>
            )}

            {/* Floating Dock */}
            <View style={styles.dockContainer}>
                <View style={styles.dock}>
                    {/* Settings Button (Left) */}
                    <TouchableOpacity
                        style={styles.dockButton}
                        onPress={handleSettingsPress}
                        activeOpacity={0.7}
                    >
                        <MaterialIcons name="settings" size={24} color={colors.textSecondary} />
                    </TouchableOpacity>

                    {/* Center Primary Button */}
                    <PrimaryButton />

                    {/* Right Secondary Button */}
                    <SecondaryButton />
                </View>
                <Text style={styles.hintText}>Long press to swap</Text>
            </View>

            <VoiceRecorder
                visible={isVoiceRecorderVisible}
                onFinish={handleVoiceFinish}
                onCancel={() => setIsVoiceRecorderVisible(false)}
                autoStart={true}
            />
        </ScreenContainer>
    );
};

const styles = StyleSheet.create({
    scrollContent: {
        paddingTop: spacing.m,
        paddingBottom: spacing.xxl,
    },
    searchContainer: {
        overflow: 'hidden',
        paddingHorizontal: spacing.m,
        justifyContent: 'center',
        marginTop: spacing.xxl + spacing.l, // Move down to be visible on phones
    },
    searchBar: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderRadius: 12,
        paddingHorizontal: spacing.m,
        height: 56, // Increased for better usability on mobile
    },
    searchInput: {
        flex: 1,
        marginLeft: spacing.s,
        color: colors.text,
        fontSize: 16,
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
        marginTop: spacing.xl,
    },
    dockContainer: {
        position: 'absolute',
        bottom: spacing.xl + spacing.m, // Moved up significantly
        left: 0,
        right: 0,
        alignItems: 'center',
        justifyContent: 'center',
    },
    dock: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: colors.surface,
        borderRadius: 32,
        paddingVertical: spacing.s,
        paddingHorizontal: spacing.xl,
        width: Math.min(width * 0.85, 360),
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.15,
        shadowRadius: 20,
        elevation: 10,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
    },
    dockButton: {
        width: 48,
        height: 48,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 24,
    },
    centerButton: {
        width: 88,
        height: 88,
        marginTop: -20, // Pull it up slightly; dock sits lower now
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: colors.background, // Gap filler
        borderRadius: 44,
        padding: 6,
    },
    centerButtonInner: {
        width: '100%',
        height: '100%',
        borderRadius: 38,
        backgroundColor: colors.primary,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: colors.primary,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.4,
        shadowRadius: 12,
        elevation: 8,
    },
    hintText: {
        ...typography.caption,
        color: colors.textMuted,
        marginTop: spacing.xs,
        opacity: 0.6,
        fontSize: 10,
    },
});
