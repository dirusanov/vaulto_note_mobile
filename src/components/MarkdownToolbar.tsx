import React from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';

export type MarkdownFormatType = 'bold' | 'italic' | 'strikethrough' | 'list' | 'todo' | 'h1' | 'h2' | 'h3';

interface MarkdownToolbarProps {
    onFormat: (type: MarkdownFormatType) => void;
}

export const MarkdownToolbar: React.FC<MarkdownToolbarProps> = ({ onFormat }) => {
    return (
        <View style={styles.container}>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="always"
            >
                <TouchableOpacity
                    style={styles.button}
                    onPress={() => onFormat('todo')}
                    hitSlop={{ top: 10, bottom: 10, left: 5, right: 5 }}
                >
                    <MaterialIcons name="check-box" size={24} color={colors.text} />
                </TouchableOpacity>

                <View style={styles.divider} />

                <TouchableOpacity
                    style={styles.button}
                    onPress={() => onFormat('h1')}
                    hitSlop={{ top: 10, bottom: 10, left: 5, right: 5 }}
                >
                    <MaterialIcons name="looks-one" size={24} color={colors.text} />
                </TouchableOpacity>

                <TouchableOpacity
                    style={styles.button}
                    onPress={() => onFormat('h2')}
                    hitSlop={{ top: 10, bottom: 10, left: 5, right: 5 }}
                >
                    <MaterialIcons name="looks-two" size={24} color={colors.text} />
                </TouchableOpacity>

                <TouchableOpacity
                    style={styles.button}
                    onPress={() => onFormat('h3')}
                    hitSlop={{ top: 10, bottom: 10, left: 5, right: 5 }}
                >
                    <MaterialIcons name="looks-3" size={24} color={colors.text} />
                </TouchableOpacity>

                <View style={styles.divider} />

                <TouchableOpacity
                    style={styles.button}
                    onPress={() => onFormat('bold')}
                    hitSlop={{ top: 10, bottom: 10, left: 5, right: 5 }}
                >
                    <MaterialIcons name="format-bold" size={24} color={colors.text} />
                </TouchableOpacity>

                <TouchableOpacity
                    style={styles.button}
                    onPress={() => onFormat('italic')}
                    hitSlop={{ top: 10, bottom: 10, left: 5, right: 5 }}
                >
                    <MaterialIcons name="format-italic" size={24} color={colors.text} />
                </TouchableOpacity>

                <TouchableOpacity
                    style={styles.button}
                    onPress={() => onFormat('strikethrough')}
                    hitSlop={{ top: 10, bottom: 10, left: 5, right: 5 }}
                >
                    <MaterialIcons name="format-strikethrough" size={24} color={colors.text} />
                </TouchableOpacity>

                <View style={styles.divider} />

                <TouchableOpacity
                    style={styles.button}
                    onPress={() => onFormat('list')}
                    hitSlop={{ top: 10, bottom: 10, left: 5, right: 5 }}
                >
                    <MaterialIcons name="format-list-bulleted" size={24} color={colors.text} />
                </TouchableOpacity>
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        backgroundColor: colors.surface,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        paddingVertical: spacing.xs,
        // Elevation/Shadow for visual separation
        ...Platform.select({
            ios: {
                shadowColor: '#000',
                shadowOffset: { width: 0, height: -2 },
                shadowOpacity: 0.1,
                shadowRadius: 2,
            },
            android: {
                elevation: 4,
            },
        }),
    },
    scrollContent: {
        paddingHorizontal: spacing.m,
        alignItems: 'center',
        gap: spacing.m,
        height: 48,
    },
    button: {
        padding: spacing.xs,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 4,
    },
    divider: {
        width: 1,
        height: 24,
        backgroundColor: colors.border,
        marginHorizontal: spacing.xs,
    },
});
