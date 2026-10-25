import { useTranslation } from 'react-i18next';
import React, { useEffect, useMemo, useState, useRef, useCallback, useSyncExternalStore } from 'react';
import { View, Text, ScrollView, TouchableOpacity, useWindowDimensions, Animated, TextInput, RefreshControl, AppState, LayoutAnimation, UIManager, Platform, StyleSheet, BackHandler } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ScreenContainer } from '../components/ScreenContainer';
import { NoteCard } from '../components/NoteCard';
import { EmptyState } from '../components/EmptyState';
import { VoiceRecorder } from '../components/VoiceRecorder';
import { SelectionActionPanel } from '../components/SelectionActionPanel';
import { UNDO_WINDOW_MS, UndoSnackbar } from '../components/UndoSnackbar';
import { createPendingDeleteStore } from '../utils/pendingDelete';
import { colors, isDarkScheme } from '../theme/colors';
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
import { compareByContentDateDesc } from '../utils/contentDate';
import { rtlFlip } from '../i18n/direction';
import { useNetInfo } from '@react-native-community/netinfo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSubscription } from '../context/SubscriptionContext';
import { getAIProvider, getOnDeviceTranscription, getTranscriptionEnabled } from '../utils/storage';
import { isOnDeviceTranscriptionActive } from '../services/TranscriptionService';

const DOCK_PREF_KEY = 'vaulto_dock_preference';

const SEARCH_BAR_HEIGHT = 60;
// Tag chips (36) and the gap under them: the row folds away with the search bar.
const TAG_ROW_HEIGHT = 44;
const DOCK_HEIGHT = 68;
// Free cloud minutes are mentioned by the record button only when few are left.
const LOW_MINUTES_SECONDS = 5 * 60;
const UNLIMITED_SECONDS = 360000;
const PROFILE_REFRESH_MS = 20000;

// Notes deleted from the list wait here for the Undo window to close. Kept
// outside the screen so a remount (a theme change remounts the whole tree) or
// a re-render can never move them to the trash before the window is over.
const listPendingDelete = createPendingDeleteStore({
    windowMs: UNDO_WINDOW_MS,
    onError: (error) => console.error('[NotesList] Delete failed', error),
});

