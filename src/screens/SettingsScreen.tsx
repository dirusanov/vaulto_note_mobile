import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Switch, Alert, Linking } from 'react-native';
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
    getSelfHostedUrl,
    getSelfHostedApiKey,
    setAIProvider,
    setOpenAIApiKey,
    setSelfHostedUrl,
    setSelfHostedApiKey,
    getAgentModeEnabled,
    setAgentModeEnabled,
    getTranscriptionEnabled,
    setTranscriptionEnabled
} from '../utils/storage';
import { testOpenAIConnection, testSelfHostedConnection } from '../services/TranscriptionService';
import { MaterialIcons } from '@expo/vector-icons';
import { UsageCard } from '../components/UsageCard';
import { SignOutChoiceDialog } from '../components/SignOutChoiceDialog';
import { useEncryption } from '../context/EncryptionContext';
import { EnableSyncModal } from '../components/EnableSyncModal';
import { UnlockSyncModal } from '../components/UnlockSyncModal';
import { UnlockingOverlay } from '../components/UnlockingOverlay';
import { syncService } from '../services/SyncService';



export const SettingsScreen = () => {
    const navigation = useNavigation<any>();
    const { signOut, isAuthenticated, isGuest, user, userId, refreshProfile } = useAuth();
    const { syncEnabled, syncLocked, hasRemoteKeyBundle, resetSync } = useEncryption();

    const [apiKey, setApiKeyState] = useState('');
    const [agentModeEnabled, setAgentModeEnabledState] = useState(true);
    const [transcriptionEnabled, setTranscriptionEnabledState] = useState(true);
    const [testingConnection, setTestingConnection] = useState(false);
    const [testingSelfHosted, setTestingSelfHosted] = useState(false);
    const [aiProvider, setAiProviderState] = useState<AIProvider>('secure_llm');
    const [preferencesReady, setPreferencesReady] = useState(false);
    const [showSignOutDialog, setShowSignOutDialog] = useState(false);
    const [showOpenAIInfo, setShowOpenAIInfo] = useState(false);
    const [showSelfHostedInfo, setShowSelfHostedInfo] = useState(false);
    const [showEnableSyncModal, setShowEnableSyncModal] = useState(false);
    const [showChangePinModal, setShowChangePinModal] = useState(false);
    const [showUnlockSyncModal, setShowUnlockSyncModal] = useState(false);
    const [showUnlockingOverlay, setShowUnlockingOverlay] = useState(false);
    const [unlockErrorMessage, setUnlockErrorMessage] = useState<string | null>(null);

    const [isGeneratingMagicLink, setIsGeneratingMagicLink] = useState(false);
    const [showOpenAIKey, setShowOpenAIKey] = useState(false);
    const [showSelfHostedKey, setShowSelfHostedKey] = useState(false);
    const [openAITestStatus, setOpenAITestStatus] = useState<{ type: 'idle' | 'success' | 'error'; message: string }>({
        type: 'idle',
        message: '',
    });
    const [selfHostedTestStatus, setSelfHostedTestStatus] = useState<{ type: 'idle' | 'success' | 'error'; message: string }>({
        type: 'idle',
        message: '',
    });

    // Self-hosted settings
    const [selfHostedUrl, setSelfHostedUrlState] = useState('');
    const [selfHostedApiKey, setSelfHostedApiKeyState] = useState('');

    const usingOpenAI = aiProvider === 'openai';
    const usingSelfHosted = aiProvider === 'selfhosted';
    const syncStatusLabel = !syncEnabled ? 'Local only' : syncLocked ? 'Locked' : 'Enabled';
    const syncStatusColor = !syncEnabled ? colors.textSecondary : syncLocked ? colors.warning : colors.accentGreen;
    const pinStatusLabel = syncEnabled ? 'Configured' : 'Not set';
    const pinStatusColor = syncEnabled ? colors.accentGreen : colors.textSecondary;
    const securityNote = !syncEnabled
        ? 'Enable sync to choose PIN (quick), code phrase (stronger), or Advanced Secure seed phrase.'
        : syncLocked
            ? hasRemoteKeyBundle
                ? 'Encrypted sync data detected on server. Unlock with your original key to access it.'
                : 'Sync is locked on this device. Unlock with your original key to resume syncing.'
            : 'Master key is decrypted only on-device. Use seed phrase for strongest offline protection.';

    const handleResetSync = useCallback(() => {
        Alert.alert(
            'Forgot access key?',
            'You can reset encryption key and create a new one, but previously synced encrypted notes will be permanently lost.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Continue',
                    style: 'destructive',
                    onPress: () => {
                        Alert.alert(
                            'Final confirmation',
                            'Press "I Understand, Reset" only if you agree that old synced notes cannot be recovered.',
                            [
                                { text: 'Cancel', style: 'cancel' },
                                {
                                    text: 'I Understand, Reset',
                                    style: 'destructive',
                                    onPress: async () => {
                                        try {
                                            const result = await resetSync();
                                            if (result === 'purged') {
                                                Alert.alert('Sync reset', 'Old encrypted sync data and key were removed. You can now create a new key.');
                                            } else {
                                                Alert.alert(
                                                    'Partial reset',
                                                    'Local key was reset, but server did not confirm full encrypted data purge. Please update backend to support vault reset.'
                                                );
                                            }
                                        } catch (error: any) {
                                            Alert.alert('Reset failed', error?.message || 'Unable to reset sync.');
                                        }
                                    }
                                }
                            ]
                        );
                    },
                }
            ]
        );
    }, [resetSync]);

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
            title: 'Secure LLM',
            blurb: 'Private & Anonymous',
            description: 'Whisper + LLM on our server. No data stored or analyzed. Fully anonymous and secure.',
            icon: 'security',
            accent: colors.primary,
            chips: ['Zero retention', 'Anonymous', 'Trial'],
        },
        {
            key: 'openai',
            title: 'OpenAI API',
            blurb: 'Fast & Convenient',
            description: 'Audio → Whisper, Chat → Completions. API Key required.',
            icon: 'cloud-queue',
            accent: colors.accentPurple,
            chips: ['Whisper', 'GPT', 'Fast'],
            isLocked: true,
            proMessage: 'Available in Pro',
        },
        {
            key: 'selfhosted',
            title: 'Self Hosted',
            blurb: 'Full Control',
            description: 'Connect to your server using Docker Compose.',
            icon: 'dns',
            accent: colors.accentGreen,
            chips: ['Your Server', 'VPN/SSL'],
            isLocked: true,
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
            const [storedOpenAIKey, provider, url, storedSelfHostedApiKey, agentMode, transcription] = await Promise.all([
                getOpenAIApiKey(),
                getAIProvider(),
                getSelfHostedUrl(),
                getSelfHostedApiKey(),
                getAgentModeEnabled(),
                getTranscriptionEnabled()
            ]);

            if (storedOpenAIKey) setApiKeyState(storedOpenAIKey);

            setAiProviderState(provider || 'secure_llm');

            if (url) setSelfHostedUrlState(url);
            if (storedSelfHostedApiKey) setSelfHostedApiKeyState(storedSelfHostedApiKey);
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
            Alert.alert(
                'Pro Feature',
                `${selectedOption.title} is available in the Pro plan. Upgrade to unlock advanced AI providers and enhanced features.`,
                [
                    {
                        text: 'Maybe Later',
                        style: 'cancel'
                    },
                    {
                        text: 'Learn More',
                        onPress: () => {
                            // TODO: Navigate to upgrade screen when available
                            Alert.alert('Coming Soon', 'Pro plan details will be available soon!');
                        }
                    }
                ]
            );
            return;
        }

        setAiProviderState(provider);
        try {
            await setAIProvider(provider);
        } catch (e) {
            console.error('Failed to persist AI provider', e);
        }
    };

    const toggleAgentMode = async (value: boolean) => {
        setAgentModeEnabledState(value);
        await setAgentModeEnabled(value);
    };

    const toggleTranscription = async (value: boolean) => {
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
            setSelfHostedUrl(selfHostedUrl.trim());
        }, 400);

        return () => clearTimeout(timeout);
    }, [selfHostedUrl, preferencesReady]);

    useEffect(() => {
        if (!preferencesReady) return;
        const timeout = setTimeout(() => {
            setSelfHostedApiKey(selfHostedApiKey.trim());
        }, 400);

        return () => clearTimeout(timeout);
    }, [selfHostedApiKey, preferencesReady]);

    const handleTestConnection = async () => {
        if (!usingOpenAI) {
            setOpenAITestStatus({ type: 'error', message: 'Select OpenAI to test connection.' });
            return;
        }

        if (!apiKey) {
            setOpenAITestStatus({ type: 'error', message: 'Enter API Key.' });
            return;
        }

        setTestingConnection(true);
        setOpenAITestStatus({ type: 'idle', message: '' });
        await setOpenAIApiKey(apiKey.trim());
        const isConnected = await testOpenAIConnection();
        setTestingConnection(false);

        if (isConnected) {
            setOpenAITestStatus({ type: 'success', message: 'OpenAI connection working.' });
        } else {
            setOpenAITestStatus({ type: 'error', message: 'Connection failed. Check API Key.' });
        }
    };

    const handleTestSelfHostedConnection = async () => {
        if (!usingSelfHosted) {
            setSelfHostedTestStatus({ type: 'error', message: 'Select Self-Hosted to test connection.' });
            return;
        }

        if (!selfHostedUrl) {
            setSelfHostedTestStatus({ type: 'error', message: 'Enter Server URL.' });
            return;
        }

        if (!selfHostedApiKey) {
            setSelfHostedTestStatus({ type: 'error', message: 'Enter API Secret Key.' });
            return;
        }

        setTestingSelfHosted(true);
        setSelfHostedTestStatus({ type: 'idle', message: '' });
        await Promise.all([
            setSelfHostedUrl(selfHostedUrl.trim()),
            setSelfHostedApiKey(selfHostedApiKey.trim()),
        ]);
        const isConnected = await testSelfHostedConnection(selfHostedUrl.trim(), selfHostedApiKey.trim());
        setTestingSelfHosted(false);

        if (isConnected) {
            setSelfHostedTestStatus({ type: 'success', message: 'Connection to your server working.' });
        } else {
            setSelfHostedTestStatus({ type: 'error', message: 'Connection failed. Check URL and Key.' });
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
                <View style={styles.badge}>
                    <MaterialIcons
                        name={activeProvider?.icon as any || 'shield'}
                        size={16}
                        color={activeProvider?.accent || colors.primary}
                    />
                    <Text style={[styles.badgeText, { color: activeProvider?.accent || colors.primary }]}>
                        {aiProvider === 'openai' ? 'OpenAI' : aiProvider === 'selfhosted' ? 'Self Hosted' : 'Secure LLM'}
                    </Text>
                </View>
            </View>
            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

                <View style={styles.card}>
                    <View style={styles.cardHeader}>
                        <Text style={styles.sectionTitle}>Account</Text>
                    </View>
                    {isAuthenticated && user ? (
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
                                <View style={styles.syncStatusRow}>
                                    <MaterialIcons
                                        name={
                                            !syncEnabled
                                                ? "cloud-off"
                                                : syncLocked
                                                    ? "lock"
                                                    : unsyncedCount > 0
                                                        ? "cloud-upload"
                                                        : "cloud-done"
                                        }
                                        size={14}
                                        color={
                                            !syncEnabled
                                                ? colors.textSecondary
                                                : syncLocked
                                                    ? colors.warning
                                                    : unsyncedCount > 0
                                                        ? colors.warning
                                                        : colors.accentGreen
                                        }
                                    />
                                    <Text style={[
                                        styles.syncStatusText,
                                        (syncLocked || unsyncedCount > 0) && { color: colors.warning }
                                    ]}>
                                        {syncEnabled
                                            ? (syncLocked
                                                ? "Sync locked (unlock to sync)"
                                                : (unsyncedCount > 0 ? `${unsyncedCount} unsynced` : "Notes synced"))
                                            : "Sync disabled"}
                                    </Text>
                                </View>
                            </View>
                        </View>
                    ) : (
                        <>
                            <Text style={styles.syncHint}>Sign in to sync encrypted notes across devices</Text>
                            <Button
                                title="Sign In"
                                onPress={() => navigation.navigate('SignIn')}
                                style={styles.signInButton}
                            />
                        </>
                    )}


                    <UsageCard user={user} aiProvider={aiProvider} isGuest={isGuest} />

                    {isAuthenticated && !isGuest && (
                        <View style={{ marginTop: spacing.m }}>
                            <Button
                                title="Manage Account (Web)"
                                loading={isGeneratingMagicLink}
                                onPress={async () => {
                                    setIsGeneratingMagicLink(true);
                                    try {
                                        const { url } = await import('../api/auth').then(m => m.authApi.generateMagicLink());
                                        const canOpen = await Linking.canOpenURL(url);
                                        if (canOpen) {
                                            await Linking.openURL(url);
                                        } else {
                                            Alert.alert('Error', 'Cannot open web browser');
                                        }
                                    } catch (error: any) {
                                        Alert.alert('Error', error?.message || 'Failed to generate magic link');
                                    } finally {
                                        setIsGeneratingMagicLink(false);
                                    }
                                }}
                                variant="outline"
                            />
                        </View>
                    )}
                </View>

                <View style={styles.card}>
                    <View style={styles.cardHeader}>
                        <Text style={styles.sectionTitle}>Security</Text>
                    </View>
                    <Text style={styles.sectionHint}>
                        Notes are encrypted on this device before sync. Master key never leaves device in plaintext.
                    </Text>
                    <View style={styles.securityRow}>
                        <Text style={styles.securityLabel}>Sync</Text>
                        <Text style={[styles.securityValue, { color: syncStatusColor }]}>{syncStatusLabel}</Text>
                    </View>
                    <View style={styles.securityRow}>
                        <Text style={styles.securityLabel}>Access key</Text>
                        <Text style={[styles.securityValue, { color: pinStatusColor }]}>{pinStatusLabel}</Text>
                    </View>
                    <Text style={styles.securityCopy}>{securityNote}</Text>
                    {syncEnabled && syncLocked && (
                        <View style={{ marginTop: spacing.m }}>
                            <Button title="Unlock Sync" onPress={() => setShowUnlockSyncModal(true)} />
                            <View style={{ marginTop: spacing.s }}>
                                <Button
                                    title="Reset Sync (Forgot key)"
                                    variant="outline"
                                    onPress={handleResetSync}
                                />
                            </View>
                        </View>
                    )}
                    {syncEnabled && !syncLocked && (
                        <View style={{ marginTop: spacing.m }}>
                            <Button
                                title="Change Access Key"
                                onPress={() => {
                                    if (!isAuthenticated || isGuest) {
                                        Alert.alert('Sign in required', 'Please sign in to change your access key.');
                                        return;
                                    }
                                    setShowChangePinModal(true);
                                }}
                            />
                        </View>
                    )}
                    {!syncEnabled && (
                        <View style={{ marginTop: spacing.m }}>
                            <Button
                                title="Enable Sync & Choose Security"
                                onPress={() => {
                                    if (!isAuthenticated || isGuest) {
                                        Alert.alert('Sign in required', 'Please sign in to enable sync.');
                                        return;
                                    }
                                    setShowEnableSyncModal(true);
                                }}
                            />
                        </View>
                    )}
                </View>

                <View style={styles.card}>
                    <View style={styles.cardHeader}>
                        <Text style={styles.sectionTitle}>Preferences</Text>
                    </View>

                    <View style={styles.preferenceRow}>
                        <View style={{ flex: 1, marginRight: spacing.s }}>
                            <Text style={styles.preferenceTitle}>Auto-transcribe recordings</Text>
                            <Text style={styles.preferenceDescription}>
                                Automatically transcribe audio after recording
                            </Text>
                        </View>
                        <Switch
                            value={transcriptionEnabled}
                            onValueChange={(val) => {
                                toggleTranscription(val);
                            }}
                            trackColor={{ false: colors.border, true: colors.primary }}
                            thumbColor={colors.surface}
                            ios_backgroundColor={colors.border}
                        />
                    </View>
                </View>

                <View style={styles.card}>
                    <View style={styles.cardHeader}>
                        <Text style={styles.sectionTitle}>AI Provider</Text>
                    </View>
                    <Text style={styles.sectionHint}>Choose where prompts and transcription are processed.</Text>

                    {/* Agent Mode Toggle */}
                    <View style={styles.agentModeCard}>
                        <View style={styles.agentModeHeader}>
                            <View style={styles.agentModeTitleRow}>
                                <View style={styles.agentModeIcon}>
                                    <MaterialIcons name="auto-awesome" size={20} color={colors.primary} />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.agentModeTitle}>Agent Mode</Text>
                                    <Text style={styles.agentModeDescription}>
                                        Intellectual assistant for note creation
                                    </Text>
                                    {aiProvider !== 'secure_llm' && (
                                        <Text style={styles.agentModeWarning}>
                                            Requires Secure LLM
                                        </Text>
                                    )}
                                </View>
                                <Switch
                                    value={agentModeEnabled && aiProvider === 'secure_llm'}
                                    onValueChange={toggleAgentMode}
                                    trackColor={{ false: colors.border, true: colors.primary }}
                                    thumbColor={colors.surface}
                                    ios_backgroundColor={colors.border}
                                    disabled={aiProvider !== 'secure_llm'}
                                />
                            </View>
                        </View>
                    </View>

                    <View style={styles.providerSwitcher}>
                        {providerOptions.map((option) => {
                            const isActive = aiProvider === option.key;
                            const isLocked = option.isLocked || false;
                            return (
                                <TouchableOpacity
                                    key={option.key}
                                    style={[
                                        styles.providerPill,
                                        isActive && styles.providerPillActive,
                                        isLocked && !isActive && styles.providerPillLocked,
                                    ]}
                                    onPress={() => updateProvider(option.key)}
                                    activeOpacity={0.9}
                                >
                                    <View
                                        style={[
                                            styles.providerPillIcon,
                                            { backgroundColor: isActive ? option.accent : colors.backgroundSecondary },
                                        ]}
                                    >
                                        <MaterialIcons
                                            name={option.icon as any}
                                            size={18}
                                            color={isActive ? colors.surface : isLocked ? colors.textSecondary : colors.textSecondary}
                                        />
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <View style={styles.providerPillTitleRow}>
                                            <Text style={[styles.providerPillTitle, isLocked && styles.providerPillTitleLocked]}>{option.title}</Text>
                                            {isLocked && (
                                                <View style={styles.lockBadge}>
                                                    <MaterialIcons name="workspace-premium" size={14} color={colors.accentPurple} />
                                                    <Text style={styles.lockBadgeText}>Pro</Text>
                                                </View>
                                            )}
                                        </View>
                                        <Text style={[styles.providerPillSubtitle, isLocked && styles.providerPillSubtitleLocked]}>
                                            {isLocked ? option.proMessage : option.blurb}
                                        </Text>
                                    </View>
                                    {!isLocked && (
                                        <View style={[styles.radio, isActive && styles.radioActive]}>
                                            {isActive && <View style={styles.radioDot} />}
                                        </View>
                                    )}
                                    {isLocked && (
                                        <MaterialIcons name="lock-outline" size={20} color={colors.textSecondary} />
                                    )}
                                </TouchableOpacity>
                            );
                        })}
                    </View>

                    {activeProvider && (
                        <>
                            <View style={styles.activeProviderCard}>
                                <View style={[styles.activeProviderIcon, { backgroundColor: activeProvider.accent }]}>
                                    <MaterialIcons name={activeProvider.icon as any} size={22} color={colors.surface} />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.activeProviderTitle}>{activeProvider.title}</Text>
                                    <Text style={styles.activeProviderDescription}>{activeProvider.description}</Text>
                                    <View style={styles.chipRow}>
                                        {activeProvider.chips.map((chip) => (
                                            <View key={chip} style={styles.microChip}>
                                                <Text
                                                    style={styles.microChipText}
                                                    numberOfLines={1}
                                                    adjustsFontSizeToFit
                                                    minimumFontScale={0.8}
                                                >
                                                    {chip}
                                                </Text>
                                            </View>
                                        ))}
                                    </View>
                                </View>
                            </View>
                        </>
                    )}

                    {usingOpenAI && (
                        <View style={styles.settingsPanel}>
                            <View style={styles.settingsPanelHeader}>
                                <View style={styles.inlineTitle}>
                                    <MaterialIcons name="key" size={18} color={colors.primary} />
                                    <Text style={styles.panelTitle}>OpenAI Access</Text>
                                </View>
                            </View>
                            <TouchableOpacity
                                style={styles.infoToggleRow}
                                onPress={() => setShowOpenAIInfo((prev) => !prev)}
                                activeOpacity={0.85}
                            >
                                <MaterialIcons
                                    name={showOpenAIInfo ? 'expand-less' : 'expand-more'}
                                    size={20}
                                    color={colors.textSecondary}
                                />
                                <Text style={styles.infoToggleText}>
                                    {showOpenAIInfo ? 'Hide details' : 'How it works?'}
                                </Text>
                            </TouchableOpacity>
                            {showOpenAIInfo && (
                                <View style={styles.infoBox}>
                                    <Text style={styles.infoBoxText}>
                                        API key is stored on device and used only for OpenAI requests.
                                    </Text>
                                    <Text style={styles.infoBoxText}>
                                        Key can be changed anytime — saves automatically.
                                    </Text>
                                </View>
                            )}
                            <View style={styles.inputCluster}>
                                <Text style={styles.label}>OpenAI API Key</Text>
                                <View style={styles.secretFieldRow}>
                                    <TextInput
                                        value={apiKey}
                                        onChangeText={setApiKeyState}
                                        placeholder="sk-..."
                                        secureTextEntry={!showOpenAIKey}
                                        style={[styles.compactInput, styles.flex]}
                                        containerStyle={[styles.inputContainer, styles.noMarginContainer, styles.flex]}
                                    />
                                    <TouchableOpacity
                                        style={styles.eyeButton}
                                        onPress={() => setShowOpenAIKey((prev) => !prev)}
                                        activeOpacity={0.8}
                                    >
                                        <MaterialIcons
                                            name={showOpenAIKey ? 'visibility-off' : 'visibility'}
                                            size={20}
                                            color={colors.textSecondary}
                                        />
                                    </TouchableOpacity>
                                </View>
                                <TouchableOpacity
                                    style={[
                                        styles.testActionButton,
                                        testingConnection && styles.testActionButtonDisabled,
                                    ]}
                                    onPress={handleTestConnection}
                                    activeOpacity={0.9}
                                    disabled={testingConnection}
                                >
                                    {testingConnection ? (
                                        <ActivityIndicator color={colors.surface} />
                                    ) : (
                                        <>
                                            <MaterialIcons name="bolt" size={18} color={colors.surface} />
                                            <Text style={styles.testActionText}>Test Connection</Text>
                                        </>
                                    )}
                                </TouchableOpacity>
                                {openAITestStatus.type !== 'idle' && (
                                    <View style={styles.statusRow}>
                                        <MaterialIcons
                                            name={openAITestStatus.type === 'success' ? 'check-circle' : 'error-outline'}
                                            size={18}
                                            color={openAITestStatus.type === 'success' ? colors.accentGreen : colors.error}
                                        />
                                        <Text
                                            style={[
                                                styles.statusText,
                                                openAITestStatus.type === 'success' ? styles.statusTextSuccess : styles.statusTextError,
                                            ]}
                                        >
                                            {openAITestStatus.message}
                                        </Text>
                                    </View>
                                )}
                            </View>
                        </View>
                    )}

                    {usingSelfHosted && (
                        <View style={styles.settingsPanel}>
                            <View style={styles.settingsPanelHeader}>
                                <View style={styles.inlineTitle}>
                                    <MaterialIcons name="router" size={18} color={colors.accentGreen} />
                                    <Text style={styles.panelTitle}>Self-Hosted Access</Text>
                                </View>
                            </View>
                            <TouchableOpacity
                                style={styles.infoToggleRow}
                                onPress={() => setShowSelfHostedInfo((prev) => !prev)}
                                activeOpacity={0.85}
                            >
                                <MaterialIcons
                                    name={showSelfHostedInfo ? 'expand-less' : 'expand-more'}
                                    size={20}
                                    color={colors.textSecondary}
                                />
                                <Text style={styles.infoToggleText}>
                                    {showSelfHostedInfo ? 'Hide details' : 'How to setup?'}
                                </Text>
                            </TouchableOpacity>
                            {showSelfHostedInfo && (
                                <View style={styles.infoBox}>
                                    <Text style={styles.infoBoxText}>
                                        Enter full URL to your API (with port and /api/v1).
                                    </Text>
                                    <Text style={styles.infoBoxText}>
                                        API Secret Key comes from your .env. It is encrypted and stored automatically.
                                    </Text>
                                </View>
                            )}
                            <View style={styles.inputCluster}>
                                <Text style={styles.label}>Server URL</Text>
                                <TextInput
                                    value={selfHostedUrl}
                                    onChangeText={setSelfHostedUrlState}
                                    placeholder="http://192.168.1.100:8000/api/v1"
                                    style={styles.compactInput}
                                    containerStyle={styles.inputContainer}
                                />

                                <Text style={[styles.label, styles.labelSpacing]}>API Secret Key</Text>
                                <View style={styles.secretFieldRow}>
                                    <TextInput
                                        value={selfHostedApiKey}
                                        onChangeText={setSelfHostedApiKeyState}
                                        placeholder="your_secret_api_key_here"
                                        secureTextEntry={!showSelfHostedKey}
                                        style={[styles.compactInput, styles.flex]}
                                        containerStyle={[styles.inputContainer, styles.noMarginContainer, styles.flex]}
                                    />
                                    <TouchableOpacity
                                        style={styles.eyeButton}
                                        onPress={() => setShowSelfHostedKey((prev) => !prev)}
                                        activeOpacity={0.8}
                                    >
                                        <MaterialIcons
                                            name={showSelfHostedKey ? 'visibility-off' : 'visibility'}
                                            size={20}
                                            color={colors.textSecondary}
                                        />
                                    </TouchableOpacity>
                                </View>
                                <TouchableOpacity
                                    style={[
                                        styles.testActionButton,
                                        testingSelfHosted && styles.testActionButtonDisabled,
                                    ]}
                                    onPress={handleTestSelfHostedConnection}
                                    activeOpacity={0.9}
                                    disabled={testingSelfHosted}
                                >
                                    {testingSelfHosted ? (
                                        <ActivityIndicator color={colors.surface} />
                                    ) : (
                                        <>
                                            <MaterialIcons name="bolt" size={18} color={colors.surface} />
                                            <Text style={styles.testActionText}>Test Connection</Text>
                                        </>
                                    )}
                                </TouchableOpacity>
                                {selfHostedTestStatus.type !== 'idle' && (
                                    <View style={styles.statusRow}>
                                        <MaterialIcons
                                            name={selfHostedTestStatus.type === 'success' ? 'check-circle' : 'error-outline'}
                                            size={18}
                                            color={selfHostedTestStatus.type === 'success' ? colors.accentGreen : colors.error}
                                        />
                                        <Text
                                            style={[
                                                styles.statusText,
                                                selfHostedTestStatus.type === 'success' ? styles.statusTextSuccess : styles.statusTextError,
                                            ]}
                                        >
                                            {selfHostedTestStatus.message}
                                        </Text>
                                    </View>
                                )}
                            </View>
                        </View>
                    )}
                </View>




                <View style={styles.card}>
                    <Text style={styles.sectionTitle}>App Info</Text>
                    <Text style={styles.info}>Version 1.0.0</Text>
                    <Text style={styles.info}>Data is not stored or analyzed.</Text>

                    <View style={styles.legalLinks}>
                        <TouchableOpacity onPress={() => Linking.openURL('https://vaultonote.com/privacy')}>
                            <Text style={styles.linkText}>Privacy Policy</Text>
                        </TouchableOpacity>
                        <View style={styles.linkDivider} />
                        <TouchableOpacity onPress={() => Linking.openURL('https://vaultonote.com/terms')}>
                            <Text style={styles.linkText}>Terms of Service</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {
                    isAuthenticated && (
                        <View style={[styles.footer, { marginBottom: spacing.xxl + spacing.l }]}>
                            <Button
                                title="Sign Out"
                                onPress={handleSignOut}
                                variant="destructive"
                                style={[styles.button, { backgroundColor: 'transparent' }]}
                            />
                        </View>
                    )
                }




            </ScrollView >

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
                title="Verifying Access Key"
                subtitle="Checking your key and decrypting sync. This may take up to a minute on some devices."
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
        </ScreenContainer >
    );
};

