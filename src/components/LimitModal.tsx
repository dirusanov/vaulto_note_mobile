import { useTranslation } from 'react-i18next';
import React, { useEffect, useRef, useState } from 'react';
import {
    Modal,
    View,
    Text,
    TouchableOpacity,
    TouchableWithoutFeedback,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { subscriptionApi, CurrentPeriodUsage } from '../api/subscription';
import { onLimitReached, setLimitSheetOpen } from '../utils/limitEvents';
import { LLM_LIMIT_REASON, markAiLimitReached } from '../utils/aiLimitState';
import { LOCAL_WHISPER_ENABLED } from '../utils/featureFlags';
import { isOnDeviceTranscriptionActive } from '../services/TranscriptionService';
import { LocalWhisperDownloadModal } from './LocalWhisperDownloadModal';
import { createStyles } from '../theme/createStyles';
import { useAuth } from '../hooks/useAuth';

export const LimitModal: React.FC = () => {
    const { t } = useTranslation();

    const navigation = useNavigation();
    const { isAuthenticated, isGuest, user } = useAuth();
    const isGuestUser = !isAuthenticated || isGuest;
    const [visible, setVisible] = useState(false);
    // The server's reason, when the emitter passes one (`meta.reason` of the 403).
    const [limitReason, setLimitReason] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [usage, setUsage] = useState<CurrentPeriodUsage | null>(null);
    const [onDeviceActive, setOnDeviceActive] = useState(true);
    const [showWhisperDownload, setShowWhisperDownload] = useState(false);
    // Several screens mount this modal; only the one on top may answer, or they stack.
    const isFocused = useIsFocused();
    const isFocusedRef = useRef(isFocused);
    isFocusedRef.current = isFocused;

    useEffect(() => {
        const unsubscribe = onLimitReached.subscribe((reason?: string) => {
            if (!isFocusedRef.current) return;
            setLimitReason(typeof reason === 'string' ? reason : null);
            setVisible(true);
            fetchUsage(typeof reason === 'string' ? reason : null);
            void isOnDeviceTranscriptionActive().then(setOnDeviceActive).catch(() => setOnDeviceActive(true));
        });
        return unsubscribe;
    }, []);

    // Others (the note screen's queued prompts) wait while this sheet is up.
    useEffect(() => {
        setLimitSheetOpen(visible);
        return () => setLimitSheetOpen(false);
    }, [visible]);

    const fetchUsage = async (reason: string | null) => {
        setLoading(true);
        try {
            const data = await subscriptionApi.getCurrentPeriodUsage();
            setUsage(data);
            // The server may refuse with tokens left (less than the request needs):
            // the refusal decides, the usage only tells when it resets.
            if (reason === LLM_LIMIT_REASON) markAiLimitReached(data?.period_end_at);
        } catch (error) {
            console.warn('[LimitModal] Failed to fetch usage:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleClose = () => {
        setVisible(false);
    };

    const handleUpgrade = () => {
        setVisible(false);
        // A guest signs in first: the account brings its own free minutes.
        (navigation as any).navigate(isGuestUser ? 'SignIn' : 'Paywall');
    };

    let title = t('aux.usageLimitTitle', 'Usage Limit Reached');
    let message = t('aux.usageLimitDesc', 'You have exceeded your usage limits. Please try again later or upgrade your plan.');
    let iconName: keyof typeof MaterialIcons.glyphMap = 'warning-amber';
    let isTrial = false;
    let isTranscriptionLimit = false;
    let showUpgrade = false;

    // The plan before usage arrives comes from the profile, so the sheet reads
    // right from the first frame instead of showing a spinner.
    const planName = (usage?.plan ?? user?.plan ?? '').trim().toLowerCase();
    const isFreePlan = usage ? planName !== 'pro' : !(user?.is_pro || planName === 'pro');
    // The server's code says which allowance ran out. Without one (older
    // servers), the usage figures tell, AI first as before.
    const llmEmpty = !!usage && usage.limits.llm_remaining_tokens <= 0;
    const isAiLimit = limitReason ? limitReason === LLM_LIMIT_REASON : llmEmpty;

    if (isAiLimit) {
        const resetAt = usage?.period_end_at ?? user?.current_usage_period_end_at ?? null;
        title = t('aux.aiLimitTitle', 'AI Limit Reached');
        message = isGuestUser
            ? t('aux.aiLimitGuestDesc', 'Sign in to get your own monthly AI allowance.')
            : resetAt
                ? t('aux.aiLimitDescDate', 'You have used this month\'s AI allowance. It resets on {{date}}.', {
                    date: new Date(resetAt).toLocaleDateString(),
                })
                : t('aux.aiLimitDescNoDate', 'You have used this month\'s AI allowance. It resets at the start of your next period.');
        iconName = 'auto-awesome';
        // Signed-in free users can upgrade; guests sign in for an allowance of their own.
        showUpgrade = isGuestUser || isFreePlan;
    } else if (usage) {
        const transEmptyPro = usage.limits.transcription_subscription_remaining_seconds <= 0;
        const transEmptyTrial = usage.limits.transcription_trial_remaining_seconds <= 0;

        if (isFreePlan && transEmptyTrial) {
            title = t('aux.trialExhaustedTitle', 'Trial Exhausted');
            message = t('aux.trialExhaustedDesc', 'You have used all your trial transcription minutes. Upgrade to PRO to get more minutes and unlock all features!');
            iconName = 'stars';
            isTrial = true;
            isTranscriptionLimit = true;
        } else if (!isFreePlan && transEmptyPro) {
            title = t('aux.transcriptionLimitTitle', 'Transcription Limit Reached');
            message = usage.subscription_next_refill_at
                ? t('aux.transcriptionLimitDescDate', 'You have used all your PRO transcription minutes for this period. Your limit will reset on {{date}}.', {
                    date: new Date(usage.subscription_next_refill_at).toLocaleDateString(),
                })
                : t('aux.transcriptionLimitDescNoDate', 'You have used all your PRO transcription minutes for this period. Your limit will reset at the start of your next billing cycle.');
            iconName = 'mic-off';
            isTranscriptionLimit = true;
        }
    }

    // A guest can be refused while still holding free minutes: all guests share a
    // daily cloud budget (gateway code "guest_budget_exhausted"). The reason comes
    // from the 403 body; without one, a balance left over means that budget.
    const guestSecondsLeft = usage
        ? usage.limits.transcription_trial_remaining_seconds + usage.limits.transcription_subscription_remaining_seconds
        : user?.transcription_remaining_seconds;
    const guestCloudBusy = isGuestUser && (limitReason
        ? limitReason === 'guest_budget_exhausted'
        : typeof guestSecondsLeft === 'number' && guestSecondsLeft > 0);

    if (isGuestUser && !isAiLimit) {
        title = guestCloudBusy
            ? t('aux.guestBusyTitle', 'Cloud transcription is busy')
            : t('aux.guestMinutesUsedTitle', 'Free minutes used up');
        message = guestCloudBusy
            ? t('aux.guestBusyDesc', 'Free cloud transcription without an account is busy right now. Sign in for your own free minutes, or turn speech into text on this device — free and offline.')
            : t('aux.guestMinutesUsedDesc', 'Sign in to get more free minutes and sync your notes. Or turn speech into text right on this device — free and offline.');
        iconName = guestCloudBusy ? 'cloud-queue' : 'stars';
        isTrial = true;
        isTranscriptionLimit = true;
    }
    showUpgrade = showUpgrade || isTrial;

    // Out of transcription minutes is not a dead end: the phone can transcribe for free.
    const offerOnDevice = LOCAL_WHISPER_ENABLED && isTranscriptionLimit && !onDeviceActive && !loading;

    const whisperModal = (
        <LocalWhisperDownloadModal
            visible={showWhisperDownload}
            onClose={() => setShowWhisperDownload(false)}
            onDownloadComplete={() => {
                // No "always on device" switch: out of minutes, recordings fall
                // back to this model, and the cloud returns with new minutes.
                setShowWhisperDownload(false);
            }}
        />
    );

    if (!visible) return whisperModal;

    return (
        <>
        {whisperModal}
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

                            {/* Shown at once and refined when usage arrives: a spinner-only
                                body made the buttons jump under the finger. */}
                            <Text style={styles.message}>{message}</Text>

                            <View style={styles.actionsRow}>
                                <TouchableOpacity onPress={handleClose} activeOpacity={0.8} style={styles.cancelButton}>
                                    <Text style={styles.cancelText}>{showUpgrade ? t('aux.maybeLater', 'Maybe Later') : t('common.close', 'Close')}</Text>
                                </TouchableOpacity>

                                {showUpgrade && (
                                    <TouchableOpacity onPress={handleUpgrade} activeOpacity={0.85} style={styles.primaryButton}>
                                        <Text style={styles.primaryText}>{isGuestUser ? t('auth.signIn', 'Sign In') : t("aux.upgrade", "Upgrade")}</Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                            {offerOnDevice && (
                                <TouchableOpacity
                                    onPress={() => { setVisible(false); setShowWhisperDownload(true); }}
                                    activeOpacity={0.85}
                                    style={styles.onDeviceButton}
                                    accessibilityRole="button"
                                >
                                    <MaterialIcons name="phonelink-lock" size={18} color={colors.primary} />
                                    <Text style={styles.onDeviceText}>{t('aux.onDeviceFree', 'Transcribe free on this device')}</Text>
                                </TouchableOpacity>
                            )}
                        </View>
                    </TouchableWithoutFeedback>
                </View>
            </TouchableWithoutFeedback>
        </Modal>
        </>
    );
};

const styles = createStyles(() => ({
    onDeviceButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        alignSelf: 'stretch',
        minHeight: 48,
        marginTop: spacing.m,
        borderRadius: 14,
        backgroundColor: colors.primaryLight,
    },
    onDeviceText: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.primary,
    },
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
        color: colors.onPrimary,
    },
}));
