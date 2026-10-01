import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Switch, Alert, Linking, Modal, Pressable, Platform, Image, Animated, Easing } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import appConfig from '../../app.json';
import { ScreenContainer } from '../components/ScreenContainer';
import { Button } from '../components/Button';
import { TextInput } from '../components/TextInput';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { useAuth } from '../hooks/useAuth';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import {
    AIProvider,
    TranscriptionLanguage,
    getAIProvider,
    getOpenAIApiKey,
    getOpenAIBaseUrl,
    getLegacySelfHostedApiKey,
    setAIProvider,
    setOpenAIApiKey,
    setOpenAIBaseUrl,
    getAgentModeEnabled,
    setAgentModeEnabled,
    getTranscriptionEnabled,
    setTranscriptionEnabled,
    getTranscriptionLanguage,
    setTranscriptionLanguage,
    getOnDeviceTranscription,
    setOnDeviceTranscription,
} from '../utils/storage';
import { LocalWhisperDownloadModal } from '../components/LocalWhisperDownloadModal';
import { OnDeviceModelSection, OnDeviceModelState, OnDeviceModelOption, formatModelSize } from '../components/OnDeviceModelSection';
import { hasRoomForModel } from '../services/modelDownload';
import { testOpenAIConnection } from '../services/TranscriptionService';
import { SignInRequiredModal } from '../components/SignInRequiredModal';
import { AgentModeVaultoGateModal } from '../components/AgentModeVaultoGateModal';
import { DeleteConfirmationDialog } from '../components/DeleteConfirmationDialog';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { UsageCard } from '../components/UsageCard';
import { SignOutChoiceDialog } from '../components/SignOutChoiceDialog';
import { useEncryption } from '../context/EncryptionContext';
import { EnableSyncModal } from '../components/EnableSyncModal';
import { UnlockSyncModal } from '../components/UnlockSyncModal';
import { UnlockingOverlay } from '../components/UnlockingOverlay';
import { DisableSyncModal } from '../components/DisableSyncModal';
import { DisableEncryptionModal } from '../components/DisableEncryptionModal';
import { syncService } from '../services/SyncService';
import { useSubscription } from '../context/SubscriptionContext';
import { CurrentPeriodUsage, subscriptionApi } from '../api/subscription';
import { ProIcon } from '../components/ProIcon';
import { DEFAULT_OPENAI_BASE_URL, normalizeOpenAIBaseUrl } from '../utils/openaiCompat';
import * as Clipboard from 'expo-clipboard';
import { SecurityInfoModal } from '../components/SecurityInfoModal';
import { LOCAL_MODELS_ENABLED, LOCAL_WHISPER_ENABLED } from '../utils/featureFlags';
import {
    cancelLocalWhisperDownload,
    deleteLocalWhisperModel,
    downloadLocalWhisperModel,
    getAvailableLocalWhisperModels,
    getLocalWhisperModelStatus,
    LocalWhisperModelKey,
    setSelectedLocalWhisperModel,
    isLocalWhisperModelSupportedByDevice,
    canFitLocalWhisperModel,
} from '../services/LocalWhisperService';
import {
    cancelLocalLLMDownload,
    deleteLocalLLMModel,
    downloadLocalLLMModel,
    getAvailableLocalLLMModels,
    getLocalLLMModelStatus,
    isLocalLLMRuntimeAvailable,
    LocalLLMModelKey,
    setSelectedLocalLLMModel,
    isLocalLLMModelSupportedByDevice,
    getRecommendedLocalLLMModelKey,
} from '../services/LocalLLMService';
import { SearchableLanguageSelector } from '../components/SearchableLanguageSelector';
import { RecoveryCodeModal } from '../components/RecoveryCodeModal';

const formatSubscriptionDate = (isoDate: string | null) => {
    if (!isoDate) return null;
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
};

const getDaysUntilDate = (isoDate: string | null) => {
    if (!isoDate) return null;
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return null;
    const diffMs = date.getTime() - Date.now();
    return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
};

interface SubscriptionStatusSectionProps {
    isAuthenticated: boolean;
    isGuest: boolean;
    isPro: boolean;
    isLoading: boolean;
    onUpgrade: () => void;
    onOpenMinutesSheet: () => void;
    canManageSubscription: boolean;
    onManageSubscription: () => void;
}

const SubscriptionStatusSection: React.FC<SubscriptionStatusSectionProps> = ({
    isAuthenticated,
    isGuest,
    isPro,
    isLoading,
    onUpgrade,
    onOpenMinutesSheet,
    canManageSubscription,
    onManageSubscription,
}) => {
    const { t } = useTranslation();
    
    if (!isAuthenticated || isGuest) return null;

    if (isLoading) {
        return <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: spacing.s }} />;
    }

    if (isPro) {
        return (
            <View style={styles.proStatusCard}>
                <View style={styles.proStatusHeader}>
                    {/* Unified PRO Badge with Crown */}
                    <View style={{ alignItems: 'center' }}>
                        <MaterialCommunityIcons
                            name="crown"
                            size={32}
                            color="#FCD34D"
                            style={{
                                marginBottom: -12,
                                transform: [{ rotate: '-15deg' }],
                                zIndex: 1,
                                shadowColor: '#FCD34D',
                                shadowOffset: { width: 0, height: 3 },
                                shadowOpacity: 0.7,
                                shadowRadius: 4,
                            }}
                        />
                        <View style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            backgroundColor: colors.primary,
                            paddingHorizontal: 8,
                            paddingVertical: 4,
                            borderRadius: 10, // Pill shape
                            gap: 4,
                            shadowColor: colors.primary,
                            shadowOffset: { width: 0, height: 2 },
                            shadowOpacity: 0.3,
                            shadowRadius: 4,
                            elevation: 2,
                        }}>
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
                            <Text style={{
                                ...typography.caption,
                                color: '#fff',
                                fontWeight: '800', // Extra bold
                                fontSize: 11,
                                letterSpacing: 0.5,
                            }}>{t('common.pro')}</Text>
                        </View>
                    </View>

                    {/* Spacer to push "ACTIVE" to the right */}
                    <View style={{ flex: 1 }} />

                    <View style={styles.proStatusPill}>
                        <Text style={styles.proStatusPillText}>{t('settings.ui.activeCaps')}</Text>
                    </View>
                </View>
                <TouchableOpacity
                    style={styles.proStatusAction}
                    onPress={onOpenMinutesSheet}
                    activeOpacity={0.9}
                >
                    <View style={styles.proStatusActionLeft}>
                        <MaterialIcons name="receipt-long" size={16} color={colors.primary} />
                        <Text style={[styles.proStatusActionText, { color: colors.textSecondary, fontWeight: 'normal', fontSize: 13 }]}>{t('settings.ui.subscriptionDetails')}</Text>
                    </View>
                    <MaterialIcons name="chevron-right" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
                {canManageSubscription && (
                    <TouchableOpacity
                        style={styles.proStatusAction}
                        onPress={onManageSubscription}
                        activeOpacity={0.9}
                    >
                        <View style={styles.proStatusActionLeft}>
                            <MaterialIcons name="manage-accounts" size={16} color={colors.primary} />
                            <Text style={[styles.proStatusActionText, { color: colors.textSecondary, fontWeight: 'normal', fontSize: 13 }]}>
                                {t('settings.ui.manageGooglePlay')}
                            </Text>
                        </View>
                        <MaterialIcons name="open-in-new" size={16} color={colors.textSecondary} />
                    </TouchableOpacity>
                )}
            </View>
        );
    }

    return (
        <View style={styles.premiumUpgradeCard}>
            <TouchableOpacity style={styles.premiumUpgradeRow} onPress={onUpgrade} activeOpacity={0.9}>
                <View style={styles.premiumUpgradeIcon}>
                    <ProIcon
                        size={22}
                        containerSize={40}
                        backgroundColor="#FFF7E6"
                        borderColor="#FCD34D"
                    />
                </View>
                <View style={styles.premiumUpgradeCopy}>
                    <Text style={styles.premiumUpgradeTitle}>{t('settings.pro.upgrade')}</Text>
                    <Text style={styles.premiumUpgradeSubtitle}>
                        {t('settings.pro.subtitle')}
                    </Text>
                </View>
                <MaterialIcons name="chevron-right" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
        </View>
    );
};