const styles = StyleSheet.create({
    agentModeWarning: {
        ...typography.caption,
        color: colors.error,
        marginTop: 4,
        fontWeight: '600',
    },
    scrollContent: {
        paddingVertical: spacing.s,
        gap: spacing.m,
        paddingBottom: spacing.xxl, // Ensure bottom content is visible
    },
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
        marginBottom: spacing.m,
        marginTop: spacing.xl,
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
    card: {
        backgroundColor: colors.surface,
        borderRadius: 20,
        padding: spacing.l,
        shadowColor: colors.cardShadow,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.1,
        shadowRadius: 10,
        elevation: 3,
        borderWidth: 1,
        borderColor: colors.border,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: spacing.s,
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
    compactInput: {
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
    userAvatar: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: colors.primary,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: colors.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 4,
    },
    userAvatarText: {
        ...typography.h2,
        color: colors.surface,
        fontSize: 20,
        fontWeight: '700',
    },
    userInfoText: {
        flex: 1,
        gap: 2,
    },
    userName: {
        ...typography.h3,
        fontSize: 17,
        fontWeight: '600',
        color: colors.text,
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
    legalLinks: {
        marginTop: spacing.m,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.m,
    },
    linkText: {
        ...typography.bodySmall,
        color: colors.primary,
        textDecorationLine: 'underline',
    },
    linkDivider: {
        width: 1,
        height: 12,
        backgroundColor: colors.border,
    },
});
