import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Switch, Alert, Linking, Modal, Pressable, Platform, Image, Animated, Easing } from 'react-native';
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
    setTranscriptionEnabled
} from '../utils/storage';
import { testOpenAIConnection } from '../services/TranscriptionService';
import { SignInRequiredModal } from '../components/SignInRequiredModal';
import { MaterialIcons } from '@expo/vector-icons';
import { UsageCard } from '../components/UsageCard';
import { SignOutChoiceDialog } from '../components/SignOutChoiceDialog';
import { useEncryption } from '../context/EncryptionContext';
import Constants from 'expo-constants';
import { EnableSyncModal } from '../components/EnableSyncModal';
import { UnlockSyncModal } from '../components/UnlockSyncModal';
import { UnlockingOverlay } from '../components/UnlockingOverlay';
import { syncService } from '../services/SyncService';
import { useSubscription } from '../context/SubscriptionContext';
import { ProIcon } from '../components/ProIcon';
import { DEFAULT_OPENAI_BASE_URL, normalizeOpenAIBaseUrl } from '../utils/openaiCompat';
import { SecurityInfoModal } from '../components/SecurityInfoModal';

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
}

const SubscriptionStatusSection: React.FC<SubscriptionStatusSectionProps> = ({
    isAuthenticated,
    isGuest,
    isPro,
    isLoading,
    onUpgrade,
    onOpenMinutesSheet,
}) => {
    if (!isAuthenticated || isGuest) return null;

    if (isLoading) {
        return <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: spacing.s }} />;
    }

    if (isPro) {
        return (
            <View style={styles.proStatusCard}>
                <View style={styles.proStatusHeader}>
                    {/* Unified PRO Badge (Restored) */}
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
                        }}>PRO</Text>
                    </View>

                    {/* Spacer to push "ACTIVE" to the right */}
                    <View style={{ flex: 1 }} />

                    <View style={styles.proStatusPill}>
                        <Text style={styles.proStatusPillText}>ACTIVE</Text>
                    </View>
                </View>
                <TouchableOpacity
                    style={styles.proStatusAction}
                    onPress={onOpenMinutesSheet}
                    activeOpacity={0.9}
                >
                    <View style={styles.proStatusActionLeft}>
                        {/* Hourglass icon removed as requested */}
                        <Text style={[styles.proStatusActionText, { color: colors.textSecondary, fontWeight: 'normal', fontSize: 13 }]}>Subscription details</Text>
                    </View>
                    <MaterialIcons name="chevron-right" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
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
                    <Text style={styles.premiumUpgradeTitle}>Upgrade to Pro</Text>
                    <Text style={styles.premiumUpgradeSubtitle}>
                        Extended transcription & premium features
                    </Text>
                </View>
                <MaterialIcons name="chevron-right" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
        </View>
    );
};



