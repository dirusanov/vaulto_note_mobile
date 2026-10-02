import { useTranslation } from 'react-i18next';
import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, useWindowDimensions, Animated, TextInput, RefreshControl, AppState, LayoutAnimation, UIManager, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ScreenContainer } from '../components/ScreenContainer';
import { NoteCard } from '../components/NoteCard';
import { EmptyState } from '../components/EmptyState';
import { VoiceRecorder } from '../components/VoiceRecorder';
import { SelectionActionPanel } from '../components/SelectionActionPanel';
import { UndoSnackbar } from '../components/UndoSnackbar';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { useNotesContext } from '../contexts/NotesContext';
import { useAuth } from '../hooks/useAuth';
import { useEncryption } from '../context/EncryptionContext';
import { useNavigation, useIsFocused, useFocusEffect, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AudioRecording } from '../services/AudioService';
import { MaterialIcons } from '@expo/vector-icons';
import { UnlockSyncModal } from '../components/UnlockSyncModal';
import { ResetEncryptionModal } from '../components/ResetEncryptionModal';
import { UnlockingOverlay } from '../components/UnlockingOverlay';
import { hasMeaningfulRichContent, richContentToPlainText } from '../utils/richContent';
import { countTags, hasTag } from '../utils/tags';
import { createStyles } from '../theme/createStyles';
import { haptics } from '../utils/haptics';
import { rtlFlip } from '../i18n/direction';
import { useNetInfo } from '@react-native-community/netinfo';

const DOCK_PREF_KEY = 'vaulto_dock_preference';

const SEARCH_BAR_HEIGHT = 60;

