import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Switch, Linking, Modal, Pressable, Platform, Image, StyleSheet } from 'react-native';
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
import { useNavigation, useFocusEffect, useRoute } from '@react-navigation/native';
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
    getLocalModelsEnabled,
    setLocalModelsEnabled,
} from '../utils/storage';
import { formatModelSize } from '../components/OnDeviceModelSection';
import { attachOfflineDownload, cancelOfflineDownload, downloadOfflineModels, getModelChoices, getOfflineDownloadProgress, getOfflineStatus, OfflinePlan, OfflineStatus, planOfflineModels, removeOfflineModels } from '../services/offlineMode';
import { ModelPickerSheet } from '../components/ModelPickerSheet';
import { testOpenAIConnection } from '../services/TranscriptionService';
import { SignInRequiredModal } from '../components/SignInRequiredModal';
import { DeleteConfirmationDialog } from '../components/DeleteConfirmationDialog';
import { MaterialIcons } from '@expo/vector-icons';
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
import { appAlert } from '../components/AppAlert';

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

// ─── Building blocks ─────────────────────────────────────────────────────────
// Settings is a list of plain grouped rows: a quiet label above each group, text
// rows inside, an optional footnote below. No icons in rows, no nested cards.

interface SectionProps {
    label?: string;
    labelAccessory?: React.ReactNode;
    footer?: React.ReactNode;
    children: React.ReactNode;
}

const Section: React.FC<SectionProps> = ({ label, labelAccessory, footer, children }) => (
    <View style={styles.section}>
        {!!label && (
            <View style={styles.sectionLabelRow}>
                <Text style={styles.sectionLabel}>{label}</Text>
                {labelAccessory}
            </View>
        )}
        <View style={styles.group}>{children}</View>
        {typeof footer === 'string' ? <Text style={styles.sectionFooter}>{footer}</Text> : footer}
    </View>
);

const Divider = () => <View style={styles.divider} />;

interface RowProps {
    title: string;
    detail?: string | null;
    /** A small amber dot by the title: needs attention, not an error. */
    attention?: boolean;
    value?: string | null;
    tone?: 'default' | 'accent' | 'danger';
    onPress?: () => void;
    disabled?: boolean;
    /** Replaces the chevron: a switch, a spinner. */
    accessory?: React.ReactNode;
    /** Opens something outside the app. */
    external?: boolean;
    accessibilityLabel?: string;
}

const Row: React.FC<RowProps> = ({
    title, detail, attention, value, tone = 'default', onPress, disabled, accessory, external, accessibilityLabel,
}) => {
    const showChevron = !!onPress && accessory === undefined && tone !== 'danger';
    const content = (
        <>
            <View style={styles.rowText}>
                <View style={styles.rowTitleLine}>
                    <Text
                        style={[styles.rowTitle, tone === 'accent' && styles.rowTitleAccent, tone === 'danger' && styles.rowTitleDanger]}
                    >
                        {title}
                    </Text>
                    {attention && <View style={styles.attentionDot} />}
                </View>
                {!!detail && <Text style={styles.rowDetail}>{detail}</Text>}
            </View>
            {!!value && <Text style={styles.rowValue} numberOfLines={1}>{value}</Text>}
            {accessory}
            {showChevron && (
                <MaterialIcons
                    name={external ? 'north-east' : 'chevron-right'}
                    size={external ? 16 : 20}
                    color={colors.textTertiary}
                    style={external ? undefined : rtlFlip}
                />
            )}
        </>
    );
    if (!onPress) return <View style={styles.row}>{content}</View>;
    return (
        <TouchableOpacity
            style={[styles.row, disabled && styles.rowDisabled]}
            onPress={onPress}
            disabled={disabled}
            activeOpacity={0.6}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
        >
            {content}
        </TouchableOpacity>
    );
};

const Toggle: React.FC<{ value: boolean; onChange: (value: boolean) => void; disabled?: boolean; label: string }> = ({
    value, onChange, disabled, label,
}) => (
    <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: colors.borderHover, true: colors.primary }}
        thumbColor={colors.onPrimary}
        ios_backgroundColor={colors.borderHover}
        accessibilityLabel={label}
    />
);

interface SubscriptionRowsProps {
    isAuthenticated: boolean;
    isGuest: boolean;
    isPro: boolean;
    isLoading: boolean;
    onUpgrade: () => void;
    onOpenMinutesSheet: () => void;
    canManageSubscription: boolean;
    onManageSubscription: () => void;
}

const SubscriptionRows: React.FC<SubscriptionRowsProps> = ({
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
        return (
            <>
                <Divider />
                <ActivityIndicator size="small" color={colors.textSecondary} style={{ marginVertical: spacing.m }} />
            </>
        );
    }

    if (isPro) {
        return (
            <>
                <Divider />
                <Row title={t('settings.ui.subscriptionDetails', 'Subscription details')} onPress={onOpenMinutesSheet} />
                {canManageSubscription && (
                    <>
                        <Divider />
                        <Row title={t('settings.ui.manageGooglePlay', 'Manage in Google Play')} onPress={onManageSubscription} external />
                    </>
                )}
            </>
        );
    }

    return (
        <>
            <Divider />
            <Row
                title={t('settings.pro.upgrade', 'Upgrade to Pro')}
                detail={t('settings.pro.subtitle', 'Extended transcription & premium features')}
                tone="accent"
                onPress={onUpgrade}
            />
        </>
    );
};



