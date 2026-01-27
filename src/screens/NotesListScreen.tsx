import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions, Vibration, Animated, TextInput, RefreshControl, Alert } from 'react-native';
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
import { useAuth } from '../hooks/useAuth';
import { useNavigation, useIsFocused, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AudioRecording } from '../services/AudioService';
import { MaterialIcons } from '@expo/vector-icons';

const { width } = Dimensions.get('window');
const DOCK_PREF_KEY = 'vaulto_dock_preference';

export const NotesListScreen = () => {
    const navigation = useNavigation<NativeStackNavigationProp<any>>();
    const isFocused = useIsFocused();
    const { notes, loading, fetchNotes, searchNotes, syncNotes } = useNotesContext();
    const [isVoiceRecorderVisible, setIsVoiceRecorderVisible] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    // true = Mic is Center (Primary), Note is Right (Secondary)
    // false = Note is Center (Primary), Mic is Right (Secondary)
    const [isMicPrimary, setIsMicPrimary] = useState(true);

    // Search Bar Animation
    const searchBarHeight = useRef(new Animated.Value(0)).current;
    const lastScrollY = useRef(0);
    const isSearchVisible = useRef(false);
    const scrollAccumulator = useRef(0);
    const lastToggleTime = useRef(0); // Cooldown to prevent rapid toggling

    useFocusEffect(
        useCallback(() => {
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

    const { isGuest } = useAuth(); // Import useAuth hook

    const handleMicPress = () => {
        if (isGuest) {
            Alert.alert(
                'AI Features Locked',
                'Sign in to record and transcribe voice notes.',
                [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Sign In', onPress: () => navigation.navigate('Settings') } // Navigate to Settings or SignIn
                ]
            );
            return;
        }
        setIsVoiceRecorderVisible(true);
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

    const onRefresh = useCallback(async () => {
        await syncNotes();
    }, [syncNotes]);


    const { height: screenHeight } = Dimensions.get('window');

    // Reset search bar on mount
    useEffect(() => {
        searchBarHeight.setValue(0);
        isSearchVisible.current = false;
    }, []);

    const handleScroll = (event: any) => {
        const currentScrollY = event.nativeEvent.contentOffset.y;
        const diff = currentScrollY - lastScrollY.current;
        const now = Date.now();

        // Update lastScrollY early
        lastScrollY.current = currentScrollY;

        // Don't show search bar if there are 5 or fewer notes
        const minNotesForSearch = 6;
        if (notes.length < minNotesForSearch) {
            return;
        }

        // Dead zone - ignore very small movements (micro-jitter)
        const deadZone = 1;
        if (Math.abs(diff) < deadZone) {
            return;
        }

        // Cooldown period after toggle (300ms)
        const cooldownMs = 300;
        if (now - lastToggleTime.current < cooldownMs) {
            return;
        }

        // Hysteresis threshold
        const toggleThreshold = 12;

        // If direction changes, decay the accumulator instead of flipping instantly
        const currentDirection = diff > 0 ? 1 : -1;
        const accumulatorDirection = scrollAccumulator.current > 0 ? 1 : scrollAccumulator.current < 0 ? -1 : 0;

        if (accumulatorDirection !== 0 && currentDirection !== accumulatorDirection) {
            // Direction changed - decay accumulator by half
            scrollAccumulator.current *= 0.5;
        }

        // Accumulate scroll delta
        scrollAccumulator.current += diff;

        // Clamp accumulator
        scrollAccumulator.current = Math.max(-100, Math.min(100, scrollAccumulator.current));

        // Show search bar when accumulated downward scroll (negative) exceeds threshold
        if (scrollAccumulator.current < -toggleThreshold && !isSearchVisible.current) {
            Animated.timing(searchBarHeight, {
                toValue: 60,
                duration: 180,
                useNativeDriver: false,
            }).start();
            isSearchVisible.current = true;
            scrollAccumulator.current = 0;
            lastToggleTime.current = now;
        }
        // Hide search bar when accumulated upward scroll (positive) exceeds threshold
        else if (scrollAccumulator.current > toggleThreshold && isSearchVisible.current && searchQuery === '') {
            Animated.timing(searchBarHeight, {
                toValue: 0,
                duration: 100,
                useNativeDriver: false,
            }).start();
            isSearchVisible.current = false;
            scrollAccumulator.current = 0;
            lastToggleTime.current = now;
        }
    };

    // Split notes into two columns for masonry layout
    const leftColumnNotes = notes.filter((_, index) => index % 2 === 0);
    const rightColumnNotes = notes.filter((_, index) => index % 2 !== 0);

    const PrimaryButton = () => {
        if (isMicPrimary) {
            return (
                <TouchableOpacity
                    style={styles.centerButton}
                    onPress={handleMicPress}
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
                    onPress={handleMicPress}
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
            <View style={styles.topBar}>
                {/* <Text style={styles.topTitle}>Notes</Text> */}
                <View style={styles.topActions}>
                    {/* <TouchableOpacity
                        style={[styles.syncButton, loading && styles.syncButtonDisabled]}
                        onPress={handleSyncPress}
                        disabled={loading}
                    >
                        {loading ? (
                            <ActivityIndicator size="small" color={colors.primary} />
                        ) : (
                            <MaterialIcons name="sync" size={20} color={colors.primary} />
                        )}
                        <Text style={styles.syncButtonText}>Sync</Text>
                    </TouchableOpacity> */}
                </View>
            </View>
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
                    contentContainerStyle={[
                        styles.scrollContent,
                        { flexGrow: 1, minHeight: screenHeight + 20 } // Ensure scrollable even with few notes
                    ]}
                    showsVerticalScrollIndicator={false}
                    onScroll={handleScroll}
                    scrollEventThrottle={4}
                    refreshControl={
                        <RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor={colors.primary} />
                    }
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
                    <View style={styles.dockButtonRow}>
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
    topBar: {
        paddingTop: spacing.s, // Slight padding to push search bar down a bit
        paddingHorizontal: spacing.m,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    topTitle: {
        ...typography.h2,
        color: colors.text,
        fontSize: 28,
        fontWeight: '700',
    },
    topActions: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    syncButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.m,
        paddingVertical: spacing.xs,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: colors.primary,
        backgroundColor: colors.surface,
    },
    syncButtonDisabled: {
        opacity: 0.6,
    },
    syncButtonText: {
        ...typography.button,
        color: colors.primary,
        marginLeft: spacing.xs,
    },
    scrollContent: {
        paddingTop: spacing.m,
        paddingBottom: spacing.xxl,
    },
    searchContainer: {
        overflow: 'hidden',
        paddingHorizontal: spacing.m,
        justifyContent: 'center',
        marginTop: 0, // No margin, highest possible position
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
        bottom: spacing.xxl + spacing.l, // Moved up significantly
        left: 0,
        right: 0,
        alignItems: 'center',
        justifyContent: 'center',
    },
    dock: {
        flexDirection: 'column',
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderRadius: 32,
        paddingTop: 8, // Push contents down for vertical centering
        paddingBottom: 4,
        paddingHorizontal: spacing.xl,
        width: Math.min(width * 0.85, 360),
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.15,
        shadowRadius: 20,
        elevation: 10,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
        height: 70, // Fixed height
    },
    dockButtonRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
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
        marginTop: -35, // Lowered blue icon
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
        color: colors.text,
        marginTop: -8, // Pull text up more to avoid bottom overflow
        marginBottom: 2,
        opacity: 0.75,
        fontSize: 9, // Reduced size
    },
});
