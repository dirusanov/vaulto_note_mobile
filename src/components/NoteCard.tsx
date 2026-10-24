import React, { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Note } from '../api/notes';
import { colors, isDarkScheme } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { deriveAutoTitleFromPlainText, hasMeaningfulRichContent, richContentToPlainText, richContentToPreviewText } from '../utils/richContent';
import { stripStoredTitleMarkdown } from '../utils/markdownUtils';
import { useEncryption } from '../context/EncryptionContext';
import { isMasterCiphertext } from '../crypto/encryption';
import { plainVariantTitle, userVariantName } from '../i18n/variantLabels';
import { createStyles } from '../theme/createStyles';
import { textAlignFor } from '../i18n/direction';
import { splitTags } from '../utils/tags';
import { contentDateOf } from '../utils/contentDate';
import { getAudioEmbedAttributesFromHtml } from '../utils/audioEmbeds';
import { DRAWING_MARKER, firstDrawingSvg } from '../drawing/drawingFormat';
import { DrawingThumbnail } from '../drawing/DrawingThumbnail';
import { CHECKED_LINE, layoutCardPreview, uncheckedFirst } from '../utils/cardPreview';

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
    
    // With end-to-end encryption on, every synced note is encrypted: a lock on
    // each card says nothing new. Settings shows that state once. The lock
    // stays for content still sealed with a master key (it cannot be read yet).
    const isEncrypted = mode !== 'e2ee' && (
        (typeof content === 'string' && isMasterCiphertext(content)) ||
        (typeof note.title === 'string' && isMasterCiphertext(note.title)));

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

    // Line breaks and checklist state survive, so a list reads as a list. A
    // checklist with ticked items is read further, so moving those items to
    // the end does not hide unticked ones that come after them.
    const basePreview = richContentToPreviewText(content);
    const fullPreview = basePreview.includes('☑')
        ? uncheckedFirst(richContentToPreviewText(content, 40, 1200))
        : basePreview;
    // An untitled note's title is its first line; don't print that line twice.
    const hasStoredTitle = !!activeChildTitle || !!note.title?.trim();
    // Every card reads the same way: a bold first line, then grey text. An
    // untitled note's first line takes the title's place; an untitled
    // checklist shows only its items.
    const { mode: previewMode, leadLine, previewString } = layoutCardPreview(fullPreview, title, hasStoredTitle);
    const titleIsCutFirstLine = previewMode === 'lead';
    const isChecklistOnly = previewMode === 'list';

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

    // Ticked items past the card's lines fold into "+N checked", like Keep.
    const previewLineBudget = titleIsCutFirstLine || isChecklistOnly ? 5 : 4;
    const previewLines = previewString ? previewString.split('\n') : [];
    const hiddenLines = previewLines.slice(previewLineBudget - 1);
    const foldedChecked = previewLines.length > previewLineBudget
        && hiddenLines.every(line => CHECKED_LINE.test(line))
        ? hiddenLines.length
        : 0;
    const shownPreviewLines = foldedChecked ? previewLines.slice(0, previewLineBudget - 1) : previewLines;

    /** A preview line with its #tags coloured; a ticked item is struck through and muted. */
    const renderLine = (line: string, key: string | number) => {
        const checked = line.match(CHECKED_LINE);
        const body = checked ? checked[3] : line;
        const parts = splitTags(body).map((part, index) => (
            part.tag
                ? <Text key={index} style={styles.tagText}>{part.text}</Text>
                : part.text
        ));
        if (!checked) return <React.Fragment key={key}>{parts}</React.Fragment>;
        return (
            <Text key={key} style={styles.checkedItem}>
                {checked[1]}{checked[2]}<Text style={styles.checkedItemText}>{parts}</Text>
            </Text>
        );
    };

    const isEmpty = !title && !hasMeaningfulRichContent(content);
    const isVoiceOnly = !title && !!hasAudio;
    // A handwritten note has no text to show: say what it is instead of an empty card.
    const hasDrawing = content.includes(DRAWING_MARKER);
    const isDrawingOnly = !isVoiceOnly && hasDrawing && !title && !fullPreview.trim();
    // A thumbnail shows what is drawn; the stored preview picture is reused.
    const drawingSvg = useMemo(() => (hasDrawing ? firstDrawingSvg(content) : null), [hasDrawing, content]);
    const voiceDuration = hasAudio ? formatVoiceDuration(note.audio_duration ?? embeddedAudioDuration(content)) : '';

    // When the text last changed, not when it was last pinned or switched.
    const dateLabel = formatDate(contentDateOf(note));
    const voiceLabel = [t('notes.voiceRecording'), voiceDuration].filter(Boolean).join(', ');
    // Read aloud without the box glyphs; a ticked item says so.
    const spokenLine = (line: string) => {
        const text = line.replace(/^\s*[☐☑]\s*/, '').trim();
        return CHECKED_LINE.test(line) ? `${text}, ${t('a11y.checked', 'checked')}` : text;
    };
    // One spoken summary for the whole card: what it is first ("Voice
    // recording, 0:18", "Drawing" or its text), then its date and badges.
    const cardLabel = [
        isVoiceOnly ? voiceLabel : isDrawingOnly ? t('notes.drawing', 'Drawing') : isChecklistOnly ? '' : spokenLine(titleIsCutFirstLine ? leadLine : title),
        !isEmpty && previewString && (titleIsCutFirstLine || isChecklistOnly || previewString !== title)
            ? shownPreviewLines.map(spokenLine).filter(Boolean).join(', ').slice(0, 200)
            : '',
        foldedChecked ? t('notes.checkedMore', '+{{count}} checked', { count: foldedChecked }) : '',
        hasAudio && !isVoiceOnly ? voiceLabel : '',
        hasDrawing && !isDrawingOnly ? t('notes.drawing', 'Drawing') : '',
        dateLabel,
        note.is_protected ? t('a11y.protected', 'Protected note') : isEncrypted ? t('a11y.encrypted', 'End-to-end encrypted') : '',
        storageScope === 'local_only' ? t('a11y.onThisPhoneOnly', 'Only on this device') : '',
        note.is_pinned ? t('a11y.pinned', 'Pinned') : '',
    ].map(part => part.trim()).filter(Boolean).join(', ');

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
            onPressIn={() => animatePress(0.98)}
            onPressOut={() => animatePress(1)}
            accessibilityRole="button"
            accessibilityLabel={cardLabel}
            accessibilityState={isSelectionMode ? { selected: isSelected } : undefined}
        >
        <Animated.View style={[styles.card, { transform: [{ scale: pressScale }] }]}>
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
                        accessibilityLabel={voiceLabel}
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
                ) : isDrawingOnly && drawingSvg ? (
                    // Full width in selection mode too: the checkbox sits over its corner
                    // instead of narrowing (and re-cropping) the picture.
                    <View accessible accessibilityLabel={t('notes.drawing', 'Drawing')}>
                        <DrawingThumbnail svg={drawingSvg} />
                    </View>
                ) : isDrawingOnly ? (
                    <View style={[styles.voiceRow, isSelectionMode && { paddingEnd: 28 }]}>
                        <View style={styles.voiceIcon}>
                            <MaterialIcons name="gesture" size={18} color={colors.primary} />
                        </View>
                        <Text style={styles.drawingLabel}>{t('notes.drawing', 'Drawing')}</Text>
                    </View>
                ) : titleIsCutFirstLine ? (
                    <Text style={[styles.title, textAlignFor(leadLine), isSelectionMode && { paddingEnd: 28 }]} numberOfLines={3}>
                        {renderLine(leadLine, 'lead')}
                    </Text>
                ) : isChecklistOnly ? null : (
                    <Text style={[styles.title, textAlignFor(title), isSelectionMode && { paddingEnd: 28 }]} numberOfLines={2}>
                        {title || ' '}
                    </Text>
                )}
                {(!isEmpty && previewString && (titleIsCutFirstLine || isChecklistOnly || previewString !== title)) && (
                    <>
                        <Text
                            style={[styles.preview, isChecklistOnly && styles.checklistPreview, textAlignFor(previewString), isChecklistOnly && isSelectionMode && { paddingEnd: 28 }]}
                            numberOfLines={foldedChecked ? previewLineBudget - 1 : previewLineBudget}
                        >
                            {shownPreviewLines.map((line, index) => (
                                <React.Fragment key={index}>
                                    {index > 0 ? '\n' : null}
                                    {renderLine(line, index)}
                                </React.Fragment>
                            ))}
                        </Text>
                        {foldedChecked > 0 && (
                            <Text style={[styles.preview, styles.checkedMore, textAlignFor(previewString)]} numberOfLines={1}>
                                {t('notes.checkedMore', '+{{count}} checked', { count: foldedChecked })}
                            </Text>
                        )}
                    </>
                )}
                {drawingSvg && !isDrawingOnly && <DrawingThumbnail svg={drawingSvg} />}
            </View>
            <View style={styles.footer}>
                <Text style={styles.date}>{dateLabel}</Text>
                <View style={styles.iconsRow}>
                    {!!hasAudio && !isVoiceOnly && (
                        // A note with text and a recording says so, with its length.
                        <View
                            style={styles.audioChip}
                            accessible
                            accessibilityLabel={voiceLabel}
                        >
                            <MaterialIcons name="mic-none" size={14} color={colors.textSecondary} />
                            {voiceDuration ? <Text style={styles.audioChipText}>{voiceDuration}</Text> : null}
                        </View>
                    )}
                    {hasDrawing && !drawingSvg && !isDrawingOnly && (
                        <MaterialIcons name="gesture" size={15} color={colors.textTertiary} style={styles.footerIcon} accessibilityLabel={t('notes.drawing', 'Drawing')} />
                    )}
                    {note.is_protected ? (
                        <MaterialIcons name="shield" size={14} color={colors.textTertiary} style={styles.footerIcon} accessibilityLabel={t("a11y.protected", "Protected note")} />
                    ) : !!isEncrypted && (
                        <MaterialIcons name="lock-outline" size={14} color={colors.textTertiary} style={styles.footerIcon} accessibilityLabel={t("a11y.encrypted", "End-to-end encrypted")} />
                    )}
                    {storageScope === 'local_only' && (
                        <MaterialIcons name="smartphone" size={14} color={colors.textTertiary} style={styles.footerIcon} accessibilityLabel={t("a11y.onThisPhoneOnly", "Only on this device")} />
                    )}
                    {!!note.is_pinned && (
                        <MaterialIcons name="push-pin" size={14} color={colors.textSecondary} style={styles.footerIcon} accessibilityLabel={t('a11y.pinned', 'Pinned')} />
                    )}
                </View>
            </View>
            {/* Drawn over the card's edge, so selecting it does not shift the content. */}
            {isSelected && <View style={styles.selectedOutline} pointerEvents="none" />}
        </Animated.View>
        </Pressable>
    );
};

