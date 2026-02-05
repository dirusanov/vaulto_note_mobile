import React from 'react';
import { TouchableOpacity, Text, StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Note } from '../api/notes';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';


import { parseMarkdownText, parseMarkdownToData } from '../utils/markdownUtils';

interface NoteCardProps {
    note: Note;
    onPress: () => void;
    onLongPress?: () => void;
    isSelectionMode?: boolean;
    isSelected?: boolean;
}

export const NoteCard = ({ note, onPress, onLongPress, isSelectionMode = false, isSelected = false }: NoteCardProps) => {
    let content = note.content || '';

    // Check if there is an active improvement (active child note)
    if (note.improvements && note.improvements.length > 0) {
        const activeChild = note.improvements.find(imp => imp.is_active);
        if (activeChild && activeChild.content) {
            content = activeChild.content;
        }
    }

    // Determine if audio is present (flag or check content)
    const hasAudio = note.has_audio || /!\[audio\]\(.*?\)/.test(content);

    const buildTitle = () => {
        if (note.title && note.title.trim().length > 0) return note.title.trim();

        // Strip audio blocks for title generation
        const contentForTitle = content.replace(/!\[audio\]\(.*?\)/g, '');

        // Use the centralized parser to strip markdown
        const contentToParse = contentForTitle.length > 1000 ? contentForTitle.substring(0, 1000) : contentForTitle;
        let { content: plainText } = parseMarkdownToData(contentToParse);

        // Remove Checkboxes and Hashes before formatting
        plainText = plainText.replace(/\[\s*(x|X)?\s*\]/g, '').replace(/#/g, '');

        const cleanedTokens = plainText
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ')
            .map(token => token.trim())
            .filter(token => {
                if (!token) return false;
                if (/^[-*_]+$/.test(token)) return false; // Separators/Bullets
                return true;
            });

        if (cleanedTokens.length === 0) return '';
        return cleanedTokens.slice(0, 3).join(' ');
    };

    // Extract title
    const title = buildTitle();

    // Prepare preview text
    // We replace audio markdown with a unique marker to split and render custom chips
    const AUDIO_MARKER = '{{AUDIO}}';
    let previewString = content.replace(/!\[audio\]\(.*?\)/g, AUDIO_MARKER);

    previewString = previewString.length > 120
        ? previewString.substring(0, 120).replace(/\n/g, ' ') + '...'
        : previewString.replace(/\n/g, ' ');

    const parts = previewString.split(AUDIO_MARKER);
    const previewNodes: React.ReactNode[] = [];

    parts.forEach((part, index) => {
        if (part) {
            previewNodes.push(...parseMarkdownText(part, styles.preview));
        }

        if (index < parts.length - 1) {
            previewNodes.push(
                <View key={`audio-chip-${index}`} style={styles.audioChip}>
                    <MaterialIcons name="headset" size={12} color={colors.textSecondary} style={{ marginRight: 2 }} />
                    <Text style={styles.audioChipText}>audio</Text>
                </View>
            );
        }
    });

    // Format date nicely
    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        const now = new Date();

        const isToday = date.getDate() === now.getDate() &&
            date.getMonth() === now.getMonth() &&
            date.getFullYear() === now.getFullYear();

        const isThisYear = date.getFullYear() === now.getFullYear();

        if (isToday) {
            return date.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });
        } else if (isThisYear) {
            return date.toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'short'
            });
        } else {
            return date.toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'short',
                year: 'numeric'
            });
        }
    };

    const isEmpty = !title && (!content || content.trim().length === 0);

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
                <Text style={[styles.title, (!title && hasAudio) && styles.placeholderTitle]} numberOfLines={1}>
                    {title || (hasAudio ? 'Voice Note' : ' ')}
                </Text>
                {(!isEmpty && previewString && previewString !== title) && (
                    <Text style={styles.preview} numberOfLines={6}>
                        {previewNodes}
                    </Text>
                )}
                {(isEmpty && hasAudio) && (
                    <Text style={styles.audioPreviewLabel}> Audio recording available</Text>
                )}
            </View>
            <View style={styles.footer}>
                <Text style={styles.date}>
                    {formatDate(note.updated_at || note.created_at || '')}
                </Text>
                <View style={styles.iconsRow}>
                    {hasAudio && (
                        <MaterialIcons name="mic" size={16} color={colors.textTertiary} />
                    )}
                    {note.is_pinned && (
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
