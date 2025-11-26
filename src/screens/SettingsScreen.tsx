import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ScreenContainer } from '../components/ScreenContainer';
import { Button } from '../components/Button';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { useAuth } from '../hooks/useAuth';

export const SettingsScreen = () => {
    const { signOut } = useAuth();

    return (
        <ScreenContainer>
            <View style={styles.header}>
                <Text style={styles.title}>Settings</Text>
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Account</Text>
                <Text style={styles.info}>Logged in</Text>
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>App Info</Text>
                <Text style={styles.info}>Version 1.0.0</Text>
            </View>

            <View style={styles.footer}>
                <Button
                    title="Sign Out"
                    onPress={signOut}
                    variant="outline"
                    style={styles.button}
                />
            </View>
        </ScreenContainer>
    );
};

const styles = StyleSheet.create({
    header: {
        paddingVertical: spacing.m,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        marginBottom: spacing.l,
    },
    title: {
        ...typography.h1,
    },
    section: {
        marginBottom: spacing.xl,
    },
    sectionTitle: {
        ...typography.h2,
        fontSize: 18,
        marginBottom: spacing.s,
    },
    info: {
        ...typography.body,
        color: colors.textMuted,
    },
    footer: {
        marginTop: 'auto',
        marginBottom: spacing.l,
    },
    button: {
        borderColor: colors.error,
    },
});
