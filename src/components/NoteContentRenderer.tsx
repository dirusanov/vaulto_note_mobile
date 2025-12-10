import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { spacing } from '../theme/spacing';
import { parseMarkdownText } from '../utils/markdownUtils';

interface NoteContentRendererProps {
    content: string;
    onToggleTodo?: (index: number) => void;
    onTextPress?: () => void;
}

export const NoteContentRenderer: React.FC<NoteContentRendererProps> = ({
    content,
    onToggleTodo,
    onTextPress,
}) => {
    const lines = useMemo(() => content.split('\n'), [content]);

    if (!content) {
        return (
            <TouchableOpacity onPress={onTextPress} activeOpacity={1} style={styles.container}>
                <Text style={[styles.text, { color: colors.textMuted }]}>
                    Tap to start typing...
                </Text>
            </TouchableOpacity>
        );
    }

    return (
        <TouchableOpacity onPress={onTextPress} activeOpacity={1} style={styles.container}>
            {lines.map((line, index) => {
                // Check for headers (H1-H3)
                const h1Match = line.match(/^#\s+(.*)$/);
                const h2Match = line.match(/^##\s+(.*)$/);
                const h3Match = line.match(/^###\s+(.*)$/);

                if (h1Match) {
                    return (
                        <Text key={index} style={[styles.text, typography.h2, styles.headerMetadata]}>
                            {parseMarkdownText(h1Match[1], [styles.text, typography.h2])}
                        </Text>
                    );
                }

                if (h2Match) {
                    return (
                        <Text key={index} style={[styles.text, typography.h3, styles.headerMetadata]}>
                            {parseMarkdownText(h2Match[1], [styles.text, typography.h3])}
                        </Text>
                    );
                }

                if (h3Match) {
                    return (
                        <Text key={index} style={[styles.text, typography.bodyLarge, { fontWeight: 'bold' }, styles.headerMetadata]}>
                            {parseMarkdownText(h3Match[1], [styles.text, typography.bodyLarge, { fontWeight: 'bold' }])}
                        </Text>
                    );
                }

                // Check for todo pattern: "- [ ] " or "- [x] "
                // We use a regex that handles optional whitespace
                const todoMatch = line.match(/^\s*-\s\[([ xX])\]\s(.*)$/);

                if (todoMatch) {
                    const isChecked = todoMatch[1].toLowerCase() === 'x';
                    const text = todoMatch[2];

                    return (
                        <View key={`${index}-${line.length}`} style={styles.todoRow}>
                            <TouchableOpacity
                                onPress={() => onToggleTodo && onToggleTodo(index)}
                                style={styles.checkboxContainer}
                                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                            >
                                <MaterialIcons
                                    name={isChecked ? "check-box" : "check-box-outline-blank"}
                                    size={24}
                                    color={isChecked ? colors.primary : colors.textTertiary}
                                />
                            </TouchableOpacity>
                            <Text
                                style={[
                                    styles.todoText,
                                    isChecked && styles.todoTextChecked
                                ]}
                            >
                                {parseMarkdownText(text, [styles.todoText, isChecked && styles.todoTextChecked])}
                            </Text>
                        </View>
                    );
                }

                // Regular text line
                // If it's an empty line, render a spacer to maintain paragraph breaks
                if (line.trim() === '') {
                    return <View key={index} style={styles.spacer} />;
                }

                return (
                    <Text key={index} style={styles.text}>
                        {parseMarkdownText(line, styles.text)}
                    </Text>
                );
            })}
        </TouchableOpacity>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        minHeight: 200,
    },
    text: {
        ...typography.body,
        fontSize: 16,
        lineHeight: 24,
        color: colors.text,
        marginBottom: 4, // Slight spacing between lines naturally
    },
    spacer: {
        height: 12, // Visual height for empty lines
    },
    todoRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 8,
        marginTop: 4,
        paddingRight: spacing.s,
    },
    checkboxContainer: {
        marginRight: spacing.s,
        marginTop: 0, // Align with text top
    },
    todoText: {
        ...typography.body,
        fontSize: 16,
        lineHeight: 24,
        color: colors.text,
        flex: 1,
    },
    todoTextChecked: {
        textDecorationLine: 'line-through',
        color: colors.textTertiary,
    },
    headerMetadata: {
        marginTop: 8,
        marginBottom: 4,
    },
});
