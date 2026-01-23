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

    // "Unlimited" logic: If total credits > 100 hours (360000s)
    const isUnlimited = user.trial_total_credits > 360000;

    // Trial Calculations - Fixed 10 mins (600s) default if not provided
    const totalSeconds = user.trial_total_credits || 600;
    const usedSeconds = user.trial_used_credits || 0;
    const remainingSeconds = Math.max(0, totalSeconds - usedSeconds);
    const progress = Math.min(1, usedSeconds / totalSeconds);
    const isExpired = remainingSeconds <= 0;

    // Formatting helpers
    const formatTimeMMSS = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
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

    if (isGuest) {
        return (
            <View style={styles.card}>
                <View style={styles.headerRow}>
                    <Text style={styles.title}>Free Plan</Text>
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
                <Text style={styles.title}>Transcription available</Text>
            </View>

            <View style={styles.progressContainer}>
                <View style={[styles.progressBar, { width: `${progress * 100}%` }]} />
            </View>

            <View style={styles.statsRow}>
                <Text style={styles.statsText}>
                    Used: {formatTimeMMSS(usedSeconds)} / {formatTimeMMSS(totalSeconds)}
                </Text>
            </View>

            {isExpired && (
                <View style={styles.expiredContainer}>
                    <Text style={styles.warningText}>
                        You’ve used all 10 free minutes.{'\n'}Upgrade coming soon.
                    </Text>

                    <View style={styles.buttonRow}>
                        <View style={[styles.button, styles.buttonDisabled]}>
                            <Text style={styles.buttonTextDisabled}>Upgrade (soon)</Text>
                        </View>
                        <View style={[styles.button, styles.buttonSecondary]}>
                            <Text style={styles.buttonTextSecondary}>Notify me</Text>
                        </View>
                    </View>
                </View>
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
        marginBottom: 12,
    },
    title: {
        fontSize: 16,
        fontWeight: '600',
        color: theme.colors.text,
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
        marginBottom: 4,
    },
    statsText: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        fontWeight: '500',
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
    expiredContainer: {
        marginTop: 12,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
    },
    warningText: {
        color: theme.colors.text,
        fontSize: 15,
        textAlign: 'center',
        marginBottom: 12,
        fontWeight: '500',
    },
    guestText: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        marginTop: 4,
        lineHeight: 20,
    },
    buttonRow: {
        flexDirection: 'row',
        gap: 12,
        justifyContent: 'center',
    },
    button: {
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.primary,
        alignItems: 'center',
        minWidth: 120,
    },
    buttonDisabled: {
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.background,
    },
    buttonSecondary: {
        backgroundColor: 'transparent',
    },
    buttonTextDisabled: {
        color: theme.colors.textSecondary,
        fontSize: 14,
        fontWeight: '600',
    },
    buttonTextSecondary: {
        color: theme.colors.primary,
        fontSize: 14,
        fontWeight: '600',
    },
});
