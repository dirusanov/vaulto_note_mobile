import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

interface PinCodeInputProps {
    label?: string;
    value: string;
    onChange: (value: string) => void;
    length?: number;
    helperText?: string;
}

export const PinCodeInput = ({
    label,
    value,
    onChange,
    length = 8,
    helperText,
}: PinCodeInputProps) => {
    const [revealed, setRevealed] = useState(false);
    const [focused, setFocused] = useState(false);
    const inputRef = useRef<TextInput>(null);

    useEffect(() => {
        const cleaned = value.replace(/\D/g, '').slice(0, length);
        if (cleaned !== value) {
            onChange(cleaned);
        }
    }, [length, onChange, value]);

    const digits = useMemo(() => value.padEnd(length, ' '), [length, value]);

    const handleChange = (text: string) => {
        const cleaned = text.replace(/\D/g, '').slice(0, length);
        onChange(cleaned);
    };

    const focusInput = () => {
        inputRef.current?.focus();
    };

    return (
        <View style={styles.container}>
            {label && <Text style={styles.label}>{label}</Text>}
            <Pressable onPress={focusInput} style={styles.boxRow}>
                {Array.from({ length }).map((_, index) => {
                    const char = digits[index];
                    const isActive = focused && value.length === index;
                    return (
                        <View
                            key={index}
                            style={[
                                styles.box,
                                focused && styles.boxFocused,
                                isActive && styles.boxActive,
                            ]}
                        >
                            <Text style={styles.boxText}>
                                {char.trim() ? (revealed ? char : '•') : ''}
                            </Text>
                        </View>
                    );
                })}
            </Pressable>
            <View style={styles.actionsRow}>
                <Text style={styles.helper}>{helperText || `Enter ${length}-digit PIN`}</Text>
                <Pressable onPress={() => setRevealed((prev) => !prev)}>
                    <Text style={styles.toggle}>{revealed ? 'Hide PIN' : 'Show PIN'}</Text>
                </Pressable>
            </View>
            <TextInput
                ref={inputRef}
                value={value}
                onChangeText={handleChange}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                maxLength={length}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                style={styles.hiddenInput}
            />
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        marginBottom: spacing.m,
    },
    label: {
        ...typography.body,
        color: colors.textSecondary,
        marginBottom: spacing.s,
    },
    boxRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: spacing.s,
    },
    box: {
        flex: 1,
        minHeight: 48,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
    },
    boxFocused: {
        borderColor: colors.primary,
    },
    boxActive: {
        borderColor: colors.primary,
        backgroundColor: colors.background,
    },
    boxText: {
        ...typography.h3,
        color: colors.text,
    },
    actionsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: spacing.s,
    },
    helper: {
        ...typography.caption,
        color: colors.textMuted,
    },
    toggle: {
        ...typography.caption,
        color: colors.primary,
    },
    hiddenInput: {
        position: 'absolute',
        opacity: 0,
        width: 1,
        height: 1,
    },
});
