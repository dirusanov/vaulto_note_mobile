import { useTranslation } from 'react-i18next';
import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { UserProfile } from '../api/auth';
import { AIProvider } from '../utils/storage';
import { ProIcon } from './ProIcon';

interface UsageCardProps {
    user: UserProfile | null;
    aiProvider?: AIProvider;
    isGuest?: boolean;
    isPro?: boolean;
    compact?: boolean;
    embedded?: boolean;
}

export const UsageCard: React.FC<UsageCardProps> = ({ user, aiProvider, isGuest, isPro = false, compact = false, embedded = false }) => {
    const { t } = useTranslation();

    // Only show for Vaulto AI provider
    if (aiProvider !== 'vaulto_ai') return null;
    if (!user) return null;

    console.log('[UsageCard] Rendering for user:', user.email || 'Guest');
    const totalSeconds = user.transcription_total_seconds ?? 1800;
    const usedSeconds = user.transcription_total_used_seconds ?? 0;
    console.log('[UsageCard] Credits:', totalSeconds, 'Used:', usedSeconds, 'Remaining:', user.transcription_remaining_seconds);

    // "Unlimited" logic: If total seconds > 100 hours (360000s)
    const isUnlimited = totalSeconds > 360000;
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

    if (compact) {
        const label = isUnlimited
            ? 'Transcription: Unlimited'
            : `Transcription left: ${formatTimeMMSS(remainingSeconds)}`;

        return (
            <View style={styles.compactWrap}>
                <View style={[styles.compactIcon, { backgroundColor: getProgressColor() + '15' }]}>
                    <MaterialIcons name="graphic-eq" size={16} color={getProgressColor()} />
                </View>
                <Text style={styles.compactText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                    {label}
                </Text>
            </View>
        );
    }

    if (isUnlimited) {
        return (
            <View style={embedded ? styles.embeddedWrap : styles.card}>
                <View style={styles.headerRow}>
                    <View style={styles.titleRow}>
                        <ProIcon
                            size={18}
                            containerSize={36}
                            backgroundColor={colors.primary + '12'}
                            borderColor={colors.primary + '30'}
                        />
                        <Text style={styles.title}>{t("aux.vaultoAIPlan", "Vaulto AI Plan")}</Text>
                    </View>
                    {/* Unified Badge */}
                    <View style={styles.proBadge}>
                        <Image
                            source={require('../../assets/icon.png')}
                            style={{
                                width: 10,
                                height: 10,
                                tintColor: '#FFFFFF',
                                opacity: 1,
                            }}
                            resizeMode="contain"
                        />
                        <Text style={styles.proBadgeText}>{t("aux.pro", "PRO")}</Text>
                    </View>
                </View>
                <View style={styles.unlimitedContainer}>
                    <MaterialIcons name="all-inclusive" size={24} color={colors.primary} />
                    <Text style={styles.unlimitedText}>{t("aux.unlimitedAccess", "Unlimited Access")}</Text>
                </View>
            </View>
        );
    }

    if (isGuest) {
        return (
            <View style={embedded ? styles.embeddedWrap : styles.card}>
                <View style={styles.headerRow}>
                    <View style={styles.titleRow}>
                        <View style={[styles.iconContainer, { backgroundColor: colors.warning + '15' }]}>
                            <MaterialIcons name="lock-outline" size={20} color={colors.warning} />
                        </View>
                        <Text style={styles.title}>{t('settings.ai.transcription', 'Transcription')}</Text>
                    </View>
                </View>
                <Text style={styles.guestText}>
                    {t('aux.createAccountTranscribe', 'Create an account to enable transcription.')}
                </Text>
            </View>
        );
    }

    return (
        <View style={embedded ? styles.embeddedWrap : styles.card}>
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
                        <Text style={styles.title}>{isPro ? 'Transcription Balance' : 'Trial Balance'}</Text>
                        <Text style={styles.subtitle}>{isPro ? 'Monthly Pro minutes' : 'One-time trial minutes'}</Text>
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
                <Text style={styles.statsLabel}>{t("settings.ui.used", "Used")}</Text>
                <Text style={styles.statsValue}>
                    {formatTimeMMSS(usedSeconds)} / {formatTimeMMSS(totalSeconds)}
                </Text>
            </View>

            {isExpired && (
                <View style={styles.expiredContainer}>
                    <View style={styles.warningBox}>
                        <MaterialIcons name="info-outline" size={18} color={colors.error} />
                        <Text style={styles.warningText}>
                            {isPro ? "You've used all monthly minutes" : `You've used all ${Math.round(totalSeconds / 60)} free minutes`}
                        </Text>
                    </View>
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
    compactWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        paddingVertical: 4,
        paddingHorizontal: 8,
        borderRadius: 999,
        backgroundColor: colors.backgroundSecondary,
        borderWidth: 1,
        borderColor: colors.border,
        flexShrink: 1,
        minWidth: 0,
    },
    embeddedWrap: {
        marginTop: spacing.s,
        paddingTop: spacing.s,
        borderTopWidth: 1,
        borderTopColor: colors.border,
    },
    compactIcon: {
        width: 22,
        height: 22,
        borderRadius: 11,
        alignItems: 'center',
        justifyContent: 'center',
    },
    compactText: {
        ...typography.caption,
        color: colors.textSecondary,
        fontWeight: '700',
        flexShrink: 1,
        minWidth: 0,
    },
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
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.primary,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 10,
        gap: 4,
        shadowColor: colors.primary,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
        elevation: 2,
    },
    proBadgeText: {
        ...typography.caption,
        color: '#fff',
        fontWeight: '800', // Extra bold
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
