import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Pressable, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Note } from '../api/notes';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { deriveAutoTitleFromPlainText, hasMeaningfulRichContent, richContentToPlainText, richContentToPreviewText } from '../utils/richContent';
import { stripStoredTitleMarkdown } from '../utils/markdownUtils';
import { useEncryption } from '../context/EncryptionContext';
import { isMasterCiphertext } from '../crypto/encryption';
import { plainVariantTitle, userVariantName } from '../i18n/variantLabels';
import { createStyles } from '../theme/createStyles';
import { textAlignFor } from '../i18n/direction';
import { splitTags } from '../utils/tags';
import { getAudioEmbedAttributesFromHtml } from '../utils/audioEmbeds';

const VOICE_WAVE = [6, 12, 8, 16, 10, 14, 6, 18, 9, 13, 7, 15, 8, 11, 5, 12, 9, 6];

/** Length of the first audio card embedded in the note, if any. */
const embeddedAudioDuration = (content: string): number | undefined => {
    const tag = content.match(/<img\b[^>]*>/i)?.[0];
    return tag ? getAudioEmbedAttributesFromHtml(tag)?.duration ?? undefined : undefined;
};

const formatVoiceDuration = (seconds?: number | null): string => {
    if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return '';
    const total = Math.round(seconds);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

interface NoteCardProps {
    note: Note;
    onPress: () => void;
    onLongPress?: () => void;
    isSelectionMode?: boolean;
    isSelected?: boolean;
}

export const NoteCard = ({ note, onPress, onLongPress, isSelectionMode = false, isSelected = false }: NoteCardProps) => {
    const { t, i18n } = useTranslation();
    // Dates follow the app language, not the device's.
    const dateLocale = i18n.language || undefined;
    const { mode } = useEncryption();
    const activeChild = note.improvements?.find(imp => imp.is_active);
    // AI-written titles can still carry markdown; a card renders plain text.
    // A name the user gave a version labels that version, not the note.
    const activeChildTitle = userVariantName(activeChild?.title)
        ? ''
        : stripStoredTitleMarkdown(plainVariantTitle(activeChild?.title));
    let content = note.content || '';
    const storageScope = note.storage_scope ?? 'sync';
    
    // Logic for showing the lock icon:
    // 1. If we are in E2EE mode, all synced notes are protected.
    // 2. If we are in Local mode, we only show it as a warning if the content itself is still encrypted with a Master Key.
    const isEncrypted = (mode === 'e2ee' && storageScope === 'sync') || 
                       (typeof content === 'string' && isMasterCiphertext(content)) ||
                       (typeof note.title === 'string' && isMasterCiphertext(note.title));

    // Check if there is an active improvement (active child note)
    if (note.improvements && note.improvements.length > 0) {
        if (activeChild && activeChild.content) {
            content = activeChild.content;
        }
    }

    // Determine if audio is present (flag or check content)
    const hasAudio = note.has_audio || /!\[audio\]\(.*?\)/.test(content);

    const plainContent = richContentToPlainText(content);

    const buildTitle = () => {
        // The note keeps one title across its versions; a version's own title
        // is only used when the note has none.
        if (note.title && note.title.trim().length > 0) return stripStoredTitleMarkdown(note.title);
        if (activeChildTitle) return activeChildTitle;

        return deriveAutoTitleFromPlainText(plainContent);
    };

    // Extract title
    const title = buildTitle();

    // Line breaks and checklist state survive, so a list reads as a list.
    const fullPreview = richContentToPreviewText(content);
    // An untitled note's title is its first line; don't print that line twice.
    const hasStoredTitle = !!activeChildTitle || !!note.title?.trim();
    // Untitled notes show their text, as Keep does: a title derived from the
    // first line would only repeat it.
    const titleIsCutFirstLine = !hasStoredTitle && !!fullPreview.trim();
    const previewString = fullPreview;

    // Format date nicely
    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        const now = new Date();

        const isToday = date.getDate() === now.getDate() &&
            date.getMonth() === now.getMonth() &&
            date.getFullYear() === now.getFullYear();

        const isThisYear = date.getFullYear() === now.getFullYear();

        if (isToday) {
            return date.toLocaleTimeString(dateLocale, {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });
        } else if (isThisYear) {
            return date.toLocaleDateString(dateLocale, {
                day: 'numeric',
                month: 'short'
            });
        } else {
            return date.toLocaleDateString(dateLocale, {
                day: 'numeric',
                month: 'short',
                year: 'numeric'
            });
        }
    };

    const isEmpty = !title && !hasMeaningfulRichContent(content);
    const isVoiceOnly = !title && !!hasAudio;
    const voiceDuration = isVoiceOnly ? formatVoiceDuration(note.audio_duration ?? embeddedAudioDuration(content)) : '';

    // The card sinks slightly under the finger, like Keep and Apple Notes.
    const pressScale = useRef(new Animated.Value(1)).current;
    const animatePress = (toValue: number) => {
        Animated.spring(pressScale, { toValue, useNativeDriver: true, speed: 40, bounciness: 4 }).start();
    };

    return (
        <Pressable
            onPress={onPress}
            onLongPress={onLongPress}
            delayLongPress={350}
            onPressIn={() => animatePress(0.97)}
            onPressOut={() => animatePress(1)}
            accessibilityRole="button"
            accessibilityState={isSelectionMode ? { selected: isSelected } : undefined}
        >
        <Animated.View style={[styles.card, isSelected && styles.selectedCard, { transform: [{ scale: pressScale }] }]}>
            {isSelectionMode && (
                <View style={styles.selectionIndicator}>
                    <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                        {isSelected && (
                            <MaterialIcons name="check" size={16} color={colors.onPrimary} />
                        )}
                    </View>
                </View>
            )}
            <View style={styles.content}>
                {isVoiceOnly ? (
                    // A recording without text yet: show it as audio (icon, wave,
                    // length) instead of a placeholder title in any language.
                    <View
                        style={[styles.voiceRow, isSelectionMode && { paddingEnd: 28 }]}
                        accessible
                        accessibilityLabel={[t("notes.voiceRecording"), voiceDuration].filter(Boolean).join(', ')}
                    >
                        <View style={styles.voiceIcon}>
                            <MaterialIcons name="mic" size={18} color={colors.primary} />
                        </View>
                        <View style={styles.voiceWave}>
                            {VOICE_WAVE.map((height, index) => (
                                <View key={index} style={[styles.voiceBar, { height }]} />
                            ))}
                        </View>
                        {voiceDuration ? <Text style={styles.voiceDuration}>{voiceDuration}</Text> : null}
                    </View>
                ) : titleIsCutFirstLine ? null : (
                    <Text style={[styles.title, textAlignFor(title), isSelectionMode && { paddingEnd: 28 }]} numberOfLines={2}>
                        {title || ' '}
                    </Text>
                )}
                {(!isEmpty && previewString && (titleIsCutFirstLine || previewString !== title)) && (
                    <Text
                        style={[
                            styles.preview,
                            titleIsCutFirstLine && styles.previewLead,
                            textAlignFor(previewString),
                            titleIsCutFirstLine && isSelectionMode && { paddingEnd: 28 },
                        ]}
                        numberOfLines={titleIsCutFirstLine ? 8 : 6}
                    >
                        {splitTags(previewString).map((part, index) => (
                            part.tag
                                ? <Text key={index} style={styles.tagText}>{part.text}</Text>
                                : part.text
                        ))}
                    </Text>
                )}
            </View>
            <View style={styles.footer}>
                <Text style={styles.date}>
                    {formatDate(note.updated_at || note.created_at || '')}
                </Text>
                <View style={styles.iconsRow}>
                    {!!hasAudio && !isVoiceOnly && (
                        <MaterialIcons name="mic" size={16} color={colors.textTertiary} />
                    )}
                    {note.is_protected ? (
                        <MaterialIcons name="shield" size={14} color={colors.primary} style={{ marginLeft: 4 }} accessibilityLabel={t("a11y.protected", "Protected note")} />
                    ) : !!isEncrypted && (
                        <MaterialIcons name="lock" size={14} color={colors.primary} style={{ marginLeft: 4 }} accessibilityLabel={t("a11y.encrypted", "End-to-end encrypted")} />
                    )}
                    {storageScope === 'local_only' && (
                        <MaterialIcons name="smartphone" size={14} color={colors.textSecondary} style={{ marginLeft: 4 }} accessibilityLabel={t("a11y.onThisPhoneOnly", "Only on this phone")} />
                    )}
                    {!!note.is_pinned && (
                        <MaterialIcons name="push-pin" size={14} color={colors.primary} style={{ marginLeft: 4 }} />
                    )}
                </View>
            </View>
        </Animated.View>
        </Pressable>
    );
};

