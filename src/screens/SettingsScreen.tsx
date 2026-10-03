import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Switch, Alert, Linking, Modal, Pressable, Platform, Image } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import appConfig from '../../app.json';
import { ScreenContainer } from '../components/ScreenContainer';
import { Button } from '../components/Button';
import { TextInput } from '../components/TextInput';
import { colors, isDarkScheme } from '../theme/colors';
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
    getTranscriptionLanguage,
    setTranscriptionLanguage,
    getOnDeviceTranscription,
    setOnDeviceTranscription,
} from '../utils/storage';
import { formatModelSize } from '../components/OnDeviceModelSection';
import { cancelOfflineDownload, downloadOfflineModels, getOfflineStatus, OfflinePlan, OfflineStatus, planOfflineModels, removeOfflineModels } from '../services/offlineMode';
import { testOpenAIConnection } from '../services/TranscriptionService';
import { SignInRequiredModal } from '../components/SignInRequiredModal';
import { DeleteConfirmationDialog } from '../components/DeleteConfirmationDialog';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { UsageCard } from '../components/UsageCard';
import { SignOutChoiceDialog } from '../components/SignOutChoiceDialog';
import { DeleteAccountModal } from '../components/DeleteAccountModal';
import { SuccessModal } from '../components/SuccessModal';
import { authApi } from '../api/auth';
import Purchases from 'react-native-purchases';
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
import { SecurityInfoModal } from '../components/SecurityInfoModal';
import { CUSTOM_AI_ENABLED, LOCAL_MODELS_ENABLED, LOCAL_WHISPER_ENABLED, isLocalAIProvider } from '../utils/featureFlags';
import { getLocalWhisperModelStatus } from '../services/LocalWhisperService';
import { SearchableLanguageSelector } from '../components/SearchableLanguageSelector';
import { RecoveryCodeModal } from '../components/RecoveryCodeModal';
import { createStyles } from '../theme/createStyles';
import { useTheme } from '../theme/ThemeContext';
import { getErrorMessage } from '../utils/errorMessage';
import { applyLayoutDirection } from '../i18n/direction';
import { haptics } from '../utils/haptics';
import { rtlFlip } from '../i18n/direction';
import { useNotesContext } from '../contexts/NotesContext';
import { isWeeklyDigestEnabled, setWeeklyDigestEnabled } from '../services/notifications';
import { exportNotesAsZip, pickNotesToImport } from '../services/notesTransfer';

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
                    <MaterialIcons name="chevron-right" size={18} color={colors.textSecondary} style={rtlFlip} />
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
                        backgroundColor={colors.warningLight}
                        borderColor="#FCD34D"
                        tintColor={null}
                    />
                </View>
                <View style={styles.premiumUpgradeCopy}>
                    <Text style={styles.premiumUpgradeTitle}>{t('settings.pro.upgrade')}</Text>
                    <Text style={styles.premiumUpgradeSubtitle}>
                        {t('settings.pro.subtitle')}
                    </Text>
                </View>
                <MaterialIcons name="chevron-right" size={20} color={colors.textSecondary} style={rtlFlip} />
            </TouchableOpacity>
        </View>
    );
};