export const NotesListScreen = () => {
    const { t } = useTranslation();
    const navigation = useNavigation<NativeStackNavigationProp<any>>();
    const isFocused = useIsFocused();
    const { userId, isAuthenticated, isGuest, user, refreshProfile } = useAuth();
    const { isPro, proTrial } = useSubscription();
    // Account avatar in the search bar (as in Keep/Gmail): the initial of the name
    // or e-mail when signed in, a person icon for guests.
    const signedIn = isAuthenticated && !isGuest;
    // Live window size: tablets rotate (Android 16 ignores the portrait lock
    // on large screens), so nothing may be measured once at import time.
    const { width: windowWidth, height: screenHeight } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const columnCount = windowWidth >= 1100 ? 4 : windowWidth >= 700 ? 3 : 2;
    const netInfo = useNetInfo();
    // `null` means not known yet; only a definite "no" shows the offline note.
    const isOffline = netInfo.isConnected === false;
    const avatarInitial = signedIn
        ? ((user?.full_name || user?.email || '').trim().charAt(0).toUpperCase() || null)
        : null;
    const { syncLocked, resetRecoveryPending, bundle: encryptionBundle } = useEncryption();
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
    // Results start at the top (with the "Ask AI" row), not where the list was scrolled to.
    const listScrollRef = useRef<ScrollView>(null);
    const hasSearch = searchQuery.trim().length > 0;
    useEffect(() => {
        listScrollRef.current?.scrollTo({ y: 0, animated: false });
    }, [hasSearch]);
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
    // Hidden ids include those being moved to the trash, so they do not
    // reappear for a moment once the Undo bar has gone.
    const { undoableIds: pendingDeleteIds, hiddenIds: hiddenDeleteIds } = useSyncExternalStore(
        listPendingDelete.subscribe,
        listPendingDelete.getSnapshot,
    );

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

    // Free minutes: whether the next recording goes to the cloud is read on
    // focus (Settings may have changed it), and the balance is refreshed at
    // most every few seconds, not on every render.
    const [cloudTranscription, setCloudTranscription] = useState(false);
    const lastProfileRefreshRef = useRef(0);
    useFocusEffect(
        useCallback(() => {
            let cancelled = false;
            void (async () => {
                try {
                    const [provider, onDeviceChosen, enabled, onDeviceActive] = await Promise.all([
                        getAIProvider(),
                        getOnDeviceTranscription(),
                        getTranscriptionEnabled(),
                        isOnDeviceTranscriptionActive(),
                    ]);
                    if (!cancelled) setCloudTranscription(provider === 'vaulto_ai' && enabled && !onDeviceChosen && !onDeviceActive);
                } catch {
                    if (!cancelled) setCloudTranscription(false);
                }
            })();
            if (!isPro && Date.now() - lastProfileRefreshRef.current > PROFILE_REFRESH_MS) {
                lastProfileRefreshRef.current = Date.now();
                void refreshProfile();
            }
            return () => { cancelled = true; };
        }, [isPro, refreshProfile])
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
                // The unlock sheet stays: picking the key's QR from the gallery or
                // the camera permission prompt also sends the app to the background.
                setShowUnlockingOverlay(false);
                setUnlockProgress(null);
                // Only a real trip to the background (the app may be killed
                // there) ends the Undo window early; "inactive" is also the
                // notification shade or a system prompt on iOS.
                if (nextState === 'background') listPendingDelete.flush();
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

    // Not tied to selection mode: the header stays laid out under the
    // selection bar so the cards do not move.
    const shouldShowLockBanner =
        isAuthenticated &&
        !isGuest &&
        syncLocked &&
        !lockBannerDismissed;
    const shouldShowResetRecoveryBanner =
        isAuthenticated
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

    // A note started while the list shows one tag belongs under it.
    const handleCreateNote = () => {
        navigation.navigate('NoteEdit', activeTag ? { initialTag: activeTag } : undefined);
    };

    const handleVoiceFinish = (recording: AudioRecording, transcribe: boolean) => {
        setIsVoiceRecorderVisible(false);
        navigation.navigate('NoteEdit', { initialRecording: recording, initialTranscribe: transcribe, ...(activeTag ? { initialTag: activeTag } : {}) });
    };

    const handleSearch = (text: string) => {
        setSearchQuery(text);
        searchNotes(text);
    };

    const handleExitSelectionMode = () => {
        setIsSelectionMode(false);
        setSelectedNoteIds(new Set());
    };

    // Android Back steps out of selection, then a tag filter, then a search,
    // before it is allowed to leave the app.
    useFocusEffect(
        useCallback(() => {
            const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
                if (isSelectionMode) {
                    setIsSelectionMode(false);
                    setSelectedNoteIds(new Set());
                    return true;
                }
                if (activeTag) {
                    setActiveTag(null);
                    return true;
                }
                if (searchQuery) {
                    setSearchQuery('');
                    searchNotes('');
                    return true;
                }
                return false;
            });
            return () => subscription.remove();
        }, [activeTag, isSelectionMode, searchNotes, searchQuery])
    );

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

    // Like Gmail and Keep: no confirmation, the notes leave the list at once
    // and an Undo bar stays for a few seconds before anything is erased.
    // A second delete inside the window joins the same batch (one Undo brings
    // all of them back); a repeated tap on Delete adds nothing.
    const handleBatchDelete = () => {
        const ids = Array.from(selectedNoteIds);
        handleExitSelectionMode();
        if (ids.length === 0) return;
        if (listPendingDelete.schedule(ids, batchDeleteNotes)) haptics.warning();
    };

    const handleUndoDelete = () => {
        if (listPendingDelete.undo()) haptics.light();
    };

    // While encryption is locked nothing uploads (SyncService skips the sync), so a
    // pull to refresh says so briefly instead of looking like a sync that worked.
    const [lockedSyncNotice, setLockedSyncNotice] = useState(false);
    const lockedSyncNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => {
        if (lockedSyncNoticeTimerRef.current) clearTimeout(lockedSyncNoticeTimerRef.current);
    }, []);
    useEffect(() => {
        if (!syncLocked) setLockedSyncNotice(false);
    }, [syncLocked]);

    const onRefresh = useCallback(async () => {
        if (isRefreshing) return;
        setIsRefreshing(true);
        try {
            await syncNotes();
        } finally {
            setIsRefreshing(false);
        }
        if (isAuthenticated && !isGuest && syncLocked) {
            if (lockedSyncNoticeTimerRef.current) clearTimeout(lockedSyncNoticeTimerRef.current);
            setLockedSyncNotice(true);
            lockedSyncNoticeTimerRef.current = setTimeout(() => setLockedSyncNotice(false), UNDO_WINDOW_MS);
        }
    }, [isAuthenticated, isGuest, isRefreshing, syncLocked, syncNotes]);



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
        if (hiddenDeleteIds.includes(n.id)) return false;
        const activeChild = n.improvements?.find(imp => imp.is_active);
        const displayTitle = (activeChild?.title || activeChild?.label || n.title || '').trim();
        const displayContent = activeChild?.content || n.content || '';
        const hasTitle = displayTitle.length > 0;
        const hasContent = hasMeaningfulRichContent(displayContent);
        const hasAudio = n.has_audio;
        return hasTitle || hasContent || hasAudio;
    });

    // Tags come from #hashtags in the notes (all notes, not just the search hits).
    // The original text counts too: AI tags are written there, also when an AI version is shown.
    const notePlainText = (n: typeof notes[number]) => {
        const activeChild = n.improvements?.find(imp => imp.is_active);
        const shown = richContentToPlainText(activeChild?.content || n.content || '');
        return activeChild
            ? `${n.title || ''}\n${shown}\n${richContentToPlainText(n.content || '')}`
            : `${n.title || ''}\n${shown}`;
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
    // First launch: nothing to search yet, so the bar keeps only the avatar.
    const isWelcomeEmpty = canShowEmptyState && !searchQuery.trim() && lockedCount === 0 && !syncLocked;

    // Split notes into two columns for masonry layout
    // Sort pinned notes first
    const sortedNotes = [...tagFilteredNotes].sort((a, b) => {
        // Pinned notes come first
        if (a.is_pinned && !b.is_pinned) return -1;
        if (!a.is_pinned && b.is_pinned) return 1;
        // Otherwise by when the text last changed (a pin or version switch
        // does not move a note).
        return compareByContentDateDesc(a, b);
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
    const toColumns = (list: typeof sortedNotes) => {
        const columns: (typeof sortedNotes)[] = Array.from({ length: columnCount }, () => []);
        list.forEach((note, index) => {
            columns[index % columnCount].push(note);
        });
        return columns;
    };
    // Like Keep: with anything pinned, "Pinned" and "Others" head two grids.
    const pinnedNotes = orderedNotes.filter(note => note.is_pinned);
    const otherNotes = pinnedNotes.length > 0 ? orderedNotes.filter(note => !note.is_pinned) : orderedNotes;
    const noteSections: { key: string; title: string | null; columns: (typeof sortedNotes)[] }[] = pinnedNotes.length > 0
        ? [
            { key: 'pinned', title: t('notes.sectionPinned', 'Pinned'), columns: toColumns(pinnedNotes) },
            ...(otherNotes.length > 0
                ? [{ key: 'others', title: t('notes.sectionOthers', 'Others'), columns: toColumns(otherNotes) }]
                : []),
        ]
        : [{ key: 'all', title: null, columns: toColumns(otherNotes) }];

    // Guests and free accounts: "N min left" by the record button once the
    // free cloud minutes run low, and only while recordings go to the cloud.
    const remainingSeconds = user?.transcription_remaining_seconds;
    const backendPro = (user as any)?.is_pro === true || String((user as any)?.plan ?? '').toLowerCase() === 'pro';
    const minutesHint = !isPro && !backendPro && cloudTranscription && !!user
        && typeof remainingSeconds === 'number'
        && (user.transcription_total_seconds ?? 0) <= UNLIMITED_SECONDS
        && remainingSeconds <= LOW_MINUTES_SECONDS
        ? (remainingSeconds > 0
            ? t('notes.freeMinutesLeft', '{{minutes}} min left', { minutes: Math.max(1, Math.round(remainingSeconds / 60)) })
            : t('notes.freeMinutesUsed', 'Free minutes used up'))
        : null;
    // The same quiet line is the natural moment to mention the no-card Pro trial.
    const minutesHintOffersTrial = !!minutesHint && signedIn && proTrial.available;
    const minutesHintText = minutesHint && minutesHintOffersTrial
        ? `${minutesHint} · ${t('notes.tryProFree', 'Try Pro free')}`
        : minutesHint;

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
                        <MaterialIcons name="mic" size={28} color={colors.onPrimary} />
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
                        <MaterialIcons name="edit" size={26} color={colors.onPrimary} />
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
                    <MaterialIcons name="edit" size={24} color={colors.text} />
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
                    <MaterialIcons name="mic-none" size={24} color={colors.text} />
                </TouchableOpacity>
            );
        }
    };

    return (
        <ScreenContainer>
            {/* Selection mode lays the action bar over the header instead of
                swapping it out, so the cards stay exactly where they were. */}
            <View>
            <View
                style={isSelectionMode && styles.headerHidden}
                pointerEvents={isSelectionMode ? 'none' : 'auto'}
                accessibilityElementsHidden={isSelectionMode}
                importantForAccessibility={isSelectionMode ? 'no-hide-descendants' : 'auto'}
            >
            <View style={styles.topBar} />
            {/* Banners and search keep a readable width on tablets. */}
            <View style={styles.headerColumn}>
            {/* Offline: say that nothing is lost, sync just waits for the network. */}
            {isOffline && (
                <View style={styles.offlinePill} accessibilityLiveRegion="polite">
                    <MaterialIcons name="cloud-off" size={14} color={colors.textTertiary} />
                    <Text style={styles.offlineText} numberOfLines={2}>
                        {signedIn
                            ? t('notes.offlineSync', 'Offline. Changes are saved and will sync later.')
                            : t('notes.offline', 'Offline. Notes and on-device features still work.')}
                    </Text>
                </View>
            )}
            {/* Signed out but notes were kept: they are on the phone, just not readable yet. */}
            {!signedIn && lockedCount > 0 && (
                <View style={styles.lockBanner}>
                    <View style={styles.lockBannerHeader}>
                        <View style={styles.lockBannerTextWrap}>
                            <Text style={styles.lockBannerTitle}>
                                {t('notes.keptLockedTitle', 'Account notes kept on this device: {{count}}', { count: lockedCount })}
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
                            <Text style={styles.lockActionPrimaryText}>{t('auth.signIn', 'Sign In')}</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            )}
            {shouldShowResetRecoveryBanner && (
                <View style={styles.lockBanner}>
                    <View style={styles.lockBannerHeader}>
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
                        hitSlop={10}
                        accessibilityRole="button"
                        accessibilityLabel={t('a11y.close', 'Close')}
                    >
                        <MaterialIcons name="close" size={18} color={colors.textTertiary} />
                    </TouchableOpacity>
                    <View style={styles.lockBannerHeader}>
                        <View style={styles.lockBannerTextWrap}>
                            <Text style={styles.lockBannerTitle}>
                                {t("notes.syncLocked")}
                            </Text>
                            <Text style={styles.lockBannerText}>
                                {encryptionBundle?.secret_mode === 'recovery_code'
                                    ? t("notes.unlockWithKey", "Enter your recovery key to show them on this device.")
                                    : t("notes.unlockToRestore")}
                                {/* Nothing uploads while locked: new notes stay on this phone only. */}
                                {` ${t('notes.lockedNotBackedUp', 'Until then, new notes are not backed up.')}`}
                            </Text>
                        </View>
                    </View>
                    <View style={styles.lockActionsRow}>
                        <TouchableOpacity
                            style={styles.lockActionPrimary}
                            onPress={() => setShowUnlockSyncModal(true)}
                            activeOpacity={0.85}
                        >
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
            <Animated.View style={[styles.searchContainer, { height: searchBarHeight, opacity: searchBarHeight.interpolate({ inputRange: [0, SEARCH_BAR_HEIGHT], outputRange: [0, 1] }) }]}>
                <View style={[styles.searchBar, isWelcomeEmpty && styles.searchBarBare]}>
                    {!isWelcomeEmpty && (
                        <>
                            <MaterialIcons name="search" size={20} color={colors.textSecondary} />
                            <TextInput
                                style={styles.searchInput}
                                placeholder={t("common.search")}
                                placeholderTextColor={colors.textTertiary}
                                value={searchQuery}
                                onChangeText={handleSearch}
                            />
                        </>
                    )}
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
            {/* Tag filter: one tap narrows the list to a #tag, like Keep's labels. */}
            {/* Folds away together with the search bar: left alone, the chips
                floated over cards cut off under them. */}
            {allTags.length > 0 && (
                <Animated.View
                    style={{
                        overflow: 'hidden',
                        height: searchBarHeight.interpolate({ inputRange: [0, SEARCH_BAR_HEIGHT], outputRange: [0, TAG_ROW_HEIGHT] }),
                        opacity: searchBarHeight.interpolate({ inputRange: [0, SEARCH_BAR_HEIGHT], outputRange: [0, 1] }),
                    }}
                >
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
                </Animated.View>
            )}

            </View>
            </View>
            {isSelectionMode && (
                <View style={styles.selectionPanelOverlay}>
                    <SelectionActionPanel
                        selectedCount={selectedNoteIds.size}
                        onPin={handleBatchPin}
                        onUnpin={handleBatchPin}
                        onDelete={handleBatchDelete}
                        onClose={handleExitSelectionMode}
                        allPinned={allSelectedPinned}
                    />
                </View>
            )}
            </View>

            <ScrollView
                ref={listScrollRef}
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
                {searchQuery.trim().length > 0 && (
                    <TouchableOpacity
                        style={styles.askRow}
                        disabled={isSelectionMode}
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
                            // A fresh device has no local rows yet, but its server
                            // notes can still be locked. Do not imply an empty account.
                            variant={searchQuery.trim() ? 'search' : (lockedCount > 0 || syncLocked ? 'plain' : 'welcome')}
                            message={searchQuery.trim()
                                ? t("notes.noSearchResults", "No notes match your search")
                                : syncLocked
                                    // The banner above already asks for the key: don't repeat it.
                                    ? shouldShowLockBanner
                                        ? t('notes.lockedListHint', 'Your notes will appear here once they are unlocked.')
                                        : encryptionBundle?.secret_mode === 'recovery_code'
                                            ? t('notes.unlockWithKey', 'Enter your recovery key to show them on this device.')
                                            : t('notes.unlockToRestore')
                                : ''}
                        />
                    </View>
                ) : (
                    <>
                    {noteSections.map((section, sectionIndex) => (
                        <React.Fragment key={section.key}>
                            {section.title && (
                                <Text
                                    style={[styles.sectionTitle, sectionIndex > 0 && styles.sectionTitleFollowing]}
                                    accessibilityRole="header"
                                    numberOfLines={1}
                                >
                                    {section.title}
                                </Text>
                            )}
                            <View style={styles.masonryContainer}>
                                {section.columns.map((columnNotes, columnIndex) => (
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
                        </React.Fragment>
                    ))}
                    </>
                )}
                {/* Room for the floating dock, so the last cards can scroll clear of it. */}
                <View style={{ height: DOCK_HEIGHT + Math.max(insets.bottom, spacing.m) + spacing.l }} pointerEvents="none" />
            </ScrollView>

            {/* First launch: the one thing to do, right above the button that does it. */}
            {isWelcomeEmpty && !isSelectionMode && !isVoiceRecorderVisible && (
                <View
                    pointerEvents="box-none"
                    style={[styles.welcomeHintContainer, { bottom: Math.max(insets.bottom, spacing.m) + spacing.m + DOCK_HEIGHT + spacing.s }]}
                >
                    <TouchableOpacity
                        style={styles.welcomeHint}
                        onPress={isMicPrimary ? handleMicPress : handleCreateNote}
                        activeOpacity={0.6}
                        hitSlop={8}
                        accessibilityRole="button"
                    >
                        {/* The arrow is part of the text, so it stays with the last word when it wraps. */}
                        <Text style={styles.welcomeHintText}>
                            {isMicPrimary ? t("notes.tapMicToRecord") : t("notes.tapPencilToWrite")}
                            {'\u00A0'}
                            <MaterialIcons name="south" size={16} color={colors.primary} />
                        </Text>
                    </TouchableOpacity>
                </View>
            )}

            {/* Few free minutes left: one quiet line above the record button; tap for Settings
                (or the paywall, when it also offers the no-card trial). */}
            {!!minutesHint && !isWelcomeEmpty && !isSelectionMode && !isVoiceRecorderVisible && (
                <View
                    pointerEvents="box-none"
                    style={[styles.minutesHintContainer, { bottom: Math.max(insets.bottom, spacing.m) + spacing.m + DOCK_HEIGHT + spacing.s }]}
                >
                    <TouchableOpacity
                        style={styles.minutesHint}
                        onPress={minutesHintOffersTrial ? () => navigation.navigate('Paywall') : handleSettingsPress}
                        activeOpacity={0.7}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={minutesHintText ?? undefined}
                    >
                        <MaterialIcons
                            name={minutesHintOffersTrial ? 'workspace-premium' : 'graphic-eq'}
                            size={14}
                            color={minutesHintOffersTrial ? colors.primary : colors.textSecondary}
                        />
                        <Text style={styles.minutesHintText} numberOfLines={1}>{minutesHintText}</Text>
                    </TouchableOpacity>
                </View>
            )}

            {/* Floating dock: hidden in selection mode and while the recorder takes its place. */}
            {!isSelectionMode && !isVoiceRecorderVisible && (
                <View style={[styles.dockContainer, { bottom: Math.max(insets.bottom, spacing.m) + spacing.m }]} key={dockInstanceKey} pointerEvents="box-none">
                    <View style={styles.dock}>
                        <View style={styles.dockButtonRow}>
                            <TouchableOpacity
                                style={styles.dockButton}
                                onPress={() => navigation.navigate('AskNotes')}
                                activeOpacity={0.7}
                                accessibilityRole="button"
                                accessibilityLabel={t("ask.title", "Ask your notes")}
                            >
                                <MaterialIcons name="auto-awesome" size={22} color={colors.text} />
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
            {!pendingDeleteIds && (
                <UndoSnackbar
                    message={lockedSyncNotice
                        ? t('notes.lockedSyncNotice', 'Not synced: unlock encryption to back up new notes.')
                        : null}
                    onUndo={() => {
                        setLockedSyncNotice(false);
                        setShowUnlockSyncModal(true);
                    }}
                    actionLabel={t('settings.ui.unlock')}
                />
            )}
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
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.backgroundSecondary,
    },
    avatarGuest: {
        backgroundColor: colors.backgroundSecondary,
    },
    avatarText: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.text,
    },
    searchBarButton: {
        width: 44,
        height: 44,
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
    // Kept in the layout (only invisible) while the selection bar covers it.
    headerHidden: {
        opacity: 0,
    },
    selectionPanelOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 30,
        elevation: 4,
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
    // Offline is a status, not an alarm: one quiet line above the list.
    offlinePill: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        marginHorizontal: spacing.m,
        marginBottom: spacing.s,
        paddingHorizontal: spacing.m,
    },
    offlineText: {
        flexShrink: 1,
        fontSize: 13,
        lineHeight: 18,
        color: colors.textSecondary,
        textAlign: 'center',
    },
    // Banners read like a short note from the app: text first, one clear action.
    lockBanner: {
        marginHorizontal: spacing.m,
        marginBottom: spacing.m,
        paddingHorizontal: spacing.m,
        paddingVertical: 14,
        borderRadius: 14,
        backgroundColor: colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: isDarkScheme() ? colors.surface : colors.border,
    },
    lockBannerHeader: {
        paddingEnd: spacing.xl,
    },
    lockBannerTextWrap: {
        gap: 4,
    },
    lockBannerTitle: {
        fontSize: 15,
        lineHeight: 20,
        fontWeight: '600',
        color: colors.text,
    },
    lockBannerText: {
        fontSize: 13,
        lineHeight: 18,
        color: colors.textSecondary,
    },
    lockBannerClose: {
        position: 'absolute',
        top: spacing.s,
        end: spacing.s,
        padding: spacing.xs,
        zIndex: 2,
    },
    lockActionPrimary: {
        justifyContent: 'center',
        backgroundColor: colors.primary,
        minHeight: 40,
        paddingHorizontal: 18,
        borderRadius: 20,
    },
    lockActionPrimaryText: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.onPrimary,
    },
    lockActionsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: spacing.s,
        marginTop: 12,
    },
    lockActionSecondary: {
        minHeight: 40,
        justifyContent: 'center',
        paddingHorizontal: 12,
    },
    lockActionSecondaryText: {
        fontSize: 14,
        fontWeight: '500',
        color: colors.textSecondary,
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
        borderRadius: 24,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: isDarkScheme() ? colors.surface : colors.border,
        paddingLeft: spacing.m,
        paddingRight: spacing.xxs,
        height: 48,
    },
    searchBarBare: {
        justifyContent: 'flex-end',
        backgroundColor: 'transparent',
        borderColor: 'transparent',
    },
    searchInput: {
        flex: 1,
        height: 48,
        marginLeft: spacing.s,
        color: colors.text,
        fontSize: 16,
    },
    // Keep-style group labels above the pinned notes and the rest.
    sectionTitle: {
        fontSize: 12,
        lineHeight: 16,
        fontWeight: '600',
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        color: colors.textSecondary,
        // Lined up with the card edges. Padding, not margin: with width 100% a margin would push it off-centre.
        paddingHorizontal: spacing.xs,
        marginBottom: spacing.s,
        width: '100%',
        maxWidth: 1200,
        alignSelf: 'center',
    },
    sectionTitleFollowing: {
        marginTop: spacing.m,
    },
    minutesHintContainer: {
        position: 'absolute',
        left: spacing.m,
        right: spacing.m,
        alignItems: 'center',
        zIndex: 19,
        elevation: 19,
    },
    minutesHint: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        minHeight: 28,
        paddingHorizontal: 12,
        borderRadius: 14,
        backgroundColor: isDarkScheme() ? colors.surfaceElevated : colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: isDarkScheme() ? colors.borderHover : colors.border,
    },
    minutesHintText: {
        fontSize: 12,
        fontWeight: '500',
        color: colors.textSecondary,
        fontVariant: ['tabular-nums'],
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
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: isDarkScheme() ? colors.surface : colors.border,
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
        fontSize: 13,
        fontWeight: '500',
        color: colors.textSecondary,
        fontVariant: ['tabular-nums'],
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
        // Same readable column as the search bar on tablets.
        width: '100%',
        maxWidth: 760,
        alignSelf: 'center',
    },
    welcomeHintContainer: {
        position: 'absolute',
        left: spacing.m,
        right: spacing.m,
        alignItems: 'center',
    },
    welcomeHint: {
        paddingHorizontal: spacing.m,
        paddingVertical: spacing.s,
        borderRadius: 20,
        backgroundColor: colors.background,
    },
    welcomeHintText: {
        fontSize: 15,
        lineHeight: 21,
        fontWeight: '500',
        color: colors.primary,
        textAlign: 'center',
    },
    dockContainer: {
        position: 'absolute',
        left: 0,
        right: 0,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 20,
        elevation: 20,
    },
    // One floating pill: Ask on the left, the main action in the middle, the
    // other way to make a note on the right. Everything sits inside the pill.
    dock: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: isDarkScheme() ? colors.surfaceElevated : colors.surface,
        borderRadius: 34,
        paddingHorizontal: spacing.s,
        width: 264,
        maxWidth: '80%',
        height: DOCK_HEIGHT,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: isDarkScheme() ? 0.4 : 0.1,
        shadowRadius: 16,
        elevation: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: isDarkScheme() ? colors.borderHover : colors.border,
    },
    dockButtonRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
    },
    dockButton: {
        width: 52,
        height: 52,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 26,
    },
    centerButton: {
        width: 56,
        height: 56,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 28,
    },
    centerButtonInner: {
        width: '100%',
        height: '100%',
        borderRadius: 28,
        backgroundColor: colors.primary,
        justifyContent: 'center',
        alignItems: 'center',
    },
}));
