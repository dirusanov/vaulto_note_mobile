import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Modal,
    Pressable,
    ScrollView,
    Text,
    TouchableOpacity,
    TouchableWithoutFeedback,
    useWindowDimensions,
    View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { createStyles } from '../theme/createStyles';
import { usePhrasePlayer, type PhraseAudio } from '../hooks/usePhrasePlayer';
import {
    activePhraseKey,
    formatPhraseTime,
    linkTextToRecordings,
    phrasesOfRecording,
    type LinkedPhrase,
    type TimingSourceRecording,
} from '../utils/phraseTiming';

interface ListenSheetProps {
    visible: boolean;
    onClose: () => void;
    /**
     * Plain text to show and link (the note's current version). Without it the
     * recordings' own phrases are shown.
     */
    text?: string | null;
    sources: TimingSourceRecording[];
    audio: PhraseAudio[];
    title?: string;
    /** Extra actions under the transcript (e.g. Insert / Copy for one recording). */
    footer?: React.ReactNode;
    /** Start playing from the first sentence on opening (opened from a play button). */
    autoPlay?: boolean;
}

interface PhraseRowProps {
    phrase: LinkedPhrase;
    active: boolean;
    onPress: (phrase: LinkedPhrase) => void;
    onLayoutY: (key: string, y: number) => void;
    playHint: string;
    unlinkedLabel: string;
    /** Width of the time column, so every sentence starts at the same edge. */
    gutter: number;
}