export const SettingsScreen = () => {
    const navigation = useNavigation<any>();
    const { t, i18n } = useTranslation();
    const [showAppLanguageModal, setShowAppLanguageModal] = useState(false);
    const { preference: themePreference, setPreference: setThemePreference } = useTheme();
    const { getAllNotes, createNote } = useNotesContext();
    const [digestEnabled, setDigestEnabled] = useState(false);
    const [transferBusy, setTransferBusy] = useState<'export' | 'import' | null>(null);
    useEffect(() => {
        void isWeeklyDigestEnabled().then(setDigestEnabled).catch(() => undefined);
    }, []);

    const toggleDigest = async (value: boolean) => {
        setDigestEnabled(value);
        const ok = await setWeeklyDigestEnabled(value).catch(() => false);
        if (!ok) {
            setDigestEnabled(false);
            Alert.alert(t('digest.settingTitle', 'Weekly summary'), t('digest.permissionDenied', 'Allow notifications for Vaulto in the phone settings to get the summary.'), [
                { text: t('common.cancel', 'Cancel'), style: 'cancel' },
                { text: t('edit.tasks.openSettings', 'Open settings'), onPress: () => { void Linking.openSettings(); } },
            ]);
        }
    };

    const handleExport = async () => {
        setTransferBusy('export');
        try {
            const result = await exportNotesAsZip(getAllNotes());
            if (result.exported === 0) {
                Alert.alert(t('data.exportTitle', 'Export notes'), t('data.exportNothing', 'There are no notes to export.'));
            } else if (result.skippedProtected > 0) {
                Alert.alert(
                    t('data.exportTitle', 'Export notes'),
                    t('data.exportSkippedProtected', 'Protected notes ({{count}}) were not exported: they never leave the phone unencrypted.', { count: result.skippedProtected }),
                );
            }
        } catch (error) {
            Alert.alert(t('data.exportTitle', 'Export notes'), getErrorMessage(error, t('data.exportFailed', 'Could not export the notes.')));
        } finally {
            setTransferBusy(null);
        }
    };

    const handleImport = async () => {
        setTransferBusy('import');
        try {
            const found = await pickNotesToImport();
            if (!found) return;
            if (found.length === 0) {
                Alert.alert(t('data.importTitle', 'Import notes'), t('data.importNothing', 'No notes found in these files. Supported: .md, .txt, .zip and Google Keep (Takeout).'));
                return;
            }
            let created = 0;
            for (const note of found) {
                try {
                    await createNote({ title: note.title, content: note.content });
                    created += 1;
                } catch {
                    // Empty notes are rejected by createNote; skip them.
                }
            }
            haptics.success();
            Alert.alert(t('data.importTitle', 'Import notes'), t('data.importDone', 'Imported notes: {{count}}', { count: created }));
        } catch (error) {
            Alert.alert(t('data.importTitle', 'Import notes'), getErrorMessage(error, t('data.importFailed', 'Could not import the notes.')));
        } finally {
            setTransferBusy(null);
        }
    };
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
        // Arabic flips the whole layout; that takes one quick reload.
        await applyLayoutDirection(lang);
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
        enableE2EEWithRecoveryKey,
        autoEncrypting,
    } = useEncryption();
    const [overlayKind, setOverlayKind] = useState<'unlock' | 'encrypt'>('unlock');

    // End-to-end encryption with a recovery key: the key is shown app-wide once ready.
    const handleEnableEncryption = useCallback(async () => {
        setOverlayKind('encrypt');
        setUnlockProgress(0);
        setShowUnlockingOverlay(true);
        try {
            await enableE2EEWithRecoveryKey((progress) => setUnlockProgress(progress));
        } catch (error: any) {
            Alert.alert(t('aux.enableSyncFailed', 'Could not enable encryption'), getErrorMessage(error, t('common.errorOccurred', 'An error occurred')));
        } finally {
            setShowUnlockingOverlay(false);
            setUnlockProgress(null);
            setOverlayKind('unlock');
        }
    }, [enableE2EEWithRecoveryKey, t]);

    const [apiKey, setApiKeyState] = useState('');
    const [openAIBaseUrl, setOpenAIBaseUrlState] = useState(DEFAULT_OPENAI_BASE_URL);
    const [transcriptionLanguage, setTranscriptionLanguageState] = useState<TranscriptionLanguage>('auto');
    const [testingConnection, setTestingConnection] = useState(false);
    const [aiProvider, setAiProviderState] = useState<AIProvider>('vaulto_ai');
    const [preferencesReady, setPreferencesReady] = useState(false);
    const [showSignOutDialog, setShowSignOutDialog] = useState(false);
    const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);
    const [showAccountDeletedModal, setShowAccountDeletedModal] = useState(false);
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
    const [showSecurityAuthModal, setShowSecurityAuthModal] = useState(false);
    const [showDisableSyncModal, setShowDisableSyncModal] = useState(false);
    const [showDisableEncryptionModal, setShowDisableEncryptionModal] = useState(false);
    // Every model's state (on the phone? fits this phone?), not only the selected one.
    const [showSecurityInfoModal, setShowSecurityInfoModal] = useState(false);
    const [currentPeriodUsage, setCurrentPeriodUsage] = useState<CurrentPeriodUsage | null>(null);
    const [onDeviceTranscription, setOnDeviceTranscriptionState] = useState(false);
    const [offlineStatus, setOfflineStatus] = useState<OfflineStatus | null>(null);
    const [offlinePlan, setOfflinePlan] = useState<OfflinePlan | null>(null);
    // Non-null while offline mode downloads: bytes across both models.
    const [offlineProgress, setOfflineProgress] = useState<{ loaded: number; total: number } | null>(null);
    const [showOfflineOffConfirm, setShowOfflineOffConfirm] = useState(false);
    const offlineStartingRef = useRef(false);

    const usingOpenAI = aiProvider === 'openai';
    const showCustomAIConfig = usingOpenAI || customAIPending;
    const usingLocalWhisper = LOCAL_MODELS_ENABLED && ((aiProvider as string) === 'local_whisper' || (aiProvider as string) === 'local');
    const guestSecondsLeft = user?.transcription_remaining_seconds;
    const trialInfoText = typeof guestSecondsLeft === 'number'
        ? (guestSecondsLeft > 0
            ? t('settings.ui.guestMinutesLeft', 'Free speech-to-text left: {{minutes}} min. Sign in to get more and sync your notes.', { minutes: Math.max(1, Math.round(guestSecondsLeft / 60)) })
            : t('settings.ui.guestMinutesUsed', 'Free minutes are used up. Sign in to get more, or turn on "Work without internet" below.'))
        : t('settings.ui.trialInfoAccount', 'Sign in to get free speech-to-text minutes and sync your notes.');
    const hasConfiguredKey = encryptionMode === 'e2ee';
    const syncToggleDisabled = !isAuthenticated || isGuest;
    const isGuestOrAnonymous = !isAuthenticated || isGuest;
    const isSubscriptionActive = Platform.OS === 'android' && !!subscriptionStatus?.isActive;

    // Voice & AI card: the cloud works with no setup; one "Offline mode" switch
    // downloads the best speech and AI models this phone can run; "Only on this
    // phone" then keeps voice (and AI) on the device even online.
    const offlineDownloading = offlineProgress !== null;
    const offlineOn = !!offlineStatus?.speechReady || offlineDownloading;
    const offlineAIMissing = !!offlineStatus?.speechReady && !!offlineStatus?.aiSupported && !offlineStatus?.aiReady;
    const privateMode = !!offlineStatus?.speechReady && (usingLocalWhisper || onDeviceTranscription);
    const privateVoiceOnly = !offlineStatus?.aiReady;
    const offlineDescription = offlineDownloading
        ? [
            t('settings.voice.downloading', 'Downloading · {{percent}}%', {
                percent: offlineProgress && offlineProgress.total > 0 ? Math.round((offlineProgress.loaded / offlineProgress.total) * 100) : 0,
            }),
            offlineProgress && offlineProgress.total > 0
                ? `${formatModelSize(offlineProgress.loaded, t)} / ${formatModelSize(offlineProgress.total, t)}`
                : '',
        ].filter(Boolean).join(' · ')
        : offlineStatus?.speechReady
            ? (offlineAIMissing
                ? t('settings.voice.offlineAIMissing', 'Speech works offline. Tap to add AI ({{size}})', {
                    size: formatModelSize(offlinePlan?.downloadBytes ?? 0, t),
                })
                : offlineStatus.aiReady
                    ? t('settings.voice.offlineReadyAll', 'Ready · speech and AI work without internet')
                    : t('settings.voice.offlineReadySpeech', 'Ready · speech works without internet'))
            : offlinePlan
                ? t('settings.voice.offlineHintAll', 'Speech and AI right on the phone, no internet needed · {{size}}', {
                    size: formatModelSize(offlinePlan.downloadBytes, t),
                })
                : t('settings.voice.offlineNoSpace', 'Not enough free space on this phone');

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



    const refreshOffline = useCallback(async () => {
        try {
            const [status, plan] = await Promise.all([getOfflineStatus(), planOfflineModels()]);
            setOfflineStatus(status);
            setOfflinePlan(plan);
        } catch (error) {
            console.warn('Failed to read offline mode state', error);
        }
    }, []);

    useEffect(() => {
        loadPreferences();
        void getOnDeviceTranscription().then(setOnDeviceTranscriptionState);
    }, []);

    useFocusEffect(
        useCallback(() => {
            void refreshOffline();
        }, [refreshOffline])
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
            const [storedOpenAIKey, storedBaseUrl, provider, legacySelfHostedApiKey, whisperStatus, savedLanguage] = await Promise.all([
                getOpenAIApiKey(),
                getOpenAIBaseUrl(),
                getAIProvider(),
                getLegacySelfHostedApiKey(),
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

            // A phone-only setup without its speech model (chosen before the model was
            // downloaded, or the file was removed) has nothing to turn off in the new
            // settings and would fail every recording: hand it back to the cloud.
            if (isLocalAIProvider(provider) && !whisperStatus.isDownloaded) {
                await setAIProvider('vaulto_ai');
                await setOnDeviceTranscription(false);
                setOnDeviceTranscriptionState(false);
                setAiProviderState('vaulto_ai');
            } else {
                setAiProviderState(provider || 'vaulto_ai');
            }
            setTranscriptionLanguageState(savedLanguage);
        } catch (error) {
            console.error('Failed to load settings', error);
        } finally {
            setPreferencesReady(true);
        }
    };

    const updateProvider = async (provider: AIProvider) => {
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

    // Turns offline mode on (or completes it): the best models for this phone,
    // confirmed once with their total size, downloaded as one progress bar.
    const handleEnableOffline = useCallback(async () => {
        if (offlineStartingRef.current || offlineProgress !== null) return;
        offlineStartingRef.current = true;
        try {
            const plan = await planOfflineModels();
            if (!plan) {
                Alert.alert(
                    t('settings.voice.offlineNoSpaceTitle', 'Not enough space'),
                    t('settings.voice.offlineNoSpace', 'Not enough free space on this phone'),
                );
                return;
            }
            if (plan.downloadBytes > 0) {
                const net = await NetInfo.fetch().catch(() => null);
                const proceed = await new Promise<boolean>((resolve) => {
                    Alert.alert(
                        t('settings.voice.offlineConfirmTitle', 'Download offline mode?'),
                        [
                            t('settings.voice.offlineConfirmDesc', 'The best speech and AI models for this phone, {{size}}, downloaded once. After that notes work without internet.', {
                                size: formatModelSize(plan.downloadBytes, t),
                            }),
                            net?.type === 'cellular' ? t('localAI.downloadCellular', 'You are on mobile data — Wi-Fi is recommended.') : '',
                        ].filter(Boolean).join('\n\n'),
                        [
                            { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
                            { text: t('localAI.download', 'Download'), onPress: () => resolve(true) },
                        ],
                        { cancelable: true, onDismiss: () => resolve(false) },
                    );
                });
                if (!proceed) return;
            }
            setOfflineProgress({ loaded: 0, total: plan.downloadBytes });
            offlineStartingRef.current = false;
            try {
                await downloadOfflineModels(plan, (loaded, total) => setOfflineProgress({ loaded, total }));
                haptics.success();
            } catch (error: any) {
                if (!String(error?.message ?? '').toLowerCase().includes('cancel')) {
                    Alert.alert(t('alerts.downloadFailed', 'Download failed'), getErrorMessage(error, t('aux.unableDownloadWhisper')));
                }
            } finally {
                setOfflineProgress(null);
                await refreshOffline();
            }
        } finally {
            offlineStartingRef.current = false;
        }
    }, [offlineProgress, refreshOffline, t]);

    const handleToggleOffline = useCallback(async (on: boolean) => {
        if (on) {
            await handleEnableOffline();
            return;
        }
        if (offlineProgress !== null) {
            await cancelOfflineDownload();
            return;
        }
        setShowOfflineOffConfirm(true);
    }, [handleEnableOffline, offlineProgress]);

    // Off removes both models. Settings first, so a failed delete never leaves a
    // phone-only setup without its models.
    const handleDisableOffline = useCallback(async () => {
        setShowOfflineOffConfirm(false);
        setOnDeviceTranscriptionState(false);
        await setOnDeviceTranscription(false);
        if (usingLocalWhisper) {
            await updateProvider('vaulto_ai');
        }
        try {
            await removeOfflineModels();
        } catch (error: any) {
            Alert.alert(t('alerts.deleteFailed', 'Could not delete'), getErrorMessage(error, t('alerts.whisperDeleteFailed', 'Could not remove the speech model.')));
        }
        await refreshOffline();
    }, [usingLocalWhisper, refreshOffline, t]);

    const handleTogglePrivateMode = useCallback(async (on: boolean) => {
        setOnDeviceTranscriptionState(on);
        await setOnDeviceTranscription(on);
        // AI moves to the phone only when its model is there; otherwise "local"
        // would block every AI feature. Voice alone stays private then.
        if (!on) {
            await updateProvider('vaulto_ai');
        } else if (offlineStatus?.aiReady) {
            await updateProvider('local');
        }
    }, [offlineStatus?.aiReady]);

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

    // Throws on failure so DeleteAccountModal can show the error and stay open.
    const handleDeleteAccount = async (keepLocalNotes: boolean) => {
        // Stop background sync so it cannot upload into the account being deleted.
        syncService.setSyncEnabled(false);
        try {
            await authApi.deleteAccount();
        } catch (error) {
            syncService.setSyncEnabled(syncEnabled);
            console.error('[Settings] Account deletion failed', getErrorMessage(error));
            throw error;
        }
        try {
            await Purchases.logOut();
        } catch (error) {
            // Already anonymous in RevenueCat, or the SDK is not configured.
            console.warn('[Settings] RevenueCat logOut after account deletion failed', error);
        }
        setShowDeleteAccountModal(false);
        await signOut({ keepLocalNotes, wipeLocal: !keepLocalNotes });
        setShowAccountDeletedModal(true);
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
                    <MaterialIcons name="arrow-back" size={24} color={colors.text} style={rtlFlip} />
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
                                        <Text style={styles.userName} numberOfLines={1}>{user.full_name}</Text>
                                    )}
                                    <Text
                                        style={user.full_name ? styles.userEmail : styles.userEmailPrimary}
                                        numberOfLines={1}
                                        ellipsizeMode="middle"
                                    >
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
                        <MaterialIcons name="chevron-right" size={20} color={colors.textSecondary} style={rtlFlip} />
                    </TouchableOpacity>
                    <View style={styles.themeDivider} />
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.s }}>
                        <MaterialIcons name="contrast" size={24} color={colors.textSecondary} />
                        <Text style={styles.preferenceTitle}>{t('settings.theme.title', 'Theme')}</Text>
                    </View>
                    <View style={styles.themeSegments} accessibilityRole="radiogroup">
                        {([
                            { key: 'system', icon: 'brightness-auto', label: t('settings.theme.system', 'System') },
                            { key: 'light', icon: 'light-mode', label: t('settings.theme.light', 'Light') },
                            { key: 'dark', icon: 'dark-mode', label: t('settings.theme.dark', 'Dark') },
                        ] as const).map((option) => {
                            const selected = themePreference === option.key;
                            return (
                                <TouchableOpacity
                                    key={option.key}
                                    style={[styles.themeSegment, selected && styles.themeSegmentActive]}
                                    onPress={() => {
                                        if (!selected) {
                                            haptics.selection();
                                            setThemePreference(option.key);
                                        }
                                    }}
                                    accessibilityRole="radio"
                                    accessibilityState={{ selected }}
                                    accessibilityLabel={option.label}
                                >
                                    <MaterialIcons
                                        name={option.icon}
                                        size={18}
                                        color={selected ? colors.primary : colors.textSecondary}
                                    />
                                    <Text
                                        style={[styles.themeSegmentText, selected && styles.themeSegmentTextActive]}
                                        numberOfLines={2}
                                    >
                                        {option.label}
                                    </Text>
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                </View>

                {/* Your data: trash, export, import */}
                <View style={styles.card}>
                    <Text style={styles.dataCardTitle}>{t('data.title', 'Notes')}</Text>
                    <View style={styles.preferenceRow}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.s, flex: 1 }}>
                            <MaterialIcons name="insights" size={24} color={colors.textSecondary} />
                            <View style={{ flex: 1 }}>
                                <Text style={styles.preferenceTitle}>{t('digest.settingTitle', 'Weekly summary')}</Text>
                                <Text style={styles.preferenceDescription}>{t('digest.settingDesc', 'Sunday evening: what you noted and what is still open')}</Text>
                            </View>
                        </View>
                        <Switch
                            value={digestEnabled}
                            onValueChange={(value) => { void toggleDigest(value); }}
                            trackColor={{ false: colors.textTertiary, true: colors.primary }}
                            thumbColor={colors.onPrimary}
                            style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                            accessibilityLabel={t('digest.settingTitle', 'Weekly summary')}
                        />
                    </View>
                    <View style={styles.themeDivider} />
                    <TouchableOpacity
                        style={styles.preferenceRow}
                        activeOpacity={0.85}
                        onPress={() => navigation.navigate('Trash')}
                        accessibilityRole="button"
                    >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.s, flex: 1 }}>
                            <MaterialIcons name="delete-outline" size={24} color={colors.textSecondary} />
                            <View style={{ flex: 1 }}>
                                <Text style={styles.preferenceTitle}>{t('trash.title', 'Trash')}</Text>
                                <Text style={styles.preferenceDescription}>{t('trash.rowDesc', 'Deleted notes, kept for 30 days')}</Text>
                            </View>
                        </View>
                        <MaterialIcons name="chevron-right" size={20} color={colors.textSecondary} style={rtlFlip} />
                    </TouchableOpacity>
                    <View style={styles.themeDivider} />
                    <TouchableOpacity
                        style={styles.preferenceRow}
                        activeOpacity={0.85}
                        onPress={() => { void handleExport(); }}
                        disabled={transferBusy !== null}
                        accessibilityRole="button"
                    >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.s, flex: 1 }}>
                            <MaterialIcons name="ios-share" size={24} color={colors.textSecondary} />
                            <View style={{ flex: 1 }}>
                                <Text style={styles.preferenceTitle}>{t('data.exportTitle', 'Export notes')}</Text>
                                <Text style={styles.preferenceDescription}>{t('data.exportDesc', 'Markdown files in a ZIP')}</Text>
                            </View>
                        </View>
                        {transferBusy === 'export'
                            ? <ActivityIndicator size="small" color={colors.primary} />
                            : <MaterialIcons name="chevron-right" size={20} color={colors.textSecondary} style={rtlFlip} />}
                    </TouchableOpacity>
                    <View style={styles.themeDivider} />
                    <TouchableOpacity
                        style={styles.preferenceRow}
                        activeOpacity={0.85}
                        onPress={() => { void handleImport(); }}
                        disabled={transferBusy !== null}
                        accessibilityRole="button"
                    >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.s, flex: 1 }}>
                            <MaterialIcons name="file-download" size={24} color={colors.textSecondary} />
                            <View style={{ flex: 1 }}>
                                <Text style={styles.preferenceTitle}>{t('data.importTitle', 'Import notes')}</Text>
                                <Text style={styles.preferenceDescription}>{t('data.importDesc', '.md, .txt, .zip or Google Keep (Takeout)')}</Text>
                            </View>
                        </View>
                        {transferBusy === 'import'
                            ? <ActivityIndicator size="small" color={colors.primary} />
                            : <MaterialIcons name="chevron-right" size={20} color={colors.textSecondary} style={rtlFlip} />}
                    </TouchableOpacity>
                </View>

                {/* Cloud Sync */}
                {/* Guests have nothing to sync yet; the account card above offers sign-in. */}
                {!isGuestOrAnonymous && (
                    <View style={styles.card}>
                        <View style={[styles.cardHeader, { marginBottom: 0 }]}>
                            <Text style={styles.dataCardTitle}>{t("settings.ui.cloudSync", "Cloud Sync")}</Text>
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

                        {/* A guest has no vault: encryption controls left by a previous account do not apply. */}
                        {(!hasConfiguredKey || isGuestOrAnonymous) ? (
                            <>
                                <View style={[styles.preferenceRow, styles.voiceRow]}>
                                    <View style={styles.voiceRowText}>
                                        <MaterialIcons name={syncEnabled ? 'cloud-done' : 'cloud-off'} size={24} color={syncEnabled ? colors.primary : colors.textSecondary} />
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.preferenceTitle}>{t('settings.sync.title', 'Sync')}</Text>
                                            <Text style={styles.preferenceDescription}>
                                                {syncEnabled
                                                    ? t('settings.sync.onPlain', 'On · notes are backed up and on all your devices')
                                                    : t('settings.sync.off', 'Off · notes stay on this phone')}
                                            </Text>
                                        </View>
                                    </View>
                                    <Switch
                                        value={syncEnabled}
                                        onValueChange={(value) => { void handleToggleSync(value); }}
                                        disabled={showUnlockingOverlay || resetRecoveryPending}
                                        trackColor={{ false: colors.textTertiary, true: colors.primary }}
                                        thumbColor={colors.onPrimary}
                                        style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                                        accessibilityLabel={t('settings.sync.title', 'Sync')}
                                    />
                                </View>
                                <View style={styles.separator} />
                                <TouchableOpacity
                                    style={[styles.preferenceRow, styles.voiceRow]}
                                    activeOpacity={0.85}
                                    accessibilityRole="button"
                                    disabled={autoEncrypting}
                                    onPress={() => {
                                        if (isGuestOrAnonymous) {
                                            setShowSecurityAuthModal(true);
                                            return;
                                        }
                                        void handleEnableEncryption();
                                    }}
                                >
                                    <View style={styles.voiceRowText}>
                                        <MaterialIcons name="lock-outline" size={24} color={colors.textSecondary} />
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.preferenceTitle}>{t('settings.sync.e2eeTitle', 'End-to-end encryption')}</Text>
                                            <Text style={styles.preferenceDescription}>
                                                {autoEncrypting
                                                    ? t('settings.sync.e2eeTurningOn', 'Turning on…')
                                                    : t('settings.sync.e2eeOffDesc', 'Only you can read your notes, not even Vaulto')}
                                            </Text>
                                        </View>
                                    </View>
                                    {autoEncrypting
                                        ? <ActivityIndicator size="small" color={colors.primary} />
                                        : <Text style={styles.rowAction}>{t('settings.sync.turnOn', 'Turn on')}</Text>}
                                </TouchableOpacity>
                            </>
                        ) : encryptionStatus === 'locked' ? (
                            <TouchableOpacity
                                style={styles.preferenceRow}
                                activeOpacity={0.85}
                                accessibilityRole="button"
                                onPress={() => {
                                    if (isGuestOrAnonymous) {
                                        setShowSecurityAuthModal(true);
                                        return;
                                    }
                                    setShowUnlockSyncModal(true);
                                }}
                            >
                                <View style={[styles.securityRowLeft, { gap: spacing.s }]}>
                                    <MaterialIcons name="lock-outline" size={24} color={colors.textSecondary} />
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.preferenceTitle}>
                                            {t("settings.ui.vaultLocked", "Vault is locked")}
                                        </Text>
                                        {hasRemoteKeyBundle && (
                                            <Text style={styles.preferenceDescription}>
                                                {t("settings.ui.unlockToRestore", "Encrypted notes on server")}
                                            </Text>
                                        )}
                                    </View>
                                </View>
                                <Text style={styles.rowAction}>{t("settings.ui.unlock", "Unlock")}</Text>
                            </TouchableOpacity>
                        ) : (
                            <>
                                <View style={[styles.preferenceRow, styles.voiceRow]}>
                                    <View style={styles.voiceRowText}>
                                        <MaterialIcons name={syncEnabled ? 'cloud-done' : 'cloud-off'} size={24} color={syncEnabled ? colors.primary : colors.textSecondary} />
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.preferenceTitle}>{t('settings.sync.title', 'Sync')}</Text>
                                            <Text style={styles.preferenceDescription}>
                                                {encryptionStatus === 'loading'
                                                    ? t('settings.ui.checking', 'Checking…')
                                                    : syncEnabled
                                                        ? t('settings.sync.onE2ee', 'On · end-to-end encrypted, only you can read it')
                                                        : t('settings.sync.off', 'Off · notes stay on this phone')}
                                            </Text>
                                        </View>
                                    </View>
                                    {encryptionStatus === 'loading' ? (
                                        <ActivityIndicator size="small" color={colors.primary} />
                                    ) : !syncToggleDisabled && (
                                        <Switch
                                            value={syncEnabled}
                                            onValueChange={(value) => { void handleToggleSync(value); }}
                                            disabled={showUnlockingOverlay}
                                            trackColor={{ false: colors.textTertiary, true: colors.primary }}
                                            thumbColor={colors.onPrimary}
                                            style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                                            accessibilityLabel={t('settings.sync.title', 'Sync')}
                                        />
                                    )}
                                </View>
                                {!!recoveryCode && (
                                    <>
                                        <View style={styles.separator} />
                                        <TouchableOpacity
                                            style={[styles.preferenceRow, styles.voiceRow]}
                                            activeOpacity={0.85}
                                            accessibilityRole="button"
                                            onPress={() => setShowRecoveryCodeModal(true)}
                                        >
                                            <View style={styles.voiceRowText}>
                                                <MaterialCommunityIcons name="key-variant" size={24} color={colors.textSecondary} />
                                                <View style={{ flex: 1 }}>
                                                    <Text style={styles.preferenceTitle}>{t('settings.recovery.keyTitle', 'Recovery key')}</Text>
                                                    <Text style={styles.preferenceDescription}>{t('settings.sync.keyDesc', 'Opens your notes on a new phone')}</Text>
                                                </View>
                                            </View>
                                            <MaterialIcons name="chevron-right" size={20} color={colors.textSecondary} style={rtlFlip} />
                                        </TouchableOpacity>
                                    </>
                                )}
                                <TouchableOpacity
                                    style={styles.quietLink}
                                    onPress={() => setShowDisableEncryptionModal(true)}
                                    accessibilityRole="button"
                                >
                                    <Text style={styles.quietLinkText}>{t('settings.sync.turnOffE2ee', 'Turn off end-to-end encryption')}</Text>
                                </TouchableOpacity>
                            </>
                        )}

                    </View>
                )}





                {/* Voice & AI: works out of the box (cloud), one switch for offline */}
                <View style={styles.card}>
                    <Text style={styles.dataCardTitle}>{t("settings.voice.title", "Voice & AI")}</Text>

                    {LOCAL_WHISPER_ENABLED && (
                        <>
                            <TouchableOpacity
                                style={[styles.preferenceRow, styles.voiceRow]}
                                activeOpacity={0.85}
                                disabled={!offlineAIMissing || offlineDownloading}
                                onPress={() => { void handleEnableOffline(); }}
                                accessibilityRole={offlineAIMissing ? 'button' : undefined}
                            >
                                <View style={styles.voiceRowText}>
                                    <MaterialIcons name="cloud-off" size={24} color={offlineOn ? colors.primary : colors.textSecondary} />
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.preferenceTitle}>{t("settings.voice.offlineMode", "Offline mode")}</Text>
                                        <Text style={styles.preferenceDescription}>{offlineDescription}</Text>
                                    </View>
                                </View>
                                <Switch
                                    value={offlineOn}
                                    onValueChange={(value) => { void handleToggleOffline(value); }}
                                    disabled={!offlineOn && !offlinePlan}
                                    trackColor={{ false: colors.textTertiary, true: colors.primary }}
                                    thumbColor={colors.onPrimary}
                                    style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                                    accessibilityLabel={t("settings.voice.offlineMode", "Offline mode")}
                                />
                            </TouchableOpacity>

                            {offlineDownloading && (
                                <View style={styles.voiceProgress}>
                                    <View style={styles.voiceProgressTrack}>
                                        <View style={[styles.voiceProgressFill, {
                                            width: `${offlineProgress && offlineProgress.total > 0 ? Math.round((offlineProgress.loaded / offlineProgress.total) * 100) : 0}%`,
                                        }]} />
                                    </View>
                                    <TouchableOpacity onPress={() => { void cancelOfflineDownload(); }} hitSlop={12} accessibilityRole="button">
                                        <Text style={styles.voiceProgressCancel}>{t("common.cancel", "Cancel")}</Text>
                                    </TouchableOpacity>
                                </View>
                            )}

                            {!!offlineStatus?.speechReady && (
                                <>
                                    <View style={styles.separator} />
                                    <View style={[styles.preferenceRow, styles.voiceRow]}>
                                        <View style={styles.voiceRowText}>
                                            <MaterialIcons name="phonelink-lock" size={24} color={privateMode ? colors.primary : colors.textSecondary} />
                                            <View style={{ flex: 1 }}>
                                                <Text style={styles.preferenceTitle}>{t("settings.voice.private", "Only on this phone")}</Text>
                                                <Text style={styles.preferenceDescription}>
                                                    {privateVoiceOnly
                                                        ? t("settings.voice.privateVoiceDesc", "Voice never leaves the phone, even online")
                                                        : t("settings.voice.privateDesc", "Voice and AI never leave the phone, even online")}
                                                </Text>
                                            </View>
                                        </View>
                                        <Switch
                                            value={privateMode}
                                            onValueChange={(value) => { void handleTogglePrivateMode(value); }}
                                            trackColor={{ false: colors.textTertiary, true: colors.primary }}
                                            thumbColor={colors.onPrimary}
                                            style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                                            accessibilityLabel={t("settings.voice.private", "Only on this phone")}
                                        />
                                    </View>
                                </>
                            )}
                            <View style={styles.separator} />
                        </>
                    )}

                    <View style={[styles.modelLanguageRow, styles.voiceRow]}>
                        <MaterialIcons name="translate" size={24} color={colors.textSecondary} />
                        <Text style={styles.modelLanguageLabel}>{t('localModels.language', 'Speech language')}</Text>
                        <SearchableLanguageSelector
                            value={transcriptionLanguage}
                            onChange={(lang) => { void updateTranscriptionLanguage(lang); }}
                        />
                    </View>
                            {/* Setup for Custom AI (OpenAI & Compatible) */}
                            {CUSTOM_AI_ENABLED && showCustomAIConfig && (
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
                                            <ActivityIndicator size="small" color={colors.onPrimary} />
                                        ) : (
                                            <>
                                                <MaterialIcons name="wifi-tethering" size={16} color={colors.onPrimary} />
                                                <Text style={styles.openAITestButtonText}>{t("settings.ui.testConnection", "Test Connection")}</Text>
                                            </>
                                        )}
                                    </TouchableOpacity>
                                </View>
                            )}

                </View>

                {/* Sign Out & About */}
                <View style={{ marginTop: spacing.m, marginBottom: spacing.m, gap: spacing.m }}>
                    {isAuthenticated && !isGuest && (
                        <>
                            <TouchableOpacity
                                style={styles.signOutButton}
                                onPress={handleSignOut}
                            >
                                <MaterialIcons name="logout" size={18} color={colors.error} style={rtlFlip} />
                                <Text style={styles.signOutText}>{t("settings.account.signOut", "Sign Out")}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={styles.deleteAccountButton}
                                onPress={() => setShowDeleteAccountModal(true)}
                                accessibilityRole="button"
                            >
                                <Text style={styles.deleteAccountText}>{t("settings.ui.deleteAccount", "Delete Account")}</Text>
                            </TouchableOpacity>
                        </>
                    )}

                    <View style={{ alignItems: 'center', gap: spacing.s, opacity: 0.7 }}>
                        {/* Wraps: the two links do not fit on one line in every language. */}
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: spacing.l, rowGap: spacing.xs, paddingHorizontal: spacing.m }}>
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
                                    {`\u2066${formatTimeMMSS(subscriptionUsedSeconds)} / ${formatTimeMMSS(subscriptionTotalSeconds)}\u2069`}
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

            <DeleteConfirmationDialog
                visible={showOfflineOffConfirm}
                title={t('settings.voice.offlineModeOffTitle', 'Turn off offline mode?')}
                message={t(
                    'settings.voice.offlineModeOffDesc',
                    'The models are removed from this phone and free {{size}}. Without internet, recordings are saved and turned into text once you are back online.',
                    { size: formatModelSize(offlineStatus?.bytesOnPhone ?? 0, t) }
                )}
                onConfirm={() => { void handleDisableOffline(); }}
                onCancel={() => setShowOfflineOffConfirm(false)}
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
                title={overlayKind === 'encrypt'
                    ? t("settings.sync.encryptingTitle", "Encrypting your notes")
                    : t("settings.ui.unlockingNotesTitle", "Unlocking notes")}
                subtitle={overlayKind === 'encrypt'
                    ? t("settings.sync.encryptingSubtitle", "Only you will be able to read them.")
                    : t("settings.ui.unlockingNotesSubtitle", "Checking your passphrase on this device.")}
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
            <DeleteAccountModal
                visible={showDeleteAccountModal}
                onClose={() => setShowDeleteAccountModal(false)}
                onConfirm={handleDeleteAccount}
                onManageSubscription={() => { void openManageSubscription(); }}
            />
            <SuccessModal
                visible={showAccountDeletedModal}
                title={t('settings.deleteAccountDialog.successTitle', 'Account deleted')}
                message={t('settings.deleteAccountDialog.successMessage', 'Your account and its data have been deleted from our servers.')}
                onClose={() => setShowAccountDeletedModal(false)}
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

