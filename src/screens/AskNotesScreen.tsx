import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenContainer } from '../components/ScreenContainer';
import { MarkdownPreview } from '../components/MarkdownPreview';
import { LimitModal } from '../components/LimitModal';
import { SignInRequiredModal } from '../components/SignInRequiredModal';
import { useNotesContext } from '../contexts/NotesContext';
import { answerFromNotes, isOnDeviceAI } from '../services/AIService';
import { colors, isDarkScheme } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { deriveAutoTitleFromPlainText, richContentToAgentMarkdown, richContentToPlainText } from '../utils/richContent';
import { buildNoteSources, formatSourcesForModel, NoteSource, SearchableNote } from '../utils/noteSearch';
import { getPrivateAIAllowed } from '../utils/storage';
import { useAuth } from '../hooks/useAuth';
import { getErrorMessage, isNetworkError } from '../utils/errorMessage';
import { stripStoredTitleMarkdown } from '../utils/markdownUtils';
import { createStyles } from '../theme/createStyles';
import { haptics } from '../utils/haptics';
import { rtlFlip } from '../i18n/direction';
import { getEffectiveAIProvider } from '../services/effectiveProvider';
import { isLocalLLMRuntimeAvailable } from '../services/LocalLLMService';
import { LOCAL_MODELS_ENABLED } from '../utils/featureFlags';
import { LLM_LIMIT_REASON, usageLimitReasonOf } from '../utils/aiLimitState';

type Message =
    | { id: string; role: 'user'; text: string }
    | { id: string; role: 'assistant'; text: string; sources: NoteSource[] }
    | { id: string; role: 'error'; text: string; offline?: boolean }
    // A usage limit answered in the chat, with a way forward, instead of silence.
    | { id: string; role: 'limit'; text: string; upgrade: boolean };

/**
 * "Ask your notes": retrieval runs on the device over decrypted notes; only the
 * best-matching excerpts are sent to the AI, and local-only notes stay out of it
 * unless the user allowed AI for private notes.
 */
