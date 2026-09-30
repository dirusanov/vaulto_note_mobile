import { useTranslation } from 'react-i18next';
import React, { useEffect, useRef, useState } from 'react';
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
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { subscriptionApi, CurrentPeriodUsage } from '../api/subscription';
import { onLimitReached } from '../utils/limitEvents';
import { LOCAL_WHISPER_ENABLED } from '../utils/featureFlags';
import { setOnDeviceTranscription } from '../utils/storage';
import { isOnDeviceTranscriptionActive } from '../services/TranscriptionService';
import { LocalWhisperDownloadModal } from './LocalWhisperDownloadModal';

export const LimitModal: React.FC = () => {
    const { t } = useTranslation();

    const navigation = useNavigation();
    const [visible, setVisible] = useState(false);
    const [loading, setLoading] = useState(false);
    const [usage, setUsage] = useState<CurrentPeriodUsage | null>(null);
    const [onDeviceActive, setOnDeviceActive] = useState(true);
    const [showWhisperDownload, setShowWhisperDownload] = useState(false);
    // Several screens mount this modal; only the one on top may answer, or they stack.
    const isFocused = useIsFocused();
    const isFocusedRef = useRef(isFocused);
    isFocusedRef.current = isFocused;

    useEffect(() => {
        const unsubscribe = onLimitReached.subscribe(() => {
            if (!isFocusedRef.current) return;
            setVisible(true);
            fetchUsage();
            void isOnDeviceTranscriptionActive().then(setOnDeviceActive).catch(() => setOnDeviceActive(true));
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

    let title = t('aux.usageLimitTitle', 'Usage Limit Reached');
    let message = t('aux.usageLimitDesc', 'You have exceeded your usage limits. Please try again later or upgrade your plan.');
    let iconName: keyof typeof MaterialIcons.glyphMap = 'warning-amber';
    let isTrial = false;
    let isTranscriptionLimit = false;

    if (usage) {
        const isFree = (usage.plan || '').trim().toLowerCase() !== 'pro';
        const transEmptyPro = usage.limits.transcription_subscription_remaining_seconds <= 0;
        const transEmptyTrial = usage.limits.transcription_trial_remaining_seconds <= 0;
        const llmEmpty = usage.limits.llm_remaining_tokens <= 0;

        if (llmEmpty) {
            title = t('aux.aiLimitTitle', 'AI Limit Reached');
            message = t('aux.aiLimitDesc', 'You have exceeded your Vaulto AI tokens limit for this period. Please try again later.');
            iconName = 'auto-awesome';
        } else if (isFree && transEmptyTrial) {
            title = t('aux.trialExhaustedTitle', 'Trial Exhausted');
            message = t('aux.trialExhaustedDesc', 'You have used all your trial transcription minutes. Upgrade to PRO to get more minutes and unlock all features!');
            iconName = 'stars';
            isTrial = true;
            isTranscriptionLimit = true;
        } else if (!isFree && transEmptyPro) {
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

    // Out of transcription minutes is not a dead end: the phone can transcribe for free.
    const offerOnDevice = LOCAL_WHISPER_ENABLED && isTranscriptionLimit && !onDeviceActive && !loading;

    const whisperModal = (
        <LocalWhisperDownloadModal
            visible={showWhisperDownload}
            onClose={() => setShowWhisperDownload(false)}
            onDownloadComplete={() => {
                setShowWhisperDownload(false);
                void setOnDeviceTranscription(true);
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

                            {loading ? (
                                <View style={styles.loaderContainer}>
                                    <ActivityIndicator size="small" color={colors.primary} />
                                </View>
                            ) : (
                                <Text style={styles.message}>{message}</Text>
                            )}

                            <View style={styles.actionsRow}>
                                <TouchableOpacity onPress={handleClose} activeOpacity={0.8} style={styles.cancelButton}>
                                    <Text style={styles.cancelText}>{isTrial ? t('aux.maybeLater', 'Maybe Later') : t('common.close', 'Close')}</Text>
                                </TouchableOpacity>

                                {isTrial && (
                                    <TouchableOpacity onPress={handleUpgrade} activeOpacity={0.85} style={styles.primaryButton}>
                                        <Text style={styles.primaryText}>{t("aux.upgrade", "Upgrade")}</Text>
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
                                    <Text style={styles.onDeviceText}>{t('aux.onDeviceFree', 'Transcribe free on this phone')}</Text>
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

const styles = StyleSheet.create({
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
