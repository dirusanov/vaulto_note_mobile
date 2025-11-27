import React from 'react';
import { TouchableOpacity, Text, StyleSheet, View } from 'react-native';
import { Note } from '../contexts/NotesContext';
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
            activeOpacity={0.9}
        >
            <View style={styles.content}>
                <Text style={styles.title}>
                    {title}
                </Text>
                {preview && preview !== title && (
                    <Text style={styles.preview} numberOfLines={6}>
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
