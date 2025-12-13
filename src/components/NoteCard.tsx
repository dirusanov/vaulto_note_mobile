import React from 'react';
import { TouchableOpacity, Text, StyleSheet, View } from 'react-native';
import { Note } from '../api/notes';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

import { parseMarkdownText } from '../utils/markdownUtils';

interface NoteCardProps {
    note: Note;
    onPress: () => void;
}

export const NoteCard = ({ note, onPress }: NoteCardProps) => {
    let content = note.content || '';

    // Check if there is an active improvement (child note)
    if (note.improvements && note.improvements.length > 0) {
        const activeChild = note.improvements.find(imp => imp.is_active);
        if (activeChild && activeChild.content) {
            content = activeChild.content;
        }
    }
    const buildTitle = () => {
        if (note.title && note.title.trim().length > 0) return note.title.trim();
        const cleanedTokens = content
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ')
            .map(token => token.trim())
            .filter(token => {
                if (!token) return false;
                if (/^#+$/.test(token)) return false;
                if (/^[-*_]+$/.test(token)) return false;
                if (/^-?\[\s*(x|X)?\s*\]$/.test(token)) return false;
                return true;
            })
            .map(token => token.replace(/^[\[\](){}<>*_\-#+]+/, '').replace(/[\[\](){}<>*_\-#+]+$/, ''))
            .filter(token => !!token);
        if (cleanedTokens.length === 0) return '';
        return cleanedTokens.slice(0, 2).join(' ');
    };

    // Extract title and preview
    const title = buildTitle();
    // We want to keep the raw text length check for truncation logic, 
    // but we can't easily truncate *after* parsing markdown without breaking tags.
    // For a simple preview, we will truncate the string first (carefully) or rely on Text props if possible.
    // However, parseMarkdownText returns an array of Text nodes. 
    // If we pass a long string to parseMarkdownText, it returns nodes.
    // We should truncate the string *before* parsing, but we must be careful not to split inside a tag.
    // Given the simple regex parser, splitting `**bold**` into `**bo...` might show raw chars if the closer is missing.
    // Let's just truncate as string first. If it breaks a tag, it renders as text, which is acceptable for a preview.

    const previewTextRaw = content.length > 120
        ? content.substring(0, 120).replace(/\n/g, ' ') + '...'
        : content.replace(/\n/g, ' ');

    // Use parseMarkdownText for the preview
    // We pass styles.preview as baseStyle
    const previewNodes = parseMarkdownText(previewTextRaw, styles.preview);

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

    return (
        <TouchableOpacity
            style={styles.card}
            onPress={onPress}
            activeOpacity={0.9}
        >
            <View style={styles.content}>
                <Text style={styles.title} numberOfLines={1}>
                    {title || ' '}
                </Text>
                {(previewTextRaw && previewTextRaw !== title) && (
                    <Text style={styles.preview} numberOfLines={6}>
                        {previewNodes}
                    </Text>
                )}
            </View>
            {(note.updated_at || note.created_at) && (
                <View style={styles.footer}>
                    <Text style={styles.date}>
                        {formatDate(note.updated_at || note.created_at || '')}
                    </Text>
                </View>
            )}
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
    },
    date: {
        fontSize: 12,
        color: colors.textTertiary,
        fontWeight: '500',
    },
});