export const AskNotesScreen = () => {
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    const navigation = useNavigation<NativeStackNavigationProp<any>>();
    const route = useRoute<any>();
    // `notes` may be narrowed by the list's search box; the chat searches everything.
    const { notes, getAllNotes, isHydrated } = useNotesContext();
    const { isAuthenticated, isGuest, user } = useAuth();
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState<Message[]>([]);
    const [busy, setBusy] = useState(false);
    const [privateAllowed, setPrivateAllowed] = useState(false);
    const [onDeviceAI, setOnDeviceAI] = useState(false);
    // Vaulto AI answers signed-in users only (the server rejects guests). A guest
    // without on-device AI learns that before typing, not from an error after.
    const [aiLocked, setAiLocked] = useState(false);
    const [showGate, setShowGate] = useState(false);
    const gateShownRef = useRef(false);
    const scrollRef = useRef<ScrollView>(null);
    const initialAskedRef = useRef(false);
    const isGuestUser = !isAuthenticated || isGuest;
    const canSetUpOnDevice = LOCAL_MODELS_ENABLED && isLocalLLMRuntimeAvailable();

    const checkAILocked = useCallback(async (): Promise<boolean> => (
        isGuestUser && (await getEffectiveAIProvider()) === 'vaulto_ai'
    ), [isGuestUser]);

    useEffect(() => {
        void getPrivateAIAllowed().then(setPrivateAllowed).catch(() => setPrivateAllowed(false));
    }, []);

    // Again on every return: the user may have signed in or set up the model meanwhile.
    useFocusEffect(useCallback(() => {
        let active = true;
        void isOnDeviceAI().then((value) => { if (active) setOnDeviceAI(value); }).catch(() => undefined);
        void checkAILocked().then((locked) => {
            if (!active) return;
            setAiLocked(locked);
            // Offer the ways forward once on arrival; after "Not now" it waits for a tap.
            if (locked && !gateShownRef.current) {
                gateShownRef.current = true;
                setShowGate(true);
            }
            if (!locked) setShowGate(false);
        }).catch(() => undefined);
        return () => { active = false; };
    }, [checkAILocked]));

    // Every readable note, tagged with what may limit sending it to a cloud AI.
    const allSearchable = useMemo<(SearchableNote & { cloudAllowed: boolean })[]>(() => (getAllNotes().length > 0 ? getAllNotes() : notes || [])
        .filter((note: any) => !note.deleted && !note.pending_delete && note.privacy !== 'hidden')
        .map((note: any) => {
            const active = (note.improvements || []).find((imp: any) => imp.is_active && !imp.deleted);
            const content = active?.content ?? note.content ?? '';
            // Markdown keeps checklist state ("- [x]"); plain text would make every
            // task look open to "Which tasks are still open?".
            const text = richContentToAgentMarkdown(content);
            // Same title the note card shows.
            const title = stripStoredTitleMarkdown(note.title || '').trim()
                || stripStoredTitleMarkdown(active?.title || '').trim()
                || deriveAutoTitleFromPlainText(richContentToPlainText(content));
            // Protected notes never reach a cloud AI; legacy local-only ones only with consent.
            const cloudAllowed = !note.is_protected && (privateAllowed || note.storage_scope !== 'local_only');
            return { id: note.id, title, text, updatedAt: note.updated_at, cloudAllowed };
        })
        .filter((note) => note.text.trim().length > 0), [getAllNotes, notes, privateAllowed]);
    const searchable = useMemo(() => allSearchable.filter((note) => note.cloudAllowed), [allSearchable]);

    const ask = useCallback(async (raw: string, options: { recentDays?: number } = {}) => {
        const question = raw.trim();
        if (!question || busy) return;
        if (await checkAILocked()) {
            setAiLocked(true);
            setShowGate(true);
            return;
        }
        haptics.light();
        setInput('');
        const stamp = `${Date.now()}`;
        setMessages((prev) => [...prev, { id: `q-${stamp}`, role: 'user', text: question }]);
        setBusy(true);
        try {
            // On-device AI sees every note (nothing leaves the phone) but has a
            // smaller context, so it gets fewer, shorter excerpts.
            const onDevice = await isOnDeviceAI();
            // The weekly summary only looks at notes changed in the last days.
            const cutoff = options.recentDays ? Date.now() - options.recentDays * 24 * 60 * 60 * 1000 : 0;
            const recent = <T extends { updatedAt?: string }>(list: T[]) => (cutoff
                ? list.filter((note) => note.updatedAt && new Date(note.updatedAt).getTime() >= cutoff)
                : list);
            const sources = onDevice
                ? buildNoteSources(recent(allSearchable), question, { limit: 4, perNoteChars: 900, totalChars: 3200 })
                : buildNoteSources(recent(searchable), question, cutoff ? { limit: 10 } : undefined);
            if (sources.length === 0) {
                setMessages((prev) => [...prev, {
                    id: `a-${stamp}`,
                    role: 'assistant',
                    text: t('ask.noNotes', 'There are no notes to search yet.'),
                    sources: [],
                }]);
                return;
            }
            // Sources picked for on-device AI may include protected notes: keep the
            // answer on the phone even if the network returns meanwhile.
            const answer = await answerFromNotes(question, formatSourcesForModel(sources), { onDeviceOnly: onDevice });
            // Only list the notes the answer actually cites; fall back to all used.
            const cited = sources.filter((source) => answer.includes(`[${source.index}]`));
            setMessages((prev) => [...prev, {
                id: `a-${stamp}`,
                role: 'assistant',
                text: answer || t('ask.emptyAnswer', 'No answer came back. Try rephrasing the question.'),
                sources: cited.length > 0 ? cited : sources,
            }]);
        } catch (error) {
            // A used-up quota is answered here, in the chat (the request asks the
            // service not to open the limit sheet): the question must not just hang.
            if (getErrorMessage(error, '').toLowerCase().includes('usage limit')) {
                const reason = usageLimitReasonOf(error);
                const resetAt = user?.current_usage_period_end_at;
                const isPro = !!user?.is_pro || (user?.plan || '').trim().toLowerCase() === 'pro';
                const text = reason && reason !== LLM_LIMIT_REASON
                    ? t('ask.limitGeneric', 'A usage limit was reached, so this question was not answered. Try again later.')
                    : resetAt
                        ? t('ask.aiLimitDate', 'This month\'s AI allowance is used up, so this question was not answered. It resets on {{date}}.', {
                            date: new Date(resetAt).toLocaleDateString(),
                        })
                        : t('ask.aiLimit', 'This month\'s AI allowance is used up, so this question was not answered. It resets at the start of your next period.');
                setMessages((prev) => [...prev, { id: `l-${stamp}`, role: 'limit', text, upgrade: !isGuestUser && !isPro }]);
                return;
            }
            // Offline with cloud AI: point to the on-device model, which needs no network.
            const offline = isNetworkError(error) && !(await isOnDeviceAI().catch(() => false));
            setMessages((prev) => [...prev, {
                id: `e-${stamp}`,
                role: 'error',
                text: getErrorMessage(error, t('ask.failed', 'Could not get an answer. Check your connection and try again.')),
                offline,
            }]);
        } finally {
            setBusy(false);
        }
    }, [allSearchable, busy, checkAILocked, isGuestUser, searchable, t, user]);

    useEffect(() => {
        const initial = route.params?.question as string | undefined;
        // Wait for the local notes to load, or the question would find nothing.
        if (initial && !initialAskedRef.current && (isHydrated || allSearchable.length > 0)) {
            initialAskedRef.current = true;
            void ask(initial, { recentDays: route.params?.recentDays });
        }
    }, [allSearchable.length, ask, isHydrated, route.params?.question, route.params?.recentDays]);

    useEffect(() => {
        const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
        return () => clearTimeout(timer);
    }, [messages.length, busy]);

    const examples = [
        t('ask.example1', 'What did I plan for this week?'),
        t('ask.example2', 'Summarize my notes about work'),
        t('ask.example3', 'Which tasks are still open?'),
    ];

    return (
        <ScreenContainer>
            <View style={styles.header}>
                <TouchableOpacity
                    onPress={() => navigation.goBack()}
                    style={styles.iconButton}
                    activeOpacity={0.6}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={t('a11y.back', 'Back')}
                >
                    <MaterialIcons name="arrow-back" size={24} color={colors.text} style={rtlFlip} />
                </TouchableOpacity>
                {/* Once the chat starts, the large title has scrolled away: keep a small one. */}
                {messages.length > 0 && (
                    <Text style={styles.title} numberOfLines={1}>{t('ask.title', 'Ask your notes')}</Text>
                )}
            </View>

            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0}
            >
                <ScrollView
                    ref={scrollRef}
                    style={{ flex: 1 }}
                    contentContainerStyle={styles.messages}
                    keyboardShouldPersistTaps="handled"
                >
                    {messages.length === 0 && (
                        <View style={styles.empty}>
                            <Text style={styles.emptyHeading} accessibilityRole="header">{t('ask.title', 'Ask your notes')}</Text>
                            <Text style={styles.subtitle}>
                                {t('ask.subtitle', 'Answers from everything you have written down, with links to the notes.')}
                            </Text>
                            <Text style={styles.emptyTitle}>{t('ask.examplesLabel', 'Try asking')}</Text>
                            <View style={styles.examples}>
                                {examples.map((example, index) => (
                                    <TouchableOpacity
                                        key={example}
                                        style={[styles.example, index > 0 && styles.exampleDivided]}
                                        onPress={() => { if (aiLocked) setShowGate(true); else void ask(example); }}
                                        activeOpacity={0.6}
                                        accessibilityRole="button"
                                    >
                                        {/* Locked: still readable as examples, but plainly not ready to send. */}
                                        <Text style={[styles.exampleText, aiLocked && styles.exampleTextLocked]}>{example}</Text>
                                        <MaterialIcons name={aiLocked ? 'lock-outline' : 'arrow-upward'} size={18} color={colors.textTertiary} />
                                    </TouchableOpacity>
                                ))}
                            </View>
                            {/* How privacy works, as a footnote rather than the first thing said. */}
                            <View style={styles.privacyFootnote}>
                                <MaterialIcons name="lock-outline" size={14} color={colors.textTertiary} />
                                <Text style={styles.privacyFootnoteText}>
                                    {onDeviceAI
                                        ? t('ask.privacyNoteLocal', 'Runs entirely on this device, offline — nothing is sent anywhere.')
                                        : t('ask.privacyNote', 'Notes are searched on this device; only the matching excerpts are sent to AI.')}
                                </Text>
                            </View>
                        </View>
                    )}
                    {messages.map((message) => {
                        if (message.role === 'user') {
                            return (
                                <View key={message.id} style={styles.userBubble}>
                                    <Text style={styles.userText} selectable>{message.text}</Text>
                                </View>
                            );
                        }
                        if (message.role === 'limit') {
                            return (
                                <View key={message.id} style={styles.limitBubble}>
                                    <View style={styles.limitRow}>
                                        <MaterialIcons name="auto-awesome" size={18} color={colors.primary} />
                                        <Text style={styles.limitText}>{message.text}</Text>
                                    </View>
                                    {(message.upgrade || canSetUpOnDevice) && (
                                        <View style={styles.limitActions}>
                                            {canSetUpOnDevice && (
                                                <TouchableOpacity
                                                    style={styles.limitSecondary}
                                                    onPress={() => navigation.navigate('Settings', { section: 'voice' })}
                                                    accessibilityRole="button"
                                                >
                                                    <Text style={styles.limitSecondaryText}>{t('alerts.aiSetUpOnDevice', 'Set up AI on this device')}</Text>
                                                </TouchableOpacity>
                                            )}
                                            {message.upgrade && (
                                                <TouchableOpacity
                                                    style={styles.signInButton}
                                                    onPress={() => navigation.navigate('Paywall')}
                                                    accessibilityRole="button"
                                                >
                                                    <Text style={styles.signInText}>{t('aux.upgrade', 'Upgrade')}</Text>
                                                </TouchableOpacity>
                                            )}
                                        </View>
                                    )}
                                </View>
                            );
                        }
                        if (message.role === 'error') {
                            return (
                                <View key={message.id} style={styles.errorBubble}>
                                    <MaterialIcons name="error-outline" size={18} color={colors.error} />
                                    <Text style={styles.errorText}>
                                        {message.text}
                                        {message.offline ? (
                                            <Text style={styles.errorHint}>{`\n${t('ask.offlineHint', 'AI on this device works without internet.')}`}</Text>
                                        ) : null}
                                    </Text>
                                    {message.offline && (
                                        <TouchableOpacity
                                            style={styles.signInButton}
                                            onPress={() => navigation.navigate('Settings')}
                                            accessibilityRole="button"
                                        >
                                            <Text style={styles.signInText}>{t('ask.setUpOnDevice', 'Set up')}</Text>
                                        </TouchableOpacity>
                                    )}
                                </View>
                            );
                        }
                        return (
                            <View key={message.id} style={styles.answer}>
                                <MarkdownPreview content={message.text} fontSize={15} selectable />
                                {message.sources.length > 0 && (
                                    <View style={styles.sources}>
                                        {message.sources.map((source) => (
                                            <TouchableOpacity
                                                key={source.id}
                                                style={styles.sourceChip}
                                                onPress={() => navigation.navigate('NoteEdit', { noteId: source.id })}
                                                hitSlop={{ top: 6, bottom: 6 }}
                                                accessibilityRole="link"
                                            >
                                                <Text style={styles.sourceIndex}>{source.index}</Text>
                                                <Text style={styles.sourceTitle} numberOfLines={1}>
                                                    {source.title || t('ask.untitled', 'Untitled')}
                                                </Text>
                                            </TouchableOpacity>
                                        ))}
                                    </View>
                                )}
                            </View>
                        );
                    })}
                    {busy && (
                        <View style={styles.thinking}>
                            <ActivityIndicator size="small" color={colors.primary} />
                            <Text style={styles.thinkingText}>{t('ask.thinking', 'Looking through your notes…')}</Text>
                        </View>
                    )}
                </ScrollView>

                <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, spacing.s) }]}>
                    {aiLocked ? (
                        <TouchableOpacity
                            style={[styles.input, styles.lockedInput]}
                            onPress={() => setShowGate(true)}
                            activeOpacity={0.7}
                            accessibilityRole="button"
                        >
                            <MaterialIcons name="lock-outline" size={18} color={colors.textTertiary} />
                            <Text style={styles.lockedInputText} numberOfLines={1}>
                                {t('ask.lockedPlaceholder', 'Sign in or set up AI to ask')}
                            </Text>
                        </TouchableOpacity>
                    ) : (
                        <>
                            <TextInput
                                style={styles.input}
                                value={input}
                                onChangeText={setInput}
                                placeholder={t('ask.placeholder', 'Ask a question…')}
                                placeholderTextColor={colors.textTertiary}
                                multiline
                                maxLength={500}
                                onSubmitEditing={() => { void ask(input); }}
                                blurOnSubmit
                                returnKeyType="send"
                            />
                            <TouchableOpacity
                                style={[styles.sendButton, (!input.trim() || busy) && styles.sendButtonDisabled]}
                                onPress={() => { void ask(input); }}
                                disabled={!input.trim() || busy}
                                accessibilityRole="button"
                                accessibilityLabel={t('ask.send', 'Ask')}
                            >
                                <MaterialIcons name="arrow-upward" size={22} color={colors.onPrimary} />
                            </TouchableOpacity>
                        </>
                    )}
                </View>
            </KeyboardAvoidingView>
            <SignInRequiredModal
                visible={showGate}
                title={t('alerts.aiLockedTitle', 'Sign in to use AI')}
                message={t('ask.gateText', 'Ask your notes works with a free account, or with AI that runs on this device — offline and private.')}
                onClose={() => setShowGate(false)}
                onSignIn={() => {
                    setShowGate(false);
                    navigation.navigate('SignIn');
                }}
                secondaryLabel={canSetUpOnDevice ? t('alerts.aiSetUpOnDevice', 'Set up AI on this device') : undefined}
                onSecondary={() => {
                    setShowGate(false);
                    navigation.navigate('Settings', { section: 'voice' });
                }}
            />
            <LimitModal />
        </ScreenContainer>
    );
};

