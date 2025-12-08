import React from 'react';
import { TouchableOpacity, Text, StyleSheet, View } from 'react-native';
import { Note } from '../api/notes';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

interface NoteCardProps {
    note: Note;
    onPress: () => void;
}

export const NoteCard = ({ note, onPress }: NoteCardProps) => {
    let content = note.content || '';
    if (note.active_child_id && note.active_child_id && note.active_child_id !== 'original' && note.improvements) {
        const activeChild = note.improvements.find(imp => imp.id === note.active_child_id);
        if (activeChild?.content) {
            content = activeChild.content;
        }
    }
    const buildTitle = () => {
        if (note.title && note.title.trim().length > 0) return note.title.trim();
        const words = content.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
        if (words.length === 0) return '';
        return words.slice(0, 2).join(' ');
    };

    // Extract title and preview
    const title = buildTitle();
    const preview = content.length > 120
        ? content.substring(0, 120).replace(/\n/g, ' ') + '...'
        : content.replace(/\n/g, ' ');

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
                {(preview && preview !== title) && (
                    <Text style={styles.preview} numberOfLines={6}>
                        {preview}
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