const styles = createStyles(() => ({
    card: {
        backgroundColor: colors.surface,
        borderRadius: 16,
        marginBottom: spacing.m,
        // Soft shadow
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 3,
        position: 'relative',
    },
    selectedCard: {
        borderWidth: 2,
        borderColor: colors.primary,
        backgroundColor: colors.surface,
    },
    selectionIndicator: {
        position: 'absolute',
        top: spacing.s,
        right: spacing.s,
        zIndex: 10,
    },
    checkbox: {
        width: 24,
        height: 24,
        borderRadius: 12,
        borderWidth: 2,
        borderColor: colors.border,
        backgroundColor: colors.background,
        justifyContent: 'center',
        alignItems: 'center',
    },
    checkboxSelected: {
        backgroundColor: colors.primary,
        borderColor: colors.primary,
    },
    content: {
        padding: spacing.m,
        paddingBottom: spacing.s,
    },
    title: {
        fontSize: 18,
        fontWeight: '700',
        marginBottom: spacing.xs,
        color: colors.text,
        lineHeight: 24,
    },
    preview: {
        fontSize: 14,
        lineHeight: 20,
        color: colors.textSecondary,
    },
    tagText: {
        color: colors.primary,
    },
    // Untitled note shown as its text: a touch larger and in the text colour.
    previewLead: {
        fontSize: 15,
        lineHeight: 21,
        color: colors.text,
    },
    footer: {
        paddingHorizontal: spacing.m,
        paddingBottom: spacing.m,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    iconsRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    date: {
        fontSize: 12,
        color: colors.textTertiary,
        fontWeight: '500',
    },
    voiceRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
        paddingVertical: 2,
    },
    voiceIcon: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.primaryLight,
    },
    voiceWave: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        height: 22,
        overflow: 'hidden',
    },
    voiceBar: {
        width: 3,
        borderRadius: 2,
        backgroundColor: colors.textTertiary,
    },
    voiceDuration: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.text,
        fontVariant: ['tabular-nums'],
    },
}));
