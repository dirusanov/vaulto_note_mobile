import React from 'react';
import { View, Text } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { createStyles } from '../theme/createStyles';

interface EmptyStateProps {
    message: string;
    /**
     * 'welcome' introduces the app on an empty list (first launch); 'search' is
     * a plain "nothing found"; 'plain' just shows the message.
     */
    variant?: 'welcome' | 'search' | 'plain';
}

export const EmptyState = ({ message, variant = 'plain' }: EmptyStateProps) => {
    const { t } = useTranslation();

    if (variant === 'search') {
        return (
            <View style={styles.container}>
                <MaterialIcons name="search-off" size={40} color={colors.textTertiary} />
                <Text style={[styles.text, { marginTop: spacing.s }]}>{message}</Text>
            </View>
        );
    }

    if (variant === 'welcome') {
        const points: { icon: keyof typeof MaterialIcons.glyphMap; title: string; text: string }[] = [
            {
                icon: 'mic',
                title: t('welcome.voiceTitle', 'Speak, get text'),
                text: t('welcome.voiceText', 'Recordings turn into text, even without internet.'),
            },
            {
                icon: 'auto-awesome',
                title: t('welcome.aiTitle', 'AI tidies it up'),
                text: t('welcome.aiText', 'Improve the text, find tasks, ask about your notes.'),
            },
            {
                icon: 'lock',
                title: t('welcome.privacyTitle', 'Private by default'),
                text: t('welcome.privacyText', 'Notes are encrypted on the phone and end-to-end when synced: only you can read them.'),
            },
        ];
        return (
            <View style={styles.welcome}>
                <View style={styles.heroIcon}>
                    <MaterialIcons name="graphic-eq" size={34} color={colors.primary} />
                </View>
                <Text style={styles.welcomeTitle}>{t('welcome.title', 'Your notes will live here')}</Text>
                <View style={styles.points}>
                    {points.map((point) => (
                        <View key={point.icon} style={styles.point}>
                            <View style={styles.pointIcon}>
                                <MaterialIcons name={point.icon} size={20} color={colors.primary} />
                            </View>
                            <View style={styles.pointText}>
                                <Text style={styles.pointTitle}>{point.title}</Text>
                                <Text style={styles.pointBody}>{point.text}</Text>
                            </View>
                        </View>
                    ))}
                </View>
                {/* Kept in the layout while hidden, so the screen does not jump. */}
                <View style={styles.cta}>
                    <Text style={[styles.ctaText, !message && { opacity: 0 }]}>{message || ' '}</Text>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <Text style={styles.text}>{message}</Text>
        </View>
    );
};

const styles = createStyles(() => ({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: spacing.xl,
    },
    text: {
        ...typography.body,
        color: colors.textSecondary,
        textAlign: 'center',
    },
    welcome: {
        alignItems: 'center',
        paddingHorizontal: spacing.m,
        paddingTop: spacing.s,
    },
    heroIcon: {
        width: 72,
        height: 72,
        borderRadius: 36,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.primaryLight,
        marginBottom: spacing.m,
    },
    welcomeTitle: {
        fontSize: 22,
        fontWeight: '700',
        color: colors.text,
        textAlign: 'center',
        marginBottom: spacing.m,
    },
    points: {
        alignSelf: 'stretch',
        gap: spacing.s,
    },
    point: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.m,
        padding: spacing.m,
        borderRadius: 16,
        backgroundColor: colors.surface,
    },
    pointIcon: {
        width: 40,
        height: 40,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.primaryLight,
    },
    pointText: {
        flex: 1,
    },
    pointTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.text,
    },
    pointBody: {
        fontSize: 14,
        lineHeight: 20,
        color: colors.textSecondary,
        marginTop: 2,
    },
    cta: {
        alignItems: 'center',
        marginTop: spacing.l,
    },
    ctaText: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.primary,
        textAlign: 'center',
    },
}));
