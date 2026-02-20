import React, { useEffect, useState } from 'react';
import {
    Modal,
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    TouchableWithoutFeedback,
    ActivityIndicator,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { useNavigation } from '@react-navigation/native';
import { subscriptionApi, CurrentPeriodUsage } from '../api/subscription';
import { onLimitReached } from '../utils/limitEvents';

export const LimitModal: React.FC = () => {
    const navigation = useNavigation();
    const [visible, setVisible] = useState(false);
    const [loading, setLoading] = useState(false);
    const [usage, setUsage] = useState<CurrentPeriodUsage | null>(null);

    useEffect(() => {
        const unsubscribe = onLimitReached.subscribe(() => {
            setVisible(true);
            fetchUsage();
        });
        return unsubscribe;
    }, []);

    const fetchUsage = async () => {
        setLoading(true);
        try {
            const data = await subscriptionApi.getCurrentPeriodUsage();
            setUsage(data);
        } catch (error) {
            console.error('[LimitModal] Failed to fetch usage:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleClose = () => {
        setVisible(false);
    };

    const handleUpgrade = () => {
        setVisible(false);
        (navigation as any).navigate('Paywall');
    };

    let title = 'Usage Limit Reached';
    let message = 'You have exceeded your usage limits. Please try again later or upgrade your plan.';
    let iconName: keyof typeof MaterialIcons.glyphMap = 'warning-amber';
    let isTrial = false;

    if (usage) {
        const isFree = (usage.plan || '').trim().toLowerCase() !== 'pro';
        const transEmptyPro = usage.limits.transcription_subscription_remaining_seconds <= 0;
        const transEmptyTrial = usage.limits.transcription_trial_remaining_seconds <= 0;
        const llmEmpty = usage.limits.llm_remaining_tokens <= 0;

        if (llmEmpty) {
            title = 'AI Limit Reached';
            message = 'You have exceeded your Vaulto AI tokens limit for this period. Please try again later.';
            iconName = 'auto-awesome';
        } else if (isFree && transEmptyTrial) {
            title = 'Trial Exhausted';
            message = 'You have used all your trial transcription minutes. Upgrade to PRO to get more minutes and unlock all features!';
            iconName = 'stars';
            isTrial = true;
        } else if (!isFree && transEmptyPro) {
            title = 'Transcription Limit Reached';
            const resetDate = usage.subscription_next_refill_at
                ? new Date(usage.subscription_next_refill_at).toLocaleDateString()
                : 'your next billing cycle';
            message = `You have used all your PRO transcription minutes for this period. Your limit will reset on ${resetDate}.`;
            iconName = 'mic-off';
        }
    }

    if (!visible) return null;

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={handleClose}
        >
            <TouchableWithoutFeedback onPress={handleClose}>
                <View style={styles.overlay}>
                    <TouchableWithoutFeedback>
                        <View style={styles.modal}>
                            <View style={styles.iconContainer}>
                                <MaterialIcons
                                    name={iconName}
                                    size={28}
                                    color={isTrial ? colors.warning : colors.primary}
                                />
                            </View>

                            <Text style={styles.title}>{title}</Text>

                            {loading ? (
                                <View style={styles.loaderContainer}>
                                    <ActivityIndicator size="small" color={colors.primary} />
                                </View>
                            ) : (
                                <Text style={styles.message}>{message}</Text>
                            )}

                            <View style={styles.actionsRow}>
                                <TouchableOpacity onPress={handleClose} activeOpacity={0.8} style={styles.cancelButton}>
                                    <Text style={styles.cancelText}>{isTrial ? 'Maybe Later' : 'Close'}</Text>
                                </TouchableOpacity>

                                {isTrial && (
                                    <TouchableOpacity onPress={handleUpgrade} activeOpacity={0.85} style={styles.primaryButton}>
                                        <Text style={styles.primaryText}>Upgrade</Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                        </View>
                    </TouchableWithoutFeedback>
                </View>
            </TouchableWithoutFeedback>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.38)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: spacing.l,
    },
    modal: {
        backgroundColor: colors.surface,
        borderRadius: 24,
        padding: spacing.xl,
        width: '100%',
        maxWidth: 360,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.12,
        shadowRadius: 22,
        elevation: 10,
        borderWidth: 1,
        borderColor: colors.border,
    },
    iconContainer: {
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: `${colors.backgroundSecondary}`,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: spacing.m,
    },
    title: {
        ...typography.h3,
        textAlign: 'center',
        marginBottom: spacing.xs,
        color: colors.text,
    },
    loaderContainer: {
        marginVertical: spacing.l,
        height: 22,
        justifyContent: 'center',
    },
    message: {
        ...typography.body,
        textAlign: 'center',
        color: colors.textSecondary,
        marginBottom: spacing.l,
        lineHeight: 22,
    },
    actionsRow: {
        flexDirection: 'row',
        width: '100%',
        gap: spacing.s,
    },
    cancelButton: {
        flex: 1,
        height: 46,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.backgroundSecondary,
        borderWidth: 1,
        borderColor: colors.border,
    },
    cancelText: {
        ...typography.button,
        color: colors.textSecondary,
    },
    primaryButton: {
        flex: 1,
        height: 46,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.primary,
    },
    primaryText: {
        ...typography.button,
        color: colors.surface,
    },
});