const PhraseRow = memo(({ phrase, active, onPress, onLayoutY, playHint, unlinkedLabel, gutter }: PhraseRowProps) => {
    const link = phrase.link;
    const time = link ? formatPhraseTime(link.start) : '';
    const content = (
        <>
            <Text style={[styles.time, { width: gutter }, active && styles.timeActive]} importantForAccessibility="no" numberOfLines={1}>
                {time}
            </Text>
            <Text style={[styles.phrase, !link && styles.phraseUnlinked]}>{phrase.text}</Text>
        </>
    );
    if (!link) {
        return (
            <View
                style={styles.row}
                onLayout={(event) => onLayoutY(phrase.key, event.nativeEvent.layout.y)}
                accessible
                accessibilityLabel={`${phrase.text}. ${unlinkedLabel}`}
            >
                {content}
            </View>
        );
    }
    return (
        <Pressable
            onPress={() => onPress(phrase)}
            onLayout={(event) => onLayoutY(phrase.key, event.nativeEvent.layout.y)}
            style={({ pressed }) => [styles.row, active && styles.rowActive, pressed && !active && styles.rowPressed]}
            android_ripple={{ color: colors.primaryLight, borderless: false }}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${time}, ${phrase.text}`}
            accessibilityHint={playHint}
        >
            {content}
        </Pressable>
    );
});

/**
 * The note as text with its audio: tap a sentence to hear it from there; the
 * sentence being heard is tinted and kept in view. Sentences changed since the
 * recording have no time and are not tappable.
 */
export const ListenSheet = ({ visible, onClose, text, sources, audio, title, footer, autoPlay }: ListenSheetProps) => {
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    const { state, playFrom, toggle, stop } = usePhrasePlayer(audio, visible);
    const scrollRef = useRef<ScrollView>(null);
    const rowY = useRef<Record<string, number>>({});
    const [follow, setFollow] = useState(true);
    // "0:00" at the system text size; "1:02:05" needs more room.
    const { fontScale } = useWindowDimensions();

    const { phrases, rewritten, hasUnlinked } = useMemo(() => {
        if (!visible) return { phrases: [] as LinkedPhrase[], rewritten: false, hasUnlinked: false };
        const linked = text && text.trim() ? linkTextToRecordings(text, sources) : [];
        if (linked.some((phrase) => phrase.link)) {
            return { phrases: linked, rewritten: false, hasUnlinked: linked.some((phrase) => !phrase.link) };
        }
        // Nothing of this version matches (rewritten by AI, or no text): the
        // recordings' own words are still worth listening to.
        return { phrases: sources.flatMap(phrasesOfRecording), rewritten: !!(text && text.trim()), hasUnlinked: false };
    }, [visible, text, sources]);

    const activeKey = activePhraseKey(phrases, state.recordingId, state.position);
    const longest = phrases.reduce((max, phrase) => Math.max(max, phrase.link?.start ?? 0), 0);
    const gutter = Math.ceil((longest >= 3600 ? 60 : 38) * Math.max(1, fontScale));

    useEffect(() => {
        if (!visible) {
            rowY.current = {};
            setFollow(true);
        }
    }, [visible]);

    // Keep the sentence being heard in view (unless the reader scrolled away).
    useEffect(() => {
        if (!follow || !activeKey || !state.isPlaying) return;
        const y = rowY.current[activeKey];
        if (typeof y === 'number') scrollRef.current?.scrollTo({ y: Math.max(0, y - 72), animated: true });
    }, [activeKey, follow, state.isPlaying]);

    const handlePress = useCallback((phrase: LinkedPhrase) => {
        if (!phrase.link) return;
        setFollow(true);
        void playFrom(phrase.link.recordingId, phrase.link.start);
    }, [playFrom]);

    const handleLayoutY = useCallback((key: string, y: number) => {
        rowY.current[key] = y;
    }, []);

    const close = () => {
        void stop();
        onClose();
    };

    const firstLinked = phrases.find((phrase) => phrase.link);

    // Opened from the note's play button: it plays, as the button promises,
    // and the text follows along. Once per opening.
    const autoPlayedRef = useRef(false);
    useEffect(() => {
        if (!visible) {
            autoPlayedRef.current = false;
            return;
        }
        if (!autoPlay || autoPlayedRef.current || !firstLinked) return;
        autoPlayedRef.current = true;
        handlePress(firstLinked);
    }, [autoPlay, firstLinked, handlePress, visible]);
    const handlePlayPause = () => {
        if (state.recordingId && !state.failed) {
            void toggle();
        } else if (firstLinked?.link) {
            handlePress(firstLinked);
        }
    };

    const progress = state.duration > 0 ? Math.min(1, state.position / state.duration) : 0;
    const playHint = t('listen.playHint', 'Plays the recording from this sentence');
    const unlinkedLabel = t('listen.unlinked', 'Changed after recording, no audio link');
    const hint = rewritten
        ? t('listen.rewritten', 'This version was rewritten, so here is the recording’s own text.')
        : hasUnlinked
            ? t('listen.hintWithEdits', 'Tap a sentence to hear it. Sentences you changed have no time.')
            : t('listen.hint', 'Tap a sentence to hear it.');

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
            <TouchableWithoutFeedback onPress={close} accessible={false}>
                <View style={styles.overlay}>
                    <TouchableWithoutFeedback accessible={false}>
                        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.m) }]}>
                            <View style={styles.handle} />
                            <View style={styles.header}>
                                <Text style={styles.title} accessibilityRole="header">
                                    {title || t('listen.title', 'Text and audio')}
                                </Text>
                                <TouchableOpacity
                                    onPress={close}
                                    style={styles.iconButton}
                                    accessibilityRole="button"
                                    accessibilityLabel={t('a11y.close', 'Close')}
                                >
                                    <MaterialIcons name="close" size={22} color={colors.textSecondary} />
                                </TouchableOpacity>
                            </View>
                            <Text style={styles.hint}>{hint}</Text>

                            <ScrollView
                                ref={scrollRef}
                                style={styles.list}
                                contentContainerStyle={styles.listContent}
                                onScrollBeginDrag={() => setFollow(false)}
                            >
                                {phrases.map((phrase) => (
                                    <PhraseRow
                                        key={phrase.key}
                                        phrase={phrase}
                                        active={phrase.key === activeKey}
                                        onPress={handlePress}
                                        onLayoutY={handleLayoutY}
                                        playHint={playHint}
                                        unlinkedLabel={unlinkedLabel}
                                        gutter={gutter}
                                    />
                                ))}
                            </ScrollView>

                            <View style={styles.player}>
                                <TouchableOpacity
                                    onPress={handlePlayPause}
                                    style={styles.playButton}
                                    disabled={!firstLinked || state.isLoading}
                                    accessibilityRole="button"
                                    accessibilityLabel={state.isPlaying ? t('listen.pause', 'Pause') : t('listen.play', 'Play')}
                                    accessibilityState={{ busy: state.isLoading, disabled: !firstLinked }}
                                >
                                    {state.isLoading ? (
                                        <ActivityIndicator color={colors.onPrimary} size="small" />
                                    ) : (
                                        <MaterialIcons name={state.isPlaying ? 'pause' : 'play-arrow'} size={28} color={colors.onPrimary} />
                                    )}
                                </TouchableOpacity>
                                <View style={styles.playerMiddle}>
                                    <View style={styles.track} importantForAccessibility="no-hide-descendants">
                                        <View style={[styles.trackFill, { width: `${progress * 100}%` }]} />
                                    </View>
                                    <Text
                                        style={styles.clock}
                                        accessibilityLabel={t('listen.position', '{{position}} of {{duration}}', {
                                            position: formatPhraseTime(state.position),
                                            duration: formatPhraseTime(state.duration),
                                        })}
                                    >
                                        {state.failed
                                            ? t('listen.failed', 'Could not play this recording')
                                            : `${formatPhraseTime(state.position)} / ${formatPhraseTime(state.duration)}`}
                                    </Text>
                                </View>
                                {!follow && state.isPlaying ? (
                                    <TouchableOpacity
                                        onPress={() => setFollow(true)}
                                        style={styles.iconButton}
                                        accessibilityRole="button"
                                        accessibilityLabel={t('listen.follow', 'Show the current sentence')}
                                    >
                                        <MaterialIcons name="vertical-align-center" size={22} color={colors.primary} />
                                    </TouchableOpacity>
                                ) : (
                                    <View style={styles.iconButton} />
                                )}
                            </View>
                            {footer}
                        </View>
                    </TouchableWithoutFeedback>
                </View>
            </TouchableWithoutFeedback>
        </Modal>
    );
};

const styles = createStyles(() => ({
    overlay: {
        flex: 1,
        backgroundColor: colors.overlay,
        justifyContent: 'flex-end',
    },
    sheet: {
        backgroundColor: colors.surface,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        width: '100%',
        maxWidth: 640,
        alignSelf: 'center',
        maxHeight: '88%',
        paddingTop: spacing.s,
    },
    handle: {
        alignSelf: 'center',
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: colors.border,
        marginBottom: spacing.xs,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingLeft: spacing.m,
        paddingRight: spacing.xs,
    },
    title: {
        flex: 1,
        fontSize: 18,
        fontWeight: '700',
        color: colors.text,
    },
    hint: {
        fontSize: 13,
        lineHeight: 18,
        color: colors.textSecondary,
        paddingHorizontal: spacing.m,
        marginBottom: spacing.s,
    },
    list: {
        flexGrow: 0,
        flexShrink: 1,
    },
    listContent: {
        paddingHorizontal: spacing.s,
        paddingBottom: spacing.m,
    },
    row: {
        flexDirection: 'row',
        // First lines share a baseline at any text size.
        alignItems: 'baseline',
        minHeight: 44,
        borderRadius: 12,
        paddingVertical: 10,
        paddingHorizontal: spacing.s,
        gap: spacing.s,
    },
    rowActive: {
        backgroundColor: colors.activeWordHighlight,
    },
    rowPressed: {
        backgroundColor: colors.backgroundSecondary,
    },
    time: {
        fontSize: 13,
        lineHeight: 18,
        color: colors.textSecondary,
        fontVariant: ['tabular-nums'],
    },
    timeActive: {
        color: colors.primary,
        fontWeight: '600',
    },
    phrase: {
        flex: 1,
        fontSize: 16,
        lineHeight: 24,
        color: colors.text,
    },
    phraseUnlinked: {
        color: colors.textSecondary,
    },
    player: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
        paddingHorizontal: spacing.m,
        paddingTop: spacing.s,
        borderTopWidth: 1,
        borderTopColor: colors.border,
    },
    playButton: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: colors.primary,
        alignItems: 'center',
        justifyContent: 'center',
    },
    playerMiddle: {
        flex: 1,
        gap: 6,
    },
    track: {
        height: 4,
        borderRadius: 2,
        backgroundColor: colors.primaryLight,
        overflow: 'hidden',
    },
    trackFill: {
        height: 4,
        borderRadius: 2,
        backgroundColor: colors.primary,
    },
    clock: {
        fontSize: 13,
        color: colors.textSecondary,
        fontVariant: ['tabular-nums'],
    },
    iconButton: {
        width: 48,
        height: 48,
        alignItems: 'center',
        justifyContent: 'center',
    },
}));