export const NotesListScreen = () => {
    const { t } = useTranslation();
    const navigation = useNavigation<NativeStackNavigationProp<any>>();
    const isFocused = useIsFocused();
    const { userId, isAuthenticated, isGuest, user } = useAuth();
    // Account avatar in the search bar (as in Keep/Gmail): the initial of the name
    // or e-mail when signed in, a person icon for guests.
    const signedIn = isAuthenticated && !isGuest;
    // Live window size: tablets rotate (Android 16 ignores the portrait lock
    // on large screens), so nothing may be measured once at import time.
    const { width: windowWidth, height: screenHeight } = useWindowDimensions();
    const columnCount = windowWidth >= 1100 ? 4 : windowWidth >= 700 ? 3 : 2;
    const netInfo = useNetInfo();
    // `null` means not known yet; only a definite "no" shows the offline note.
    const isOffline = netInfo.isConnected === false;
    const avatarInitial = signedIn
        ? ((user?.full_name || user?.email || '').trim().charAt(0).toUpperCase() || null)
        : null;
    const { syncLocked, resetRecoveryPending } = useEncryption();
    const {
        notes,
        loading,
        fetchNotes,
        searchNotes,
        syncNotes,
        batchPinNotes,
        batchUnpinNotes,
        batchDeleteNotes,
        lockedCount,
        getAllNotes,
    } = useNotesContext();
    const [activeTag, setActiveTag] = useState<string | null>(null);
    const [isVoiceRecorderVisible, setIsVoiceRecorderVisible] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [showUnlockSyncModal, setShowUnlockSyncModal] = useState(false);
    const [showResetSyncModal, setShowResetSyncModal] = useState(false);
    const [showUnlockingOverlay, setShowUnlockingOverlay] = useState(false);
    const [unlockProgress, setUnlockProgress] = useState<number | null>(null);
    const [unlockErrorMessage, setUnlockErrorMessage] = useState<string | null>(null);
    const [lockBannerDismissed, setLockBannerDismissed] = useState(false);
    const [dockInstanceKey, setDockInstanceKey] = useState(0);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const lastFetchAtRef = useRef(0);
    const initialFetchDoneRef = useRef(false);
    const initialOrderRef = useRef<string[] | null>(null);
    const prevListKeyRef = useRef<string | null>(null);
    const sortFreezeUntilRef = useRef<number | null>(null);

    // Selection mode state
    const [isSelectionMode, setIsSelectionMode] = useState(false);
    const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
    // Deleted from the list at once, committed after the Undo window closes.
    const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(null);
    const pendingDeleteRef = useRef<string[] | null>(null);
    const pendingDeleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // true = Mic is Center (Primary), Note is Right (Secondary)
    // false = Note is Center (Primary), Mic is Right (Secondary)
    const [isMicPrimary, setIsMicPrimary] = useState(true);

    // Search Bar Animation
    // The search bar (with settings) is shown at the top and slides away while
    // scrolling down through the list, back on scrolling up.
    const searchBarHeight = useRef(new Animated.Value(SEARCH_BAR_HEIGHT)).current;
    const lastScrollY = useRef(0);
    const isSearchVisible = useRef(true);
    const scrollAccumulator = useRef(0);
    const lastToggleTime = useRef(0); // Cooldown to prevent rapid toggling

    useFocusEffect(
        useCallback(() => {
            if (!userId) return;
            const now = Date.now();
            const shouldFetch = !initialFetchDoneRef.current || now - lastFetchAtRef.current > 30000;
            if (!shouldFetch) return;
            initialFetchDoneRef.current = true;
            lastFetchAtRef.current = now;
            fetchNotes();
        }, [fetchNotes, userId])
    );

    useEffect(() => {
        initialFetchDoneRef.current = false;
        lastFetchAtRef.current = 0;
        initialOrderRef.current = null;
        sortFreezeUntilRef.current = null;
    }, [userId]);

    // Ensure modals/overlays do not block input after app background/restore
    useEffect(() => {
        const subscription = AppState.addEventListener('change', (nextState) => {
            if (nextState === 'background' || nextState === 'inactive') {
                setShowUnlockSyncModal(false);
                setShowUnlockingOverlay(false);
                setUnlockProgress(null);
                commitPendingDeleteRef.current();
                setIsSelectionMode(false);
                setSelectedNoteIds(new Set());
                return;
            }
            if (nextState === 'active') {
                // Reset dock touchables to avoid stuck pressability after resume.
                setDockInstanceKey((prev) => prev + 1);
            }
        });
        return () => {
            subscription.remove();
        };
    }, []);

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
        haptics.medium();
        try {
            await AsyncStorage.setItem(DOCK_PREF_KEY, String(newValue));
        } catch (e) {
            console.error('Failed to save dock preference', e);
        }
    };

    const handleNotePress = (note: any) => {
        if (isSelectionMode) {
            // Toggle selection
            haptics.selection();
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
            haptics.medium();
        }
    };

    const handleSettingsPress = () => {
        navigation.navigate('Settings');
    };

    const shouldShowLockBanner =
        !isSelectionMode &&
        isAuthenticated &&
        !isGuest &&
        syncLocked &&
        !lockBannerDismissed;
    const shouldShowResetRecoveryBanner =
        !isSelectionMode
        && isAuthenticated
        && !isGuest
        && resetRecoveryPending;

    useEffect(() => {
        if (Platform.OS === 'android') {
            UIManager.setLayoutAnimationEnabledExperimental?.(true);
        }
    }, []);

    useEffect(() => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    }, [shouldShowLockBanner, shouldShowResetRecoveryBanner]);

    useEffect(() => {
        // A dismissal belongs only to the current lock session. A later remote
        // enable/key rotation must surface the unlock action again.
        setLockBannerDismissed(false);
    }, [syncLocked, userId]);

    const dismissLockBanner = useCallback(() => {
        setLockBannerDismissed(true);
    }, []);

    const handleMicPress = () => {
        setIsVoiceRecorderVisible(true);
    };

    // Widget / Quick Settings tile: vaultonote://record lands here with a stamp.
    const route = useRoute<any>();
    const startRecordingAt: number | undefined = route.params?.startRecordingAt;
    useEffect(() => {
        if (!startRecordingAt) return;
        setIsVoiceRecorderVisible(true);
        // Consumed: a remount (theme change restores navigation state) must not
        // start the microphone again.
        navigation.setParams({ startRecordingAt: undefined });
    }, [navigation, startRecordingAt]);

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

    const commitPendingDelete = () => {
        if (pendingDeleteTimerRef.current) {
            clearTimeout(pendingDeleteTimerRef.current);
            pendingDeleteTimerRef.current = null;
        }
        const ids = pendingDeleteRef.current;
        if (!ids) return;
        pendingDeleteRef.current = null;
        setPendingDeleteIds(null);
        batchDeleteNotes(ids).catch((error) => console.error('[NotesList] Delete failed', error));
    };
    const commitPendingDeleteRef = useRef(commitPendingDelete);
    commitPendingDeleteRef.current = commitPendingDelete;

    // Like Gmail and Keep: no confirmation, the notes leave the list at once
    // and an Undo bar stays for a few seconds before anything is erased.
    const handleBatchDelete = () => {
        commitPendingDelete();
        const ids = Array.from(selectedNoteIds);
        if (ids.length === 0) return;
        haptics.warning();
        pendingDeleteRef.current = ids;
        setPendingDeleteIds(ids);
        pendingDeleteTimerRef.current = setTimeout(() => commitPendingDeleteRef.current(), 5000);
        handleExitSelectionMode();
    };

    const handleUndoDelete = () => {
        if (pendingDeleteTimerRef.current) {
            clearTimeout(pendingDeleteTimerRef.current);
            pendingDeleteTimerRef.current = null;
        }
        pendingDeleteRef.current = null;
        setPendingDeleteIds(null);
        haptics.light();
    };

    // Leaving the screen commits a pending delete instead of dropping it.
    useEffect(() => () => commitPendingDeleteRef.current(), []);

    const onRefresh = useCallback(async () => {
        if (isRefreshing) return;
        setIsRefreshing(true);
        try {
            await syncNotes();
        } finally {
            setIsRefreshing(false);
        }
    }, [isRefreshing, syncNotes]);



    // Reset search bar on mount
    useEffect(() => {
        searchBarHeight.setValue(SEARCH_BAR_HEIGHT);
        isSearchVisible.current = true;
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
                toValue: SEARCH_BAR_HEIGHT,
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
        if (pendingDeleteIds?.includes(n.id)) return false;
        const activeChild = n.improvements?.find(imp => imp.is_active);
        const displayTitle = (activeChild?.title || activeChild?.label || n.title || '').trim();
        const displayContent = activeChild?.content || n.content || '';
        const hasTitle = displayTitle.length > 0;
        const hasContent = hasMeaningfulRichContent(displayContent);
        const hasAudio = n.has_audio;
        return hasTitle || hasContent || hasAudio;
    });

    // Tags come from #hashtags in the notes (all notes, not just the search hits).
    const notePlainText = (n: typeof notes[number]) => {
        const activeChild = n.improvements?.find(imp => imp.is_active);
        return `${n.title || ''}\n${richContentToPlainText(activeChild?.content || n.content || '')}`;
    };
    const allTags = useMemo(
        () => countTags(getAllNotes().filter(n => !n.deleted).map(notePlainText)),
        // Recomputed whenever the visible notes change (edits, sync, deletes).
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [notes],
    );
    useEffect(() => {
        if (activeTag && !allTags.some(item => item.tag === activeTag)) setActiveTag(null);
    }, [activeTag, allTags]);
    const tagFilteredNotes = activeTag ? filteredNotes.filter(n => hasTag(notePlainText(n), activeTag)) : filteredNotes;

    const canShowEmptyState = !!userId && !loading && filteredNotes.length === 0;

    // Split notes into two columns for masonry layout
    // Sort pinned notes first
    const sortedNotes = [...tagFilteredNotes].sort((a, b) => {
        // Pinned notes come first
        if (a.is_pinned && !b.is_pinned) return -1;
        if (!a.is_pinned && b.is_pinned) return 1;
        // Otherwise sort by updated_at
        const dateA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const dateB = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        return dateB - dateA;
    });


    let orderedNotes = sortedNotes;
    const nowMs = Date.now();
    if (sortedNotes.length > 0 && initialOrderRef.current === null) {
        initialOrderRef.current = sortedNotes.map(note => note.id);
        sortFreezeUntilRef.current = nowMs + 2500;
    }
    if (initialOrderRef.current && sortFreezeUntilRef.current && nowMs < sortFreezeUntilRef.current) {
        const byId = new Map(sortedNotes.map(note => [note.id, note]));
        const frozen: typeof sortedNotes = [];
        initialOrderRef.current.forEach((id) => {
            const note = byId.get(id);
            if (note) frozen.push(note);
        });
        const frozenIds = new Set(frozen.map(note => note.id));
        const newcomers = sortedNotes.filter(note => !frozenIds.has(note.id));
        orderedNotes = newcomers.length > 0 ? [...newcomers, ...frozen] : frozen;
    } else if (sortedNotes.length > 0) {
        initialOrderRef.current = sortedNotes.map(note => note.id);
        sortFreezeUntilRef.current = null;
    }

    // Cards slide into place when notes are added, removed or filtered by the
    // search, instead of jumping. Configured before the commit it animates.
    const listKey = orderedNotes.map(note => note.id).join('|');
    if (prevListKeyRef.current !== null && prevListKeyRef.current !== listKey) {
        LayoutAnimation.configureNext(LayoutAnimation.create(220, 'easeInEaseOut', 'opacity'));
    }
    prevListKeyRef.current = listKey;

    // Masonry columns: two on phones, three or four on tablets.
    const noteColumns: (typeof sortedNotes)[] = Array.from({ length: columnCount }, () => []);
    orderedNotes.forEach((note, index) => {
        noteColumns[index % columnCount].push(note);
    });

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
                    accessibilityRole="button"
                    accessibilityLabel={t("a11y.recordVoice", "Record voice note")}
                    accessibilityHint={t("common.holdToSwitch")}
                    delayLongPress={500}
                    activeOpacity={0.8}
                >
                    <View style={styles.centerButtonInner}>
                        <MaterialIcons name="mic" size={40} color={colors.onPrimary} />
                    </View>
                </TouchableOpacity>
            );
        } else {
            return (
                <TouchableOpacity
                    style={styles.centerButton}
                    onPress={handleCreateNote}
                    onLongPress={toggleDockLayout}
                    accessibilityRole="button"
                    accessibilityLabel={t("a11y.newNote", "New note")}
                    accessibilityHint={t("common.holdToSwitch")}
                    delayLongPress={500}
                    activeOpacity={0.8}
                >
                    <View style={styles.centerButtonInner}>
                        <MaterialIcons name="edit" size={40} color={colors.onPrimary} />
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
                    accessibilityRole="button"
                    accessibilityLabel={t("a11y.newNote", "New note")}
                    accessibilityHint={t("common.holdToSwitch")}
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
                    accessibilityRole="button"
                    accessibilityLabel={t("a11y.recordVoice", "Record voice note")}
                    accessibilityHint={t("common.holdToSwitch")}
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
            {/* Banners and search keep a readable width on tablets. */}
            <View style={styles.headerColumn}>
            {/* Offline: say that nothing is lost, sync just waits for the network. */}
            {isOffline && !isSelectionMode && (
                <View style={styles.offlinePill} accessibilityLiveRegion="polite">
                    <MaterialIcons name="cloud-off" size={16} color={colors.textSecondary} />
                    <Text style={styles.offlineText} numberOfLines={2}>
                        {signedIn
                            ? t('notes.offlineSync', 'Offline. Changes are saved and will sync later.')
                            : t('notes.offline', 'Offline. Notes and on-device features still work.')}
                    </Text>
                </View>
            )}
            {/* Signed out but notes were kept: they are on the phone, just not readable yet. */}
            {!signedIn && lockedCount > 0 && !isSelectionMode && (
                <View style={styles.lockBanner}>
                    <View style={styles.lockBannerHeader}>
                        <View style={styles.lockBannerIcon}>
                            <MaterialIcons name="lock" size={20} color={colors.primary} />
                        </View>
                        <View style={styles.lockBannerTextWrap}>
                            <Text style={styles.lockBannerTitle}>
                                {t('notes.keptLockedTitle', 'Account notes kept on this phone: {{count}}', { count: lockedCount })}
                            </Text>
                            <Text style={styles.lockBannerText}>
                                {t('notes.keptLockedText', 'They are encrypted. Sign in to your account to open them.')}
                            </Text>
                        </View>
                    </View>
                    <View style={styles.lockActionsRow}>
                        <TouchableOpacity
                            style={styles.lockActionPrimary}
                            onPress={() => navigation.navigate('SignIn')}
                            activeOpacity={0.85}
                        >
                            <MaterialIcons name="login" size={16} color={colors.onPrimary} style={rtlFlip} />
                            <Text style={styles.lockActionPrimaryText}>{t('auth.signIn', 'Sign In')}</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            )}
            {shouldShowResetRecoveryBanner && (
                <View style={styles.lockBanner}>
                    <View style={styles.lockBannerHeader}>
                        <View style={styles.lockBannerIcon}>
                            <MaterialIcons name="security" size={20} color={colors.warning} />
                        </View>
                        <View style={styles.lockBannerTextWrap}>
                            <Text style={styles.lockBannerTitle}>
                                {t('notes.resetRecoveryTitle', 'Encrypted vault was reset')}
                            </Text>
                            <Text style={styles.lockBannerText}>
                                {t('notes.resetRecoveryDescription', 'Your retained notes are local-only and sync is paused. Choose how to recover them in Settings.')}
                            </Text>
                        </View>
                    </View>
                    <View style={styles.lockActionsRow}>
                        <TouchableOpacity
                            style={styles.lockActionPrimary}
                            onPress={handleSettingsPress}
                            activeOpacity={0.85}
                        >
                            <MaterialIcons name="settings" size={16} color={colors.onPrimary} />
                            <Text style={styles.lockActionPrimaryText}>
                                {t('notes.reviewRecovery', 'Review options')}
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>
            )}
            {shouldShowLockBanner && (
                <View style={styles.lockBanner}>
                    <TouchableOpacity
                        onPress={dismissLockBanner}
                        style={styles.lockBannerClose}
                        activeOpacity={0.75}
                    >
                        <MaterialIcons name="close" size={18} color={colors.textTertiary} />
                    </TouchableOpacity>
                    <View style={styles.lockBannerHeader}>
                        <View style={styles.lockBannerIcon}>
                            <MaterialIcons name="lock-open" size={20} color={colors.primary} />
                        </View>
                        <View style={styles.lockBannerTextWrap}>
                            <Text style={styles.lockBannerTitle}>
                                {t("notes.syncLocked")}
                            </Text>
                            <Text style={styles.lockBannerText}>
                                {t("notes.unlockToRestore")}
                            </Text>
                        </View>
                    </View>
                    <View style={styles.lockActionsRow}>
                        <TouchableOpacity
                            style={styles.lockActionPrimary}
                            onPress={() => setShowUnlockSyncModal(true)}
                            activeOpacity={0.85}
                        >
                            <MaterialIcons name="vpn-key" size={16} color={colors.onPrimary} />
                            <Text style={styles.lockActionPrimaryText}>{t("settings.ui.unlock")}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.lockActionSecondary}
                            onPress={() => setShowResetSyncModal(true)}
                            activeOpacity={0.7}
                        >
                            <Text style={styles.lockActionSecondaryText}>
                                {t("settings.ui.resetAccess")}
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>
            )}
            {!isSelectionMode && (
                <Animated.View style={[styles.searchContainer, { height: searchBarHeight, opacity: searchBarHeight.interpolate({ inputRange: [0, SEARCH_BAR_HEIGHT], outputRange: [0, 1] }) }]}>
                    <View style={styles.searchBar}>
                        <MaterialIcons name="search" size={20} color={colors.textTertiary} />
                        <TextInput
                            style={styles.searchInput}
                            placeholder={t("common.search")}
                            placeholderTextColor={colors.textTertiary}
                            value={searchQuery}
                            onChangeText={handleSearch}
                        />
                        {searchQuery.length > 0 && (
                            <TouchableOpacity
                                onPress={() => handleSearch('')}
                                style={styles.searchBarButton}
                                accessibilityRole="button"
                                accessibilityLabel={t("a11y.close", "Close")}
                            >
                                <MaterialIcons name="close" size={20} color={colors.textTertiary} />
                            </TouchableOpacity>
                        )}
                        <TouchableOpacity
                            onPress={handleSettingsPress}
                            style={styles.searchBarButton}
                            accessibilityRole="button"
                            accessibilityLabel={t("a11y.accountSettings", "Account and settings")}
                        >
                            <View style={[styles.avatar, !avatarInitial && styles.avatarGuest]}>
                                {avatarInitial ? (
                                    <Text style={styles.avatarText}>{avatarInitial}</Text>
                                ) : (
                                    <MaterialIcons name="person" size={20} color={colors.textSecondary} />
                                )}
                            </View>
                        </TouchableOpacity>
                    </View>
                </Animated.View>
            )}
            {/* Tag filter: one tap narrows the list to a #tag, like Keep's labels. */}
            {!isSelectionMode && allTags.length > 0 && (
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.tagRow}
                    keyboardShouldPersistTaps="handled"
                >
                    {allTags.slice(0, 30).map(({ tag, count }) => {
                        const selected = activeTag === tag;
                        return (
                            <TouchableOpacity
                                key={tag}
                                style={[styles.tagChip, selected && styles.tagChipActive]}
                                onPress={() => {
                                    haptics.selection();
                                    setActiveTag(selected ? null : tag);
                                }}
                                accessibilityRole="button"
                                accessibilityState={{ selected }}
                            >
                                <Text style={[styles.tagChipText, selected && styles.tagChipTextActive]}>
                                    #{tag}
                                </Text>
                                <Text style={[styles.tagChipCount, selected && styles.tagChipTextActive]}>{count}</Text>
                                {selected && <MaterialIcons name="close" size={14} color={colors.onPrimary} />}
                            </TouchableOpacity>
                        );
                    })}
                </ScrollView>
            )}

            </View>

            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={[
                    styles.scrollContent,
                    { flexGrow: 1, minHeight: screenHeight + 20 } // Ensure scrollable even with few notes
                ]}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                onScroll={handleScroll}
                scrollEventThrottle={4}
                refreshControl={
                    <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={colors.primary} />
                }
            >
                {searchQuery.trim().length > 0 && !isSelectionMode && (
                    <TouchableOpacity
                        style={styles.askRow}
                        onPress={() => navigation.navigate('AskNotes', { question: searchQuery.trim() })}
                        accessibilityRole="button"
                    >
                        <MaterialIcons name="auto-awesome" size={18} color={colors.primary} />
                        <Text style={styles.askRowText} numberOfLines={1}>
                            {t("ask.askAbout", "Ask AI: “{{query}}”", { query: searchQuery.trim() })}
                        </Text>
                        <MaterialIcons name="chevron-right" size={20} color={colors.textTertiary} style={rtlFlip} />
                    </TouchableOpacity>
                )}
                {canShowEmptyState ? (
                    <View style={styles.emptyContainer}>
                        <EmptyState
                            // The intro is for a first launch, not for someone whose notes are kept locked.
                            variant={searchQuery.trim() ? 'search' : (lockedCount > 0 ? 'plain' : 'welcome')}
                            message={searchQuery.trim()
                                ? t("notes.noSearchResults", "No notes match your search")
                                : isMicPrimary ? t("notes.tapMicToRecord") : t("notes.tapPencilToWrite")}
                        />
                    </View>
                ) : (
                    <View style={styles.masonryContainer}>
                        {noteColumns.map((columnNotes, columnIndex) => (
                            <View key={columnIndex} style={styles.column}>
                                {columnNotes.map(note => (
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
                        ))}
                    </View>
                )}
                <View style={{ height: 120 }} pointerEvents="none" />
            </ScrollView>

            {/* Floating Dock - hide in selection mode */}
            {!isSelectionMode && (
                <View style={styles.dockContainer} key={dockInstanceKey} pointerEvents="box-none">
                    <View style={styles.dock}>
                        <View style={styles.dockButtonRow}>
                            <TouchableOpacity
                                style={styles.dockButton}
                                onPress={() => navigation.navigate('AskNotes')}
                                activeOpacity={0.7}
                                accessibilityRole="button"
                                accessibilityLabel={t("ask.title", "Ask your notes")}
                            >
                                <MaterialIcons name="auto-awesome" size={24} color={colors.primary} />
                            </TouchableOpacity>

                            {/* Center Primary Button */}
                            <PrimaryButton />

                            {/* Right Secondary Button */}
                            <SecondaryButton />
                        </View>
                    </View>
                </View>
            )}

            <VoiceRecorder
                visible={isVoiceRecorderVisible}
                onFinish={(rec, transcribe) => handleVoiceFinish(rec, transcribe)}
                onCancel={() => setIsVoiceRecorderVisible(false)}
                autoStart={true}
                isMainScreen={true}
            />

            <UndoSnackbar
                message={pendingDeleteIds
                    ? t('notes.deletedCount', { count: pendingDeleteIds.length, defaultValue: 'Deleted: {{count}}' })
                    : null}
                onUndo={handleUndoDelete}
            />
            <UnlockSyncModal
                visible={showUnlockSyncModal}
                errorMessage={unlockErrorMessage}
                onClose={() => {
                    setShowUnlockSyncModal(false);
                    setUnlockErrorMessage(null);
                }}
                onUnlocking={() => {
                    setUnlockProgress(8);
                    setShowUnlockingOverlay(true);
                    setUnlockErrorMessage(null);
                }}
                onProgress={setUnlockProgress}
                onError={(message) => {
                    setShowUnlockingOverlay(false);
                    setUnlockProgress(null);
                    setUnlockErrorMessage(message);
                    setShowUnlockSyncModal(true);
                }}
                onUnlocked={() => {
                    setUnlockProgress(100);
                    setShowUnlockSyncModal(false);
                    setShowUnlockingOverlay(false);
                    setUnlockProgress(null);
                    setUnlockErrorMessage(null);
                    setTimeout(() => {
                        void syncNotes();
                    }, 0);
                }}
            />
            <ResetEncryptionModal
                visible={showResetSyncModal}
                onClose={() => setShowResetSyncModal(false)}
                onReset={() => {
                    setShowResetSyncModal(false);
                    void onRefresh();
                }}
            />
            <UnlockingOverlay
                visible={showUnlockingOverlay}
                title={t("settings.ui.unlockingNotesTitle")}
                subtitle={t("settings.ui.unlockingNotesSubtitle")}
                progress={unlockProgress ?? undefined}
                progressLabel={t("common.progress")}
            />
        </ScreenContainer>
    );
};

const styles = createStyles(() => ({
    avatar: {
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.primary,
    },
    avatarGuest: {
        backgroundColor: colors.backgroundSecondary,
    },
    avatarText: {
        fontSize: 15,
        fontWeight: '700',
        color: colors.onPrimary,
    },
    searchBarButton: {
        width: 48,
        height: 48,
        alignItems: 'center',
        justifyContent: 'center',
    },
    askRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginHorizontal: 4,
        marginBottom: 12,
        minHeight: 48,
        paddingVertical: 12,
        paddingHorizontal: 14,
        borderRadius: 14,
        backgroundColor: colors.primaryLight,
    },
    askRowText: {
        flex: 1,
        fontSize: 14,
        fontWeight: '500',
        color: colors.text,
    },
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
    offlinePill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
        marginHorizontal: spacing.m,
        marginBottom: spacing.m,
        paddingHorizontal: spacing.m,
        paddingVertical: 10,
        borderRadius: 14,
        backgroundColor: colors.backgroundSecondary,
    },
    offlineText: {
        flex: 1,
        fontSize: 13,
        color: colors.textSecondary,
    },
    lockBanner: {
        marginHorizontal: spacing.m,
        marginBottom: spacing.m,
        padding: spacing.m,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: colors.primary + '18',
        backgroundColor: colors.surface,
        shadowColor: colors.primary,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.08,
        shadowRadius: 18,
        elevation: 4,
    },
    lockBannerHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.m,
        paddingRight: spacing.xl,
    },
    lockBannerIcon: {
        width: 42,
        height: 42,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.primary + '10',
        borderWidth: 1,
        borderColor: colors.primary + '14',
    },
    lockBannerTextWrap: {
        flex: 1,
    },
    lockBannerTitle: {
        ...typography.noteTitle,
        color: colors.text,
    },
    lockBannerText: {
        ...typography.caption,
        color: colors.textSecondary,
        fontSize: 13,
        lineHeight: 18,
        marginTop: spacing.xs,
    },
    lockBannerClose: {
        position: 'absolute',
        top: spacing.s,
        right: spacing.s,
        padding: spacing.xs,
        zIndex: 2,
    },
    lockActionPrimary: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        backgroundColor: colors.primary,
        minHeight: 48,
        paddingHorizontal: spacing.m,
        paddingVertical: spacing.s + 2,
        borderRadius: 12,
    },
    lockActionPrimaryText: {
        ...typography.captionBold,
        color: colors.onPrimary,
        fontSize: 13,
    },
    lockActionsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
        marginTop: spacing.m,
    },
    lockActionSecondary: {
        minHeight: 48,
        justifyContent: 'center',
        paddingHorizontal: spacing.m,
        paddingVertical: spacing.s + 2,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
    },
    lockActionSecondaryText: {
        ...typography.captionBold,
        color: colors.textSecondary,
        fontSize: 13,
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
        paddingLeft: spacing.m,
        paddingRight: spacing.xs,
        height: 56, // Increased for better usability on mobile
    },
    searchInput: {
        flex: 1,
        height: 48,
        marginLeft: spacing.s,
        color: colors.text,
        fontSize: 16,
    },
    masonryContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        width: '100%',
        maxWidth: 1200,
        alignSelf: 'center',
    },
    tagRow: {
        gap: spacing.xs,
        paddingHorizontal: spacing.m,
        paddingBottom: spacing.s,
    },
    tagChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        minHeight: 36,
        paddingHorizontal: 12,
        borderRadius: 18,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
    },
    tagChipActive: {
        backgroundColor: colors.primary,
        borderColor: colors.primary,
    },
    tagChipText: {
        fontSize: 14,
        fontWeight: '500',
        color: colors.text,
    },
    tagChipCount: {
        fontSize: 12,
        color: colors.textTertiary,
    },
    tagChipTextActive: {
        color: colors.onPrimary,
    },
    headerColumn: {
        width: '100%',
        maxWidth: 760,
        alignSelf: 'center',
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
        zIndex: 20,
        elevation: 20,
    },
    dock: {
        flexDirection: 'column',
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderRadius: 32,
        paddingTop: 8, // Push contents down for vertical centering
        paddingBottom: 4,
        paddingHorizontal: spacing.l,
        // Three actions: the thumb reaches all of them, with room between each.
        width: 320,
        maxWidth: '86%',
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
}));
