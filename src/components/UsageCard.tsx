import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import { UserProfile } from '../api/auth';
import { AIProvider } from '../utils/storage';

interface UsageCardProps {
    user: UserProfile | null;
    aiProvider?: AIProvider;
    isGuest?: boolean;
}

export const UsageCard: React.FC<UsageCardProps> = ({ user, aiProvider, isGuest }) => {
    // Only show for Secure LLM provider
    if (aiProvider !== 'secure_llm') return null;
    if (!user) return null;

    console.log('[UsageCard] Rendering for user:', user.email || 'Guest');
    console.log('[UsageCard] Credits:', user.trial_total_credits, 'Used:', user.trial_used_credits, 'Expires:', user.trial_expires_at);

    // "Unlimited" logic: If total credits > 100 hours (360000s) or plan is 'pro' (future proof)
    const isUnlimited = user.trial_total_credits > 360000;

    // Trial Calculations
    const totalSeconds = user.trial_total_credits || 600; // Default 10 mins for guests
    const usedSeconds = user.trial_used_credits || 0;
    const remainingSeconds = Math.max(0, totalSeconds - usedSeconds);
    const progress = Math.min(1, usedSeconds / totalSeconds);

    // Date formatting
    const expiresAt = user.trial_expires_at ? new Date(user.trial_expires_at) : null;
    const daysLeft = expiresAt
        ? Math.max(0, Math.ceil((expiresAt.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)))
        : 0;

    // Formatting helpers
    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        return `${mins} min`;
    };

    if (isUnlimited) {
        return (
            <View style={styles.card}>
                <View style={[styles.headerRow, { marginBottom: 0 }]}>
                    <Text style={styles.title}>Secure LLM Plan</Text>
                    <View style={styles.badge}>
                        <Text style={styles.badgeText}>PRO</Text>
                    </View>
                </View>
                <Text style={styles.unlimitedText}>Unlimited Access</Text>
            </View>
        );
    }

    const cardTitle = isGuest ? 'Guest Trial' : 'Free Trial';

    return (
        <View style={styles.card}>
            <View style={styles.headerRow}>
                <Text style={styles.title}>{cardTitle}</Text>
                {expiresAt && (
                    <Text style={styles.expiryText}>
                        {daysLeft > 0 ? `${daysLeft} days left` : 'Expired'}
                    </Text>
                )}
            </View>

            <View style={styles.progressContainer}>
                <View style={[styles.progressBar, { width: `${progress * 100}%` }]} />
            </View>

            <View style={styles.statsRow}>
                <Text style={styles.statsText}>
                    {formatTime(usedSeconds)} used
                </Text>
                <Text style={styles.statsText}>
                    {formatTime(totalSeconds)} limit
                </Text>
            </View>

            {daysLeft === 0 && !isGuest && (
                <Text style={styles.warningText}>Trial expired. Please upgrade.</Text>
            )}

            {isGuest && (
                <Text style={styles.hintText}>Create account to unlock full access</Text>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    card: {
        backgroundColor: theme.colors.surface,
        borderRadius: 14,
        padding: 14,
        marginBottom: 10,
        marginTop: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
    },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    title: {
        fontSize: 18,
        fontWeight: '600',
        color: theme.colors.text,
    },
    expiryText: {
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
    progressContainer: {
        height: 6,
        backgroundColor: theme.colors.background,
        borderRadius: 3,
        marginBottom: 8,
        overflow: 'hidden',
    },
    progressBar: {
        height: '100%',
        backgroundColor: theme.colors.primary,
        borderRadius: 4,
    },
    statsRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    statsText: {
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
    badge: {
        backgroundColor: theme.colors.primary,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 8,
    },
    badgeText: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 12,
    },
    unlimitedText: {
        fontSize: 16,
        color: theme.colors.primary,
        fontWeight: '500',
        marginTop: 8,
    },
    warningText: {
        color: theme.colors.error,
        marginTop: 10,
        fontSize: 14,
    },
    hintText: {
        color: theme.colors.primary,
        marginTop: 10,
        fontSize: 14,
    },
});
