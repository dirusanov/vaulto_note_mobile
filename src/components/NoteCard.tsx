import React from 'react';
import { useTranslation } from 'react-i18next';
import { TouchableOpacity, Text, StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Note } from '../api/notes';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { deriveAutoTitleFromPlainText, hasMeaningfulRichContent, richContentToPlainText, richContentToPreviewText } from '../utils/richContent';
import { stripStoredTitleMarkdown } from '../utils/markdownUtils';
import { useEncryption } from '../context/EncryptionContext';
import { isMasterCiphertext } from '../crypto/encryption';
import { plainVariantTitle, userVariantName } from '../i18n/variantLabels';

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
    const [firstPreviewLine, ...restPreviewLines] = fullPreview.split('\n');
    const previewString = !hasStoredTitle && title && firstPreviewLine?.trim() === title
        ? restPreviewLines.join('\n')
        : fullPreview;

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

    return (
        <TouchableOpacity
            style={[styles.card, isSelected && styles.selectedCard]}
            onPress={onPress}
            onLongPress={onLongPress}
            activeOpacity={0.9}
        >
            {isSelectionMode && (
                <View style={styles.selectionIndicator}>
                    <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                        {isSelected && (
                            <MaterialIcons name="check" size={16} color={colors.background} />
                        )}
                    </View>
                </View>
            )}
            <View style={styles.content}>
                <Text style={[styles.title, (!title && hasAudio) && styles.placeholderTitle]} numberOfLines={2}>
                    {title || (hasAudio ? t("notes.voiceRecording") : ' ')}
                </Text>
                {(!isEmpty && previewString && previewString !== title) && (
                    <Text style={styles.preview} numberOfLines={6}>{previewString}</Text>
                )}
                {(isEmpty && hasAudio) && (
                    <View style={{ marginTop: spacing.xs, alignSelf: 'flex-start' }}>
                        <View style={[styles.audioChip, { transform: [] }]}>
                            <MaterialIcons name="headset" size={12} color={colors.textSecondary} style={{ marginRight: 2 }} />
                            <Text style={styles.audioChipText}>{t("notes.audioChip")}</Text>
                        </View>
                    </View>
                )}
            </View>
            <View style={styles.footer}>
                <Text style={styles.date}>
                    {formatDate(note.updated_at || note.created_at || '')}
                </Text>
                <View style={styles.iconsRow}>
                    {!!hasAudio && (
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
        </TouchableOpacity>
    );
};

const styles = StyleSheet.create({
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
    placeholderTitle: {
        color: colors.textSecondary,
        fontStyle: 'italic',
    },
    audioPreviewLabel: {
        fontSize: 14,
        color: colors.primary,
        fontWeight: '500',
        marginTop: spacing.xs,
    },
    audioChip: {
        backgroundColor: colors.background,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: 4,
        paddingHorizontal: 4,
        paddingVertical: 1,
        flexDirection: 'row',
        alignItems: 'center',
        // Push down to align with text baseline better
        transform: [{ translateY: 5 }],
    },
    audioChipText: {
        fontSize: 11,
        color: colors.textSecondary,
        fontWeight: '500',
    },
});
