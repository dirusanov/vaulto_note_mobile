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
    const content = note.content || '';
    // Extract title and preview
    const title = note.title || content.split('\n')[0] || 'Untitled Note';
    const preview = content.length > 120
        ? content.substring(0, 120).replace(/\n/g, ' ') + '...'
        : content.replace(/\n/g, ' ');

    // Format date nicely
    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        const now = new Date();
        const diff = now.getTime() - date.getTime();
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));

        if (days === 0) {
            return 'Today';
        } else if (days === 1) {
            return 'Yesterday';
        } else if (days < 7) {
            return `${days} days ago`;
        } else {
            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }
    };

    return (
        <TouchableOpacity
            style={styles.card}
            onPress={onPress}
            activeOpacity={0.7}
        >
            <View style={styles.content}>
                <Text style={styles.title} numberOfLines={2}>
                    {title}
                </Text>
                {preview && preview !== title && (
                    <Text style={styles.preview} numberOfLines={4}>
                        {preview}
                    </Text>
                )}
            </View>
            {note.updated_at && (
                <View style={styles.footer}>
                    <Text style={styles.date}>
                        {formatDate(note.updated_at)}
                    </Text>
                </View>
            )}
        </TouchableOpacity>
    );
};

const styles = StyleSheet.create({
    card: {
        backgroundColor: colors.surface,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: 'hidden',
        // Enhanced shadow for depth
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
        elevation: 2,
    },
    content: {
        padding: spacing.s,
        paddingBottom: spacing.xs,
        minHeight: 100,
    },
    title: {
        ...typography.noteTitle,
        fontSize: 15,
        fontWeight: '600',
        marginBottom: spacing.xxs,
        color: colors.text,
    },
    preview: {
        ...typography.notePreview,
        fontSize: 13,
        lineHeight: 18,
        marginTop: spacing.xxs,
        color: colors.textSecondary,
    },
    footer: {
        paddingHorizontal: spacing.s,
        paddingBottom: spacing.s,
        borderTopWidth: 0,
    },
    date: {
        ...typography.caption,
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        color: colors.textTertiary,
    },
});