export const SettingsScreen = () => {
    const navigation = useNavigation<any>();
    const { t, i18n } = useTranslation();
    const [showAppLanguageModal, setShowAppLanguageModal] = useState(false);
    const appLanguages = [
        { key: 'en', label: 'English' },
        { key: 'ru', label: 'Русский' },
        { key: 'es', label: 'Español' },
        { key: 'fr', label: 'Français' },
        { key: 'de', label: 'Deutsch' },
        { key: 'zh', label: '中文' },
        { key: 'ja', label: '日本語' },
        { key: 'pt', label: 'Português' },
        { key: 'ar', label: 'العربية' },
        { key: 'hi', label: 'हिन्दी' }
    ];

    const changeAppLanguage = async (lang: string) => {
        await i18n.changeLanguage(lang);
        await AsyncStorage.setItem('user_language', lang);
        setShowAppLanguageModal(false);
    };
    const { signOut, isAuthenticated, isGuest, user, userId, refreshProfile } = useAuth();
    const {
        isPro,
        subscriptionStatus,
        isLoading: subscriptionLoading,
    } = useSubscription();
    const {
        status: encryptionStatus,
        mode: encryptionMode,
        syncEnabled,
        syncLocked,
        resetRecoveryPending,
        hasRemoteKeyBundle,
        recoveryCode,
        setSyncEnabledPreference,
        keepResetArchiveLocal,
        resumeStandardSyncAfterReset,
    } = useEncryption();

    const [apiKey, setApiKeyState] = useState('');
    const [openAIBaseUrl, setOpenAIBaseUrlState] = useState(DEFAULT_OPENAI_BASE_URL);
    const [agentModeEnabled, setAgentModeEnabledState] = useState(true);
    const [transcriptionEnabled, setTranscriptionEnabledState] = useState(true);
    const [transcriptionLanguage, setTranscriptionLanguageState] = useState<TranscriptionLanguage>('auto');
    const [testingConnection, setTestingConnection] = useState(false);
    const [aiProvider, setAiProviderState] = useState<AIProvider>('vaulto_ai');
    const [preferencesReady, setPreferencesReady] = useState(false);
    const [showSignOutDialog, setShowSignOutDialog] = useState(false);
    const [showEnableSyncModal, setShowEnableSyncModal] = useState(false);
    const [showChangeSecretModal, setShowChangeSecretModal] = useState(false);
    const [showUnlockSyncModal, setShowUnlockSyncModal] = useState(false);
    const [showUnlockingOverlay, setShowUnlockingOverlay] = useState(false);
    const [unlockProgress, setUnlockProgress] = useState<number | null>(null);
    const [showRecoveryCodeModal, setShowRecoveryCodeModal] = useState(false);
    const [unlockErrorMessage, setUnlockErrorMessage] = useState<string | null>(null);
    const [showMinutesSheet, setShowMinutesSheet] = useState(false);

    const [showOpenAIKey, setShowOpenAIKey] = useState(false);
    // "Custom AI" opened without a saved key only reveals its form; the
    // provider switches once a connection test succeeds, so peeking at the
    // tab can no longer leave the app pointed at an unconfigured endpoint.
    const [customAIPending, setCustomAIPending] = useState(false);
    const [openAITestStatus, setOpenAITestStatus] = useState<{ type: 'idle' | 'success' | 'error'; message: string }>({
        type: 'idle',
        message: '',
    });
    const [showTranscriptionAuthModal, setShowTranscriptionAuthModal] = useState(false);
    const [showSecurityAuthModal, setShowSecurityAuthModal] = useState(false);
    const [showDisableSyncModal, setShowDisableSyncModal] = useState(false);
    const [showDisableEncryptionModal, setShowDisableEncryptionModal] = useState(false);
    const [showAgentVaultoGate, setShowAgentVaultoGate] = useState(false);
    const [showLocalWhisperDeleteConfirm, setShowLocalWhisperDeleteConfirm] = useState(false);
    // Every model's state (on the phone? fits this phone?), not only the selected one.
    const [whisperModelStates, setWhisperModelStates] = useState<Record<string, OnDeviceModelState>>({});
    const [llmModelStates, setLLMModelStates] = useState<Record<string, OnDeviceModelState>>({});
    const [recommendedLLMKey, setRecommendedLLMKey] = useState<string | null>(null);
    const [whisperDeleteKey, setWhisperDeleteKey] = useState<string | null>(null);
    const [llmDeleteKey, setLLMDeleteKey] = useState<string | null>(null);
    const [providerGate, setProviderGate] = useState<null | { kind: 'signin' | 'upgrade'; providerTitle: string }>(null);
    const [showSecurityInfoModal, setShowSecurityInfoModal] = useState(false);
    const [currentPeriodUsage, setCurrentPeriodUsage] = useState<CurrentPeriodUsage | null>(null);
    const [localWhisperStatus, setLocalWhisperStatus] = useState<Awaited<ReturnType<typeof getLocalWhisperModelStatus>> | null>(null);
    const [onDeviceTranscription, setOnDeviceTranscriptionState] = useState(false);
    const [showWhisperDownload, setShowWhisperDownload] = useState(false);
    const [localWhisperBusy, setLocalWhisperBusy] = useState(false);
    const [localWhisperProgress, setLocalWhisperProgress] = useState(0);
    const [localWhisperBytesLoaded, setLocalWhisperBytesLoaded] = useState(0);
    const [localWhisperBytesTotal, setLocalWhisperBytesTotal] = useState(0);
    const [isDownloadingLocalWhisper, setIsDownloadingLocalWhisper] = useState(false);
    const [localLLMStatus, setLocalLLMStatus] = useState<Awaited<ReturnType<typeof getLocalLLMModelStatus>> | null>(null);
    const [localLLMBusy, setLocalLLMBusy] = useState(false);
    const [localLLMProgress, setLocalLLMProgress] = useState(0);
    const [localLLMBytesLoaded, setLocalLLMBytesLoaded] = useState(0);
    const [localLLMBytesTotal, setLocalLLMBytesTotal] = useState(0);
    const [isDownloadingLocalLLM, setIsDownloadingLocalLLM] = useState(false);
    const [showLocalLLMDeleteConfirm, setShowLocalLLMDeleteConfirm] = useState(false);
    const [showModelMissingWarning, setShowModelMissingWarning] = useState(false);
    const [showAdvancedAI, setShowAdvancedAI] = useState(false);
    const warningOpacity = useRef(new Animated.Value(0)).current;
    const warningTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Agent Mode Animation - Swaying
    const swayAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (agentModeEnabled) {
            // Sway animation sequence
            Animated.loop(
                Animated.sequence([
                    // Tilt left
                    Animated.timing(swayAnim, {
                        toValue: -1,
                        duration: 1000,
                        easing: Easing.inOut(Easing.ease),
                        useNativeDriver: true,
                    }),
                    // Tilt right
                    Animated.timing(swayAnim, {
                        toValue: 1,
                        duration: 1000,
                        easing: Easing.inOut(Easing.ease),
                        useNativeDriver: true,
                    }),
                    // Return to center
                    Animated.timing(swayAnim, {
                        toValue: 0,
                        duration: 1000,
                        easing: Easing.inOut(Easing.ease),
                        useNativeDriver: true,
                    }),
                    // Pause
                    Animated.delay(2000)
                ])
            ).start();
        } else {
            swayAnim.stopAnimation();
            Animated.timing(swayAnim, {
                toValue: 0,
                duration: 300,
                useNativeDriver: true,
            }).start();
        }
    }, [agentModeEnabled]);

    const sway = swayAnim.interpolate({
        inputRange: [-1, 1],
        outputRange: ['-15deg', '15deg'],
    });

    const usingOpenAI = aiProvider === 'openai';
    const showCustomAIConfig = usingOpenAI || customAIPending;
    const usingLocalWhisper = LOCAL_MODELS_ENABLED && ((aiProvider as string) === 'local_whisper' || (aiProvider as string) === 'local');
    const usingLocalLLM = LOCAL_MODELS_ENABLED && ((aiProvider as string) === 'local_llm' || (aiProvider as string) === 'local');
    const localLLMRuntimeAvailable = isLocalLLMRuntimeAvailable();
    const usingLocal = usingLocalWhisper || usingLocalLLM;
    const trialInfoText = t('settings.ui.trialInfo');
    const hasConfiguredKey = encryptionMode === 'e2ee';
    const isSyncLocked = syncLocked || encryptionStatus === 'locked';
    const syncStatusLabel = encryptionStatus === 'loading' ? t('settings.ui.checking') : (isSyncLocked ? t('settings.ui.locked') : !syncEnabled ? t('settings.ui.off') : t('settings.ui.on'));
    const syncStatusColor = encryptionStatus === 'loading' ? colors.textSecondary : (isSyncLocked ? colors.warning : !syncEnabled ? colors.textSecondary : colors.accentGreen);
    const syncToggleDisabled = !isAuthenticated || isGuest;
    const isGuestOrAnonymous = !isAuthenticated || isGuest;
    const onDeviceTranscriptionActive = LOCAL_WHISPER_ENABLED && onDeviceTranscription && !!localWhisperStatus?.isDownloaded;
    const transcriptionAuthRequired = isGuestOrAnonymous && aiProvider === 'vaulto_ai' && !onDeviceTranscriptionActive;
    const isSubscriptionActive = Platform.OS === 'android' && !!subscriptionStatus?.isActive;

    // The agent runs on the server, so it is unavailable with Custom AI and on-device
    // AI. That is shown, not stored: the user's choice comes back with Vaulto AI.
    const agentUnavailable = usingOpenAI || usingLocalWhisper || usingLocalLLM || aiProvider === ('local' as any);

    // What each on-device model is for, in plain words. Whisper Large is left out
    // unless already on the phone: Turbo matches it at a fifth of the size.
    const whisperModelOptions: OnDeviceModelOption[] = getAvailableLocalWhisperModels()
        .filter((m) => m.key !== 'large' || whisperModelStates.large?.downloaded || localWhisperStatus?.selectedModel.key === 'large')
        .sort((a, b) => a.sizeBytes - b.sizeBytes)
        .map((m) => ({
            key: m.key,
            label: m.label,
            sizeBytes: m.sizeBytes,
            recommended: m.key === 'turbo' ? whisperModelStates.turbo?.available !== false : m.key === 'base' && whisperModelStates.turbo?.available === false,
            description: {
                tiny: t('localModels.whisperTiny', 'Fastest, basic accuracy'),
                base: t('localModels.whisperBase', 'Fast, more accurate than Tiny'),
                turbo: t('localModels.whisperTurbo', 'Most accurate, a bit slower'),
                large: t('localModels.whisperLarge', 'Largest; Turbo is as accurate'),
            }[m.key] ?? '',
        }));
    const llmModelOptions: OnDeviceModelOption[] = getAvailableLocalLLMModels()
        .sort((a, b) => a.sizeBytes - b.sizeBytes)
        .map((m) => ({
            key: m.key,
            label: m.label,
            sizeBytes: m.sizeBytes,
            recommended: m.key === recommendedLLMKey,
            description: {
                'qwen3.5-0.8b': t('localModels.llm08', 'For older phones, simple edits'),
                'qwen3.5-2b': t('localModels.llm2', 'Fast, good for short notes'),
                'qwen3.5-4b': t('localModels.llm4', 'Best answers, needs 6 GB+ RAM'),
            }[m.key] ?? '',
        }));

    const openManageSubscription = useCallback(async () => {
        const fallbackGooglePlayUrl = 'https://play.google.com/store/account/subscriptions';
        const targetUrl = (Platform.OS === 'android'
            ? (subscriptionStatus?.managementURL || fallbackGooglePlayUrl)
            : subscriptionStatus?.managementURL) || fallbackGooglePlayUrl;

        try {
            const supported = await Linking.canOpenURL(targetUrl);
            if (!supported) {
                Alert.alert(t("common.unavailable"), t("aux.unableOpenSubscription"));
                return;
            }
            await Linking.openURL(targetUrl);
        } catch (error) {
            console.error('Failed to open subscription management URL:', error);
            Alert.alert(t("common.unavailable"), t("aux.unableOpenSubscription"));
        }
    }, [subscriptionStatus?.managementURL]);

    const handleToggleSync = useCallback(async (enabled: boolean) => {
        if (syncToggleDisabled) {
            setShowSecurityAuthModal(true);
            return;
        }

        if (enabled) {
            try {
                await setSyncEnabledPreference(true);
                if (encryptionStatus === 'locked') {
                    setShowUnlockSyncModal(true);
                    return;
                }
                setTimeout(() => {
                    void syncService.syncNow('manual');
                }, 0);
            } catch (error: any) {
                Alert.alert(t("common.failed"), error?.message || t("aux.unableEnableSync"));
            }
            return;
        }

        setShowDisableSyncModal(true);
    }, [encryptionStatus, setSyncEnabledPreference, syncToggleDisabled, t]);

    const confirmKeepResetArchiveLocal = useCallback(() => {
        Alert.alert(
            t('settings.resetRecovery.keepTitle', 'Keep notes only on this device?'),
            t('settings.resetRecovery.keepDescription', 'The recovered notes will remain local and cloud sync will stay off.'),
            [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('settings.resetRecovery.keepLocal', 'Keep local'),
                    onPress: () => {
                        void keepResetArchiveLocal().catch((error: any) => {
                            Alert.alert(t('common.failed', 'Failed'), error?.message || t('aux.somethingWentWrong', 'Something went wrong'));
                        });
                    },
                },
            ],
        );
    }, [keepResetArchiveLocal, t]);

    const confirmStandardResetRecovery = useCallback(() => {
        Alert.alert(
            t('settings.resetRecovery.standardTitle', 'Sync without E2EE?'),
            t('settings.resetRecovery.standardDescription', 'Your recovered notes will be uploaded using standard sync. Vaulto can technically process their contents.'),
            [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('settings.resetRecovery.standardAction', 'Use standard sync'),
                    style: 'destructive',
                    onPress: () => {
                        void resumeStandardSyncAfterReset().catch((error: any) => {
                            Alert.alert(t('common.failed', 'Failed'), error?.message || t('aux.somethingWentWrong', 'Something went wrong'));
                        });
                    },
                },
            ],
        );
    }, [resumeStandardSyncAfterReset, t]);

    type ProviderOption = {
        key: AIProvider;
        title: string;
        blurb: string;
        description: string;
        icon: string;
        accent: string;
        chips: string[];
        isLocked?: boolean;
        proMessage?: string;
    };

    const providerOptions: ProviderOption[] = [
        {
            key: 'vaulto_ai',
            title: 'Vaulto AI',
            blurb: 'Private & Anonymous',
            description: 'Whisper + LLM on our server. No data stored or analyzed. Fully anonymous and secure.',
            icon: 'security',
            accent: colors.primary,
            chips: ['Zero retention', 'Anonymous', 'Trial'],
            isLocked: isGuestOrAnonymous,
        },
        {
            key: 'openai',
            title: 'Custom AI',
            blurb: 'OpenAI & Compatible APIs',
            description: 'Works with OpenAI, self-hosted servers, and any OpenAI-compatible API endpoints.',
            icon: 'dns',
            accent: colors.accentGreen,
            chips: ['OpenAI', 'Custom', 'Self-hosted'],
        },
        ...(LOCAL_MODELS_ENABLED ? [{
            key: 'local' as AIProvider,
            title: 'Local',
            blurb: 'On-device AI',
            description: 'Uses on-device models for both transcription and reasoning, ensuring maximum privacy and offline capability.',
            icon: 'memory',
            accent: '#0F766E',
            chips: ['Offline', 'Private'],
        }] : []),
    ];


    const refreshModelStates = useCallback(async () => {
        const describe = async (
            key: string,
            isDownloaded: Promise<boolean>,
            supported: Promise<boolean>,
            fits: Promise<boolean>,
        ): Promise<[string, OnDeviceModelState]> => {
            const [downloaded, ok, room] = await Promise.all([isDownloaded, supported, fits]);
            return [key, {
                downloaded,
                available: ok && room,
                unavailableReason: !ok
                    ? t('localModels.notEnoughMemory', 'Needs more memory than this phone has')
                    : t('localModels.notEnoughSpace', 'Not enough free space'),
            }];
        };
        try {
            const [whisperEntries, llmEntries, recommended] = await Promise.all([
                Promise.all(getAvailableLocalWhisperModels().map((m) => describe(
                    m.key,
                    getLocalWhisperModelStatus(m.key).then((st) => st.isDownloaded),
                    isLocalWhisperModelSupportedByDevice(m.key),
                    canFitLocalWhisperModel(m.key),
                ))),
                Promise.all(getAvailableLocalLLMModels().map((m) => describe(
                    m.key,
                    getLocalLLMModelStatus(m.key).then((st) => st.isDownloaded),
                    isLocalLLMModelSupportedByDevice(m.key),
                    hasRoomForModel(m.sizeBytes),
                ))),
                getRecommendedLocalLLMModelKey(),
            ]);
            setWhisperModelStates(Object.fromEntries(whisperEntries));
            setLLMModelStates(Object.fromEntries(llmEntries));
            setRecommendedLLMKey(recommended);
        } catch (error) {
            console.warn('Failed to read on-device model states', error);
        }
    }, [t]);

    const refreshLocalWhisperStatus = useCallback(async () => {
        try {
            const status = await getLocalWhisperModelStatus();
            setLocalWhisperStatus(status);
        } catch (error) {
            console.error('Failed to load Local Whisper status', error);
            setLocalWhisperStatus(null);
        }
    }, []);

    const refreshLocalLLMStatus = useCallback(async () => {
        try {
            const status = await getLocalLLMModelStatus();
            setLocalLLMStatus(status);
        } catch (error) {
            console.error('Failed to load Local LLM status', error);
            setLocalLLMStatus(null);
        }
    }, []);

    useEffect(() => {
        loadPreferences();
        void getOnDeviceTranscription().then(setOnDeviceTranscriptionState);
    }, []);

    const updateOnDeviceTranscription = useCallback(async (enabled: boolean) => {
        if (enabled && !localWhisperStatus?.isDownloaded) {
            // The switch turns on once the model is on the phone.
            setShowWhisperDownload(true);
            return;
        }
        setOnDeviceTranscriptionState(enabled);
        await setOnDeviceTranscription(enabled);
    }, [localWhisperStatus?.isDownloaded]);

    useFocusEffect(
        useCallback(() => {
            refreshLocalWhisperStatus();
            refreshLocalLLMStatus();
            void refreshModelStates();
        }, [refreshLocalWhisperStatus, refreshLocalLLMStatus, refreshModelStates])
    );

    const refreshCurrentPeriodUsage = useCallback(async () => {
        if (!isAuthenticated || isGuest) {
            setCurrentPeriodUsage(null);
            return;
        }

        try {
            const usage = await subscriptionApi.getCurrentPeriodUsage();
            setCurrentPeriodUsage(usage);
        } catch (error: any) {
            console.warn('[SettingsScreen] Failed to load current period usage', error?.message ?? error);
        }
    }, [isAuthenticated, isGuest]);

    useFocusEffect(
        useCallback(() => {
            if (!isAuthenticated || isGuest) {
                return;
            }
            console.log('[SettingsScreen] Refreshing profile data...');
            void refreshProfile();
        }, [isAuthenticated, isGuest, refreshProfile])
    );

    useFocusEffect(
        useCallback(() => {
            void refreshCurrentPeriodUsage();
        }, [refreshCurrentPeriodUsage])
    );

    const loadPreferences = async () => {
        try {
            const [storedOpenAIKey, storedBaseUrl, provider, legacySelfHostedApiKey, agentMode, transcription, whisperStatus, savedLanguage] = await Promise.all([
                getOpenAIApiKey(),
                getOpenAIBaseUrl(),
                getAIProvider(),
                getLegacySelfHostedApiKey(),
                getAgentModeEnabled(),
                getTranscriptionEnabled(),
                getLocalWhisperModelStatus(),
                getTranscriptionLanguage(),
            ]);

            if (storedBaseUrl) {
                setOpenAIBaseUrlState(normalizeOpenAIBaseUrl(storedBaseUrl));
            }

            if (storedOpenAIKey) {
                setApiKeyState(storedOpenAIKey);
            } else if (legacySelfHostedApiKey) {
                // Best-effort migration from legacy self-hosted token to OpenAI-compatible token.
                setApiKeyState(legacySelfHostedApiKey);
                void setOpenAIApiKey(legacySelfHostedApiKey);
            }

            setAiProviderState(provider || 'vaulto_ai');
            setAgentModeEnabledState(agentMode);
            setTranscriptionEnabledState(transcription);
            setLocalWhisperStatus(whisperStatus);
            setLocalLLMStatus(await getLocalLLMModelStatus());
            setTranscriptionLanguageState(savedLanguage);
        } catch (error) {
            console.error('Failed to load settings', error);
        } finally {
            setPreferencesReady(true);
        }
    };

    const updateProvider = async (provider: AIProvider) => {
        const selectedOption = providerOptions.find(opt => opt.key === provider);

        // Show upgrade alert for locked providers
        if (selectedOption?.isLocked) {
            if (!isAuthenticated || isGuest) {
                setProviderGate({ kind: 'signin', providerTitle: selectedOption.title });
                return;
            }
            setProviderGate({ kind: 'upgrade', providerTitle: selectedOption.title });
            return;
        }

        setAiProviderState(provider);
        try {
            await setAIProvider(provider);
            // The agent is unavailable with these providers; that is shown via
            // agentUnavailable, not stored, so it comes back with Vaulto AI.

            // If switching to local and no whisper model, disable transcription
            if (provider === 'local' || provider === 'local_whisper') {
                const status = await getLocalWhisperModelStatus();
                if (!status.isDownloaded) {
                    setTranscriptionEnabledState(false);
                    await setTranscriptionEnabled(false);
                }
            }
        } catch (e) {
            console.error('Failed to persist AI provider', e);
        }
    };

    const openMinutesSheet = useCallback(() => {
        if (!isAuthenticated || isGuest || !isPro) return;
        setShowMinutesSheet(true);
    }, [isAuthenticated, isGuest, isPro]);

    const closeMinutesSheet = useCallback(() => {
        setShowMinutesSheet(false);
    }, []);

    const toggleAgentMode = async (value: boolean) => {
        if (agentUnavailable) {
            setShowAgentVaultoGate(true);
            return;
        }
        setAgentModeEnabledState(value);
        await setAgentModeEnabled(value);
    };

    const toggleTranscription = async (value: boolean) => {
        // Warning is now handled by animating an inline message when model is missing.
        if (value && (aiProvider === 'local' || aiProvider === 'local_whisper')) {
            const status = await getLocalWhisperModelStatus();
            if (!status.isDownloaded) {
                setShowModelMissingWarning(true);
                warningOpacity.setValue(0);
                if (warningTimeoutRef.current) {
                    clearTimeout(warningTimeoutRef.current);
                }
                Animated.timing(warningOpacity, {
                    toValue: 1,
                    duration: 300,
                    useNativeDriver: true,
                }).start();
                warningTimeoutRef.current = setTimeout(() => {
                    Animated.timing(warningOpacity, {
                        toValue: 0,
                        duration: 300,
                        useNativeDriver: true,
                    }).start(() => setShowModelMissingWarning(false));
                }, 3500);
                return;
            }
        }

        if (transcriptionAuthRequired && value) {
            setShowTranscriptionAuthModal(true);
            setTranscriptionEnabledState(false);
            return;
        }
        setTranscriptionEnabledState(value);
        await setTranscriptionEnabled(value);
    };

    const updateTranscriptionLanguage = useCallback(async (language: TranscriptionLanguage) => {
        setTranscriptionLanguageState(language);
        await setTranscriptionLanguage(language);
    }, []);

    useEffect(() => {
        if (!preferencesReady) return;
        const timeout = setTimeout(() => {
            setOpenAIApiKey(apiKey.trim());
        }, 400);

        return () => clearTimeout(timeout);
    }, [apiKey, preferencesReady]);

    useEffect(() => {
        if (!preferencesReady) return;
        const timeout = setTimeout(() => {
            setOpenAIBaseUrl(normalizeOpenAIBaseUrl(openAIBaseUrl));
        }, 400);

        return () => clearTimeout(timeout);
    }, [openAIBaseUrl, preferencesReady]);

    useEffect(() => {
        if (!preferencesReady) return;
        if (transcriptionAuthRequired) {
            setTranscriptionEnabledState(false);
            return;
        }
        getTranscriptionEnabled()
            .then(enabled => setTranscriptionEnabledState(enabled))
            .catch(() => setTranscriptionEnabledState(true));
    }, [preferencesReady, transcriptionAuthRequired]);

    useEffect(() => {
        // Guest/anonymous users can't use Agent Mode; force UI OFF (don't persist).
        if (!preferencesReady) return;
        if (!isAuthenticated || isGuest) {
            setAgentModeEnabledState(false);
            return;
        }
        getAgentModeEnabled()
            .then(enabled => setAgentModeEnabledState(enabled))
            .catch(() => setAgentModeEnabledState(true));
    }, [isAuthenticated, isGuest, preferencesReady]);

    const handleTestConnection = async () => {
        if (!showCustomAIConfig) {
            setOpenAITestStatus({ type: 'error', message: t("aux.selectOpenAICompatible") });
            return;
        }

        if (!apiKey) {
            setOpenAITestStatus({ type: 'error', message: t("aux.enterApiKey") });
            return;
        }

        setTestingConnection(true);
        setOpenAITestStatus({ type: 'idle', message: '' });
        const normalizedBaseUrl = normalizeOpenAIBaseUrl(openAIBaseUrl);
        await Promise.all([
            setOpenAIApiKey(apiKey.trim()),
            setOpenAIBaseUrl(normalizedBaseUrl),
        ]);
        const isConnected = await testOpenAIConnection({ baseUrl: normalizedBaseUrl, apiKey: apiKey.trim() });
        setTestingConnection(false);

        if (isConnected) {
            setOpenAITestStatus({ type: 'success', message: t("aux.connectionWorking") });
            if (!usingOpenAI) {
                setCustomAIPending(false);
                await updateProvider('openai');
            }
        } else {
            setOpenAITestStatus({ type: 'error', message: t("aux.connectionFailed") });
        }
    };

    const handleSelectLocalWhisperModel = useCallback(async (modelKey: LocalWhisperModelKey) => {
        setLocalWhisperBusy(true);
        try {
            await setSelectedLocalWhisperModel(modelKey);
            const status = await getLocalWhisperModelStatus();
            setLocalWhisperStatus(status);
            
            // Auto-toggle transcription based on the newly selected model's download status
            if (aiProvider === 'local' || aiProvider === 'local_whisper') {
                setTranscriptionEnabledState(status.isDownloaded);
                await setTranscriptionEnabled(status.isDownloaded);
            }
        } finally {
            setLocalWhisperBusy(false);
        }
    }, [aiProvider]);

    const handleDownloadLocalWhisper = useCallback(async (key?: string) => {
        const modelKey = (key || localWhisperStatus?.selectedModel.key || 'tiny') as LocalWhisperModelKey;
        // The downloaded model becomes the one in use; a cancelled or failed
        // download hands it back to the model that was working before.
        // Read fresh: the status captured by this callback can predate a download that just finished.
        const current = await getLocalWhisperModelStatus().catch(() => null);
        const previous = current?.isDownloaded ? current.selectedModel.key : null;
        let completed = false;
        await setSelectedLocalWhisperModel(modelKey);
        setLocalWhisperStatus(await getLocalWhisperModelStatus(modelKey));
        setLocalWhisperBusy(true);
        setIsDownloadingLocalWhisper(true);
        setLocalWhisperProgress(0);
        setLocalWhisperBytesLoaded(0);
        setLocalWhisperBytesTotal(0);
        try {
            const status = await downloadLocalWhisperModel(modelKey, (progress, loaded, total) => {
                setLocalWhisperProgress(progress);
                setLocalWhisperBytesLoaded(loaded);
                setLocalWhisperBytesTotal(total);
            });
            setLocalWhisperStatus(status);
            completed = true;
            
            if (aiProvider === 'local' || aiProvider === 'local_whisper') {
                setTranscriptionEnabledState(true);
                await setTranscriptionEnabled(true);
            }
        } catch (error: any) {
            if (error?.message && error.message.toLowerCase().includes('cancel')) {
                // Ignore cancel errors
            } else {
                Alert.alert(t("aux.downloadFailed"), error?.message || t("aux.unableDownloadWhisper"));
            }
        } finally {
            if (!completed && previous && previous !== modelKey) {
                await setSelectedLocalWhisperModel(previous as LocalWhisperModelKey);
                setLocalWhisperStatus(await getLocalWhisperModelStatus(previous));
            }
            setLocalWhisperBusy(false);
            setIsDownloadingLocalWhisper(false);
            setLocalWhisperProgress(0);
            setLocalWhisperBytesLoaded(0);
            setLocalWhisperBytesTotal(0);
            void refreshModelStates();
        }
    }, [localWhisperStatus?.selectedModel.key, aiProvider, whisperDeleteKey, refreshModelStates]);

    const handleCancelLocalWhisper = useCallback(async () => {
        await cancelLocalWhisperDownload();
    }, []);

    const handleDeleteLocalWhisper = useCallback(async () => {
        setLocalWhisperBusy(true);
        setShowLocalWhisperDeleteConfirm(false);
        try {
            const target = whisperDeleteKey || localWhisperStatus?.selectedModel.key;
            await deleteLocalWhisperModel(target);
            const status = await getLocalWhisperModelStatus();
            setLocalWhisperStatus(status);
            
            if ((aiProvider === 'local' || aiProvider === 'local_whisper') && !status.isDownloaded) {
                setTranscriptionEnabledState(false);
                await setTranscriptionEnabled(false);
            }
            void refreshModelStates();
        } catch (error: any) {
            Alert.alert('Delete failed', error?.message || 'Unable to remove the local Whisper model.');
        } finally {
            setLocalWhisperBusy(false);
        }
    }, [localWhisperStatus?.selectedModel.key, aiProvider, whisperDeleteKey, refreshModelStates]);

    const handleSelectLocalLLMModel = useCallback(async (key: LocalLLMModelKey) => {
        setLocalLLMBusy(true);
        try {
            await setSelectedLocalLLMModel(key);
            await refreshLocalLLMStatus();
        } catch (error: any) {
            Alert.alert('Selection failed', error?.message || 'Unable to select the local LLM model.');
        } finally {
            setLocalLLMBusy(false);
        }
    }, [refreshLocalLLMStatus]);

    const handleDownloadLocalLLM = useCallback(async (key?: string) => {
        if (!localLLMStatus) return;
        const targetKey = (key || localLLMStatus.selectedModel.key) as LocalLLMModelKey;
        const target = getAvailableLocalLLMModels().find((m) => m.key === targetKey) ?? localLLMStatus.selectedModel;
        // Gigabytes: confirm first, and warn when it would go over mobile data.
        const net = await NetInfo.fetch().catch(() => null);
        const cellular = net?.type === 'cellular';
        const proceed = await new Promise<boolean>((resolve) => {
            Alert.alert(
                t('localAI.downloadTitle', 'Download {{model}}?', { model: target.label }),
                [
                    t('localAI.downloadDesc', 'The model is {{size}}. It is downloaded once; after that AI works on this phone without internet and nothing is sent anywhere.', { size: formatModelSize(target.sizeBytes, t) }),
                    cellular ? t('localAI.downloadCellular', 'You are on mobile data — Wi-Fi is recommended.') : '',
                ].filter(Boolean).join('\n\n'),
                [
                    { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
                    { text: t('localAI.download', 'Download'), onPress: () => resolve(true) },
                ],
                { cancelable: true, onDismiss: () => resolve(false) },
            );
        });
        if (!proceed) return;
        // The downloaded model becomes the one in use; a cancelled or failed
        // download hands it back to the model that was working before.
        const currentLLM = await getLocalLLMModelStatus().catch(() => null);
        const previousLLM = currentLLM?.isDownloaded ? currentLLM.selectedModel.key : null;
        let llmCompleted = false;
        await setSelectedLocalLLMModel(targetKey);
        setLocalLLMStatus(await getLocalLLMModelStatus(targetKey));
        setLocalLLMBusy(true);
        setIsDownloadingLocalLLM(true);
        setLocalLLMProgress(0);
        setLocalLLMBytesLoaded(0);
        setLocalLLMBytesTotal(0);
        try {
            await downloadLocalLLMModel(targetKey, (progress, loaded, total) => {
                setLocalLLMProgress(progress);
                setLocalLLMBytesLoaded(loaded);
                setLocalLLMBytesTotal(total);
            });
            llmCompleted = true;
            await refreshLocalLLMStatus();
        } catch (error: any) {
            if (error?.message && error.message.toLowerCase().includes('cancel')) {
                // Ignore cancel errors
            } else {
                Alert.alert('Download failed', error?.message || 'Unable to download the local LLM model.');
            }
        } finally {
            if (!llmCompleted && previousLLM && previousLLM !== targetKey) {
                await setSelectedLocalLLMModel(previousLLM as LocalLLMModelKey);
            }
            await refreshLocalLLMStatus();
            setLocalLLMBusy(false);
            setIsDownloadingLocalLLM(false);
            setLocalLLMProgress(0);
            setLocalLLMBytesLoaded(0);
            setLocalLLMBytesTotal(0);
            void refreshModelStates();
        }
    }, [localLLMStatus, refreshLocalLLMStatus, refreshModelStates, t]);

    const handleCancelLocalLLM = useCallback(async () => {
        await cancelLocalLLMDownload();
    }, []);

    const handleDeleteLocalLLM = useCallback(async () => {
        setLocalLLMBusy(true);
        setShowLocalLLMDeleteConfirm(false);
        try {
            await deleteLocalLLMModel(llmDeleteKey || localLLMStatus?.selectedModel.key);
            await refreshLocalLLMStatus();
            void refreshModelStates();
        } catch (error: any) {
            Alert.alert('Delete failed', error?.message || 'Unable to remove the local LLM model.');
        } finally {
            setLocalLLMBusy(false);
        }
    }, [localLLMStatus?.selectedModel.key, refreshLocalLLMStatus, llmDeleteKey, refreshModelStates]);

    const [unsyncedCount, setUnsyncedCount] = useState(0);

    const checkSyncStatus = useCallback(async () => {
        if (!isAuthenticated || !user) return;
        if (!syncEnabled || syncLocked) {
            setUnsyncedCount(0);
            return;
        }
        try {
            const status = await import('../services/SyncService').then(m =>
                m.syncService.getSyncStatus(userId ?? user.id)
            );
            setUnsyncedCount(status.unsyncedCount);
        } catch (error) {
            console.error('[Settings] Failed to check sync status', error);
        }
    }, [isAuthenticated, user, userId, syncEnabled, syncLocked]);

    const SYNC_STATUS_INTERVAL_MS = 60000;
    const lastSyncCheckAt = useRef(0);
    useFocusEffect(
        useCallback(() => {
            const now = Date.now();
            if (now - lastSyncCheckAt.current < SYNC_STATUS_INTERVAL_MS) {
                return;
            }
            lastSyncCheckAt.current = now;
            checkSyncStatus();
        }, [checkSyncStatus])
    );

    const handleSignOut = async () => {
        await checkSyncStatus();
        setShowSignOutDialog(true);
    };

    const subscriptionTotalSeconds = currentPeriodUsage?.limits.transcription_subscription_max_seconds
        ?? user?.transcription_subscription_max_seconds
        ?? 0;
    const subscriptionUsedSeconds = currentPeriodUsage?.limits.transcription_subscription_used_seconds
        ?? user?.transcription_subscription_used_seconds
        ?? 0;
    const subscriptionRemainingSeconds = currentPeriodUsage?.limits.transcription_subscription_remaining_seconds
        ?? user?.transcription_subscription_remaining_seconds
        ?? Math.max(0, subscriptionTotalSeconds - subscriptionUsedSeconds);
    const trialUsedSeconds = currentPeriodUsage?.limits.transcription_trial_used_seconds
        ?? user?.transcription_trial_used_seconds
        ?? 0;
    const trialRemainingSeconds = currentPeriodUsage?.limits.transcription_trial_remaining_seconds
        ?? user?.transcription_trial_remaining_seconds
        ?? Math.max(0, (user?.transcription_trial_total_seconds ?? 0) - trialUsedSeconds);
    const progress = subscriptionTotalSeconds > 0
        ? Math.min(1, subscriptionUsedSeconds / subscriptionTotalSeconds)
        : 0;
    const isExpired = subscriptionRemainingSeconds <= 0;
    const isLowBalance = subscriptionRemainingSeconds > 0 && subscriptionRemainingSeconds <= 120;
    const formatTimeMMSS = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };
    const getProgressColor = () => {
        if (isExpired) return colors.error;
        if (isLowBalance) return colors.warning;
        return colors.primary;
    };
    const refillAtLabel = formatSubscriptionDate(
        currentPeriodUsage?.subscription_next_refill_at
        ?? user?.subscription_next_refill_at
        ?? null
    );
    const refillInDays = getDaysUntilDate(
        currentPeriodUsage?.subscription_next_refill_at
        ?? user?.subscription_next_refill_at
        ?? null
    );

    return (
        <ScreenContainer>
            <View style={styles.topBar}>
                <TouchableOpacity
                    style={styles.backButton}
                    onPress={() => navigation.goBack()}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel={t("a11y.back", "Back")}
                >
                    <MaterialIcons name="arrow-back" size={22} color={colors.text} />
                </TouchableOpacity>
                <Text style={styles.title}>{t('settings.ui.settingsHeader', 'Settings')}</Text>
            </View>
            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

                <View style={styles.card}>
                    {isAuthenticated && user ? (
                        <>
                            <View style={styles.userInfoContainer}>
                                <View style={styles.userAvatar}>
                                    <Text style={styles.userAvatarText}>
                                        {(user.full_name || user.email || 'U').charAt(0).toUpperCase()}
                                    </Text>
                                </View>
                                <View style={styles.userInfoText}>
                                    {user.full_name && (
                                        <Text style={styles.userName}>{user.full_name}</Text>
                                    )}
                                    <Text style={user.full_name ? styles.userEmail : styles.userEmailPrimary}>
                                        {user.email || t('settings.account.signIn', 'Signed in')}
                                    </Text>
                                </View>
                            </View>
                            {!isPro && (
                                <UsageCard
                                    user={user}
                                    aiProvider={aiProvider}
                                    isGuest={isGuest}
                                    isPro={isPro}
                                    embedded
                                />
                            )}
                        </>
                    ) : (
                        <View>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.s, marginBottom: spacing.m }}>
                                <View style={[styles.iconContainer, { backgroundColor: colors.backgroundSecondary }]}>
                                    <MaterialIcons name="account-circle" size={24} color={colors.textSecondary} />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.preferenceTitle}>{t("settings.ui.signInTitle", "Sign in")}</Text>
                                    <Text style={styles.preferenceDescription}>{t("settings.ui.signInDesc", "Sync notes & access AI features")}</Text>
                                </View>
                            </View>
                            <Button
                                title={t("settings.ui.signInBtn", "Sign In / Create Account")}
                                onPress={() => navigation.navigate('SignIn')}
                                style={{ width: '100%' }}
                            />
                            <Text style={styles.trialInfoText}>
                                {trialInfoText}
                            </Text>
                        </View>
                    )}

                    <SubscriptionStatusSection
                        isAuthenticated={isAuthenticated}
                        isGuest={isGuest}
                        isPro={isPro}
                        isLoading={subscriptionLoading}
                        onUpgrade={() => navigation.navigate('Paywall')}
                        onOpenMinutesSheet={openMinutesSheet}
                        canManageSubscription={isSubscriptionActive}
                        onManageSubscription={openManageSubscription}
                    />
                </View>

                {/* Language / Preferences */}
                <View style={styles.card}>
                    <TouchableOpacity
                        style={styles.preferenceRow}
                        activeOpacity={0.85}
                        onPress={() => setShowAppLanguageModal(true)}
                    >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.s, flex: 1 }}>
                            <MaterialIcons name="language" size={24} color={colors.textSecondary} />
                            <View style={{ flex: 1 }}>
                                <Text style={styles.preferenceTitle}>{t('settings.languageSelection', 'App Language')}</Text>
                                <Text style={styles.preferenceDescription}>
                                    {appLanguages.find(l => l.key === i18n.language)?.label || 'English'}
                                </Text>
                            </View>
                        </View>
                        <MaterialIcons name="chevron-right" size={20} color={colors.textSecondary} />
                    </TouchableOpacity>
                </View>

                {/* Cloud Sync */}
                <View style={styles.card}>
                    <View style={styles.cardHeader}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.s }}>
                            <MaterialIcons name="cloud-sync" size={18} color={colors.primary} />
                            <Text style={styles.sectionTitle}>{t("settings.ui.cloudSync", "Cloud Sync")}</Text>
                        </View>
                        <TouchableOpacity
                            onPress={() => setShowSecurityInfoModal(true)}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                            accessibilityRole="button"
                            accessibilityLabel={t("a11y.helpSync", "About cloud sync")}
                        >
                            <MaterialIcons name="help-outline" size={18} color={colors.textSecondary} />
                        </TouchableOpacity>
                    </View>

                    {resetRecoveryPending && (
                        <View style={{
                            borderWidth: 1,
                            borderColor: colors.warning + '80',
                            backgroundColor: colors.warning + '12',
                            borderRadius: 14,
                            padding: spacing.m,
                            marginBottom: spacing.m,
                        }}>
                            <View style={{ flexDirection: 'row', gap: spacing.s, alignItems: 'flex-start' }}>
                                <MaterialCommunityIcons name="shield-alert-outline" size={20} color={colors.warning} />
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.preferenceTitle}>
                                        {t('settings.resetRecovery.title', 'Encrypted vault was reset')}
                                    </Text>
                                    <Text style={[styles.preferenceDescription, { marginTop: 4 }]}>
                                        {t('settings.resetRecovery.description', 'Notes retained on this device are isolated locally. Sync is paused so they cannot be uploaded without your choice.')}
                                    </Text>
                                </View>
                            </View>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s, marginTop: spacing.m }}>
                                <TouchableOpacity
                                    style={[styles.smallButton, { backgroundColor: colors.primary }]}
                                    onPress={() => setShowEnableSyncModal(true)}
                                >
                                    <Text style={styles.smallButtonText}>
                                        {t('settings.resetRecovery.enableE2EE', 'Restore with E2EE')}
                                    </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={styles.smallButtonOutlined}
                                    onPress={confirmKeepResetArchiveLocal}
                                >
                                    <Text style={styles.smallButtonTextOutlined}>
                                        {t('settings.resetRecovery.keepLocal', 'Keep local')}
                                    </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.smallButtonOutlined, { borderColor: colors.warning }]}
                                    onPress={confirmStandardResetRecovery}
                                >
                                    <Text style={[styles.smallButtonTextOutlined, { color: colors.warning }]}>
                                        {t('settings.resetRecovery.standardAction', 'Use standard sync')}
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    )}

                    {(!hasConfiguredKey) ? (
                        <>
                            <View style={styles.securityRowMinimal}>
                                <View style={styles.securityRowLeft}>
                                    <View style={[styles.iconContainer, { backgroundColor: colors.accentGreen + '20' }]}>
                                        <MaterialIcons name={!syncEnabled ? "cloud-off" : "cloud-done"} size={16} color={!syncEnabled ? colors.textSecondary : colors.accentGreen} />
                                    </View>
                                    <Text style={styles.securityLabelMinimal}>{t("settings.ui.sync", "Sync (Normal Mode)")}</Text>
                                </View>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.s }}>
                                    <Switch
                                        value={syncEnabled}
                                        onValueChange={(value) => {
                                            void handleToggleSync(value);
                                        }}
                                        disabled={showUnlockingOverlay || resetRecoveryPending}
                                        trackColor={{ false: colors.backgroundSecondary, true: colors.primary }}
                                        thumbColor={colors.surface}
                                        style={{ transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }] }}
                                    />
                                </View>
                            </View>

                            <View style={styles.separator} />

                            <View style={styles.securityRowMinimal}>
                                <View style={styles.securityRowLeft}>
                                    <View style={[styles.iconContainer, { backgroundColor: colors.primary + '20' }]}>
                                        <MaterialCommunityIcons name="security" size={16} color={colors.primary} />
                                    </View>
                                    <Text style={[styles.securityLabelMinimal, { flex: 1 }]}>
                                        {t("settings.ui.setupSync", "Upgrade to Encrypted Mode")}
                                    </Text>
                                </View>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.s }}>
                                    <TouchableOpacity
                                        style={[styles.smallButton, { backgroundColor: colors.primary }]}
                                        onPress={async () => {
                                            if (isGuestOrAnonymous) {
                                                setShowSecurityAuthModal(true);
                                                return;
                                            }
                                            setShowEnableSyncModal(true);
                                        }}
                                    >
                                        <Text style={styles.smallButtonText}>
                                        {t("settings.ui.setupPassphrase", "Setup Passphrase")}
                                        </Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        </>
                    ) : encryptionStatus === 'locked' ? (
                        <View style={styles.securityRowMinimal}>
                            <View style={styles.securityRowLeft}>
                                <View style={[styles.iconContainer, { backgroundColor: colors.primary + '20' }]}>
                                    <MaterialCommunityIcons name="security" size={16} color={colors.primary} />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.securityLabelMinimal}>
                                        {t("settings.ui.unlockSync", "Unlock Vault")}
                                    </Text>
                                    {hasRemoteKeyBundle && (
                                        <Text style={{ fontSize: 11, color: colors.textSecondary, marginTop: 2 }}>
                                            {t("settings.ui.unlockToRestore", "Encrypted notes on server")}
                                        </Text>
                                    )}
                                </View>
                            </View>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.s }}>
                                <TouchableOpacity
                                    style={[styles.smallButton, { backgroundColor: colors.primary }]}
                                    onPress={async () => {
                                        if (isGuestOrAnonymous) {
                                            setShowSecurityAuthModal(true);
                                            return;
                                        }
                                        setShowUnlockSyncModal(true);
                                    }}
                                >
                                    <Text style={styles.smallButtonText}>
                                        {t("settings.ui.unlock", "Unlock")}
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    ) : (
                        <>
                            <View style={styles.securityRowMinimal}>
                                <View style={styles.securityRowLeft}>
                                    <View style={[styles.iconContainer, { backgroundColor: isSyncLocked ? colors.warning + '20' : !syncEnabled ? colors.backgroundSecondary : colors.accentGreen + '20' }]}>
                                        <MaterialIcons
                                            name={isSyncLocked ? "lock" : !syncEnabled ? "cloud-off" : "cloud-done"}
                                            size={16}
                                            color={isSyncLocked ? colors.warning : !syncEnabled ? colors.textSecondary : colors.accentGreen}
                                        />
                                    </View>
                                    <Text style={styles.securityLabelMinimal}>{t("settings.ui.sync", "Sync")}</Text>
                                </View>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.s, flexShrink: 1, justifyContent: 'flex-end' }}>
                                    <Text style={[styles.securityValueMinimal, { color: syncStatusColor, flexShrink: 1 }]} numberOfLines={1}>{syncStatusLabel}</Text>
                                    {encryptionStatus === 'loading' ? (
                                        <ActivityIndicator size="small" color={colors.primary} />
                                    ) : (
                                        <>
                                            {isSyncLocked && !syncToggleDisabled && (
                                                <TouchableOpacity style={[styles.smallButton, { backgroundColor: colors.warning }]} onPress={() => setShowUnlockSyncModal(true)}>
                                                    <Text style={styles.smallButtonText}>{t("settings.ui.unlock", "Unlock")}</Text>
                                                </TouchableOpacity>
                                            )}
                                            {!isSyncLocked && !syncToggleDisabled && (
                                                <Switch
                                                    value={syncEnabled}
                                                    onValueChange={(value) => {
                                                        void handleToggleSync(value);
                                                    }}
                                                    disabled={showUnlockingOverlay}
                                                    trackColor={{ false: colors.backgroundSecondary, true: colors.primary }}
                                                    thumbColor={colors.surface}
                                                    style={{ transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }] }}
                                                />
                                            )}
                                        </>
                                    )}
                                </View>
                            </View>

                            <View style={styles.separator} />

                            <View style={styles.securityRowMinimal}>
                                <View style={styles.securityRowLeft}>
                                    <View style={[styles.iconContainer, { backgroundColor: colors.primary + '20' }]}>
                                        <MaterialCommunityIcons name="shield-key" size={16} color={colors.primary} />
                                    </View>
                                    <Text style={styles.securityLabelMinimal}>{t("settings.ui.exportRecoveryCode", "Export Recovery Code")}</Text>
                                </View>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.s }}>
                                    {!!recoveryCode && (
                                        <TouchableOpacity
                                            style={styles.smallButtonOutlined}
                                            onPress={async () => {
                                                if (recoveryCode) {
                                                    await Clipboard.setStringAsync(recoveryCode);
                                                    Alert.alert(t("common.copied"), t("settings.recovery.copiedMsg"));
                                                } else {
                                                    Alert.alert(t("common.errorTitle"), t("settings.recovery.noRecoveryCode", "No recovery code found. Try unlocking again."));
                                                }
                                            }}
                                        >
                                            <Text style={styles.smallButtonTextOutlined}>{t('settings.ui.copyBtn', 'Copy')}</Text>
                                        </TouchableOpacity>
                                    )}
                                </View>
                            </View>

                            <View style={styles.separator} />

                            <View style={styles.securityRowMinimal}>
                                <View style={styles.securityRowLeft}>
                                    <View style={[styles.iconContainer, { backgroundColor: colors.warning + '20' }]}>
                                        <MaterialCommunityIcons name="shield-off-outline" size={16} color={colors.warning} />
                                    </View>
                                    <Text style={styles.securityLabelMinimal}>{t("settings.ui.disableEncryptionTitle", "Disable Encryption")}</Text>
                                </View>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.s }}>
                                    <TouchableOpacity
                                        style={[styles.smallButtonOutlined, { borderColor: colors.warning }]}
                                        onPress={() => setShowDisableEncryptionModal(true)}
                                    >
                                        <Text style={[styles.smallButtonTextOutlined, { color: colors.warning }]}>{t('settings.ui.disableBtn', 'Disable')}</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        </>
                    )}

                </View>





                {/* AI Configuration */}

                {/* AI Configuration */}
                <View style={styles.card}>
                    <View style={styles.cardHeader}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.s }}>
                            <MaterialIcons name="psychology" size={18} color={colors.primary} />
                            <Text style={styles.sectionTitle}>{t("settings.ui.aiModel", "AI Model")}</Text>
                        </View>
                    </View>

                    {/* Agent Mode Toggle */}
                    <TouchableOpacity
                        style={[styles.preferenceRow, { marginBottom: spacing.m }]}
                        activeOpacity={0.85}
                        onPress={() => {
                            if (isGuestOrAnonymous) {
                                setProviderGate({ kind: 'signin', providerTitle: 'Agent Mode' });
                            } else if (usingOpenAI || usingLocalWhisper) {
                                setShowAgentVaultoGate(true);
                            }
                        }}
                    >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.s, flex: 1 }}>
                            <Animated.View style={{ transform: [{ rotate: sway }], opacity: agentModeEnabled && !isGuestOrAnonymous ? 1 : 0.4 }}>
                                <MaterialIcons name="smart-toy" size={24} color={agentModeEnabled && !isGuestOrAnonymous ? colors.primary : colors.textSecondary} />
                            </Animated.View>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.preferenceTitle}>{t("settings.ai.agentMode", "Agent Mode")}</Text>
                                <Text style={styles.preferenceDescription}>{t("settings.ui.intelligentAssist", "Intelligent assistance")}</Text>
                            </View>
                        </View>
                        <Switch
                            value={isGuestOrAnonymous || agentUnavailable ? false : agentModeEnabled}
                            onValueChange={(value) => {
                                toggleAgentMode(value);
                            }}
                            disabled={isGuestOrAnonymous}
                            trackColor={{ false: colors.backgroundSecondary, true: colors.primary }}
                            thumbColor={colors.surface}
                            style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                        />
                    </TouchableOpacity>

                    <View style={styles.separator} />

                    {/* Auto-Transcribe Toggle */}
                    <TouchableOpacity
                        style={[styles.preferenceRow, { marginBottom: showModelMissingWarning ? spacing.xs : spacing.m }]}
                        activeOpacity={0.85}
                        disabled={!transcriptionAuthRequired}
                        onPress={() => {
                            if (transcriptionAuthRequired) {
                                setShowTranscriptionAuthModal(true);
                            }
                        }}
                    >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.s, flex: 1 }}>
                            <MaterialIcons
                                name="mic"
                                size={24}
                                color={transcriptionEnabled && !transcriptionAuthRequired ? colors.primary : colors.textSecondary}
                            />
                            <View style={{ flex: 1 }}>
                                <Text style={styles.preferenceTitle}>{t("settings.ui.autoTranscribe", "Auto-Transcribe Audio")}</Text>
                                <Text style={styles.preferenceDescription}>{t("settings.ui.autoTranscribeDesc", "Automatic voice transcription")}</Text>
                            </View>
                        </View>
                        <Switch
                            value={transcriptionAuthRequired ? false : transcriptionEnabled}
                            onValueChange={toggleTranscription}
                            disabled={transcriptionAuthRequired}
                            trackColor={{ false: colors.backgroundSecondary, true: colors.primary }}
                            thumbColor={colors.surface}
                            style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                        />
                    </TouchableOpacity>

                    {LOCAL_WHISPER_ENABLED && (
                        <TouchableOpacity
                            style={[styles.preferenceRow, { marginBottom: spacing.m }]}
                            activeOpacity={0.85}
                            onPress={() => setShowWhisperDownload(true)}
                            accessibilityRole="button"
                        >
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.s, flex: 1 }}>
                                <MaterialIcons
                                    name="phonelink-lock"
                                    size={24}
                                    color={onDeviceTranscriptionActive ? colors.primary : colors.textSecondary}
                                />
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.preferenceTitle}>{t("settings.onDevice.title", "Transcribe on device")}</Text>
                                    <Text style={styles.preferenceDescription}>
                                        {onDeviceTranscriptionActive
                                            ? t("settings.onDevice.active", "{{model}} model · offline, audio stays on the phone", { model: localWhisperStatus?.selectedModel.label ?? '' })
                                            : t("settings.onDevice.desc", "Private and offline. Downloads a speech model once.")}
                                    </Text>
                                </View>
                            </View>
                            <Switch
                                value={onDeviceTranscriptionActive}
                                onValueChange={(value) => { void updateOnDeviceTranscription(value); }}
                                trackColor={{ false: colors.backgroundSecondary, true: colors.primary }}
                                thumbColor={colors.surface}
                                style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                            />
                        </TouchableOpacity>
                    )}

                    {showModelMissingWarning && (
                        <Animated.View style={[styles.inlineWarningContainer, { opacity: warningOpacity, marginHorizontal: spacing.m, marginBottom: spacing.m }]}>
                            <MaterialIcons name="error-outline" size={16} color={colors.warning} />
                            <Text style={styles.inlineWarningText}>
                                Whisper model not found. Check settings below.
                            </Text>
                        </Animated.View>
                    )}

                    <View style={styles.separator} />

                    {/* Compact Provider Selector */}
                    <TouchableOpacity
                        style={[styles.preferenceRow, showAdvancedAI ? { marginBottom: spacing.m } : undefined]}
                        activeOpacity={0.85}
                        onPress={() => setShowAdvancedAI(!showAdvancedAI)}
                    >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.s, flex: 1 }}>
                            <MaterialIcons name="tune" size={24} color={showAdvancedAI ? colors.primary : colors.textSecondary} />
                            <View style={{ flex: 1 }}>
                                <Text style={styles.preferenceTitle}>{t("settings.ui.advAISettings", "Advanced AI Settings")}</Text>
                                <Text style={styles.preferenceDescription}>
                                    {LOCAL_MODELS_ENABLED
                                        ? t("settings.ui.advAISettingsDescLocal", "Local and custom AI configurations")
                                        : t("settings.ui.advAISettingsDescCustom", "Custom AI configuration.")}
                                </Text>
                            </View>
                        </View>
                        <MaterialIcons name={showAdvancedAI ? 'expand-less' : 'expand-more'} size={24} color={colors.textSecondary} />
                    </TouchableOpacity>

                    {showAdvancedAI && (
                        <View style={{ gap: spacing.m }}>
                            {/* Compact Provider Selector Inside */}

                            <View style={[styles.compactProviderSelector, { flexDirection: 'column' }]}>
                                {/* Top row: Vaulto AI + Custom AI */}
                                <View style={{ flexDirection: 'row', gap: spacing.s }}>
                                    {providerOptions.filter(o => o.key !== 'local').map((option) => {
                                        const isActive = customAIPending
                                            ? option.key === 'openai'
                                            : option.key === aiProvider;
                                        const isLocked = option.isLocked;
                                        return (
                                            <TouchableOpacity
                                                key={option.key}
                                                style={[
                                                    styles.compactProviderOption,
                                                    isActive && styles.compactProviderOptionActive,
                                                    isLocked && styles.compactProviderOptionLocked,
                                                    { flex: 1 }
                                                ]}
                                                onPress={() => {
                                                    if (option.key === 'openai' && !isLocked && !apiKey.trim()) {
                                                        setCustomAIPending(true);
                                                        return;
                                                    }
                                                    setCustomAIPending(false);
                                                    if (option.key !== aiProvider) {
                                                        void updateProvider(option.key);
                                                    }
                                                }}
                                                disabled={isActive && !isLocked}
                                                accessibilityRole="button"
                                                accessibilityState={{ selected: isActive }}
                                            >
                                                {option.key === 'vaulto_ai' ? (
                                                    <Image
                                                        source={require('../../assets/icon.png')}
                                                        style={{
                                                            width: 14,
                                                            height: 14,
                                                            tintColor: isActive ? colors.surface : colors.textSecondary,
                                                        }}
                                                        resizeMode="contain"
                                                    />
                                                ) : (
                                                    <MaterialIcons name={option.icon as any} size={14} color={isActive ? colors.surface : colors.textSecondary} />
                                                )}
                                                <Text style={[styles.compactProviderText, isActive && styles.compactProviderTextActive]} numberOfLines={1}>
                                                    {option.title.replace(' Compatible', '').replace(' Hosted', '')}
                                                </Text>
                                                {isLocked && <MaterialIcons name="lock" size={12} color={colors.accentPurple} />}
                                            </TouchableOpacity>
                                        );
                                    })}
                                </View>

                                {LOCAL_MODELS_ENABLED && (
                                    <TouchableOpacity
                                        style={[
                                            styles.compactProviderOption,
                                            usingLocal && styles.compactProviderOptionActive,
                                            { paddingHorizontal: spacing.m, flex: 1 }
                                        ]}
                                        onPress={() => updateProvider('local')}
                                    >
                                        <MaterialIcons name="memory" size={14} color={usingLocal ? colors.surface : colors.textSecondary} />
                                        <Text style={[styles.compactProviderText, usingLocal && styles.compactProviderTextActive]} numberOfLines={1}>
                                            Local
                                        </Text>
                                    </TouchableOpacity>
                                )}
                            </View>

                            {/* Setup for Custom AI (OpenAI & Compatible) */}
                            {showCustomAIConfig && (
                                <View style={styles.openAIConfigCard}>
                                    {/* Header */}
                                    <View style={styles.openAIConfigHeader}>
                                        <View style={[styles.iconContainer, { backgroundColor: colors.primary + '15' }]}>
                                            <MaterialIcons name="dns" size={20} color={colors.primary} />
                                        </View>
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.openAIConfigTitle}>{t("settings.ui.customAIConfig", "Custom AI Configuration")}</Text>
                                            <Text style={styles.openAIConfigSubtitle}>{t("settings.ui.customAIConfigDesc", "OpenAI or compatible API")}</Text>
                                        </View>
                                    </View>

                                    {/* Base URL */}
                                    <View style={styles.openAIInputGroup}>
                                        <Text style={styles.openAILabel}>{t("settings.ui.baseUrl", "Base URL")}</Text>
                                        <TextInput
                                            value={openAIBaseUrl}
                                            onChangeText={setOpenAIBaseUrlState}
                                            placeholder="https://api.openai.com/v1"
                                            autoCapitalize="none"
                                            style={styles.openAIInput}
                                            placeholderTextColor={colors.textSecondary}
                                        />
                                    </View>

                                    {/* API Key */}
                                    <View style={styles.openAIInputGroup}>
                                        <Text style={styles.openAILabel}>{t("settings.ui.apiKey", "API Key")}</Text>
                                        <View style={styles.openAISecretRow}>
                                            <TextInput
                                                value={apiKey}
                                                onChangeText={setApiKeyState}
                                                placeholder="sk-..."
                                                autoCapitalize="none"
                                                secureTextEntry={!showOpenAIKey}
                                                style={[styles.openAIInput, styles.openAIInputWithButton]}
                                                placeholderTextColor={colors.textSecondary}
                                            />
                                            <TouchableOpacity
                                                style={styles.openAIEyeButton}
                                                onPress={() => setShowOpenAIKey(!showOpenAIKey)}
                                                accessibilityRole="button"
                                                accessibilityLabel={showOpenAIKey
                                                    ? t("a11y.hideApiKey", "Hide API key")
                                                    : t("a11y.showApiKey", "Show API key")}
                                            >
                                                <MaterialIcons
                                                    name={showOpenAIKey ? 'visibility' : 'visibility-off'}
                                                    size={18}
                                                    color={colors.textSecondary}
                                                />
                                            </TouchableOpacity>
                                        </View>
                                    </View>

                                    {/* Status message */}
                                    {openAITestStatus.message && (
                                        <View style={styles.openAIStatusRow}>
                                            <MaterialIcons
                                                name={openAITestStatus.type === 'success' ? 'check-circle' : 'error'}
                                                size={14}
                                                color={openAITestStatus.type === 'success' ? colors.accentGreen : colors.error}
                                            />
                                            <Text style={[
                                                styles.openAIStatusText,
                                                openAITestStatus.type === 'success' ? styles.statusTextSuccess : styles.statusTextError
                                            ]}>
                                                {openAITestStatus.message}
                                            </Text>
                                        </View>
                                    )}

                                    {customAIPending && !usingOpenAI && (
                                        <Text style={styles.openAIConfigSubtitle}>
                                            {t("settings.ui.customAIPendingHint", "Vaulto AI stays active until the connection test succeeds.")}
                                        </Text>
                                    )}

                                    {/* Test button */}
                                    <TouchableOpacity
                                        style={styles.openAITestButton}
                                        onPress={handleTestConnection}
                                        disabled={testingConnection}
                                    >
                                        {testingConnection ? (
                                            <ActivityIndicator size="small" color={colors.surface} />
                                        ) : (
                                            <>
                                                <MaterialIcons name="wifi-tethering" size={16} color={colors.surface} />
                                                <Text style={styles.openAITestButtonText}>{t("settings.ui.testConnection", "Test Connection")}</Text>
                                            </>
                                        )}
                                    </TouchableOpacity>
                                </View>
                            )}

                    {LOCAL_MODELS_ENABLED && usingLocalWhisper && (
                        <OnDeviceModelSection
                            icon="graphic-eq"
                            title={t('localModels.voiceTitle', 'Speech to text')}
                            subtitle={t('localModels.voiceSubtitle', 'Whisper · recordings and dictation, offline')}
                            models={whisperModelOptions}
                            states={whisperModelStates}
                            selectedKey={localWhisperStatus?.selectedModel.key}
                            download={isDownloadingLocalWhisper ? {
                                key: localWhisperStatus?.selectedModel.key ?? '',
                                progress: localWhisperProgress,
                                loadedBytes: localWhisperBytesLoaded,
                                totalBytes: localWhisperBytesTotal,
                            } : null}
                            busy={localWhisperBusy}
                            headerAccessory={(
                                <View style={styles.modelLanguageRow}>
                                    <MaterialIcons name="translate" size={18} color={colors.textSecondary} />
                                    <Text style={styles.modelLanguageLabel}>{t('localModels.language', 'Speech language')}</Text>
                                    <SearchableLanguageSelector
                                        value={transcriptionLanguage}
                                        onChange={(lang) => { void updateTranscriptionLanguage(lang); }}
                                    />
                                </View>
                            )}
                            onSelect={(key) => { void handleSelectLocalWhisperModel(key as LocalWhisperModelKey).then(refreshModelStates); }}
                            onDownload={(key) => { void handleDownloadLocalWhisper(key); }}
                            onCancelDownload={() => { void handleCancelLocalWhisper(); }}
                            onDelete={(key) => { setWhisperDeleteKey(key); setShowLocalWhisperDeleteConfirm(true); }}
                        />
                    )}

                    {LOCAL_MODELS_ENABLED && usingLocalLLM && (
                        <OnDeviceModelSection
                            icon="auto-awesome"
                            title={t('localModels.aiTitle', 'AI on this phone')}
                            subtitle={t('localModels.aiSubtitle', 'Qwen3.5 · edits, notes chat and tasks, offline')}
                            models={llmModelOptions}
                            states={llmModelStates}
                            selectedKey={localLLMStatus?.selectedModel.key}
                            download={isDownloadingLocalLLM ? {
                                key: localLLMStatus?.selectedModel.key ?? '',
                                progress: localLLMProgress,
                                loadedBytes: localLLMBytesLoaded,
                                totalBytes: localLLMBytesTotal,
                            } : null}
                            busy={localLLMBusy}
                            headerAccessory={!localLLMRuntimeAvailable ? (
                                <Text style={styles.modelWarning}>
                                    {t('localModels.runtimeMissing', 'This build of the app cannot run on-device AI. Update the app to use it.')}
                                </Text>
                            ) : undefined}
                            onSelect={(key) => { void handleSelectLocalLLMModel(key as LocalLLMModelKey).then(refreshModelStates); }}
                            onDownload={(key) => { void handleDownloadLocalLLM(key); }}
                            onCancelDownload={() => { void handleCancelLocalLLM(); }}
                            onDelete={(key) => { setLLMDeleteKey(key); setShowLocalLLMDeleteConfirm(true); }}
                        />
                    )}

                        </View>
                    )}

                </View>

                {/* Sign Out & About */}
                <View style={{ marginTop: spacing.m, marginBottom: spacing.m, gap: spacing.m }}>
                    {isAuthenticated && !isGuest && (
                        <TouchableOpacity
                            style={styles.signOutButton}
                            onPress={handleSignOut}
                        >
                            <MaterialIcons name="logout" size={18} color={colors.error} />
                            <Text style={styles.signOutText}>{t("settings.account.signOut", "Sign Out")}</Text>
                        </TouchableOpacity>
                    )}

                    <View style={{ alignItems: 'center', gap: spacing.s, opacity: 0.7 }}>
                        <View style={{ flexDirection: 'row', gap: spacing.l }}>
                            <TouchableOpacity onPress={() => Linking.openURL('https://vaultonote.com/privacy')}>
                                <Text style={styles.legalLink}>{t("settings.ui.privacy", "Privacy Policy")}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => Linking.openURL('https://vaultonote.com/terms')}>
                                <Text style={styles.legalLink}>{t('settings.ui.termsOfService', 'Terms of Service')}</Text>
                            </TouchableOpacity>
                        </View>
                        <TouchableOpacity onPress={() => Linking.openURL('https://vaultonote.com')}>
                            <Text style={styles.versionText}>
                                {t('settings.ui.vaultoVersion', 'Vaulto v{{version}}', { version: appConfig.expo.version })}
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>


            </ScrollView >

            <Modal
                visible={showMinutesSheet}
                transparent
                animationType="slide"
                onRequestClose={closeMinutesSheet}
            >
                <Pressable style={styles.sheetBackdrop} onPress={closeMinutesSheet}>
                    <Pressable style={styles.minutesSheet} onPress={() => { }}>
                        <View style={styles.sheetHandle} />
                        <View style={styles.minutesSheetHeader}>
                            <View>
                                <Text style={styles.minutesSheetTitle}>{t('settings.ui.remainingMinutes', 'Remaining Minutes')}</Text>
                                <Text style={styles.minutesSheetSubtitle}>
                                    {refillInDays === null
                                        ? 'Monthly Pro balance'
                                        : refillInDays === 0
                                            ? 'Refreshes today'
                                            : `Refreshes in ${refillInDays} day${refillInDays === 1 ? '' : 's'}`}
                                </Text>
                            </View>
                            <TouchableOpacity onPress={closeMinutesSheet} style={styles.sheetCloseButton} activeOpacity={0.8}>
                                <MaterialIcons name="close" size={20} color={colors.textSecondary} />
                            </TouchableOpacity>
                        </View>
                        <View style={styles.minutesUsageCard}>
                            <View style={styles.minutesUsageHeaderRow}>
                                <View style={styles.minutesUsageTitleRow}>
                                    <View style={[styles.minutesUsageIconContainer, { backgroundColor: getProgressColor() + '15' }]}>
                                        <MaterialIcons
                                            name={isExpired ? "schedule" : "hourglass-bottom"}
                                            size={20}
                                            color={getProgressColor()}
                                        />
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.minutesUsageTitle}>{t('settings.ui.transcriptionBalance', 'Transcription Balance')}</Text>
                                        <Text style={styles.minutesUsageSubtitle}>{t('settings.ui.monthlyProMinutes', 'Monthly Pro minutes')}</Text>
                                    </View>
                                </View>
                                <View style={styles.minutesUsageProBadge}>
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
                                    <Text style={styles.minutesUsageProBadgeText}>PRO</Text>
                                </View>
                            </View>

                            <View style={styles.minutesProgressTrack}>
                                <View
                                    style={[
                                        styles.minutesProgressFill,
                                        { width: `${progress * 100}%`, backgroundColor: getProgressColor() },
                                    ]}
                                />
                            </View>

                            <View style={styles.minutesUsageStatsRow}>
                                <Text style={styles.minutesUsageStatsLabel}>{t('settings.ui.used', 'Used')}</Text>
                                <Text style={styles.minutesUsageStatsValue}>
                                    {formatTimeMMSS(subscriptionUsedSeconds)} / {formatTimeMMSS(subscriptionTotalSeconds)}
                                </Text>
                            </View>

                            <View style={styles.minutesReserveRow}>
                                <Text style={styles.minutesReserveLabel}>{t('settings.ui.trialReserve', 'Trial reserve')}</Text>
                                <Text style={styles.minutesReserveValue}>
                                    {formatTimeMMSS(trialRemainingSeconds)}
                                </Text>
                            </View>

                            {isExpired && (
                                <View style={styles.minutesWarningBox}>
                                    <MaterialIcons name="info-outline" size={18} color={colors.error} />
                                    <Text style={styles.minutesWarningText}>
                                        {t('settings.ui.minutesWarningText', 'You\'ve used all monthly minutes. Trial reserve will be used next.')}
                                    </Text>
                                </View>
                            )}

                            {isLowBalance && !isExpired && (
                                <View style={styles.minutesWarningBoxLow}>
                                    <MaterialIcons name="warning-amber" size={18} color={colors.warning} />
                                    <Text style={styles.minutesWarningTextLow}>
                                        {t('settings.ui.minutesWarningTextLow', 'Running low on monthly transcription minutes')}
                                    </Text>
                                </View>
                            )}

                            {refillAtLabel && (
                                <Text style={styles.minutesRefillText}>{t('settings.ui.nextRefill', 'Next refill:')} {refillAtLabel}</Text>
                            )}
                        </View>
                    </Pressable>
                </Pressable>
            </Modal>

            <LocalWhisperDownloadModal
                visible={showWhisperDownload}
                onClose={() => setShowWhisperDownload(false)}
                onDownloadComplete={() => {
                    setShowWhisperDownload(false);
                    void (async () => {
                        await refreshLocalWhisperStatus();
                        setOnDeviceTranscriptionState(true);
                        await setOnDeviceTranscription(true);
                    })();
                }}
            />

            <SignInRequiredModal
                visible={showTranscriptionAuthModal}
                title={t('voice.signInRequired', 'Sign in required')}
                message={t('settings.ui.autoTranscribeAuthMessage', 'Auto-transcription is available after you create an account.')}
                onClose={() => setShowTranscriptionAuthModal(false)}
                onSignIn={() => {
                    setShowTranscriptionAuthModal(false);
                    navigation.navigate('SignIn');
                }}
            />

            <SignInRequiredModal
                visible={showSecurityAuthModal}
                title={t('voice.signInRequired', 'Sign in required')}
                message={t('settings.ui.securityAuthMessage', 'Sync and encryption are available after you create an account.')}
                onClose={() => setShowSecurityAuthModal(false)}
                onSignIn={() => {
                    setShowSecurityAuthModal(false);
                    navigation.navigate('SignIn');
                }}
            />

            <SignInRequiredModal
                visible={!!providerGate}
                title={providerGate?.kind === 'upgrade'
                    ? t('settings.pro.upgrade', 'Upgrade to Pro')
                    : t('voice.signInRequired', 'Sign in required')}
                message={providerGate
                    ? (providerGate.kind === 'upgrade'
                        ? t('settings.ui.providerProOnly', '{{provider}} is available in Pro.', { provider: providerGate.providerTitle })
                        : t('settings.ui.providerNeedsAccount', 'Create an account to use {{provider}}.', { provider: providerGate.providerTitle }))
                    : ''}
                signInLabel={providerGate?.kind === 'upgrade'
                    ? t('aux.upgrade', 'Upgrade')
                    : t('auth.signIn', 'Sign In')}
                onClose={() => setProviderGate(null)}
                onSignIn={() => {
                    const kind = providerGate?.kind;
                    setProviderGate(null);
                    if (kind === 'upgrade') {
                        navigation.navigate('Paywall');
                    } else {
                        navigation.navigate('SignIn');
                    }
                }}
            />

            <AgentModeVaultoGateModal
                visible={showAgentVaultoGate}
                onClose={() => setShowAgentVaultoGate(false)}
                onPrimaryAction={() => updateProvider('vaulto_ai')}
            />

            <DeleteConfirmationDialog
                visible={showLocalWhisperDeleteConfirm}
                title={t('settings.ui.removeWhisperTitle', 'Remove Model?')}
                message={t(
                    'settings.ui.removeWhisperDesc',
                    'The {{model}} Whisper model will be deleted from this device. You will need to download it again to use offline transcription.',
                    { model: getAvailableLocalWhisperModels().find((m) => m.key === whisperDeleteKey)?.label || localWhisperStatus?.selectedModel.label || 'local' }
                )}
                onConfirm={handleDeleteLocalWhisper}
                onCancel={() => setShowLocalWhisperDeleteConfirm(false)}
            />

            <DeleteConfirmationDialog
                visible={showLocalLLMDeleteConfirm}
                title={t('settings.ui.removeLLMTitle', 'Remove LLM?')}
                message={t(
                    'settings.ui.removeLLMDesc',
                    'The {{model}} LLM model will be deleted from this device. You will need to download it again to use offline reasoning.',
                    { model: getAvailableLocalLLMModels().find((m) => m.key === llmDeleteKey)?.label || localLLMStatus?.selectedModel.label || 'local' }
                )}
                onConfirm={handleDeleteLocalLLM}
                onCancel={() => setShowLocalLLMDeleteConfirm(false)}
            />

            <EnableSyncModal
                visible={showEnableSyncModal}
                onClose={() => setShowEnableSyncModal(false)}
                onEnabled={() => setShowEnableSyncModal(false)}
            />
            <EnableSyncModal
                visible={showChangeSecretModal}
                flow="change"
                onClose={() => setShowChangeSecretModal(false)}
                onChanged={() => {
                    setShowChangeSecretModal(false);
                }}
            />
            <UnlockSyncModal
                visible={showUnlockSyncModal}
                errorMessage={unlockErrorMessage}
                onClose={() => {
                    setShowUnlockSyncModal(false);
                    setUnlockErrorMessage(null);
                }}
                onUnlocking={() => {
                    setUnlockProgress(8);
                    setShowUnlockingOverlay(true);
                    setUnlockErrorMessage(null);
                }}
                onProgress={setUnlockProgress}
                onError={(message) => {
                    setShowUnlockingOverlay(false);
                    setUnlockProgress(null);
                    setUnlockErrorMessage(message);
                    setShowUnlockSyncModal(true);
                }}
                onUnlocked={() => {
                    setUnlockProgress(100);
                    setShowUnlockSyncModal(false);
                    setShowUnlockingOverlay(false);
                    setUnlockProgress(null);
                    setUnlockErrorMessage(null);
                    setTimeout(() => {
                        void setSyncEnabledPreference(true);
                        void syncService.syncNow('manual');
                    }, 100);
                }}
            />
            <UnlockingOverlay
                visible={showUnlockingOverlay}
                title={t("settings.ui.unlockingNotesTitle", "Unlocking notes")}
                subtitle={t("settings.ui.unlockingNotesSubtitle", "Checking your passphrase on this device.")}
                progress={unlockProgress ?? undefined}
                progressLabel={t("common.progress", "Progress")}
            />

            <DisableSyncModal
                visible={showDisableSyncModal}
                onClose={() => setShowDisableSyncModal(false)}
                onConfirm={async () => {
                    try {
                        await setSyncEnabledPreference(false);
                    } catch (error: any) {
                        Alert.alert(t("settings.ui.failed", "Failed"), error?.message || t("settings.ui.unableDisableSync", "Unable to disable sync."));
                    }
                }}
            />

            <DisableEncryptionModal
                visible={showDisableEncryptionModal}
                onClose={() => setShowDisableEncryptionModal(false)}
                onDisable={async () => {
                    // Turn sync back on after encryption is reset
                    // so notes get re-uploaded in plain text.
                    try {
                        await setSyncEnabledPreference(true);
                    } catch (e) {
                        // ignore
                    }
                }}
            />

            <SignOutChoiceDialog
                visible={showSignOutDialog}
                unsyncedCount={unsyncedCount}
                hasE2EE={hasConfiguredKey}
                recoveryCode={recoveryCode}
                onKeep={() => {
                    setShowSignOutDialog(false);
                    signOut({ keepLocalNotes: true, wipeLocal: false });
                }}
                onDelete={() => {
                    setShowSignOutDialog(false);
                    signOut({ keepLocalNotes: false, wipeLocal: true });
                }}
                onCancel={() => setShowSignOutDialog(false)}
            />
            <SecurityInfoModal
                visible={showSecurityInfoModal}
                onClose={() => setShowSecurityInfoModal(false)}
                e2eeEnabled={hasConfiguredKey}
                syncEnabled={syncEnabled}
            />

            <RecoveryCodeModal
                visible={showRecoveryCodeModal}
                onClose={() => setShowRecoveryCodeModal(false)}
                recoveryCode={recoveryCode}
            />

            <Modal
                visible={showAppLanguageModal}
                transparent={true}
                animationType="fade"
                onRequestClose={() => setShowAppLanguageModal(false)}
            >
                <TouchableOpacity
                    style={styles.languageModalOverlay}
                    activeOpacity={1}
                    onPress={() => setShowAppLanguageModal(false)}
                >
                    <View style={styles.languageModalContent}>
                        <Text style={styles.languageModalTitle}>{t('settings.languageSelection', 'App Language')}</Text>
                        <ScrollView showsVerticalScrollIndicator={false} bounces={false} style={{ maxHeight: 400 }}>
                            {appLanguages.map((lang) => (
                                <TouchableOpacity
                                    key={lang.key}
                                    style={[styles.languageModalItem, i18n.language === lang.key && styles.languageModalItemActive]}
                                    onPress={() => changeAppLanguage(lang.key)}
                                >
                                    <Text style={[styles.languageModalItemText, i18n.language === lang.key && styles.languageModalItemTextActive]}>
                                        {lang.label}
                                    </Text>
                                    {i18n.language === lang.key && (
                                        <MaterialIcons name="check" size={20} color={colors.primary} />
                                    )}
                                </TouchableOpacity>
                            ))}
                        </ScrollView>
                    </View>
                </TouchableOpacity>
            </Modal>
        </ScreenContainer >
    );
};