const styles = createStyles(() => ({
    // Flat paper cards: a hairline edge in light, a lighter surface in dark.
    card: {
        backgroundColor: colors.surface,
        borderRadius: 14,
        marginBottom: spacing.s,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: isDarkScheme() ? colors.surface : colors.border,
        position: 'relative',
    },
    selectedOutline: {
        position: 'absolute',
        top: -StyleSheet.hairlineWidth,
        left: -StyleSheet.hairlineWidth,
        right: -StyleSheet.hairlineWidth,
        bottom: -StyleSheet.hairlineWidth,
        borderRadius: 14,
        borderWidth: 2,
        borderColor: colors.primary,
        zIndex: 11,
    },
    selectionIndicator: {
        position: 'absolute',
        top: spacing.s,
        right: spacing.s,
        zIndex: 10,
    },
    checkbox: {
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 1.5,
        borderColor: colors.borderHover,
        backgroundColor: colors.surface,
        justifyContent: 'center',
        alignItems: 'center',
    },
    checkboxSelected: {
        backgroundColor: colors.primary,
        borderColor: colors.primary,
    },
    content: {
        paddingHorizontal: 14,
        paddingTop: 14,
        paddingBottom: spacing.s,
    },
    title: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 4,
        color: colors.text,
        lineHeight: 21,
        letterSpacing: -0.2,
    },
    preview: {
        fontSize: 14,
        lineHeight: 20,
        color: colors.textSecondary,
    },
    // Without a title the items are the note: body colour, a touch larger.
    checklistPreview: {
        fontSize: 15,
        lineHeight: 22,
        color: colors.text,
    },
    tagText: {
        color: colors.primary,
    },
    checkedItem: {
        color: colors.textTertiary,
        fontWeight: '400',
    },
    checkedItemText: {
        textDecorationLine: 'line-through',
    },
    checkedMore: {
        color: colors.textTertiary,
        marginTop: 2,
    },
    footer: {
        paddingHorizontal: 14,
        paddingBottom: 12,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    iconsRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    footerIcon: {
        marginStart: 4,
    },
    date: {
        fontSize: 12,
        color: colors.textTertiary,
    },
    voiceRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
        paddingVertical: 2,
    },
    voiceIcon: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.primaryLight,
    },
    voiceWave: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 2,
        height: 22,
        overflow: 'hidden',
    },
    voiceBar: {
        width: 2.5,
        borderRadius: 2,
        backgroundColor: colors.textTertiary,
    },
    audioChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        paddingHorizontal: 7,
        height: 22,
        borderRadius: 11,
        backgroundColor: colors.backgroundSecondary,
    },
    audioChipText: {
        fontSize: 12,
        fontWeight: '500',
        color: colors.textSecondary,
        fontVariant: ['tabular-nums'],
    },
    drawingLabel: {
        fontSize: 15,
        fontWeight: '500',
        color: colors.text,
    },
    voiceDuration: {
        fontSize: 14,
        fontWeight: '500',
        color: colors.text,
        fontVariant: ['tabular-nums'],
    },
}));