const styles = createStyles(() => ({
    header: {
        width: '100%',
        maxWidth: 760,
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        paddingTop: spacing.s,
        height: 52,
    },
    iconButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        marginStart: -spacing.s,
    },
    title: {
        flex: 1,
        fontSize: 17,
        fontWeight: '600',
        color: colors.text,
    },
    subtitle: {
        fontSize: 15,
        lineHeight: 21,
        color: colors.textSecondary,
    },
    messages: {
        width: '100%',
        maxWidth: 760,
        alignSelf: 'center',
        paddingVertical: spacing.m,
        gap: spacing.m,
        flexGrow: 1,
    },
    empty: {
        gap: spacing.xs,
    },
    emptyHeading: {
        fontSize: 32,
        lineHeight: 38,
        fontWeight: '700',
        letterSpacing: -0.8,
        color: colors.text,
    },
    emptyTitle: {
        fontSize: 13,
        lineHeight: 18,
        color: colors.textSecondary,
        marginTop: spacing.l,
        marginBottom: spacing.xxs,
        paddingHorizontal: spacing.xs,
    },
    privacyFootnote: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.xs,
        marginTop: spacing.m,
        paddingHorizontal: spacing.xs,
    },
    privacyFootnoteText: {
        flex: 1,
        fontSize: 13,
        lineHeight: 18,
        color: colors.textTertiary,
    },
    examples: {
        borderRadius: 16,
        backgroundColor: colors.surface,
        borderWidth: isDarkScheme() ? 0 : StyleSheet.hairlineWidth,
        borderColor: colors.border,
        overflow: 'hidden',
    },
    example: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
        minHeight: 52,
        paddingVertical: 12,
        paddingHorizontal: spacing.m,
    },
    exampleDivided: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: colors.border,
    },
    exampleText: {
        flex: 1,
        fontSize: 16,
        lineHeight: 22,
        color: colors.text,
    },
    exampleTextLocked: {
        color: colors.textTertiary,
    },
    userBubble: {
        alignSelf: 'flex-end',
        maxWidth: '85%',
        backgroundColor: colors.primary,
        borderRadius: 18,
        borderBottomRightRadius: 4,
        paddingVertical: 10,
        paddingHorizontal: 14,
    },
    userText: {
        color: colors.onPrimary,
        fontSize: 15,
        lineHeight: 21,
    },
    answer: {
        alignSelf: 'stretch',
        backgroundColor: colors.surface,
        borderRadius: 16,
        borderWidth: isDarkScheme() ? 0 : StyleSheet.hairlineWidth,
        borderColor: colors.border,
        padding: spacing.m,
    },
    sources: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.xs,
        marginTop: spacing.s,
    },
    sourceChip: {
        flexDirection: 'row',
        alignItems: 'center',
        maxWidth: '100%',
        minHeight: 36,
        gap: 6,
        paddingVertical: 6,
        paddingLeft: 8,
        paddingRight: 12,
        borderRadius: 18,
        backgroundColor: colors.backgroundSecondary,
    },
    sourceIndex: {
        minWidth: 20,
        height: 20,
        borderRadius: 10,
        textAlign: 'center',
        fontSize: 12,
        lineHeight: 20,
        fontWeight: '700',
        color: colors.onPrimary,
        backgroundColor: colors.primary,
        overflow: 'hidden',
    },
    sourceTitle: {
        flexShrink: 1,
        fontSize: 13,
        color: colors.text,
    },
    errorBubble: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
        padding: spacing.m,
        borderRadius: 12,
        backgroundColor: colors.errorLight,
    },
    errorHint: {
        color: colors.textSecondary,
    },
    limitBubble: {
        gap: spacing.m,
        padding: spacing.m,
        borderRadius: 12,
        backgroundColor: colors.backgroundSecondary,
        borderWidth: 1,
        borderColor: colors.border,
    },
    limitRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.s,
    },
    limitText: {
        flex: 1,
        color: colors.text,
        fontSize: 14,
        lineHeight: 20,
    },
    limitActions: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'flex-end',
        alignItems: 'center',
        gap: spacing.s,
    },
    limitSecondary: {
        minHeight: 48,
        justifyContent: 'center',
        paddingHorizontal: spacing.s,
    },
    limitSecondaryText: {
        color: colors.primary,
        fontSize: 14,
        fontWeight: '600',
    },
    errorText: {
        flex: 1,
        color: colors.error,
        fontSize: 14,
    },
    signInButton: {
        minHeight: 48,
        justifyContent: 'center',
        paddingHorizontal: spacing.m,
        marginVertical: -spacing.s,
        borderRadius: 24,
        backgroundColor: colors.primary,
    },
    signInText: {
        color: colors.onPrimary,
        fontSize: 14,
        fontWeight: '600',
    },
    thinking: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
        paddingHorizontal: spacing.s,
    },
    thinkingText: {
        fontSize: 14,
        color: colors.textSecondary,
    },
    inputBar: {
        width: '100%',
        maxWidth: 760,
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: spacing.s,
        paddingTop: spacing.s,
    },
    input: {
        flex: 1,
        maxHeight: 120,
        minHeight: 48,
        borderRadius: 24,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: isDarkScheme() ? colors.surface : colors.border,
        backgroundColor: colors.surface,
        paddingHorizontal: spacing.m,
        paddingVertical: 10,
        fontSize: 15,
        color: colors.text,
    },
    sendButton: {
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.primary,
    },
    sendButtonDisabled: {
        opacity: 0.4,
    },
    lockedInput: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
    },
    lockedInputText: {
        flex: 1,
        fontSize: 15,
        color: colors.textTertiary,
    },
}));
