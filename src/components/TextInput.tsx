import React from 'react';
import { TextInput as RNTextInput, View, Text, StyleSheet, TextInputProps, ViewStyle, StyleProp } from 'react-native';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

interface Props extends TextInputProps {
    label?: string;
    error?: string;
    containerStyle?: StyleProp<ViewStyle>;
}

export const TextInput = ({ label, error, containerStyle, style, ...props }: Props) => {
    const isMultiline = !!props.multiline;
    return (
        <View style={[styles.container, containerStyle]}>
            {label && <Text style={styles.label}>{label}</Text>}
            <RNTextInput
                style={[
                    styles.input,
                    isMultiline ? styles.inputMultiline : null,
                    error ? styles.inputError : null,
                    style,
                ]}
                placeholderTextColor={colors.textMuted}
                {...props}
            />
            {error && <Text style={styles.error}>{error}</Text>}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        marginBottom: spacing.m,
    },
    label: {
        ...typography.caption,
        marginBottom: spacing.xs,
        color: colors.text,
        fontWeight: '600',
    },
    input: {
        minHeight: 50,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        paddingHorizontal: spacing.m,
        fontSize: 16,
        color: colors.text,
    },
    inputMultiline: {
        minHeight: 96,
        paddingTop: spacing.s,
        textAlignVertical: 'top',
    },
    inputError: {
        borderColor: colors.error,
    },
    error: {
        ...typography.caption,
        color: colors.error,
        marginTop: spacing.xs,
    },
});
