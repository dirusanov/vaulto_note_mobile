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
     * 'welcome' introduces the app on an empty list (first launch; the list puts
     * its "tap the mic" hint by the dock); 'search' is a plain "nothing found";
     * 'plain' just shows the message.
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
        // What the app does, in three numbered steps.
        const points: { title: string; text: string }[] = [
            {
                title: t('welcome.voiceTitle', 'Speak, get text'),
                text: t('welcome.voiceText', 'Recordings turn into text, even without internet.'),
            },
            {
                title: t('welcome.aiTitle', 'AI tidies it up'),
                text: t('welcome.aiText', 'Improve the text, find tasks, ask about your notes.'),
            },
            {
                title: t('welcome.privacyTitle', 'Private by default'),
                text: t('welcome.privacyText', 'Notes are encrypted on the device and end-to-end when synced: only you can read them.'),
            },
        ];
        return (
            <View style={styles.welcome}>
                <Text style={styles.welcomeTitle}>{t('welcome.title', 'Your notes will live here')}</Text>
                <View style={styles.points}>
                    {points.map((point, index) => (
                        <View key={index} style={styles.point}>
                            <Text style={styles.pointNumber}>{index + 1}</Text>
                            <View style={styles.pointText}>
                                <Text style={styles.pointTitle}>{point.title}</Text>
                                <Text style={styles.pointBody}>{point.text}</Text>
                            </View>
                        </View>
                    ))}
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
        alignSelf: 'center',
        width: '100%',
        maxWidth: 400,
        paddingHorizontal: spacing.l,
        paddingTop: spacing.l,
    },
    welcomeTitle: {
        fontSize: 26,
        lineHeight: 32,
        fontWeight: '700',
        letterSpacing: -0.6,
        color: colors.text,
        marginBottom: spacing.l,
    },
    points: {
        gap: spacing.l,
    },
    point: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.m,
    },
    pointNumber: {
        width: 16,
        fontSize: 16,
        lineHeight: 22,
        fontWeight: '600',
        color: colors.primary,
        fontVariant: ['tabular-nums'],
    },
    pointText: {
        flex: 1,
        gap: 2,
    },
    pointTitle: {
        fontSize: 16,
        lineHeight: 22,
        fontWeight: '600',
        color: colors.text,
    },
    pointBody: {
        fontSize: 14,
        lineHeight: 20,
        color: colors.textSecondary,
    },
}));
