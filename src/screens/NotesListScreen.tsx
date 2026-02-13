import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions, Vibration, Animated, TextInput, RefreshControl, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ScreenContainer } from '../components/ScreenContainer';
import { NoteCard } from '../components/NoteCard';
import { Loader } from '../components/Loader';
import { EmptyState } from '../components/EmptyState';
import { VoiceRecorder } from '../components/VoiceRecorder';
import { SelectionActionPanel } from '../components/SelectionActionPanel';
import { DeleteConfirmationDialog } from '../components/DeleteConfirmationDialog';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { useNotesContext } from '../contexts/NotesContext';
import { useAuth } from '../hooks/useAuth';
import { useEncryption } from '../context/EncryptionContext';
import { useNavigation, useIsFocused, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AudioRecording } from '../services/AudioService';
import { MaterialIcons } from '@expo/vector-icons';
import { UnlockSyncModal } from '../components/UnlockSyncModal';
import { UnlockingOverlay } from '../components/UnlockingOverlay';
import { notesApi } from '../api/notes';

const { width } = Dimensions.get('window');
const DOCK_PREF_KEY = 'vaulto_dock_preference';
const LOCK_BANNER_DISMISS_PREFIX = 'vaulto_sync_lock_banner_dismissed_v1';

export const NotesListScreen = () => {
    const navigation = useNavigation<NativeStackNavigationProp<any>>();
    const isFocused = useIsFocused();
    const { userId, isAuthenticated, isGuest } = useAuth();
    const { syncLocked, custodyMode } = useEncryption();
    const {
        notes,
        loading,
        fetchNotes,
        searchNotes,
        syncNotes,
        batchPinNotes,
        batchUnpinNotes,
        batchDeleteNotes,
    } = useNotesContext();
    const [isVoiceRecorderVisible, setIsVoiceRecorderVisible] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [showUnlockSyncModal, setShowUnlockSyncModal] = useState(false);
    const [showUnlockingOverlay, setShowUnlockingOverlay] = useState(false);
    const [unlockErrorMessage, setUnlockErrorMessage] = useState<string | null>(null);
    const [lockBannerDismissed, setLockBannerDismissed] = useState(false);
    const [hasServerNotes, setHasServerNotes] = useState(false);

    // Selection mode state
    const [isSelectionMode, setIsSelectionMode] = useState(false);
    const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

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
        if (isSelectionMode) {
            // Toggle selection
            const newSelected = new Set(selectedNoteIds);
            if (newSelected.has(note.id)) {
                newSelected.delete(note.id);
            } else {
                newSelected.add(note.id);
            }
            setSelectedNoteIds(newSelected);

            // Exit selection mode if no notes selected
            if (newSelected.size === 0) {
                setIsSelectionMode(false);
            }
        } else {
            // Normal behavior - navigate to note
            navigation.navigate('NoteEdit', { noteId: note.id });
        }
    };

    const handleNoteLongPress = (note: any) => {
        if (!isSelectionMode) {
            // Enter selection mode and select this note
            setIsSelectionMode(true);
            setSelectedNoteIds(new Set([note.id]));
            Vibration.vibrate(50);
        }
    };

    const handleSettingsPress = () => {
        navigation.navigate('Settings');
    };

    const secretModeLabel = custodyMode === 'strict_seed' ? 'recovery passphrase' : 'passphrase';

    const shouldShowLockBanner =
        !isSelectionMode &&
        isAuthenticated &&
        !isGuest &&
        syncLocked &&
        hasServerNotes &&
        !lockBannerDismissed;

    useEffect(() => {
        let cancelled = false;

        const checkServerNotesPresence = async () => {
            if (!isAuthenticated || isGuest || !syncLocked) {
                if (!cancelled) {
                    setHasServerNotes(false);
                }
                return;
            }

            try {
                const response = await notesApi.sync({
                    changes: [],
                    improvement_changes: [],
                    since_updated_at: '1970-01-01T00:00:00+00:00',
                });
                const hasRemoteData =
                    (response.server_changes?.length ?? 0) > 0 ||
                    (response.improvement_changes?.length ?? 0) > 0 ||
                    (response.updated?.length ?? 0) > 0 ||
                    (response.improvement_updates?.length ?? 0) > 0 ||
                    (response.conflicts?.length ?? 0) > 0 ||
                    (response.improvement_conflicts?.length ?? 0) > 0;

                if (!cancelled) {
                    setHasServerNotes(hasRemoteData);
                }
            } catch (error) {
                console.warn('[NotesList] Failed to check remote notes presence for lock banner', error);
                if (!cancelled) {
                    setHasServerNotes(false);
                }
            }
        };

        void checkServerNotesPresence();
        return () => {
            cancelled = true;
        };
    }, [isAuthenticated, isGuest, syncLocked, userId]);

    useEffect(() => {
        let mounted = true;
        const key = userId ? `${LOCK_BANNER_DISMISS_PREFIX}_${userId}` : null;

        const hydrateDismissState = async () => {
            if (!key) {
                if (mounted) setLockBannerDismissed(false);
                return;
            }
            if (!isAuthenticated || isGuest || !syncLocked || !hasServerNotes) {
                await AsyncStorage.removeItem(key);
                if (mounted) setLockBannerDismissed(false);
                return;
            }
            const stored = await AsyncStorage.getItem(key);
            if (mounted) {
                setLockBannerDismissed(stored === '1');
            }
        };

        void hydrateDismissState();
        return () => {
            mounted = false;
        };
    }, [userId, isAuthenticated, isGuest, syncLocked, hasServerNotes]);

    const dismissLockBanner = useCallback(() => {
        setLockBannerDismissed(true);
        if (!userId) return;
        void AsyncStorage.setItem(`${LOCK_BANNER_DISMISS_PREFIX}_${userId}`, '1');
    }, [userId]);

    const handleMicPress = () => {
        setIsVoiceRecorderVisible(true);
    };

    const handleCreateNote = () => {
        navigation.navigate('NoteEdit');
    };

    const handleVoiceFinish = (recording: AudioRecording, transcribe: boolean) => {
        setIsVoiceRecorderVisible(false);
        navigation.navigate('NoteEdit', { initialRecording: recording, initialTranscribe: transcribe });
    };

    const handleSearch = (text: string) => {
        setSearchQuery(text);
        searchNotes(text);
    };

    const handleExitSelectionMode = () => {
        setIsSelectionMode(false);
        setSelectedNoteIds(new Set());
    };

    const handleBatchPin = async () => {
        const ids = Array.from(selectedNoteIds);
        // Check if all selected notes are already pinned
        const allPinned = filteredNotes
            .filter(n => ids.includes(n.id))
            .every(n => n.is_pinned);

        if (allPinned) {
            await batchUnpinNotes(ids);
        } else {
            await batchPinNotes(ids);
        }
        handleExitSelectionMode();
    };

    const handleBatchDelete = () => {
        setShowDeleteConfirm(true);
    };

    const handleConfirmDelete = async () => {
        const ids = Array.from(selectedNoteIds);
        setShowDeleteConfirm(false);
        await batchDeleteNotes(ids);
        handleExitSelectionMode();
    };

    const handleCancelDelete = () => {
        setShowDeleteConfirm(false);
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

    // Filter out empty notes (no title, content, or audio)
    const filteredNotes = notes.filter(n => {
        const hasTitle = n.title && n.title.trim().length > 0;
        const hasContent = n.content && n.content.trim().length > 0;
        const hasAudio = n.has_audio;
        return hasTitle || hasContent || hasAudio;
    });

    // Split notes into two columns for masonry layout
    // Sort pinned notes first
    const sortedNotes = [...filteredNotes].sort((a, b) => {
        // Pinned notes come first
        if (a.is_pinned && !b.is_pinned) return -1;
        if (!a.is_pinned && b.is_pinned) return 1;
        // Otherwise sort by updated_at
        const dateA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const dateB = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        return dateB - dateA;
    });

    const leftColumnNotes = sortedNotes.filter((_, index) => index % 2 === 0);
    const rightColumnNotes = sortedNotes.filter((_, index) => index % 2 !== 0);

    // Check if all selected notes are pinned
    const selectedNotes = sortedNotes.filter(n => selectedNoteIds.has(n.id));
    const allSelectedPinned = selectedNotes.length > 0 && selectedNotes.every(n => n.is_pinned);

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
            {isSelectionMode ? (
                <SelectionActionPanel
                    selectedCount={selectedNoteIds.size}
                    onPin={handleBatchPin}
                    onUnpin={handleBatchPin}
                    onDelete={handleBatchDelete}
                    onClose={handleExitSelectionMode}
                    allPinned={allSelectedPinned}
                />
            ) : (
                <View style={styles.topBar} />
            )}
            {shouldShowLockBanner && (
                <View style={styles.lockBanner}>
                    <View style={styles.lockBannerHeader}>
                        <View style={styles.lockBannerTitleRow}>
                            <View style={styles.lockBannerIcon}>
                                <MaterialIcons name="lock" size={16} color={colors.primary} />
                            </View>
                            <Text style={styles.lockBannerTitle}>Encrypted Sync Is Locked</Text>
                        </View>
                        <TouchableOpacity
                            onPress={dismissLockBanner}
                            style={styles.lockBannerClose}
                            activeOpacity={0.75}
                            accessibilityRole="button"
                            accessibilityLabel="Hide lock warning"
                        >
                            <MaterialIcons name="close" size={18} color={colors.textSecondary} />
                        </TouchableOpacity>
                    </View>
                    <Text style={styles.lockBannerText}>
                        {`Encrypted sync data detected on server. Unlock using your ${secretModeLabel} to access notes on this device.`}
                    </Text>
                    <View style={styles.lockBannerActions}>
                        <TouchableOpacity
                            style={[styles.lockActionButton, styles.lockActionPrimary]}
                            onPress={() => setShowUnlockSyncModal(true)}
                            activeOpacity={0.85}
                        >
                            <Text style={styles.lockActionPrimaryText}>Unlock Sync</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            )}
            {!isSelectionMode && (
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
            )}

            {loading && filteredNotes.length === 0 ? (
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
                    {filteredNotes.length === 0 ? (
                        <View style={styles.emptyContainer}>
                            <EmptyState message={isMicPrimary ? "Tap the microphone to record" : "Tap the pencil to write"} />
                        </View>
                    ) : (
                        <View style={styles.masonryContainer}>
                            <View style={styles.column}>
                                {leftColumnNotes.map(note => (
                                    <NoteCard
                                        key={note.id}
                                        note={note}
                                        onPress={() => handleNotePress(note)}
                                        onLongPress={() => handleNoteLongPress(note)}
                                        isSelectionMode={isSelectionMode}
                                        isSelected={selectedNoteIds.has(note.id)}
                                    />
                                ))}
                            </View>
                            <View style={styles.column}>
                                {rightColumnNotes.map(note => (
                                    <NoteCard
                                        key={note.id}
                                        note={note}
                                        onPress={() => handleNotePress(note)}
                                        onLongPress={() => handleNoteLongPress(note)}
                                        isSelectionMode={isSelectionMode}
                                        isSelected={selectedNoteIds.has(note.id)}
                                    />
                                ))}
                            </View>
                        </View>
                    )}
                    <View style={{ height: 120 }} />
                </ScrollView>
            )}

            {/* Floating Dock - hide in selection mode */}
            {!isSelectionMode && (
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
            )}

            <VoiceRecorder
                visible={isVoiceRecorderVisible}
                onFinish={(rec, transcribe) => handleVoiceFinish(rec, transcribe)}
                onCancel={() => setIsVoiceRecorderVisible(false)}
                autoStart={true}
            />

            <DeleteConfirmationDialog
                visible={showDeleteConfirm}
                noteCount={selectedNoteIds.size}
                onConfirm={handleConfirmDelete}
                onCancel={handleCancelDelete}
            />
            <UnlockSyncModal
                visible={showUnlockSyncModal}
                errorMessage={unlockErrorMessage}
                onClose={() => {
                    setShowUnlockSyncModal(false);
                    setUnlockErrorMessage(null);
                }}
                onUnlocking={() => {
                    setShowUnlockingOverlay(true);
                    setUnlockErrorMessage(null);
                }}
                onError={(message) => {
                    setShowUnlockingOverlay(false);
                    setUnlockErrorMessage(message);
                    setShowUnlockSyncModal(true);
                }}
                onUnlocked={() => {
                    setShowUnlockSyncModal(false);
                    setShowUnlockingOverlay(false);
                    setUnlockErrorMessage(null);
                    setTimeout(() => {
                        void syncNotes();
                    }, 0);
                }}
            />
            <UnlockingOverlay
                visible={showUnlockingOverlay}
                title="Verifying Passphrase"
                subtitle="Checking your passphrase and decrypting sync. This may take up to a minute on some devices."
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
    lockBanner: {
        marginHorizontal: spacing.m,
        marginBottom: spacing.s,
        padding: spacing.m,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        shadowColor: colors.cardShadow,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
        elevation: 2,
    },
    lockBannerHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: spacing.xs,
    },
    lockBannerTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        flex: 1,
    },
    lockBannerIcon: {
        width: 26,
        height: 26,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.backgroundSecondary,
    },
    lockBannerTitle: {
        ...typography.body,
        color: colors.text,
        fontWeight: '700',
    },
    lockBannerClose: {
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
    },
    lockBannerText: {
        ...typography.caption,
        color: colors.textSecondary,
        lineHeight: 18,
    },
    lockBannerActions: {
        marginTop: spacing.s,
        flexDirection: 'row',
        gap: spacing.s,
    },
    lockActionButton: {
        flex: 1,
        minHeight: 40,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.s,
    },
    lockActionPrimary: {
        backgroundColor: colors.primary,
    },
    lockActionSecondary: {
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.backgroundSecondary,
    },
    lockActionPrimaryText: {
        ...typography.captionBold,
        color: colors.surface,
    },
    lockActionSecondaryText: {
        ...typography.captionBold,
        color: colors.text,
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