const styles = StyleSheet.create({
    modelLanguageRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
        minHeight: 44,
    },
    modelWarning: {
        fontSize: 13,
        lineHeight: 18,
        color: colors.warning,
    },
    modelLanguageLabel: {
        flex: 1,
        fontSize: 14,
        color: colors.text,
    },
    languageModalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.4)',
        justifyContent: 'center',
    },
    languageModalContent: {
        backgroundColor: colors.surface,
        marginHorizontal: spacing.xl,
        borderRadius: 24,
        padding: spacing.l,
        maxHeight: '80%',
        ...Platform.select({
            ios: {
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 8 },
                shadowOpacity: 0.15,
                shadowRadius: 24,
            },
            android: {
                elevation: 12,
            },
        }),
    },
    languageModalTitle: {
        ...typography.h3,
        marginBottom: spacing.m,
        textAlign: 'center',
        color: colors.text,
    },
    languageModalItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: spacing.m,
        paddingHorizontal: spacing.m,
        borderRadius: 12,
        marginBottom: spacing.xs,
    },
    languageModalItemActive: {
        backgroundColor: colors.primary + '15',
    },
    languageModalItemText: {
        ...typography.body,
        color: colors.text,
        fontSize: 16,
    },
    languageModalItemTextActive: {
        color: colors.primary,
        fontWeight: '700',
    },
    trialInfoText: {
        ...typography.caption,
        color: colors.textSecondary,
        marginTop: spacing.s,
        textAlign: 'center',
    },
    agentModeWarning: {
        ...typography.caption,
        color: colors.error,
        marginTop: 4,
        fontWeight: '600',
    },
    backButton: {
        width: 48,
        height: 48,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.surface,
    },
    title: {
        ...typography.h1,
        fontSize: 24,
        flex: 1,
    },
    badge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        paddingHorizontal: spacing.m,
        paddingVertical: spacing.xs,
        borderRadius: 20,
        backgroundColor: colors.backgroundSecondary,
    },
    badgeText: {
        ...typography.caption,
        color: colors.primary,
        fontWeight: '700',
    },
    proStatusCard: {
        marginTop: spacing.s,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        paddingHorizontal: spacing.m,
        paddingBottom: spacing.s,
        paddingTop: spacing.xs,
        gap: spacing.s,
    },
    proStatusHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
    },
    proStatusCopy: {
        flex: 1,
    },
    proStatusTitle: {
        ...typography.h3,
        fontSize: 16,
        color: colors.text,
    },
    proStatusPill: {
        borderRadius: 999,
        paddingHorizontal: spacing.s,
        paddingVertical: 4,
        backgroundColor: colors.primary + '12',
        borderWidth: 1,
        borderColor: colors.primary + '30',
    },
    proStatusPillText: {
        ...typography.captionBold,
        color: colors.primary,
        fontSize: 11,
    },
    scrollContent: {
        paddingVertical: spacing.s,
        paddingHorizontal: spacing.m,
        gap: spacing.m,
        paddingBottom: spacing.xxl,
    },
    card: {
        backgroundColor: colors.surface,
        borderRadius: 16,
        padding: spacing.m, // Reduced from spacing.l
        borderWidth: 1,
        borderColor: colors.border,
        // Removed heavy shadow for flatness/compactness
    },
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
        paddingHorizontal: spacing.m,
        paddingTop: spacing.l, // Status bar
        paddingBottom: spacing.s,
    },
    userAvatar: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: colors.primary,
        alignItems: 'center',
        justifyContent: 'center',
    },
    userAvatarText: {
        ...typography.h3,
        color: colors.surface,
        fontSize: 18,
        fontWeight: '700',
    },
    userName: {
        ...typography.h3,
        fontSize: 16,
        fontWeight: '600',
        color: colors.text,
    },
    preferenceTitleSmall: {
        ...typography.body,
        fontSize: 14,
        color: colors.text,
    },
    preferenceValue: {
        ...typography.caption,
        color: colors.textSecondary,
    },
    compactProviderSelector: {
        flexDirection: 'row',
        gap: spacing.s,
        marginBottom: spacing.s,
    },
    compactProviderOption: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 48,
        paddingVertical: 8,
        paddingHorizontal: 8,
        backgroundColor: colors.backgroundSecondary,
        borderRadius: 12,
        gap: 4,
        borderWidth: 1,
        borderColor: 'transparent',
    },
    compactProviderOptionActive: {
        backgroundColor: colors.primary,
    },
    compactProviderOptionLocked: {
        opacity: 0.6,
    },
    compactProviderText: {
        ...typography.captionBold,
        color: colors.textSecondary,
        fontSize: 12,
        flexShrink: 1,
    },
    compactProviderTextActive: {
        color: colors.surface,
    },
    compactConfigBox: {
        backgroundColor: colors.backgroundSecondary,
        borderRadius: 12,
        padding: spacing.s,
    },
    inputContainerCompact: {
        marginBottom: spacing.xs,
    },
    labelCompact: {
        ...typography.caption,
        color: colors.textSecondary,
        marginBottom: 2,
        fontSize: 11,
    },
    compactInput: {
        backgroundColor: colors.surface,
        borderRadius: 8,
        paddingVertical: 4, // Very compact
        paddingHorizontal: 8,
        fontSize: 13,
        borderWidth: 1,
        borderColor: colors.border,
        height: 32,
        color: colors.text,
    },
    eyeButtonCompact: {
        height: 32,
        width: 32,
        alignItems: 'center',
        justifyContent: 'center',
    },
    smallButtonOutlined: {
        marginTop: spacing.s,
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        alignSelf: 'flex-start',
    },
    smallButtonTextOutlined: {
        ...typography.captionBold,
        color: colors.text,
    },
    proStatusAction: {
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.backgroundSecondary,
        paddingVertical: spacing.s,
        paddingHorizontal: spacing.s,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    proStatusActionLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
    },
    proStatusActionText: {
        ...typography.body,
        color: colors.text,
        fontWeight: '700',
    },
    sheetBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(9, 18, 33, 0.45)',
        justifyContent: 'flex-end',
    },
    minutesSheet: {
        backgroundColor: colors.surface,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingHorizontal: spacing.l,
        paddingTop: spacing.s,
        paddingBottom: Platform.OS === 'android' ? spacing.xxl + spacing.l : spacing.xxl,
        borderWidth: 1,
        borderColor: colors.border,
    },
    sheetHandle: {
        width: 46,
        height: 5,
        borderRadius: 99,
        backgroundColor: colors.border,
        alignSelf: 'center',
        marginBottom: spacing.m,
    },
    minutesSheetHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: spacing.m,
    },
    minutesSheetTitle: {
        ...typography.h3,
        color: colors.text,
    },
    minutesSheetSubtitle: {
        ...typography.caption,
        color: colors.textSecondary,
        marginTop: 2,
    },
    sheetCloseButton: {
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: colors.backgroundSecondary,
        alignItems: 'center',
        justifyContent: 'center',
    },
    minutesUsageCard: {
        backgroundColor: colors.surface,
        borderRadius: 16,
        padding: spacing.m,
        borderWidth: 1,
        borderColor: colors.border,
        shadowColor: colors.cardShadow,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 2,
    },
    minutesUsageHeaderRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: spacing.m,
    },
    minutesUsageTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
        flex: 1,
    },
    minutesUsageIconContainer: {
        width: 36,
        height: 36,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    minutesUsageTitle: {
        ...typography.h3,
        fontSize: 16,
        fontWeight: '600',
        color: colors.text,
    },
    minutesUsageSubtitle: {
        ...typography.caption,
        fontSize: 12,
        color: colors.textSecondary,
        marginTop: 2,
    },
    minutesUsageProBadge: {
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
    minutesUsageProBadgeText: {
        ...typography.caption,
        color: '#fff',
        fontWeight: '800',
        fontSize: 11,
        letterSpacing: 0.5,
    },
    minutesProgressTrack: {
        height: 8,
        borderRadius: 4,
        backgroundColor: colors.backgroundSecondary,
        overflow: 'hidden',
        marginBottom: spacing.s,
    },
    minutesProgressFill: {
        height: '100%',
        borderRadius: 4,
    },
    minutesUsageStatsRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    minutesUsageStatsLabel: {
        ...typography.caption,
        fontSize: 13,
        color: colors.textSecondary,
    },
    minutesUsageStatsValue: {
        ...typography.body,
        fontSize: 13,
        color: colors.text,
        fontWeight: '600',
    },
    minutesReserveRow: {
        marginTop: spacing.s,
        paddingTop: spacing.s,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    minutesReserveLabel: {
        ...typography.caption,
        color: colors.textSecondary,
    },
    minutesReserveValue: {
        ...typography.body,
        fontSize: 13,
        color: colors.primary,
        fontWeight: '700',
    },
    minutesWarningBox: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
        backgroundColor: colors.error + '10',
        padding: spacing.s,
        borderRadius: 10,
        marginTop: spacing.s,
    },
    minutesWarningText: {
        ...typography.body,
        flex: 1,
        fontSize: 13,
        color: colors.error,
        fontWeight: '500',
    },
    minutesWarningBoxLow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
        backgroundColor: colors.warning + '10',
        padding: spacing.s,
        borderRadius: 10,
        marginTop: spacing.s,
    },
    minutesWarningTextLow: {
        ...typography.body,
        flex: 1,
        fontSize: 13,
        color: colors.warning,
        fontWeight: '500',
    },
    minutesRefillText: {
        ...typography.caption,
        color: colors.textSecondary,
        marginTop: spacing.s,
    },

    premiumUpgradeCard: {
        marginTop: spacing.m,
        borderRadius: 20,
        padding: spacing.m,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: 'rgba(255, 193, 7, 0.3)', // Subtle gold border
        shadowColor: colors.accentYellow,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 4,
    },
    premiumUpgradeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.m,
    },
    premiumUpgradeIcon: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: '#FFF9C4', // Light cheerful yellow
        alignItems: 'center',
        justifyContent: 'center',
    },
    premiumUpgradeCopy: {
        flex: 1,
    },
    premiumUpgradeTitle: {
        ...typography.h3,
        color: colors.text,
        fontSize: 17,
        marginBottom: 2,
    },
    premiumUpgradeSubtitle: {
        ...typography.caption,
        color: colors.textSecondary,
        fontSize: 13,
    },
    manageAccountRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: spacing.m,
        paddingHorizontal: spacing.s,
        marginTop: spacing.s,
        borderTopWidth: 0.5,
        borderTopColor: colors.border,
    },
    manageAccountIcon: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: colors.backgroundSecondary,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: spacing.m,
    },
    manageAccountText: {
        ...typography.body,
        fontSize: 16,
        fontWeight: '500',
        color: colors.text,
        flex: 1,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: spacing.s,
    },
    sectionToggleButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        paddingHorizontal: spacing.s,
        paddingVertical: 4,
        borderRadius: 10,
        backgroundColor: colors.backgroundSecondary,
    },
    sectionToggleText: {
        ...typography.captionBold,
        color: colors.textSecondary,
    },
    sectionTitle: {
        ...typography.h2,
        fontSize: 20,
    },
    sectionHint: {
        ...typography.body,
        color: colors.textSecondary,
        marginBottom: spacing.m,
    },
    securityRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 6,
    },
    securityLabel: {
        ...typography.body,
        color: colors.text,
        fontWeight: '600',
    },
    securityValue: {
        ...typography.body,
        color: colors.textSecondary,
    },
    securityCopy: {
        ...typography.caption,
        color: colors.textSecondary,
        marginTop: spacing.s,
    },
    miniPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        paddingHorizontal: spacing.s,
        paddingVertical: spacing.xs,
        borderRadius: 12,
        backgroundColor: colors.backgroundSecondary,
    },
    miniPillText: {
        ...typography.caption,
        color: colors.primary,
    },
    preferenceRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: spacing.xs,
    },
    preferenceTitle: {
        ...typography.body,
        fontWeight: '600',
        marginBottom: 2,
    },
    preferenceDescription: {
        ...typography.caption,
        color: colors.textSecondary,
    },
    timeoutRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.xs,
        marginTop: spacing.xs,
        marginBottom: spacing.s,
    },
    timeoutChip: {
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 999,
        paddingHorizontal: spacing.s,
        paddingVertical: 6,
        backgroundColor: colors.background,
    },
    timeoutChipActive: {
        borderColor: colors.primary,
        backgroundColor: '#EEF4FF',
    },
    timeoutChipText: {
        ...typography.caption,
        color: colors.textSecondary,
        fontWeight: '600',
    },
    timeoutChipTextActive: {
        color: colors.primary,
    },
    providerSwitcher: {
        flexDirection: 'column',
        gap: spacing.s,
        marginTop: spacing.s,
    },
    providerPill: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: spacing.s,
        paddingHorizontal: spacing.m,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.background,
        width: '100%',
        gap: spacing.s,
    },
    providerPillActive: {
        borderColor: colors.primary,
        backgroundColor: '#EEF4FF',
        shadowColor: colors.cardShadow,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 3,
    },
    providerPillIcon: {
        width: 36,
        height: 36,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    providerGlyphText: {
        fontSize: 12,
        fontWeight: '800',
        letterSpacing: 0.6,
    },
    providerPillTitle: {
        ...typography.h3,
        fontSize: 16,
    },
    providerPillTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
    },
    providerPillTitleLocked: {
        color: colors.textSecondary,
    },
    providerPillSubtitle: {
        ...typography.caption,
        color: colors.textSecondary,
        marginTop: 2,
    },
    providerPillSubtitleLocked: {
        color: colors.accentPurple,
        fontWeight: '600',
    },
    providerPillLocked: {
        opacity: 0.65,
    },
    lockBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        paddingHorizontal: spacing.xs,
        paddingVertical: 2,
        borderRadius: 8,
        backgroundColor: colors.accentPurple + '15',
    },
    lockBadgeText: {
        ...typography.caption,
        fontSize: 11,
        color: colors.accentPurple,
        fontWeight: '700',
    },
    activeProviderCard: {
        flexDirection: 'row',
        gap: spacing.m,
        marginTop: spacing.m,
        padding: spacing.m,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.background,
    },
    activeProviderIcon: {
        width: 48,
        height: 48,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    activeProviderTitle: {
        ...typography.h3,
        fontSize: 17,
    },
    activeProviderDescription: {
        ...typography.body,
        color: colors.textSecondary,
        marginTop: spacing.xs,
        lineHeight: 22,
    },
    chipRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4, // Reduced gap
        marginTop: spacing.xs,
        // Ensure it doesn't wrap but we try to fit
    },
    // chipRowContent removed as we are back to View
    microChip: {
        paddingHorizontal: 6, // Reduced padding
        paddingVertical: 2,
        borderRadius: 8,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        flexShrink: 1, // Allow chips to shrink if needed
    },
    microChipText: {
        ...typography.caption,
        fontSize: 11, // Slightly smaller font
        color: colors.textSecondary,
    },
    microRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        marginTop: spacing.xs,
    },
    microText: {
        ...typography.caption,
        color: colors.textSecondary,
    },
    radio: {
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 2,
        borderColor: colors.border,
        justifyContent: 'center',
        alignItems: 'center',
    },
    radioActive: {
        borderColor: colors.primary,
    },
    radioDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: colors.primary,
    },
    label: {
        ...typography.body,
        fontWeight: '600',
        marginBottom: spacing.xs,
    },
    agentModeCard: {
        backgroundColor: colors.surface,
        borderRadius: 16,
        padding: spacing.m,
        marginBottom: spacing.m,
        borderWidth: 1,
        borderColor: colors.border,
        // Add subtle shine/elevation to make it stand out
        shadowColor: colors.primary,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2,
    },
    agentModeHeader: {
        flexDirection: 'column',
    },
    agentModeTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.m,
    },
    agentModeIcon: {
        width: 40,
        height: 40,
        borderRadius: 12,
        backgroundColor: colors.backgroundSecondary,
        alignItems: 'center',
        justifyContent: 'center',
    },
    agentModeTitle: {
        ...typography.h3,
        fontSize: 16,
        marginBottom: 2,
    },
    agentModeDescription: {
        ...typography.caption,
        color: colors.textSecondary,
        lineHeight: 18,
    },
    settingsPanel: {
        marginTop: spacing.l,
        padding: spacing.m,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.background,
        gap: spacing.s,
    },
    settingsPanelHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    inlineTitle: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
    },
    panelTitle: {
        ...typography.h3,
        fontSize: 17,
    },
    inputCluster: {
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        padding: spacing.m,
        gap: spacing.s,
    },
    inputContainer: {
        marginBottom: spacing.xs,
    },
    secretFieldRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
        flex: 1,
        minWidth: 0, // Prevents flex item from overflowing
    },
    flex: {
        flex: 1,
    },
    eyeButton: {
        width: 40, // Reduced from 44 to give more space to input
        height: 40,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.backgroundSecondary,
        borderWidth: 1,
        borderColor: colors.border,
        flexShrink: 0, // Prevents button from being squeezed outside container
    },
    noMarginContainer: {
        marginBottom: 0,
    },
    testActionButton: {
        marginTop: spacing.s,
        height: 50,
        borderRadius: 14,
        backgroundColor: colors.primary,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.s,
        shadowColor: colors.cardShadow,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.2,
        shadowRadius: 10,
        elevation: 4,
    },
    testActionButtonDisabled: {
        backgroundColor: colors.textMuted,
    },
    testActionText: {
        ...typography.button,
        color: colors.surface,
    },
    labelSpacing: {
        marginTop: spacing.s,
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        marginTop: spacing.xs,
    },
    statusText: {
        ...typography.bodySmall,
        fontWeight: '600',
    },
    statusTextSuccess: {
        color: colors.accentGreen,
    },
    statusTextError: {
        color: colors.error,
    },
    infoToggleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        paddingVertical: spacing.xs,
    },
    infoToggleText: {
        ...typography.bodySmall,
        color: colors.textSecondary,
        fontWeight: '600',
    },
    infoBox: {
        marginTop: spacing.xs,
        padding: spacing.m,
        borderRadius: 12,
        backgroundColor: colors.backgroundSecondary,
        borderWidth: 1,
        borderColor: colors.border,
        gap: spacing.xs,
    },
    infoBoxText: {
        ...typography.bodySmall,
        color: colors.textSecondary,
    },
    info: {
        ...typography.body,
        color: colors.textSecondary,
        marginBottom: spacing.s,
    },
    resetButton: {
        borderColor: colors.textMuted,
        marginTop: spacing.s,
    },
    signInButton: {
        marginTop: spacing.s,
    },
    createAccountButton: {
        marginTop: spacing.m,
    },
    syncHint: {
        ...typography.caption,
        color: colors.textSecondary,
        marginBottom: spacing.xs,
    },
    footer: {
        marginTop: spacing.m,
        marginBottom: spacing.l,
    },
    button: {
        borderColor: colors.error,
    },
    // User info styles for Account section
    userInfoContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.m,
        paddingVertical: spacing.xs,
        marginBottom: spacing.s,
    },
    userInfoText: {
        flex: 1,
        gap: 2,
    },
    userEmail: {
        ...typography.bodySmall,
        color: colors.textSecondary,
    },
    userEmailPrimary: {
        ...typography.body,
        fontSize: 16,
        fontWeight: '500',
        color: colors.text,
    },
    syncStatusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        marginTop: 4,
    },
    syncStatusText: {
        ...typography.caption,
        color: colors.accentGreen,
        fontWeight: '600',
    },
    minimalAppInfo: {
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: spacing.xl,
        marginBottom: spacing.m,
        opacity: 0.7,
    },
    minimalAppInfoText: {
        ...typography.caption,
        color: colors.textSecondary,
        textAlign: 'center',
    },
    minimalAppInfoLink: {
        textDecorationLine: 'underline',
    },
    securityRowMinimal: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: spacing.s,
    },
    securityRowLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.m,
        flex: 1,
    },
    iconContainer: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    securityLabelMinimal: {
        ...typography.caption,
        color: colors.textSecondary,
        fontWeight: '500',
        flex: 1,
    },
    securityValueMinimal: {
        ...typography.bodySmall,
        fontWeight: '600',
        marginTop: 2,
    },
    smallButton: {
        backgroundColor: colors.primary,
        paddingHorizontal: spacing.m,
        paddingVertical: 6,
        borderRadius: 12,
    },
    smallButtonText: {
        ...typography.caption,
        color: colors.surface,
    },
    iconButton: {
        padding: spacing.s,
    },
    resetLink: {
        alignItems: 'center',
        paddingVertical: spacing.s,
        marginTop: spacing.xs,
    },
    resetLinkText: {
        ...typography.caption,
        color: colors.error,
        fontWeight: '600',
    },
    separator: {
        height: 1,
        backgroundColor: colors.border,
        opacity: 0.5,
    },
    signOutButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.s,
        paddingVertical: spacing.m,
        borderRadius: 12,
        backgroundColor: colors.error + '10',
        borderWidth: 1,
        borderColor: colors.error + '20',
    },
    signOutText: {
        ...typography.button,
        color: colors.error,
        fontSize: 15,
    },
    legalLink: {
        ...typography.caption,
        color: colors.textSecondary,
        textDecorationLine: 'underline',
    },
    versionText: {
        ...typography.caption,
        color: colors.textSecondary,
    },
    // OpenAI Configuration Card Styles
    openAIConfigCard: {
        marginTop: spacing.m,
        padding: spacing.m,
        borderRadius: 14,
        backgroundColor: colors.backgroundSecondary,
        borderWidth: 1,
        borderColor: colors.border,
        gap: spacing.m,
    },
    openAIConfigHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.m,
        marginBottom: spacing.xs,
    },
    openAIConfigTitle: {
        ...typography.h3,
        fontSize: 16,
        fontWeight: '600',
        color: colors.text,
    },
    openAIConfigSubtitle: {
        ...typography.caption,
        fontSize: 12,
        color: colors.textSecondary,
        marginTop: 2,
    },
    openAIModeSelectorRow: {
        flexDirection: 'row',
        gap: spacing.s,
    },
    openAIModeButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.s,
        paddingVertical: spacing.s + 2,
        paddingHorizontal: spacing.m,
        borderRadius: 12,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
    },
    openAIModeButtonActive: {
        backgroundColor: colors.primary,
        borderColor: colors.primary,
        shadowColor: colors.primary,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
        elevation: 2,
    },
    openAIModeIconContainer: {
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.backgroundSecondary,
    },
    openAIModeGlyph: {
        ...typography.button,
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 0.3,
    },
    openAIModeButtonText: {
        ...typography.button,
        fontSize: 14,
        color: colors.text,
        fontWeight: '600',
    },
    openAIModeButtonTextActive: {
        color: colors.surface,
    },
    openAIInputGroup: {
        gap: spacing.xs,
    },
    openAILabel: {
        ...typography.caption,
        fontSize: 12,
        fontWeight: '600',
        color: colors.textSecondary,
    },
    openAIInput: {
        ...typography.body,
        fontSize: 14,
        color: colors.text,
        backgroundColor: colors.surface,
        paddingHorizontal: spacing.m,
        paddingVertical: spacing.s + 2,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: colors.border,
        minHeight: 44,
    },
    openAIInputWithButton: {
        paddingRight: 44, // Make room for the eye button
    },
    openAISecretRow: {
        position: 'relative',
    },
    openAIEyeButton: {
        position: 'absolute',
        right: 2,
        top: 2,
        bottom: 2,
        width: 40,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 8,
    },
    openAIStatusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        paddingVertical: spacing.xs,
    },
    openAIStatusText: {
        ...typography.caption,
        fontSize: 12,
        fontWeight: '600',
    },
    openAITestButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        paddingVertical: spacing.m,
        paddingHorizontal: spacing.m,
        borderRadius: 10,
        backgroundColor: colors.primary,
        minHeight: 44,
        shadowColor: colors.primary,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
        elevation: 2,
    },
    openAITestButtonText: {
        ...typography.button,
        fontSize: 14,
        fontWeight: '600',
        color: colors.surface,
    },
    localWhisperModelPill: {
        minHeight: 44,
        paddingHorizontal: spacing.m,
        paddingVertical: 8,
        borderRadius: 20,
        backgroundColor: colors.background,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 70,
    },
    localWhisperModelPillActive: {
        backgroundColor: colors.primary + '10',
        borderColor: colors.primary,
    },
    localWhisperModelText: {
        ...typography.captionBold,
        fontSize: 13,
        color: colors.textSecondary,
    },
    localWhisperModelTextActive: {
        color: colors.primary,
    },
    localWhisperDeleteButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        paddingVertical: 10,
        paddingHorizontal: spacing.m,
        borderRadius: 12,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.error + '40',
        minHeight: 44,
        flex: 1,
    },
    localWhisperDeleteText: {
        ...typography.button,
        fontSize: 14,
        fontWeight: '600',
        color: colors.error,
    },
    inlineWarningContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: `${colors.warning}15`,
        paddingHorizontal: spacing.m,
        paddingVertical: spacing.xs,
        borderRadius: 16,
        gap: spacing.xs,
        borderWidth: 1,
        borderColor: `${colors.warning}30`,
    },
    inlineWarningText: {
        ...typography.captionBold,
        color: colors.warning,
        fontSize: 13,
    },
});