export const SettingsScreen = () => {
    const navigation = useNavigation<any>();
    const route = useRoute<any>();
    const scrollRef = useRef<ScrollView>(null);
    const voiceSectionYRef = useRef<number | null>(null);
    const requestedSectionRef = useRef<string | undefined>(route.params?.section);
    // Opened for a specific group (e.g. "set up AI on this device"): scroll to it
    // once its position is known.
    const scrollToRequestedSection = useCallback(() => {
        if (requestedSectionRef.current !== 'voice' || voiceSectionYRef.current === null) return;
        requestedSectionRef.current = undefined;
        const y = Math.max(0, voiceSectionYRef.current - spacing.m);
        setTimeout(() => scrollRef.current?.scrollTo({ y, animated: true }), 250);
    }, []);
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
            appAlert(t('digest.settingTitle', 'Weekly summary'), t('digest.permissionDenied', 'Allow notifications for Vaulto in the device settings to get the summary.'), [
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
                appAlert(t('data.exportTitle', 'Export notes'), t('data.exportNothing', 'There are no notes to export.'));
            } else if (result.skippedProtected > 0) {
                appAlert(
                    t('data.exportTitle', 'Export notes'),
                    t('data.exportSkippedProtected', 'Protected notes ({{count}}) were not exported: they never leave the device unencrypted.', { count: result.skippedProtected }),
                );
            }
        } catch (error) {
            appAlert(t('data.exportTitle', 'Export notes'), getErrorMessage(error, t('data.exportFailed', 'Could not export the notes.')));
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
                appAlert(t('data.importTitle', 'Import notes'), t('data.importNothing', 'No notes found in these files. Supported: .md, .txt, .zip and Google Keep (Takeout).'));
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
            appAlert(t('data.importTitle', 'Import notes'), t('data.importDone', 'Imported notes: {{count}}', { count: created }));
        } catch (error) {
            appAlert(t('data.importTitle', 'Import notes'), getErrorMessage(error, t('data.importFailed', 'Could not import the notes.')));
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
        keyBackup,
    } = useEncryption();

    // The key is the notes: show it only after the phone's own unlock (fingerprint,
    // face or PIN) when one is set.
    const openRecoveryKey = useCallback(async () => {
        const { BiometricService } = await import('../services/BiometricService');
        const LocalAuthentication = await import('expo-local-authentication');
        const level = await LocalAuthentication.getEnrolledLevelAsync().catch(() => 0);
        if (level > 0) {
            const ok = await BiometricService.authenticate(t('settings.recovery.authReason', 'Show your recovery key'));
            if (!ok) return;
        }
        setShowRecoveryCodeModal(true);
    }, [t]);
    const [overlayKind, setOverlayKind] = useState<'unlock' | 'encrypt'>('unlock');

    // End-to-end encryption with a recovery key: the key is shown app-wide once ready.
    const handleEnableEncryption = useCallback(async () => {
        setOverlayKind('encrypt');
        setUnlockProgress(0);
        setShowUnlockingOverlay(true);
        try {
            await enableE2EEWithRecoveryKey((progress) => setUnlockProgress(progress));
        } catch (error: any) {
            appAlert(t('aux.enableSyncFailed', 'Could not enable encryption'), getErrorMessage(error, t('common.errorOccurred', 'An error occurred')));
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
    // Off keeps the downloaded models on the phone; they are just not used.
    const [localModelsEnabled, setLocalModelsEnabledState] = useState(true);
    const [showRemoveModelsConfirm, setShowRemoveModelsConfirm] = useState(false);
    const [showModelPicker, setShowModelPicker] = useState(false);
    // "Whisper Turbo · Qwen3.5 2B": the models in use, under the Models row.
    const [modelSummary, setModelSummary] = useState('');
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
    const offlineOn = (localModelsEnabled && !!offlineStatus?.speechReady) || offlineDownloading;
    // Switched off with the files still on the phone: switching on needs no download.
    const offlineOffKept = !offlineOn && !!offlineStatus?.speechReady;
    const offlineAIMissing = offlineOn && !!offlineStatus?.aiSupported && !offlineStatus?.aiReady
        && !!offlinePlan?.llmKey && offlinePlan.downloadBytes > 0;
    const privateMode = usingLocalWhisper || onDeviceTranscription;
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
        : offlineOffKept
            ? t('settings.voice.offlineOffKept', 'Off · recordings go to the cloud. The models stay on this device, turning on is instant')
        : offlineStatus?.speechReady
            ? (offlineAIMissing
                ? t('settings.voice.offlineAIMissing', 'Speech works offline. Tap to add AI ({{size}})', {
                    size: formatModelSize(offlinePlan?.downloadBytes ?? 0, t),
                })
                : offlineStatus.aiReady
                    ? t('settings.voice.offlineReadyAll', 'Ready · speech and AI work without internet')
                    : t('settings.voice.offlineReadySpeech', 'Ready · speech works without internet'))
            : offlinePlan
                ? t(offlinePlan.llmKey ? 'settings.voice.offlineHintAll' : 'settings.voice.offlineHintSpeech', offlinePlan.llmKey ? 'Speech and AI without internet · {{size}}' : 'Speech without internet · {{size}}', {
                    size: formatModelSize(offlinePlan.downloadBytes, t),
                })
                : t('settings.voice.offlineNoSpace', 'Not enough free space on this device');

    const openManageSubscription = useCallback(async () => {
        const fallbackGooglePlayUrl = 'https://play.google.com/store/account/subscriptions';
        const targetUrl = (Platform.OS === 'android'
            ? (subscriptionStatus?.managementURL || fallbackGooglePlayUrl)
            : subscriptionStatus?.managementURL) || fallbackGooglePlayUrl;

        try {
            const supported = await Linking.canOpenURL(targetUrl);
            if (!supported) {
                appAlert(t("common.unavailable"), t("aux.unableOpenSubscription"));
                return;
            }
            await Linking.openURL(targetUrl);
        } catch (error) {
            console.error('Failed to open subscription management URL:', error);
            appAlert(t("common.unavailable"), t("aux.unableOpenSubscription"));
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
                appAlert(t("common.failed"), error?.message || t("aux.unableEnableSync"));
            }
            return;
        }

        setShowDisableSyncModal(true);
    }, [encryptionStatus, setSyncEnabledPreference, syncToggleDisabled, t]);

    const confirmKeepResetArchiveLocal = useCallback(() => {
        appAlert(
            t('settings.resetRecovery.keepTitle', 'Keep notes only on this device?'),
            t('settings.resetRecovery.keepDescription', 'The recovered notes will remain local and cloud sync will stay off.'),
            [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('settings.resetRecovery.keepLocal', 'Keep local'),
                    onPress: () => {
                        void keepResetArchiveLocal().catch((error: any) => {
                            appAlert(t('common.failed', 'Failed'), error?.message || t('aux.somethingWentWrong', 'Something went wrong'));
                        });
                    },
                },
            ],
        );
    }, [keepResetArchiveLocal, t]);

    const confirmStandardResetRecovery = useCallback(() => {
        appAlert(
            t('settings.resetRecovery.standardTitle', 'Sync without E2EE?'),
            t('settings.resetRecovery.standardDescription', 'Your recovered notes will be uploaded using standard sync. Vaulto can technically process their contents.'),
            [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('settings.resetRecovery.standardAction', 'Use standard sync'),
                    style: 'destructive',
                    onPress: () => {
                        void resumeStandardSyncAfterReset().catch((error: any) => {
                            appAlert(t('common.failed', 'Failed'), error?.message || t('aux.somethingWentWrong', 'Something went wrong'));
                        });
                    },
                },
            ],
        );
    }, [resumeStandardSyncAfterReset, t]);



    const refreshOffline = useCallback(async () => {
        // A download started before Settings was (re)opened: follow it.
        const inFlight = getOfflineDownloadProgress();
        if (inFlight) {
            setOfflineProgress(inFlight);
            void attachOfflineDownload((loaded, total) => setOfflineProgress({ loaded, total }))
                ?.catch(() => undefined)
                .finally(() => { setOfflineProgress(null); void refreshOffline(); });
        }
        try {
            const [status, plan, choices, enabled] = await Promise.all([getOfflineStatus(), planOfflineModels(), getModelChoices(), getLocalModelsEnabled()]);
            setLocalModelsEnabledState(enabled);
            setOfflineStatus(status);
            setOfflinePlan(plan);
            setModelSummary([...choices.speech, ...choices.ai].filter((c) => c.current).map((c) => c.name).join(' · '));
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
                appAlert(
                    t('settings.voice.offlineNoSpaceTitle', 'Not enough space'),
                    t('settings.voice.offlineNoSpace', 'Not enough free space on this device'),
                );
                return;
            }
            if (plan.downloadBytes > 0) {
                const net = await NetInfo.fetch().catch(() => null);
                const proceed = await new Promise<boolean>((resolve) => {
                    appAlert(
                        t('settings.voice.offlineConfirmTitle', 'Download models?'),
                        [
                            t('settings.voice.offlineConfirmDesc', 'The best speech and AI models for this device, {{size}}, downloaded once. After that notes work without internet.', {
                                size: formatModelSize(plan.downloadBytes, t),
                            }),
                            net?.type === 'cellular' ? t('localAI.downloadCellular', 'You are on mobile data — Wi-Fi is recommended.') : '',
                            !plan.llmKey ? t('settings.voice.speechFirst', 'Speech works without internet. Local AI is optional: it can be slow on devices with little memory.') : '',
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
                // "Only on this phone" was on with speech only: AI joins it now.
                const after = await getOfflineStatus().catch(() => null);
                if (after?.aiReady && onDeviceTranscription && !usingLocalWhisper) {
                    await updateProvider('local');
                }
            } catch (error: any) {
                if (!String(error?.message ?? '').toLowerCase().includes('cancel')) {
                    appAlert(t('alerts.downloadFailed', 'Download failed'), getErrorMessage(error, t('aux.unableDownloadWhisper')));
                }
            } finally {
                setOfflineProgress(null);
                await refreshOffline();
            }
        } finally {
            offlineStartingRef.current = false;
        }
    }, [offlineProgress, refreshOffline, onDeviceTranscription, usingLocalWhisper, t]);

    const handleToggleOffline = useCallback(async (on: boolean) => {
        if (on) {
            if (offlineStatus?.speechReady) {
                // The models are still on the phone: no download, no questions.
                setLocalModelsEnabledState(true);
                await setLocalModelsEnabled(true);
                haptics.success();
                await refreshOffline();
                return;
            }
            await handleEnableOffline();
            return;
        }
        if (offlineProgress !== null) {
            await cancelOfflineDownload();
            return;
        }
        // Off means "do not use them": everything goes back to the cloud and the
        // files stay, so there is nothing to ask about.
        setLocalModelsEnabledState(false);
        await setLocalModelsEnabled(false);
        setOnDeviceTranscriptionState(false);
        await setOnDeviceTranscription(false);
        if (usingLocalWhisper) {
            await updateProvider('vaulto_ai');
        }
        await refreshOffline();
    }, [handleEnableOffline, offlineProgress, offlineStatus?.speechReady, usingLocalWhisper, refreshOffline]);

    // Only from the Models sheet while local models are off: frees the space.
    const handleRemoveModels = useCallback(async () => {
        setShowRemoveModelsConfirm(false);
        try {
            await removeOfflineModels();
        } catch (error: any) {
            appAlert(t('alerts.deleteFailed', 'Could not delete'), getErrorMessage(error, t('alerts.whisperDeleteFailed', 'Could not remove the speech model.')));
        }
        await refreshOffline();
    }, [refreshOffline, t]);

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

    // The user's own pick from the Models sheet: same download path as offline mode.
    const handleApplyModels = useCallback(async (plan: OfflinePlan) => {
        if (offlineProgress !== null) return;
        setOfflineProgress({ loaded: 0, total: plan.downloadBytes });
        try {
            await downloadOfflineModels(plan, (loaded, total) => setOfflineProgress({ loaded, total }));
            haptics.success();
            const after = await getOfflineStatus().catch(() => null);
            if (after?.aiReady && onDeviceTranscription && !usingLocalWhisper) {
                await updateProvider('local');
            }
        } catch (error: any) {
            if (!String(error?.message ?? '').toLowerCase().includes('cancel')) {
                appAlert(t('alerts.downloadFailed', 'Download failed'), getErrorMessage(error, t('aux.unableDownloadWhisper')));
            }
        } finally {
            setOfflineProgress(null);
            await refreshOffline();
        }
    }, [offlineProgress, onDeviceTranscription, usingLocalWhisper, refreshOffline, t]);

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
        try {
            const { getSignOutDataAtRiskCount } = await import('../services/DatabaseService');
            setUnsyncedCount(await getSignOutDataAtRiskCount(userId ?? user?.id ?? ''));
            setShowSignOutDialog(true);
        } catch (error) {
            appAlert(t('common.error', 'Error'), getErrorMessage(error));
        }
    };

    // Throws on failure so DeleteAccountModal can show the error and stay open.
    const handleDeleteAccount = async (keepLocalNotes: boolean) => {
        // Stop background sync so it cannot upload into the account being deleted.
        syncService.setSyncEnabled(false);
        try {
            await authApi.deleteAccount();
            // The account and its notes are gone: so is the key's platform backup.
            if (userId) {
                const { removeKeyBackup } = await import('../services/keyBackup');
                await removeKeyBackup(userId);
            }
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

    const currentAppLanguage = appLanguages.find(l => l.key === i18n.language)?.label || 'English';
    const showAccountActions = isAuthenticated && !isGuest;

    return (
        <ScreenContainer>
            <View style={styles.topBar}>
                <TouchableOpacity
                    style={styles.backButton}
                    onPress={() => navigation.goBack()}
                    activeOpacity={0.6}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={t("a11y.back", "Back")}
                >
                    <MaterialIcons name="arrow-back" size={24} color={colors.text} style={rtlFlip} />
                </TouchableOpacity>
            </View>
            <ScrollView ref={scrollRef} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                <Text style={styles.title} accessibilityRole="header">{t('settings.ui.settingsHeader', 'Settings')}</Text>

                {/* Account */}
                <Section>
                    {isAuthenticated && user ? (
                        <>
                            <View style={styles.accountRow}>
                                <View style={styles.userAvatar}>
                                    <Text style={styles.userAvatarText}>
                                        {(user.full_name || user.email || 'U').charAt(0).toUpperCase()}
                                    </Text>
                                </View>
                                <View style={styles.userInfoText}>
                                    <View style={styles.userNameRow}>
                                        <Text style={styles.userName} numberOfLines={1}>
                                            {user.full_name || user.email || t('settings.account.signIn', 'Signed in')}
                                        </Text>
                                        {isPro && <Text style={styles.proMark}>{t('common.pro')}</Text>}
                                    </View>
                                    {!!user.full_name && !!user.email && (
                                        <Text style={styles.userEmail} numberOfLines={1} ellipsizeMode="middle">{user.email}</Text>
                                    )}
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
                        <View style={styles.signInBlock}>
                            <Text style={styles.signInTitle}>{t("settings.ui.signInTitle", "Sign in")}</Text>
                            <Text style={styles.rowDetail}>{t("settings.ui.signInDesc", "Sync notes & access AI features")}</Text>
                            <Button
                                title={t("settings.ui.signInBtn", "Sign In / Create Account")}
                                onPress={() => navigation.navigate('SignIn')}
                                style={styles.signInButton}
                            />
                            {!!trialInfoText && <Text style={styles.trialInfoText}>{trialInfoText}</Text>}
                        </View>
                    )}

                    <SubscriptionRows
                        isAuthenticated={isAuthenticated}
                        isGuest={isGuest}
                        isPro={isPro}
                        isLoading={subscriptionLoading}
                        onUpgrade={() => navigation.navigate('Paywall')}
                        onOpenMinutesSheet={openMinutesSheet}
                        canManageSubscription={isSubscriptionActive}
                        onManageSubscription={openManageSubscription}
                    />
                </Section>

                {/* General */}
                <Section label={t('settings.ui.general', 'General')}>
                    <Row
                        title={t('settings.languageSelection', 'App Language')}
                        value={currentAppLanguage}
                        onPress={() => setShowAppLanguageModal(true)}
                    />
                    <Divider />
                    <View style={styles.themeRow}>
                        <Text style={styles.rowTitle}>{t('settings.theme.title', 'Theme')}</Text>
                        <View style={styles.themeSegments} accessibilityRole="radiogroup">
                            {([
                                { key: 'system', label: t('settings.theme.system', 'System') },
                                { key: 'light', label: t('settings.theme.light', 'Light') },
                                { key: 'dark', label: t('settings.theme.dark', 'Dark') },
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
                                        activeOpacity={0.7}
                                        accessibilityRole="radio"
                                        accessibilityState={{ selected }}
                                        accessibilityLabel={option.label}
                                    >
                                        <Text
                                            style={[styles.themeSegmentText, selected && styles.themeSegmentTextActive]}
                                            numberOfLines={1}
                                            adjustsFontSizeToFit
                                            minimumFontScale={0.8}
                                        >
                                            {option.label}
                                        </Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>
                    </View>
                </Section>

                {/* Your notes: digest, trash, export, import */}
                <Section label={t('data.title', 'Notes')}>
                    <Row
                        title={t('digest.settingTitle', 'Weekly summary')}
                        detail={t('digest.settingDesc', 'Sunday evening: what you noted and what is still open')}
                        onPress={() => { void toggleDigest(!digestEnabled); }}
                        accessory={(
                            <Toggle
                                value={digestEnabled}
                                onChange={(value) => { void toggleDigest(value); }}
                                label={t('digest.settingTitle', 'Weekly summary')}
                            />
                        )}
                    />
                    <Divider />
                    <Row
                        title={t('trash.title', 'Trash')}
                        detail={t('trash.rowDesc', 'Deleted notes, kept for 30 days')}
                        onPress={() => navigation.navigate('Trash')}
                    />
                    <Divider />
                    <Row
                        title={t('data.exportTitle', 'Export notes')}
                        detail={t('data.exportDesc', 'Markdown files in a ZIP')}
                        onPress={() => { void handleExport(); }}
                        disabled={transferBusy !== null}
                        accessory={transferBusy === 'export' ? <ActivityIndicator size="small" color={colors.textSecondary} /> : undefined}
                    />
                    <Divider />
                    <Row
                        title={t('data.importTitle', 'Import notes')}
                        detail={t('data.importDesc', '.md, .txt, .zip or Google Keep (Takeout)')}
                        onPress={() => { void handleImport(); }}
                        disabled={transferBusy !== null}
                        accessory={transferBusy === 'import' ? <ActivityIndicator size="small" color={colors.textSecondary} /> : undefined}
                    />
                </Section>

                {/* Cloud Sync */}
                {/* Guests have nothing to sync yet; the account card above offers sign-in. */}
                {!isGuestOrAnonymous && (
                    <Section
                        label={t("settings.ui.cloudSync", "Cloud Sync")}
                        labelAccessory={(
                            <TouchableOpacity
                                onPress={() => setShowSecurityInfoModal(true)}
                                hitSlop={12}
                                accessibilityRole="button"
                                accessibilityLabel={t("a11y.helpSync", "About cloud sync")}
                            >
                                <MaterialIcons name="help-outline" size={16} color={colors.textTertiary} />
                            </TouchableOpacity>
                        )}
                        footer={hasConfiguredKey && encryptionStatus !== 'locked' && !isGuestOrAnonymous ? (
                            <TouchableOpacity
                                style={styles.footerLink}
                                onPress={() => setShowDisableEncryptionModal(true)}
                                accessibilityRole="button"
                            >
                                <Text style={styles.footerLinkText}>{t('settings.sync.turnOffE2ee', 'Turn off end-to-end encryption')}</Text>
                            </TouchableOpacity>
                        ) : undefined}
                    >
                        {resetRecoveryPending && (
                            <>
                                <View style={styles.noticeBlock}>
                                    <Text style={styles.noticeTitle}>
                                        {t('settings.resetRecovery.title', 'Encrypted vault was reset')}
                                    </Text>
                                    <Text style={styles.rowDetail}>
                                        {t('settings.resetRecovery.description', 'Notes retained on this device are isolated locally. Sync is paused so they cannot be uploaded without your choice.')}
                                    </Text>
                                    <View style={styles.noticeActions}>
                                        <TouchableOpacity style={styles.pillButtonPrimary} onPress={() => setShowEnableSyncModal(true)}>
                                            <Text style={styles.pillButtonPrimaryText}>
                                                {t('settings.resetRecovery.enableE2EE', 'Restore with E2EE')}
                                            </Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity style={styles.pillButton} onPress={confirmKeepResetArchiveLocal}>
                                            <Text style={styles.pillButtonText}>
                                                {t('settings.resetRecovery.keepLocal', 'Keep local')}
                                            </Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity style={styles.pillButton} onPress={confirmStandardResetRecovery}>
                                            <Text style={[styles.pillButtonText, { color: colors.warning }]}>
                                                {t('settings.resetRecovery.standardAction', 'Use standard sync')}
                                            </Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>
                                <Divider />
                            </>
                        )}

                        {/* A guest has no vault: encryption controls left by a previous account do not apply. */}
                        {(!hasConfiguredKey || isGuestOrAnonymous) ? (
                            <>
                                <Row
                                    title={t('settings.sync.title', 'Sync')}
                                    detail={syncEnabled
                                        ? t('settings.sync.onPlain', 'On · notes are backed up and on all your devices')
                                        : t('settings.sync.off', 'Off · notes stay on this device')}
                                    onPress={() => { void handleToggleSync(!syncEnabled); }}
                                    disabled={showUnlockingOverlay || resetRecoveryPending}
                                    accessory={(
                                        <Toggle
                                            value={syncEnabled}
                                            onChange={(value) => { void handleToggleSync(value); }}
                                            disabled={showUnlockingOverlay || resetRecoveryPending}
                                            label={t('settings.sync.title', 'Sync')}
                                        />
                                    )}
                                />
                                <Divider />
                                <Row
                                    title={t('settings.sync.e2eeTitle', 'End-to-end encryption')}
                                    detail={autoEncrypting
                                        ? t('settings.sync.e2eeTurningOn', 'Turning on…')
                                        : t('settings.sync.e2eeOffDesc', 'Only you can read your notes, not even Vaulto')}
                                    disabled={autoEncrypting}
                                    onPress={() => {
                                        if (isGuestOrAnonymous) {
                                            setShowSecurityAuthModal(true);
                                            return;
                                        }
                                        void handleEnableEncryption();
                                    }}
                                    accessory={autoEncrypting
                                        ? <ActivityIndicator size="small" color={colors.textSecondary} />
                                        : <Text style={styles.rowAction}>{t('settings.sync.turnOn', 'Turn on')}</Text>}
                                />
                            </>
                        ) : encryptionStatus === 'locked' ? (
                            <Row
                                title={t("settings.ui.vaultLocked", "Vault is locked")}
                                detail={hasRemoteKeyBundle ? t("settings.ui.unlockToRestore", "Encrypted notes on server") : null}
                                onPress={() => {
                                    if (isGuestOrAnonymous) {
                                        setShowSecurityAuthModal(true);
                                        return;
                                    }
                                    setShowUnlockSyncModal(true);
                                }}
                                accessory={<Text style={styles.rowAction}>{t("settings.ui.unlock", "Unlock")}</Text>}
                            />
                        ) : (
                            <>
                                <Row
                                    title={t('settings.sync.title', 'Sync')}
                                    detail={encryptionStatus === 'loading'
                                        ? t('settings.ui.checking', 'Checking…')
                                        : syncEnabled
                                            ? t('settings.sync.onE2ee', 'On · end-to-end encrypted, only you can read it')
                                            : t('settings.sync.off', 'Off · notes stay on this device')}
                                    onPress={encryptionStatus === 'loading' || syncToggleDisabled
                                        ? undefined
                                        : () => { void handleToggleSync(!syncEnabled); }}
                                    disabled={showUnlockingOverlay}
                                    accessory={encryptionStatus === 'loading'
                                        ? <ActivityIndicator size="small" color={colors.textSecondary} />
                                        : syncToggleDisabled ? null : (
                                            <Toggle
                                                value={syncEnabled}
                                                onChange={(value) => { void handleToggleSync(value); }}
                                                disabled={showUnlockingOverlay}
                                                label={t('settings.sync.title', 'Sync')}
                                            />
                                        )}
                                />
                                {!!recoveryCode && (
                                    <>
                                        <Divider />
                                        <Row
                                            title={t('settings.recovery.keyTitle', 'Recovery key')}
                                            detail={keyBackup?.cloud
                                                ? (Platform.OS === 'ios'
                                                    ? t('settings.sync.keyInIcloud', 'In iCloud Keychain · opens your notes on a new iPhone')
                                                    : t('settings.sync.keyInGoogle', 'In your Google backup · opens your notes on a new device'))
                                                : t('settings.sync.keyOnlyHere', 'Only on this device · save a copy so you never lose your notes')}
                                            attention={!keyBackup?.cloud}
                                            onPress={() => { void openRecoveryKey(); }}
                                        />
                                    </>
                                )}
                            </>
                        )}
                    </Section>
                )}

                {/* Voice & AI: works out of the box (cloud), one switch for offline */}
                <View onLayout={(event) => { voiceSectionYRef.current = event.nativeEvent.layout.y; scrollToRequestedSection(); }}>
                <Section
                    label={t("settings.voice.title", "Voice & AI")}
                    footer={privateMode ? undefined : t('settings.voice.routingHint', 'Cloud when online, downloaded models when offline. Switching is automatic. Cloud processing sends the selected audio or text to the service.')}
                >
                    {LOCAL_WHISPER_ENABLED && (
                        <>
                            <Row
                                title={t("settings.voice.offlineMode", "Work without internet")}
                                detail={offlineDescription}
                                onPress={offlineAIMissing && !offlineDownloading ? () => { void handleEnableOffline(); } : undefined}
                                accessory={(
                                    <Toggle
                                        value={offlineOn}
                                        onChange={(value) => { void handleToggleOffline(value); }}
                                        disabled={!offlineOn && !offlineOffKept && !offlinePlan}
                                        label={t("settings.voice.offlineMode", "Work without internet")}
                                    />
                                )}
                            />

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

                            {(offlineOn || privateMode) && (
                                <>
                                    <Divider />
                                    <Row
                                        title={t("settings.voice.private", "Only on this device")}
                                        detail={privateVoiceOnly
                                            ? t("settings.voice.privateVoiceDesc", "Voice never leaves the device, even online")
                                            : t("settings.voice.privateDesc", "Voice and AI never leave the device, even online")}
                                        onPress={() => { void handleTogglePrivateMode(!privateMode); }}
                                        accessory={(
                                            <Toggle
                                                value={privateMode}
                                                onChange={(value) => { void handleTogglePrivateMode(value); }}
                                                label={t("settings.voice.private", "Only on this device")}
                                            />
                                        )}
                                    />
                                </>
                            )}
                            {!offlineDownloading && (
                                <>
                                    <Divider />
                                    <Row
                                        title={t("settings.models.row", "Models")}
                                        detail={modelSummary || null}
                                        onPress={() => setShowModelPicker(true)}
                                    />
                                </>
                            )}
                            <Divider />
                        </>
                    )}

                    <SearchableLanguageSelector
                        value={transcriptionLanguage}
                        onChange={(lang) => { void updateTranscriptionLanguage(lang); }}
                        renderTrigger={(open, label) => (
                            <Row title={t('localModels.language', 'Speech language')} value={label} onPress={open} />
                        )}
                    />
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

                </Section>
                </View>

                {showAccountActions && (
                    <Section>
                        <Row title={t("settings.account.signOut", "Sign Out")} onPress={handleSignOut} accessory={null} />
                        <Divider />
                        <Row
                            title={t("settings.ui.deleteAccount", "Delete Account")}
                            tone="danger"
                            onPress={() => setShowDeleteAccountModal(true)}
                        />
                    </Section>
                )}

                <View style={styles.about}>
                    <TouchableOpacity onPress={() => Linking.openURL('https://vaultonote.com')} hitSlop={8}>
                        <Text style={styles.versionText}>
                            {t('settings.ui.vaultoVersion', 'Vaulto v{{version}}', { version: appConfig.expo.version })}
                        </Text>
                    </TouchableOpacity>
                    {/* Wraps: the two links do not fit on one line in every language. Spacing
                        instead of a "·" separator, which could be left hanging at a line end. */}
                    <View style={styles.legalLinks}>
                        <TouchableOpacity onPress={() => Linking.openURL('https://vaultonote.com/privacy')} hitSlop={8}>
                            <Text style={styles.legalLink}>{t("settings.ui.privacy", "Privacy Policy")}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => Linking.openURL('https://vaultonote.com/terms')} hitSlop={8}>
                            <Text style={styles.legalLink}>{t('settings.ui.termsOfService', 'Terms of Service')}</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </ScrollView>

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

            <ModelPickerSheet
                visible={showModelPicker}
                privateMode={privateMode}
                privateVoiceOnly={privateVoiceOnly}
                onClose={() => setShowModelPicker(false)}
                onApply={(plan) => { void handleApplyModels(plan); }}
                onUseCloud={() => { void handleTogglePrivateMode(false); }}
                removableBytes={offlineOffKept && !offlineDownloading ? offlineStatus?.bytesOnPhone ?? 0 : 0}
                onRemove={() => setShowRemoveModelsConfirm(true)}
            />
            <DeleteConfirmationDialog
                visible={showRemoveModelsConfirm}
                title={t('settings.voice.offlineModeOffTitle', 'Remove downloaded models?')}
                message={t(
                    'settings.voice.removeModelsDesc',
                    'The models are removed from this device and free {{size}}. To use them again, they are downloaded anew.',
                    { size: formatModelSize(offlineStatus?.bytesOnPhone ?? 0, t) }
                )}
                onConfirm={() => { void handleRemoveModels(); }}
                onCancel={() => setShowRemoveModelsConfirm(false)}
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
                        appAlert(t("settings.ui.failed", "Failed"), error?.message || t("settings.ui.unableDisableSync", "Unable to disable sync."));
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
                    void signOut({ keepLocalNotes: true, wipeLocal: false }).catch((error) => {
                        appAlert(t('common.error', 'Error'), getErrorMessage(error));
                    });
                }}
                onDelete={() => {
                    setShowSignOutDialog(false);
                    void signOut({ keepLocalNotes: false, wipeLocal: true }).catch((error) => {
                        appAlert(t('common.error', 'Error'), getErrorMessage(error));
                    });
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
                backup={keyBackup}
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
                                        <MaterialIcons name="check" size={20} color={colors.text} />
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
    topBar: {
        width: '100%',
        maxWidth: 680,
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.xs,
        paddingTop: spacing.s,
        height: 52,
    },
    backButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    title: {
        fontSize: 32,
        lineHeight: 38,
        fontWeight: '700',
        letterSpacing: -0.8,
        color: colors.text,
        paddingHorizontal: spacing.xs,
        marginBottom: spacing.s,
    },
    scrollContent: {
        width: '100%',
        maxWidth: 680,
        alignSelf: 'center',
        paddingTop: spacing.xs,
        paddingBottom: spacing.xxl,
        gap: spacing.l,
    },
    section: {
        gap: spacing.s,
    },
    sectionLabelRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: spacing.m,
    },
    sectionLabel: {
        fontSize: 13,
        lineHeight: 18,
        fontWeight: '500',
        color: colors.textSecondary,
    },
    group: {
        backgroundColor: colors.surface,
        borderRadius: 16,
        overflow: 'hidden',
        ...(isDarkScheme() ? {} : {
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.border,
        }),
    },
    sectionFooter: {
        fontSize: 13,
        lineHeight: 18,
        color: colors.textSecondary,
        paddingHorizontal: spacing.m,
    },
    divider: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: colors.border,
        marginStart: spacing.m,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.m,
        minHeight: 52,
        paddingHorizontal: spacing.m,
        paddingVertical: 12,
    },
    rowDisabled: {
        opacity: 0.5,
    },
    rowText: {
        flex: 1,
        gap: 2,
    },
    rowTitle: {
        fontSize: 16,
        lineHeight: 22,
        color: colors.text,
        flexShrink: 1,
    },
    rowTitleAccent: {
        color: colors.primary,
        fontWeight: '500',
    },
    rowTitleDanger: {
        color: colors.error,
    },
    rowDetail: {
        fontSize: 13,
        lineHeight: 18,
        color: colors.textSecondary,
    },
    rowTitleLine: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
    },
    attentionDot: {
        width: 7,
        height: 7,
        borderRadius: 3.5,
        backgroundColor: colors.warning,
    },
    rowValue: {
        fontSize: 15,
        lineHeight: 20,
        color: colors.textSecondary,
        maxWidth: '45%',
    },
    rowAction: {
        fontSize: 15,
        fontWeight: '500',
        color: colors.primary,
    },
    accountRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingHorizontal: spacing.m,
        paddingVertical: 14,
    },
    userAvatar: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: colors.backgroundSecondary,
        alignItems: 'center',
        justifyContent: 'center',
    },
    userAvatarText: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.text,
    },
    userInfoText: {
        flex: 1,
        gap: 2,
    },
    userNameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
    },
    userName: {
        fontSize: 17,
        lineHeight: 22,
        fontWeight: '600',
        color: colors.text,
        flexShrink: 1,
    },
    proMark: {
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 0.6,
        color: colors.primary,
    },
    userEmail: {
        fontSize: 13,
        lineHeight: 18,
        color: colors.textSecondary,
    },
    signInBlock: {
        padding: spacing.m,
        gap: 4,
    },
    signInTitle: {
        fontSize: 17,
        lineHeight: 22,
        fontWeight: '600',
        color: colors.text,
    },
    signInButton: {
        width: '100%',
        marginTop: spacing.m,
    },
    trialInfoText: {
        fontSize: 13,
        lineHeight: 18,
        color: colors.textSecondary,
        marginTop: spacing.s,
    },
    themeRow: {
        paddingHorizontal: spacing.m,
        paddingVertical: 12,
        gap: 10,
    },
    themeSegments: {
        flexDirection: 'row',
        backgroundColor: colors.backgroundSecondary,
        borderRadius: 10,
        padding: 2,
    },
    themeSegment: {
        flex: 1,
        height: 32,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.xs,
    },
    themeSegmentActive: {
        backgroundColor: isDarkScheme() ? colors.surfaceElevated : colors.surface,
        ...Platform.select({
            ios: {
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 1 },
                shadowOpacity: 0.08,
                shadowRadius: 2,
            },
            android: { elevation: 1 },
        }),
    },
    themeSegmentText: {
        fontSize: 14,
        color: colors.textSecondary,
    },
    themeSegmentTextActive: {
        color: colors.text,
        fontWeight: '600',
    },
    footerLink: {
        alignSelf: 'flex-start',
        paddingHorizontal: spacing.m,
        paddingVertical: 2,
    },
    footerLinkText: {
        fontSize: 13,
        lineHeight: 18,
        color: colors.textSecondary,
        textDecorationLine: 'underline',
    },
    noticeBlock: {
        padding: spacing.m,
        gap: 4,
    },
    noticeTitle: {
        fontSize: 16,
        lineHeight: 22,
        fontWeight: '600',
        color: colors.warning,
    },
    noticeActions: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.s,
        marginTop: spacing.m,
    },
    pillButton: {
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 999,
        backgroundColor: colors.backgroundSecondary,
    },
    pillButtonText: {
        fontSize: 14,
        fontWeight: '500',
        color: colors.text,
    },
    pillButtonPrimary: {
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 999,
        backgroundColor: colors.primary,
    },
    pillButtonPrimaryText: {
        fontSize: 14,
        fontWeight: '500',
        color: colors.onPrimary,
    },
    voiceProgress: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.m,
        paddingHorizontal: spacing.m,
        paddingBottom: 14,
    },
    voiceProgressTrack: {
        flex: 1,
        height: 3,
        borderRadius: 1.5,
        overflow: 'hidden',
        backgroundColor: colors.backgroundSecondary,
    },
    voiceProgressFill: {
        height: '100%',
        borderRadius: 1.5,
        backgroundColor: colors.primary,
    },
    voiceProgressCancel: {
        fontSize: 13,
        fontWeight: '500',
        color: colors.primary,
    },
    about: {
        alignItems: 'center',
        gap: 6,
        paddingTop: spacing.s,
    },
    legalLinks: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        columnGap: spacing.l,
        rowGap: spacing.xs,
        paddingHorizontal: spacing.m,
    },
    legalLink: {
        fontSize: 13,
        color: colors.textTertiary,
    },
    versionText: {
        fontSize: 13,
        color: colors.textTertiary,
    },
    languageModalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.4)',
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: spacing.xl,
    },
    languageModalContent: {
        width: '100%',
        maxWidth: 400,
        backgroundColor: colors.surface,
        borderRadius: 20,
        paddingVertical: spacing.s,
        maxHeight: '80%',
        ...Platform.select({
            ios: {
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 8 },
                shadowOpacity: 0.12,
                shadowRadius: 24,
            },
            android: {
                elevation: 8,
            },
        }),
    },
    languageModalTitle: {
        fontSize: 17,
        lineHeight: 22,
        fontWeight: '600',
        color: colors.text,
        paddingHorizontal: spacing.l,
        paddingTop: spacing.m,
        paddingBottom: spacing.s,
    },
    languageModalItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: 48,
        paddingHorizontal: spacing.l,
    },
    languageModalItemActive: {},
    languageModalItemText: {
        fontSize: 16,
        color: colors.text,
    },
    languageModalItemTextActive: {
        fontWeight: '600',
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
    statusTextSuccess: {
        color: colors.accentGreen,
    },
    statusTextError: {
        color: colors.error,
    },
    iconContainer: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
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
}));