const styles = createStyles(() => ({
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
        width: '100%',
        maxWidth: 680,
        alignSelf: 'center',
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
        width: '100%',
        maxWidth: 680,
        alignSelf: 'center',
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
        color: colors.onPrimary,
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
        color: colors.onPrimary,
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
        width: '100%',
        maxWidth: 640,
        alignSelf: 'center',
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
        backgroundColor: colors.warningLight,
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
    dataCardTitle: {
        fontSize: 13,
        fontWeight: '600',
        color: colors.textSecondary,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: spacing.s,
    },
    themeDivider: {
        height: 1,
        backgroundColor: colors.border,
        marginVertical: spacing.m,
    },
    themeSegments: {
        flexDirection: 'row',
        gap: spacing.xs,
        marginTop: spacing.s,
        padding: 4,
        borderRadius: 14,
        backgroundColor: colors.backgroundSecondary,
    },
    themeSegment: {
        flex: 1,
        minHeight: 48,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        paddingHorizontal: 4,
    },
    themeSegmentActive: {
        backgroundColor: isDarkScheme() ? '#353B43' : colors.surface,
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 1 },
        elevation: 1,
    },
    themeSegmentText: {
        fontSize: 13,
        textAlign: 'center',
        fontWeight: '500',
        color: colors.textSecondary,
    },
    themeSegmentTextActive: {
        color: colors.text,
        fontWeight: '600',
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
        backgroundColor: colors.primaryLight,
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
        backgroundColor: colors.primaryLight,
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
        color: colors.onPrimary,
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
    // Same weight as the AI-section rows so both cards read as one list.
    securityLabelMinimal: {
        ...typography.body,
        fontSize: 15,
        color: colors.text,
        fontWeight: '600',
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
        color: colors.onPrimary,
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
        minHeight: 52,
        borderRadius: 16,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
    },
    quietLink: {
        alignSelf: 'center',
        minHeight: 44,
        justifyContent: 'center',
        marginTop: spacing.xs,
    },
    quietLinkText: {
        ...typography.caption,
        color: colors.textSecondary,
    },
    rowAction: {
        ...typography.body,
        fontWeight: '600',
        color: colors.primary,
    },
    signOutText: {
        ...typography.button,
        color: colors.error,
        fontSize: 15,
    },
    deleteAccountButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        minHeight: 44,
    },
    deleteAccountText: {
        ...typography.caption,
        fontWeight: '500',
        color: colors.textSecondary,
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
        color: colors.onPrimary,
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
        color: colors.onPrimary,
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
    voiceRow: {
        minHeight: 56,
        paddingVertical: spacing.s,
    },
    voiceRowText: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
        flex: 1,
        paddingRight: spacing.s,
    },
    voiceProgress: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.m,
        paddingLeft: 24 + spacing.s,
        paddingBottom: spacing.s,
    },
    voiceProgressTrack: {
        flex: 1,
        height: 4,
        borderRadius: 2,
        overflow: 'hidden',
        backgroundColor: colors.backgroundSecondary,
    },
    voiceProgressFill: {
        height: '100%',
        borderRadius: 2,
        backgroundColor: colors.primary,
    },
    voiceProgressCancel: {
        ...typography.caption,
        fontWeight: '600',
        color: colors.primary,
    },
    voiceQuality: {
        paddingLeft: 24 + spacing.s,
        paddingBottom: spacing.m,
    },
    voiceQualityLabel: {
        ...typography.caption,
        fontWeight: '600',
        color: colors.textSecondary,
    },
    voiceQualitySize: {
        fontSize: 11,
        color: colors.textSecondary,
    },
    voiceHint: {
        ...typography.caption,
        color: colors.textSecondary,
        marginTop: spacing.s,
    },
    inlineWarningText: {
        ...typography.captionBold,
        color: colors.warning,
        fontSize: 13,
    },
}));
