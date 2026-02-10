import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useEncryption } from '../context/EncryptionContext';
import { ScreenContainer } from './ScreenContainer';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

export const EncryptionGate = ({ children }: { children: React.ReactNode }) => {
    const { status } = useEncryption();

    if (status === 'loading') {
        return (
            <ScreenContainer>
                <View style={styles.center}>
                    <ActivityIndicator size="large" color={colors.primary} />
                    <Text style={styles.text}>Preparing encrypted storage...</Text>
                </View>
            </ScreenContainer>
        );
    }

    return <>{children}</>;
};

const styles = StyleSheet.create({
    center: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.l,
    },
    text: {
        ...typography.body,
        color: colors.textSecondary,
        marginTop: spacing.m,
    },
});
