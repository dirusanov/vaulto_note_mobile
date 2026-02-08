import React from 'react';
import { StyleSheet, Text, TextInput as RNTextInput, View } from 'react-native';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

interface SeedWordsGridProps {
    words: string[];
    onChangeWord?: (index: number, value: string) => void;
    editable?: boolean;
}

export const SeedWordsGrid = ({ words, onChangeWord, editable = true }: SeedWordsGridProps) => {
    return (
        <View style={styles.grid}>
            {words.map((word, index) => (
                <View key={`seed-word-${index}`} style={styles.item}>
                    <Text style={styles.index}>{index + 1}</Text>
                    <RNTextInput
                        value={word}
                        onChangeText={(value) => onChangeWord?.(index, value)}
                        editable={editable}
                        autoCapitalize="none"
                        autoCorrect={false}
                        placeholder="word"
                        placeholderTextColor={colors.textMuted}
                        style={[styles.input, !editable && styles.inputReadOnly]}
                    />
                </View>
            ))}
        </View>
    );
};

const styles = StyleSheet.create({
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.s,
    },
    item: {
        width: '31%',
    },
    index: {
        ...typography.captionBold,
        color: colors.textSecondary,
        marginBottom: spacing.xs,
    },
    input: {
        minHeight: 44,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 10,
        backgroundColor: colors.surface,
        paddingHorizontal: spacing.s,
        color: colors.text,
        fontSize: 14,
    },
    inputReadOnly: {
        color: colors.text,
        backgroundColor: colors.background,
    },
});