export const SettingsScreen = () => {
    const navigation = useNavigation<any>();
    const { signOut, isAuthenticated, isGuest, user, userId, refreshProfile } = useAuth();
    const {
        isPro,
        isLoading: subscriptionLoading,
    } = useSubscription();
    const {
        status: encryptionStatus,
        syncEnabled,
        syncLocked,
        hasRemoteKeyBundle,
        bundle,
        custodyMode,
        setSyncEnabledPreference,
    } = useEncryption();

    const [apiKey, setApiKeyState] = useState('');
    const [openAIBaseUrl, setOpenAIBaseUrlState] = useState(DEFAULT_OPENAI_BASE_URL);
    const [agentModeEnabled, setAgentModeEnabledState] = useState(true);
    const [transcriptionEnabled, setTranscriptionEnabledState] = useState(true);
    const [testingConnection, setTestingConnection] = useState(false);
    const [aiProvider, setAiProviderState] = useState<AIProvider>('secure_llm');
    const [preferencesReady, setPreferencesReady] = useState(false);
    const [showSignOutDialog, setShowSignOutDialog] = useState(false);
    const [showOpenAIInfo, setShowOpenAIInfo] = useState(false);
    const [showEnableSyncModal, setShowEnableSyncModal] = useState(false);
    const [showChangePinModal, setShowChangePinModal] = useState(false);
    const [showUnlockSyncModal, setShowUnlockSyncModal] = useState(false);
    const [showUnlockingOverlay, setShowUnlockingOverlay] = useState(false);
    const [unlockErrorMessage, setUnlockErrorMessage] = useState<string | null>(null);
    const [showMinutesSheet, setShowMinutesSheet] = useState(false);

    const [isGeneratingMagicLink, setIsGeneratingMagicLink] = useState(false);
    const [showOpenAIKey, setShowOpenAIKey] = useState(false);
    const [openAITestStatus, setOpenAITestStatus] = useState<{ type: 'idle' | 'success' | 'error'; message: string }>({
        type: 'idle',
        message: '',
    });
    const [showTranscriptionAuthModal, setShowTranscriptionAuthModal] = useState(false);
    const [providerGate, setProviderGate] = useState<null | { kind: 'signin' | 'upgrade'; providerTitle: string }>(null);
    const [showSecurityInfoModal, setShowSecurityInfoModal] = useState(false);

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
    const trialInfoText = 'Create an account and get 30 minutes of trial transcription.';
    const hasConfiguredKey = custodyMode === 'strict_seed' || !!bundle || hasRemoteKeyBundle;
    const syncStatusLabel = !syncEnabled ? 'Off' : syncLocked ? 'Locked' : 'On';
    const syncStatusColor = !syncEnabled ? colors.textSecondary : syncLocked ? colors.warning : colors.accentGreen;
    // When configured, we show the Change button only (no extra "Configured" label).
    const passphraseStatusLabel = !hasConfiguredKey ? 'Not set' : encryptionStatus === 'locked' ? 'Locked' : '';
    const passphraseStatusColor = !hasConfiguredKey ? colors.textSecondary : encryptionStatus === 'locked' ? colors.warning : colors.accentGreen;
    const syncToggleDisabled = !isAuthenticated || isGuest;
    const isGuestOrAnonymous = !isAuthenticated || isGuest;

    const handleToggleSync = useCallback(async (enabled: boolean) => {
        if (syncToggleDisabled) {
            Alert.alert('Sign in required', 'Sign in to enable or disable sync.');
            return;
        }

        if (enabled) {
            if (!hasConfiguredKey) {
                setShowEnableSyncModal(true);
                return;
            }
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
                Alert.alert('Failed', error?.message || 'Unable to enable sync.');
            }
            return;
        }

        try {
            await setSyncEnabledPreference(false);
        } catch (error: any) {
            Alert.alert('Failed', error?.message || 'Unable to disable sync.');
        }
    }, [encryptionStatus, hasConfiguredKey, setSyncEnabledPreference, syncToggleDisabled]);

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
            key: 'secure_llm',
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
            isLocked: !isPro,
            proMessage: 'Available in Pro',
        },
    ];

    const activeProvider = providerOptions.find((provider) => provider.key === aiProvider);

    useEffect(() => {
        loadPreferences();
    }, []);

    const PROFILE_REFRESH_INTERVAL_MS = 60000;
    const lastProfileRefreshAt = useRef(0);
    useFocusEffect(
        useCallback(() => {
            if (!isAuthenticated || isGuest) {
                return;
            }
            const now = Date.now();
            if (now - lastProfileRefreshAt.current < PROFILE_REFRESH_INTERVAL_MS) {
                return;
            }
            lastProfileRefreshAt.current = now;
            console.log('[SettingsScreen] Refreshing profile data...');
            refreshProfile();
        }, [isAuthenticated, isGuest, refreshProfile])
    );

    const loadPreferences = async () => {
        try {
            const [storedOpenAIKey, storedBaseUrl, provider, legacySelfHostedApiKey, agentMode, transcription] = await Promise.all([
                getOpenAIApiKey(),
                getOpenAIBaseUrl(),
                getAIProvider(),
                getLegacySelfHostedApiKey(),
                getAgentModeEnabled(),
                getTranscriptionEnabled()
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

            setAiProviderState(provider || 'secure_llm');
            setAgentModeEnabledState(agentMode);
            setTranscriptionEnabledState(transcription);
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
        setAgentModeEnabledState(value);
        await setAgentModeEnabled(value);
    };

    const toggleTranscription = async (value: boolean) => {
        if ((!isAuthenticated || isGuest) && value) {
            setShowTranscriptionAuthModal(true);
            setTranscriptionEnabledState(false);
            return;
        }
        setTranscriptionEnabledState(value);
        await setTranscriptionEnabled(value);
    };

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
        // Anonymous users can't use transcription; force UI OFF.
        if (!preferencesReady) return;
        if (!isAuthenticated || isGuest) {
            setTranscriptionEnabledState(false);
            return;
        }
        getTranscriptionEnabled()
            .then(enabled => setTranscriptionEnabledState(enabled))
            .catch(() => setTranscriptionEnabledState(true));
    }, [isAuthenticated, isGuest, preferencesReady]);

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
        if (!usingOpenAI) {
            setOpenAITestStatus({ type: 'error', message: 'Select OpenAI Compatible to test connection.' });
            return;
        }

        if (!apiKey) {
            setOpenAITestStatus({ type: 'error', message: 'Enter API Key.' });
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
            setOpenAITestStatus({ type: 'success', message: 'Connection working.' });
        } else {
            setOpenAITestStatus({ type: 'error', message: 'Connection failed. Check API URL and Key.' });
        }
    };

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
        setShowSignOutDialog(true);
    };

    const subscriptionTotalSeconds = user?.transcription_subscription_max_seconds ?? 0;
    const subscriptionUsedSeconds = user?.transcription_subscription_used_seconds ?? 0;
    const subscriptionRemainingSeconds = user?.transcription_subscription_remaining_seconds
        ?? Math.max(0, subscriptionTotalSeconds - subscriptionUsedSeconds);
    const trialTotalSeconds = user?.transcription_trial_total_seconds ?? 0;
    const trialRemainingSeconds = user?.transcription_trial_remaining_seconds
        ?? Math.max(0, trialTotalSeconds - (user?.transcription_trial_used_seconds ?? 0));
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
    const refillAtLabel = formatSubscriptionDate(user?.subscription_next_refill_at ?? null);
    const refillInDays = getDaysUntilDate(user?.subscription_next_refill_at ?? null);

    return (
        <ScreenContainer>
            <View style={styles.topBar}>
                <TouchableOpacity
                    style={styles.backButton}
                    onPress={() => navigation.goBack()}
                    activeOpacity={0.8}
                >
                    <MaterialIcons name="arrow-back" size={22} color={colors.text} />
                </TouchableOpacity>
                <Text style={styles.title}>Settings</Text>
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
                                        {user.email || 'Signed in'}
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
                                    autoTranscribeEnabled={transcriptionEnabled}
                                    onToggleAutoTranscribe={toggleTranscription}
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
                                    <Text style={styles.preferenceTitle}>Sign in</Text>
                                    <Text style={styles.preferenceDescription}>Sync notes & access AI features</Text>
                                </View>
                            </View>
                            <Button
                                title="Sign In / Create Account"
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
                    />
                </View>

                {/* Security */}
                <View style={styles.card}>
                    <View style={styles.cardHeader}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.s }}>
                            <MaterialIcons name="security" size={18} color={colors.primary} />
                            <Text style={styles.sectionTitle}>Security</Text>
                        </View>
                        <TouchableOpacity
                            onPress={() => setShowSecurityInfoModal(true)}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        >
                            <MaterialIcons name="help-outline" size={18} color={colors.textSecondary} />
                        </TouchableOpacity>
                    </View>

                    <View style={styles.securityRowMinimal}>
                        <View style={styles.securityRowLeft}>
                            <View style={[styles.iconContainer, { backgroundColor: !syncEnabled ? colors.backgroundSecondary : syncLocked ? colors.warning + '20' : colors.accentGreen + '20' }]}>
                                <MaterialIcons
                                    name={!syncEnabled ? "cloud-off" : syncLocked ? "lock" : "cloud-done"}
                                    size={16}
                                    color={!syncEnabled ? colors.textSecondary : syncLocked ? colors.warning : colors.accentGreen}
                                />
                            </View>
                            <Text style={styles.securityLabelMinimal}>Sync</Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.s }}>
                            <Text style={[styles.securityValueMinimal, { color: syncStatusColor }]}>{syncStatusLabel}</Text>
                            {syncEnabled && syncLocked && !syncToggleDisabled && (
                                <TouchableOpacity style={[styles.smallButton, { backgroundColor: colors.warning }]} onPress={() => setShowUnlockSyncModal(true)}>
                                    <Text style={styles.smallButtonText}>Unlock</Text>
                                </TouchableOpacity>
                            )}
                            {!syncToggleDisabled && hasConfiguredKey && !syncLocked ? (
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
                            ) : (!syncToggleDisabled && !hasConfiguredKey ? (
                                <TouchableOpacity
                                    style={[
                                        styles.smallButton,
                                        {
                                            backgroundColor: colors.primary,
                                        },
                                    ]}
                                    onPress={() => {
                                        setShowEnableSyncModal(true);
                                    }}
                                >
                                    <Text style={styles.smallButtonText}>Enable</Text>
                                </TouchableOpacity>
                            ) : null)}
                        </View>
                    </View>

                    <View style={styles.separator} />

                    <View style={styles.securityRowMinimal}>
                        <View style={styles.securityRowLeft}>
                            <View style={[styles.iconContainer, { backgroundColor: passphraseStatusColor + '20' }]}>
                                <MaterialIcons name="vpn-key" size={16} color={passphraseStatusColor} />
                            </View>
                            <Text style={styles.securityLabelMinimal}>Passphrase</Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.s }}>
                            {!!passphraseStatusLabel && (
                                <Text style={[styles.securityValueMinimal, { color: passphraseStatusColor }]}>
                                    {passphraseStatusLabel}
                                </Text>
                            )}
                            {hasConfiguredKey && encryptionStatus !== 'locked' && (
                                <TouchableOpacity style={styles.smallButtonOutlined} onPress={() => setShowChangePinModal(true)}>
                                    <Text style={styles.smallButtonTextOutlined}>Change</Text>
                                </TouchableOpacity>
                            )}
                        </View>
                    </View>

                </View>





                {/* AI Configuration */}

                {/* AI Configuration */}
                <View style={styles.card}>
                    <View style={styles.cardHeader}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.s }}>
                            <MaterialIcons name="psychology" size={18} color={colors.primary} />
                            <Text style={styles.sectionTitle}>AI Model</Text>
                        </View>
                    </View>

                    {/* Agent Mode Toggle */}
                    <TouchableOpacity
                        style={[styles.preferenceRow, { marginBottom: spacing.m }]}
                        activeOpacity={0.85}
                        disabled={!isGuestOrAnonymous}
                        onPress={() => setProviderGate({ kind: 'signin', providerTitle: 'Agent Mode' })}
                    >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.s, flex: 1 }}>
                            <Animated.View style={{ transform: [{ rotate: sway }], opacity: agentModeEnabled && !isGuestOrAnonymous ? 1 : 0.4 }}>
                                <MaterialIcons name="smart-toy" size={24} color={agentModeEnabled && !isGuestOrAnonymous ? colors.primary : colors.textSecondary} />
                            </Animated.View>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.preferenceTitle}>Agent Mode</Text>
                                <Text style={styles.preferenceDescription}>Intelligent assistance</Text>
                            </View>
                        </View>
                        <Switch
                            value={isGuestOrAnonymous ? false : agentModeEnabled}
                            onValueChange={toggleAgentMode}
                            disabled={isGuestOrAnonymous}
                            trackColor={{ false: colors.backgroundSecondary, true: colors.primary }}
                            thumbColor={colors.surface}
                            style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                        />
                    </TouchableOpacity>

                    <View style={styles.separator} />

                    {/* Compact Provider Selector */}
                    <View style={styles.compactProviderSelector}>
                        {providerOptions.map((option) => {
                            const isActive = option.key === aiProvider;
                            const isLocked = option.isLocked;

                            return (
                                <TouchableOpacity
                                    key={option.key}
                                    style={[
                                        styles.compactProviderOption,
                                        isActive && styles.compactProviderOptionActive,
                                        isLocked && styles.compactProviderOptionLocked
                                    ]}
                                    onPress={() => updateProvider(option.key)}
                                    disabled={activeProvider?.key === option.key && !isLocked}
                                >
                                    {option.key === 'secure_llm' ? (
                                        <Image
                                            source={require('../../assets/icon.png')}
                                            style={{
                                                width: 16,
                                                height: 16,
                                                tintColor: isActive ? colors.surface : colors.textSecondary,
                                            }}
                                            resizeMode="contain"
                                        />
                                    ) : (
                                        <MaterialIcons name={option.icon as any} size={16} color={isActive ? colors.surface : colors.textSecondary} />
                                    )}
                                    <Text style={[styles.compactProviderText, isActive && styles.compactProviderTextActive]}>
                                        {option.title.replace(' Compatible', '').replace(' Hosted', '')}
                                    </Text>
                                    {isLocked && <MaterialIcons name="lock" size={12} color={colors.accentPurple} />}
                                </TouchableOpacity>
                            );
                        })}
                    </View>

                    {/* Setup for Custom AI (OpenAI & Compatible) */}
                    {usingOpenAI && (
                        <View style={styles.openAIConfigCard}>
                            {/* Header */}
                            <View style={styles.openAIConfigHeader}>
                                <View style={[styles.iconContainer, { backgroundColor: colors.primary + '15' }]}>
                                    <MaterialIcons name="dns" size={20} color={colors.primary} />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.openAIConfigTitle}>Custom AI Configuration</Text>
                                    <Text style={styles.openAIConfigSubtitle}>OpenAI or compatible API</Text>
                                </View>
                            </View>

                            {/* Base URL */}
                            <View style={styles.openAIInputGroup}>
                                <Text style={styles.openAILabel}>Base URL</Text>
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
                                <Text style={styles.openAILabel}>API Key</Text>
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
                                        <Text style={styles.openAITestButtonText}>Test Connection</Text>
                                    </>
                                )}
                            </TouchableOpacity>
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
                            <Text style={styles.signOutText}>Sign Out</Text>
                        </TouchableOpacity>
                    )}

                    <View style={{ alignItems: 'center', gap: spacing.s, opacity: 0.7 }}>
                        <View style={{ flexDirection: 'row', gap: spacing.l }}>
                            <TouchableOpacity onPress={() => Linking.openURL('https://vaultonote.com/privacy')}>
                                <Text style={styles.legalLink}>Privacy Policy</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => Linking.openURL('https://vaultonote.com/terms')}>
                                <Text style={styles.legalLink}>Terms of Service</Text>
                            </TouchableOpacity>
                        </View>
                        <TouchableOpacity onPress={() => Linking.openURL('https://vaultonote.com')}>
                            <Text style={styles.versionText}>Vaulto v1.0.24</Text>
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
                                <Text style={styles.minutesSheetTitle}>Remaining Minutes</Text>
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
                                        <Text style={styles.minutesUsageTitle}>Transcription Balance</Text>
                                        <Text style={styles.minutesUsageSubtitle}>Monthly Pro minutes</Text>
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
                                <Text style={styles.minutesUsageStatsLabel}>Used</Text>
                                <Text style={styles.minutesUsageStatsValue}>
                                    {formatTimeMMSS(subscriptionUsedSeconds)} / {formatTimeMMSS(subscriptionTotalSeconds)}
                                </Text>
                            </View>

                            <View style={styles.minutesReserveRow}>
                                <Text style={styles.minutesReserveLabel}>Trial reserve</Text>
                                <Text style={styles.minutesReserveValue}>
                                    {formatTimeMMSS(trialRemainingSeconds)}
                                </Text>
                            </View>

                            {isExpired && (
                                <View style={styles.minutesWarningBox}>
                                    <MaterialIcons name="info-outline" size={18} color={colors.error} />
                                    <Text style={styles.minutesWarningText}>
                                        You've used all monthly minutes. Trial reserve will be used next.
                                    </Text>
                                </View>
                            )}

                            {isLowBalance && !isExpired && (
                                <View style={styles.minutesWarningBoxLow}>
                                    <MaterialIcons name="warning-amber" size={18} color={colors.warning} />
                                    <Text style={styles.minutesWarningTextLow}>
                                        Running low on monthly transcription minutes
                                    </Text>
                                </View>
                            )}

                            {refillAtLabel && (
                                <Text style={styles.minutesRefillText}>Next refill: {refillAtLabel}</Text>
                            )}
                        </View>
                    </Pressable>
                </Pressable>
            </Modal>

            <SignInRequiredModal
                visible={showTranscriptionAuthModal}
                title="Sign in to enable"
                message="Auto-transcription is available after you create an account."
                onClose={() => setShowTranscriptionAuthModal(false)}
                onSignIn={() => {
                    setShowTranscriptionAuthModal(false);
                    navigation.navigate('SignIn');
                }}
            />

            <SignInRequiredModal
                visible={!!providerGate}
                title={providerGate?.kind === 'upgrade' ? 'Upgrade to Pro' : 'Sign in required'}
                message={providerGate
                    ? (providerGate.kind === 'upgrade'
                        ? `${providerGate.providerTitle} is available in Pro.`
                        : `Create an account to use ${providerGate.providerTitle}.`)
                    : ''}
                signInLabel={providerGate?.kind === 'upgrade' ? 'Upgrade' : 'Sign In'}
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

            <EnableSyncModal
                visible={showEnableSyncModal}
                onClose={() => setShowEnableSyncModal(false)}
                onEnabled={() => setShowEnableSyncModal(false)}
            />
            <EnableSyncModal
                visible={showChangePinModal}
                flow="change"
                onClose={() => setShowChangePinModal(false)}
                onChanged={() => {
                    setShowChangePinModal(false);
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
                    setShowUnlockingOverlay(true);
                    setUnlockErrorMessage(null);
                }}
                onError={(message) => {
                    setShowUnlockingOverlay(false);
                    setUnlockErrorMessage(message);
                    setShowUnlockSyncModal(true);
                }}
                onUnlocked={() => {
                    setShowUnlockSyncModal(false);
                    setShowUnlockingOverlay(false);
                    setUnlockErrorMessage(null);
                    setTimeout(() => {
                        void syncService.syncNow('manual');
                    }, 0);
                }}
            />
            <UnlockingOverlay
                visible={showUnlockingOverlay}
                title="Verifying Passphrase"
                subtitle="Checking your passphrase and decrypting sync. This may take up to a minute on some devices."
            />

            <SignOutChoiceDialog
                visible={showSignOutDialog}
                unsyncedCount={unsyncedCount}
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
            />
        </ScreenContainer >
    );
};

const styles = StyleSheet.create({
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
        width: 42,
        height: 42,
        borderRadius: 12,
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
        marginTop: spacing.m,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        padding: spacing.m,
        gap: spacing.m,
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
        paddingVertical: 8,
        paddingHorizontal: 4,
        backgroundColor: colors.backgroundSecondary,
        borderRadius: 10,
        gap: 6,
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
});
