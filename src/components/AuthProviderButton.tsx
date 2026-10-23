import React, { ReactNode } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { createStyles } from '../theme/createStyles';

interface Props {
    title: string;
    icon?: ReactNode;
    loading?: boolean;
    onPress: () => void;
}

export const AuthProviderButton = ({ title, icon, loading = false, onPress }: Props) => {
    return (
        <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={onPress}
            disabled={loading}
            activeOpacity={0.85}
        >
            {loading ? (
                <ActivityIndicator color={colors.text} />
            ) : (
                <View style={styles.content}>
                    {icon}
                    <Text style={styles.title}>{title}</Text>
                </View>
            )}
        </TouchableOpacity>
    );
};

const styles = createStyles(() => ({
    button: {
        height: 52,
        borderRadius: 26,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: spacing.s,
    },
    buttonDisabled: {
        opacity: 0.6,
    },
    content: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    title: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.text,
        marginStart: spacing.s,
    },
}));
