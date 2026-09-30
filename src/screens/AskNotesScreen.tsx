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
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenContainer } from '../components/ScreenContainer';
import { MarkdownPreview } from '../components/MarkdownPreview';
import { LimitModal } from '../components/LimitModal';
import { useNotesContext } from '../contexts/NotesContext';
import { answerFromNotes } from '../services/AIService';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { deriveAutoTitleFromPlainText, richContentToPlainText } from '../utils/richContent';
import { buildNoteSources, formatSourcesForModel, NoteSource, SearchableNote } from '../utils/noteSearch';
import { getAIProvider, getPrivateAIAllowed } from '../utils/storage';
import { useAuth } from '../hooks/useAuth';
import { getErrorMessage } from '../utils/errorMessage';
import { stripStoredTitleMarkdown } from '../utils/markdownUtils';

type Message =
    | { id: string; role: 'user'; text: string }
    | { id: string; role: 'assistant'; text: string; sources: NoteSource[] }
    | { id: string; role: 'error'; text: string; signIn?: boolean };

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
    const { isAuthenticated, isGuest } = useAuth();
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState<Message[]>([]);
    const [busy, setBusy] = useState(false);
    const [privateAllowed, setPrivateAllowed] = useState(false);
    const scrollRef = useRef<ScrollView>(null);
    const initialAskedRef = useRef(false);

    useEffect(() => {
        void getPrivateAIAllowed().then(setPrivateAllowed).catch(() => setPrivateAllowed(false));
    }, []);

    const searchable = useMemo<SearchableNote[]>(() => (getAllNotes().length > 0 ? getAllNotes() : notes || [])
        .filter((note: any) => !note.deleted && !note.pending_delete && note.privacy !== 'hidden')
        .filter((note: any) => privateAllowed || note.storage_scope !== 'local_only')
        .map((note: any) => {
            const active = (note.improvements || []).find((imp: any) => imp.is_active && !imp.deleted);
            const text = richContentToPlainText(active?.content ?? note.content ?? '');
            // Same title the note card shows.
            const title = stripStoredTitleMarkdown(note.title || '').trim() || deriveAutoTitleFromPlainText(text);
            return { id: note.id, title, text, updatedAt: note.updated_at };
        })
        .filter((note) => note.text.trim().length > 0), [getAllNotes, notes, privateAllowed]);

    const ask = useCallback(async (raw: string) => {
        const question = raw.trim();
        if (!question || busy) return;
        setInput('');
        const stamp = `${Date.now()}`;
        setMessages((prev) => [...prev, { id: `q-${stamp}`, role: 'user', text: question }]);
        setBusy(true);
        try {
            // Vaulto AI answers signed-in users only (the server rejects guests).
            if ((!isAuthenticated || isGuest) && (await getAIProvider()) === 'vaulto_ai') {
                setMessages((prev) => [...prev, {
                    id: `e-${stamp}`,
                    role: 'error',
                    text: t('ask.signInRequired', 'Sign in to ask AI about your notes.'),
                    signIn: true,
                }]);
                return;
            }
            const sources = buildNoteSources(searchable, question);
            if (sources.length === 0) {
                setMessages((prev) => [...prev, {
                    id: `a-${stamp}`,
                    role: 'assistant',
                    text: t('ask.noNotes', 'There are no notes to search yet.'),
                    sources: [],
                }]);
                return;
            }
            const answer = await answerFromNotes(question, formatSourcesForModel(sources));
            // Only list the notes the answer actually cites; fall back to all used.
            const cited = sources.filter((source) => answer.includes(`[${source.index}]`));
            setMessages((prev) => [...prev, {
                id: `a-${stamp}`,
                role: 'assistant',
                text: answer || t('ask.emptyAnswer', 'No answer came back. Try rephrasing the question.'),
                sources: cited.length > 0 ? cited : sources,
            }]);
        } catch (error) {
            // The limit modal explains a used-up quota; no raw error bubble on top of it.
            if (getErrorMessage(error, '').toLowerCase().includes('usage limit')) return;
            setMessages((prev) => [...prev, {
                id: `e-${stamp}`,
                role: 'error',
                text: getErrorMessage(error, t('ask.failed', 'Could not get an answer. Check your connection and try again.')),
            }]);
        } finally {
            setBusy(false);
        }
    }, [busy, isAuthenticated, isGuest, searchable, t]);

    useEffect(() => {
        const initial = route.params?.question as string | undefined;
        // Wait for the local notes to load, or the question would find nothing.
        if (initial && !initialAskedRef.current && (isHydrated || searchable.length > 0)) {
            initialAskedRef.current = true;
            void ask(initial);
        }
    }, [ask, isHydrated, route.params?.question, searchable.length]);

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
                    accessibilityRole="button"
                    accessibilityLabel={t('a11y.back', 'Back')}
                >
                    <MaterialIcons name="arrow-back" size={26} color={colors.text} />
                </TouchableOpacity>
                <View style={styles.headerText}>
                    <Text style={styles.title}>{t('ask.title', 'Ask your notes')}</Text>
                    <Text style={styles.subtitle} numberOfLines={2}>
                        {t('ask.privacyNote', 'Notes are searched on this device; only the matching excerpts are sent to AI.')}
                    </Text>
                </View>
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
                            <View style={styles.emptyIcon}>
                                <MaterialIcons name="auto-awesome" size={28} color={colors.primary} />
                            </View>
                            <Text style={styles.emptyTitle}>{t('ask.emptyTitle', 'Ask anything about your notes')}</Text>
                            {examples.map((example) => (
                                <TouchableOpacity
                                    key={example}
                                    style={styles.example}
                                    onPress={() => { void ask(example); }}
                                    accessibilityRole="button"
                                >
                                    <Text style={styles.exampleText}>{example}</Text>
                                </TouchableOpacity>
                            ))}
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
                        if (message.role === 'error') {
                            return (
                                <View key={message.id} style={styles.errorBubble}>
                                    <MaterialIcons name={message.signIn ? 'lock-outline' : 'error-outline'} size={18} color={colors.error} />
                                    <Text style={styles.errorText}>{message.text}</Text>
                                    {message.signIn && (
                                        <TouchableOpacity
                                            style={styles.signInButton}
                                            onPress={() => navigation.navigate('SignIn')}
                                            accessibilityRole="button"
                                        >
                                            <Text style={styles.signInText}>{t('ask.signIn', 'Sign in')}</Text>
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
                        <MaterialIcons name="arrow-upward" size={22} color={colors.surface} />
                    </TouchableOpacity>
                </View>
            </KeyboardAvoidingView>
            <LimitModal />
        </ScreenContainer>
    );
};

const styles = StyleSheet.create({
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: spacing.s,
        gap: spacing.s,
    },
    iconButton: {
        width: 48,
        height: 48,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: -spacing.s,
    },
    headerText: {
        flex: 1,
    },
    title: {
        fontSize: 20,
        fontWeight: '700',
        color: colors.text,
    },
    subtitle: {
        fontSize: 12,
        color: colors.textSecondary,
        marginTop: 2,
    },
    messages: {
        paddingVertical: spacing.m,
        gap: spacing.m,
        flexGrow: 1,
    },
    empty: {
        alignItems: 'center',
        paddingTop: spacing.xl,
        gap: spacing.s,
    },
    emptyIcon: {
        width: 56,
        height: 56,
        borderRadius: 28,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.primaryLight,
        marginBottom: spacing.s,
    },
    emptyTitle: {
        fontSize: 17,
        fontWeight: '600',
        color: colors.text,
        marginBottom: spacing.s,
    },
    example: {
        minHeight: 48,
        justifyContent: 'center',
        paddingVertical: 10,
        paddingHorizontal: spacing.m,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
    },
    exampleText: {
        fontSize: 14,
        color: colors.text,
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
        color: colors.surface,
        fontSize: 15,
        lineHeight: 21,
    },
    answer: {
        alignSelf: 'stretch',
        backgroundColor: colors.surface,
        borderRadius: 16,
        borderWidth: 1,
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
        color: colors.surface,
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
        backgroundColor: 'rgba(220, 53, 69, 0.08)',
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
        borderRadius: 12,
        backgroundColor: colors.primary,
    },
    signInText: {
        color: colors.surface,
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
        borderWidth: 1,
        borderColor: colors.border,
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
});
