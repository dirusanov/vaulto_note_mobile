import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { UserProfile } from '../api/auth';
import { AIProvider } from '../utils/storage';

interface UsageCardProps {
    user: UserProfile | null;
    aiProvider?: AIProvider;
    isGuest?: boolean;
    isPro?: boolean;
}

export const UsageCard: React.FC<UsageCardProps> = ({ user, aiProvider, isGuest, isPro = false }) => {
    // Only show for Secure LLM provider
    if (aiProvider !== 'secure_llm') return null;
    if (!user) return null;

    console.log('[UsageCard] Rendering for user:', user.email || 'Guest');
    console.log('[UsageCard] Credits:', user.transcription_max_seconds, 'Used:', user.transcription_used_seconds, 'Remaining:', user.transcription_remaining_seconds);

    // "Unlimited" logic: If max seconds > 100 hours (360000s)
    const isUnlimited = user.transcription_max_seconds > 360000;

    // Trial Calculations
    const totalSeconds = user.transcription_max_seconds || 600;
    const usedSeconds = user.transcription_used_seconds || 0;
    const remainingSeconds = user.transcription_remaining_seconds !== undefined
        ? user.transcription_remaining_seconds
        : Math.max(0, totalSeconds - usedSeconds);

    const progress = Math.min(1, usedSeconds / totalSeconds);
    const isExpired = remainingSeconds <= 0;
    const isLowBalance = remainingSeconds > 0 && remainingSeconds <= 120; // Less than 2 minutes

    // Formatting helpers
    const formatTimeMMSS = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    // Color states
    const getProgressColor = () => {
        if (isExpired) return colors.error;
        if (isLowBalance) return colors.warning;
        return colors.primary;
    };

    if (isUnlimited) {
        return (
            <View style={styles.card}>
                <View style={styles.headerRow}>
                    <View style={styles.titleRow}>
                        <View style={[styles.iconContainer, { backgroundColor: colors.primary + '15' }]}>
                            <MaterialIcons name="workspace-premium" size={20} color={colors.primary} />
                        </View>
                        <Text style={styles.title}>Secure LLM Plan</Text>
                    </View>
                    <View style={styles.proBadge}>
                        <Text style={styles.proBadgeText}>PRO</Text>
                    </View>
                </View>
                <View style={styles.unlimitedContainer}>
                    <MaterialIcons name="all-inclusive" size={24} color={colors.primary} />
                    <Text style={styles.unlimitedText}>Unlimited Access</Text>
                </View>
            </View>
        );
    }

    if (isGuest) {
        return (
            <View style={styles.card}>
                <View style={styles.headerRow}>
                    <View style={styles.titleRow}>
                        <View style={[styles.iconContainer, { backgroundColor: colors.accentGreen + '15' }]}>
                            <MaterialIcons name="card-giftcard" size={20} color={colors.accentGreen} />
                        </View>
                        <Text style={styles.title}>Free Trial</Text>
                    </View>
                </View>
                <Text style={styles.guestText}>
                    Sign in with Email or Google to get 10 free minutes of transcription.
                </Text>
            </View>
        );
    }

    return (
        <View style={styles.card}>
            <View style={styles.headerRow}>
                <View style={styles.titleRow}>
                    <View style={[styles.iconContainer, { backgroundColor: getProgressColor() + '15' }]}>
                        <MaterialIcons
                            name={isExpired ? "schedule" : "hourglass-bottom"}
                            size={20}
                            color={getProgressColor()}
                        />
                    </View>
                    <View>
                        <Text style={styles.title}>Transcription Balance</Text>
                        <Text style={styles.subtitle}>Transcription time</Text>
                    </View>
                </View>
            </View>

            <View style={styles.progressContainer}>
                <View style={[styles.progressBar, {
                    width: `${progress * 100}%`,
                    backgroundColor: getProgressColor(),
                }]} />
            </View>

            <View style={styles.statsRow}>
                <Text style={styles.statsLabel}>Used</Text>
                <Text style={styles.statsValue}>
                    {formatTimeMMSS(usedSeconds)} / {formatTimeMMSS(totalSeconds)}
                </Text>
            </View>

            {isExpired && (
                <View style={styles.expiredContainer}>
                    <View style={styles.warningBox}>
                        <MaterialIcons name="info-outline" size={18} color={colors.error} />
                        <Text style={styles.warningText}>
                            {isPro ? "You've used all monthly minutes" : "You've used all 10 free minutes"}
                        </Text>
                    </View>
                    {!isPro && (
                        <Text style={styles.upgradeHint}>
                            Upgrade to continue transcribing (coming soon)
                        </Text>
                    )}
                </View>
            )}

            {isLowBalance && !isExpired && (
                <View style={styles.warningBox}>
                    <MaterialIcons name="warning-amber" size={18} color={colors.warning} />
                    <Text style={[styles.warningText, { color: colors.warning }]}>
                        {isPro ? 'Running low on monthly transcription minutes' : 'Running low on transcription time'}
                    </Text>
                </View>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    card: {
        backgroundColor: colors.surface,
        borderRadius: 16,
        padding: spacing.m,
        marginVertical: spacing.s,
        borderWidth: 1,
        borderColor: colors.border,
        shadowColor: colors.cardShadow,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 2,
    },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: spacing.m,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
        flex: 1,
    },
    iconContainer: {
        width: 36,
        height: 36,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    title: {
        ...typography.h3,
        fontSize: 16,
        fontWeight: '600',
        color: colors.text,
    },
    subtitle: {
        ...typography.caption,
        fontSize: 12,
        color: colors.textSecondary,
        marginTop: 2,
    },
    proBadge: {
        backgroundColor: colors.primary,
        paddingHorizontal: spacing.s,
        paddingVertical: spacing.xs,
        borderRadius: 8,
        shadowColor: colors.primary,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
        elevation: 2,
    },
    proBadgeText: {
        ...typography.caption,
        color: '#fff',
        fontWeight: '700',
        fontSize: 11,
        letterSpacing: 0.5,
    },
    timeBadge: {
        paddingHorizontal: spacing.m,
        paddingVertical: spacing.xs,
        borderRadius: 10,
        borderWidth: 1,
    },
    timeBadgeText: {
        ...typography.h3,
        fontSize: 15,
        fontWeight: '700',
    },
    progressContainer: {
        height: 8,
        backgroundColor: colors.backgroundSecondary,
        borderRadius: 4,
        marginBottom: spacing.s,
        overflow: 'hidden',
    },
    progressBar: {
        height: '100%',
        borderRadius: 4,
    },
    statsRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    statsLabel: {
        ...typography.caption,
        fontSize: 13,
        color: colors.textSecondary,
    },
    statsValue: {
        ...typography.body,
        fontSize: 13,
        color: colors.text,
        fontWeight: '600',
    },
    unlimitedContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
        paddingVertical: spacing.xs,
    },
    unlimitedText: {
        ...typography.body,
        fontSize: 16,
        color: colors.primary,
        fontWeight: '600',
    },
    guestText: {
        ...typography.body,
        fontSize: 14,
        color: colors.textSecondary,
        lineHeight: 20,
    },
    expiredContainer: {
        marginTop: spacing.m,
        paddingTop: spacing.m,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        gap: spacing.s,
    },
    warningBox: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
        backgroundColor: colors.error + '10',
        padding: spacing.s,
        borderRadius: 10,
        marginTop: spacing.s,
    },
    warningText: {
        ...typography.body,
        flex: 1,
        fontSize: 13,
        color: colors.error,
        fontWeight: '500',
    },
    upgradeHint: {
        ...typography.caption,
        fontSize: 12,
        color: colors.textSecondary,
        textAlign: 'center',
    },
});
