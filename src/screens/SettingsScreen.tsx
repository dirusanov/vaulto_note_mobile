import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { ScreenContainer } from '../components/ScreenContainer';
import { Button } from '../components/Button';
import { TextInput } from '../components/TextInput';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { useAuth } from '../hooks/useAuth';
import { useNavigation } from '@react-navigation/native';
import {
    AIProvider,
    getAIProvider,
    getOpenAIApiKey,
    getSelfHostedUrl,
    getSelfHostedApiKey,
        resetPrivacyWarning,
        setAIProvider,
        setOpenAIApiKey,
        setSelfHostedUrl,
        setSelfHostedApiKey
} from '../utils/storage';
import { testOpenAIConnection, testSelfHostedConnection } from '../services/TranscriptionService';
import { MaterialIcons } from '@expo/vector-icons';

export const SettingsScreen = () => {
    const navigation = useNavigation<any>();
    const { signOut, isAuthenticated } = useAuth();

    const [apiKey, setApiKeyState] = useState('');
    const [testingConnection, setTestingConnection] = useState(false);
    const [testingSelfHosted, setTestingSelfHosted] = useState(false);
    const [aiProvider, setAiProviderState] = useState<AIProvider>('local');
    const [preferencesReady, setPreferencesReady] = useState(false);
    const [showOpenAIInfo, setShowOpenAIInfo] = useState(false);
    const [showSelfHostedInfo, setShowSelfHostedInfo] = useState(false);
    const [showProviderInfo, setShowProviderInfo] = useState(false);
    const [showOpenAIKey, setShowOpenAIKey] = useState(false);
    const [showSelfHostedKey, setShowSelfHostedKey] = useState(false);
    const [resettingPrivacy, setResettingPrivacy] = useState(false);
    const [openAITestStatus, setOpenAITestStatus] = useState<{ type: 'idle' | 'success' | 'error'; message: string }>({
        type: 'idle',
        message: '',
    });
    const [selfHostedTestStatus, setSelfHostedTestStatus] = useState<{ type: 'idle' | 'success' | 'error'; message: string }>({
        type: 'idle',
        message: '',
    });
    const [privacyStatus, setPrivacyStatus] = useState<{ type: 'idle' | 'success' | 'error'; message: string }>({
        type: 'idle',
        message: '',
    });

    // Self-hosted settings
    const [selfHostedUrl, setSelfHostedUrlState] = useState('');
    const [selfHostedApiKey, setSelfHostedApiKeyState] = useState('');

    const usingOpenAI = aiProvider === 'openai';
    const usingSelfHosted = aiProvider === 'selfhosted';

    type ProviderOption = {
        key: AIProvider;
        title: string;
        blurb: string;
        description: string;
        icon: string;
        accent: string;
        chips: string[];
    };

    const providerOptions: ProviderOption[] = [
        {
            key: 'local',
            title: 'Secure LLM',
            blurb: 'Локально и приватно',
            description: 'Whisper + LLaMA на вашем сервере (Docker). Всё остаётся у вас.',
            icon: 'security',
            accent: colors.primary,
            chips: ['Zero retention', 'Docker ready'],
        },
        {
            key: 'openai',
            title: 'OpenAI API',
            blurb: 'Быстро и удобно',
            description: 'Audio → Whisper, Chat → Completions. Требуется API ключ.',
            icon: 'cloud-queue',
            accent: colors.accentPurple,
            chips: ['Whisper', 'GPT', 'Fast'],
        },
        {
            key: 'selfhosted',
            title: 'Self Hosted',
            blurb: 'Полный контроль',
            description: 'Подключитесь к своему серверу с помощью Docker Compose.',
            icon: 'dns',
            accent: colors.accentGreen,
            chips: ['Ваш сервер', 'VPN/SSL'],
        },
    ];

    const activeProvider = providerOptions.find((provider) => provider.key === aiProvider);

    useEffect(() => {
        loadPreferences();
    }, []);

    const loadPreferences = async () => {
        try {
            const [storedOpenAIKey, provider, url, storedSelfHostedApiKey] = await Promise.all([
                getOpenAIApiKey(),
                getAIProvider(),
                getSelfHostedUrl(),
                getSelfHostedApiKey()
            ]);

            if (storedOpenAIKey) setApiKeyState(storedOpenAIKey);
            setAiProviderState(provider);
            if (url) setSelfHostedUrlState(url);
            if (storedSelfHostedApiKey) setSelfHostedApiKeyState(storedSelfHostedApiKey);
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
            setOpenAITestStatus({ type: 'error', message: 'Выберите OpenAI, чтобы протестировать соединение.' });
            return;
        }

        if (!apiKey) {
            setOpenAITestStatus({ type: 'error', message: 'Введите API ключ.' });
            return;
        }

        setTestingConnection(true);
        setOpenAITestStatus({ type: 'idle', message: '' });
        await setOpenAIApiKey(apiKey.trim());
        const isConnected = await testOpenAIConnection();
        setTestingConnection(false);

        if (isConnected) {
            setOpenAITestStatus({ type: 'success', message: 'Подключение к OpenAI работает.' });
        } else {
            setOpenAITestStatus({ type: 'error', message: 'Не удалось подключиться. Проверьте API ключ.' });
        }
    };

    const handleTestSelfHostedConnection = async () => {
        if (!usingSelfHosted) {
            setSelfHostedTestStatus({ type: 'error', message: 'Выберите Self-Hosted, чтобы протестировать соединение.' });
            return;
        }

        if (!selfHostedUrl) {
            setSelfHostedTestStatus({ type: 'error', message: 'Введите Server URL.' });
            return;
        }

        if (!selfHostedApiKey) {
            setSelfHostedTestStatus({ type: 'error', message: 'Введите API Secret Key.' });
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
            setSelfHostedTestStatus({ type: 'success', message: 'Подключение к вашему серверу работает.' });
        } else {
            setSelfHostedTestStatus({ type: 'error', message: 'Не удалось подключиться. Проверьте URL и ключ.' });
        }
    };

    const handleResetPrivacyWarning = async () => {
        setResettingPrivacy(true);
        setPrivacyStatus({ type: 'idle', message: '' });
        try {
            await resetPrivacyWarning();
            setPrivacyStatus({ type: 'success', message: 'Предупреждение будет показано снова.' });
        } catch (error) {
            setPrivacyStatus({ type: 'error', message: 'Не удалось сбросить предупреждение.' });
        } finally {
            setResettingPrivacy(false);
        }
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
                    {isAuthenticated ? (
                        <Text style={styles.info}>Подключено. Заметки синхронизируются.</Text>
                    ) : (
                        <>
                            <Text style={styles.info}>Guest Mode — заметки на устройстве.</Text>
                            <Button
                                title="Sign In to Sync"
                                onPress={() => navigation.navigate('SignIn')}
                                style={styles.signInButton}
                            />
                        </>
                    )}
                </View>

                <View style={styles.card}>
                    <View style={styles.cardHeader}>
                        <Text style={styles.sectionTitle}>AI Provider</Text>
                    </View>
                    <Text style={styles.sectionHint}>Выберите, где обрабатываются подсказки и транскрибация.</Text>

                    <View style={styles.providerSwitcher}>
                        {providerOptions.map((option) => {
                            const isActive = aiProvider === option.key;
                            return (
                                <TouchableOpacity
                                    key={option.key}
                                    style={[
                                        styles.providerPill,
                                        isActive && styles.providerPillActive,
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
                                            color={isActive ? colors.surface : colors.textSecondary}
                                        />
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.providerPillTitle}>{option.title}</Text>
                                        <Text style={styles.providerPillSubtitle}>{option.blurb}</Text>
                                    </View>
                                    <View style={[styles.radio, isActive && styles.radioActive]}>
                                        {isActive && <View style={styles.radioDot} />}
                                    </View>
                                </TouchableOpacity>
                            );
                        })}
                    </View>

                    {activeProvider && (
                        <>
                            <TouchableOpacity
                                style={styles.infoToggleRow}
                                onPress={() => setShowProviderInfo((prev) => !prev)}
                                activeOpacity={0.85}
                            >
                                <MaterialIcons
                                    name={showProviderInfo ? 'expand-less' : 'expand-more'}
                                    size={20}
                                    color={colors.textSecondary}
                                />
                                <Text style={styles.infoToggleText}>
                                    {showProviderInfo ? 'Скрыть детали' : 'Подробнее о провайдере'}
                                </Text>
                            </TouchableOpacity>
                            {showProviderInfo && (
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
                                                    <Text style={styles.microChipText}>{chip}</Text>
                                                </View>
                                            ))}
                                        </View>
                                        {aiProvider === 'openai' && (
                                            <View style={styles.microRow}>
                                                <MaterialIcons name="audiotrack" size={14} color={colors.textSecondary} />
                                                <Text style={styles.microText}>Audio → Whisper</Text>
                                                <MaterialIcons name="east" size={14} color={colors.textSecondary} />
                                                <MaterialIcons name="chat" size={14} color={colors.textSecondary} />
                                                <Text style={styles.microText}>LLM</Text>
                                            </View>
                                        )}
                                        {aiProvider === 'selfhosted' && (
                                            <View style={styles.microRow}>
                                                <MaterialIcons name="router" size={14} color={colors.textSecondary} />
                                                <Text style={styles.microText}>Ваш сервер</Text>
                                                <MaterialIcons name="east" size={14} color={colors.textSecondary} />
                                                <MaterialIcons name="verified-user" size={14} color={colors.textSecondary} />
                                                <Text style={styles.microText}>Private</Text>
                                            </View>
                                        )}
                                    </View>
                                </View>
                            )}
                        </>
                    )}

                    {usingOpenAI && (
                        <View style={styles.settingsPanel}>
                            <View style={styles.settingsPanelHeader}>
                                <View style={styles.inlineTitle}>
                                    <MaterialIcons name="key" size={18} color={colors.primary} />
                                    <Text style={styles.panelTitle}>OpenAI доступ</Text>
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
                                    {showOpenAIInfo ? 'Скрыть детали' : 'Как это работает?'}
                                </Text>
                            </TouchableOpacity>
                            {showOpenAIInfo && (
                                <View style={styles.infoBox}>
                                    <Text style={styles.infoBoxText}>
                                        API ключ хранится на устройстве и используется только для запросов к OpenAI.
                                    </Text>
                                    <Text style={styles.infoBoxText}>
                                        Ключ можно менять в любой момент — сохранение происходит автоматически.
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
                                        containerStyle={[styles.inputContainer, styles.noMarginContainer]}
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
                                            <Text style={styles.testActionText}>Тест подключения</Text>
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
                                    <Text style={styles.panelTitle}>Self-Hosted доступ</Text>
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
                                    {showSelfHostedInfo ? 'Скрыть детали' : 'Как это настроить?'}
                                </Text>
                            </TouchableOpacity>
                            {showSelfHostedInfo && (
                                <View style={styles.infoBox}>
                                    <Text style={styles.infoBoxText}>
                                        Укажите полный URL до вашего API (с портом и /api/v1), чтобы приложение знало, куда отправлять запросы.
                                    </Text>
                                    <Text style={styles.infoBoxText}>
                                        API Secret Key берётся из вашего .env. Он шифруется и сохраняется на устройстве автоматически.
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
                                        containerStyle={[styles.inputContainer, styles.noMarginContainer]}
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
                                            <Text style={styles.testActionText}>Тест подключения</Text>
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
                    <View style={styles.cardHeader}>
                        <Text style={styles.sectionTitle}>Privacy</Text>
                    </View>
                    <Text style={styles.info}>
                        Транскрибация и улучшения не логируются. Вы можете повторно увидеть предупреждение о приватности для голосовых заметок.
                    </Text>
                    <TouchableOpacity
                        style={styles.resetActionButton}
                        onPress={handleResetPrivacyWarning}
                        activeOpacity={0.9}
                        disabled={resettingPrivacy}
                    >
                        {resettingPrivacy ? (
                            <ActivityIndicator color={colors.error} />
                        ) : (
                            <>
                                <MaterialIcons name="restart-alt" size={18} color={colors.error} />
                                <Text style={styles.resetActionText}>Сбросить предупреждение</Text>
                            </>
                        )}
                    </TouchableOpacity>
                    {privacyStatus.type !== 'idle' && (
                        <View style={styles.statusRow}>
                            <MaterialIcons
                                name={privacyStatus.type === 'success' ? 'check-circle' : 'error-outline'}
                                size={18}
                                color={privacyStatus.type === 'success' ? colors.accentGreen : colors.error}
                            />
                            <Text
                                style={[
                                    styles.statusText,
                                    privacyStatus.type === 'success' ? styles.statusTextSuccess : styles.statusTextError,
                                ]}
                            >
                                {privacyStatus.message}
                            </Text>
                        </View>
                    )}
                </View>

                <View style={styles.card}>
                    <Text style={styles.sectionTitle}>App Info</Text>
                    <Text style={styles.info}>Version 1.0.0</Text>
                    <Text style={styles.info}>Данные не хранятся, не анализируются.</Text>
                </View>

                {isAuthenticated && (
                    <View style={styles.footer}>
                        <Button
                            title="Sign Out"
                            onPress={signOut}
                            variant="outline"
                            style={styles.button}
                        />
                    </View>
                )}
            </ScrollView>
        </ScreenContainer>
    );
};

const styles = StyleSheet.create({
    scrollContent: {
        paddingVertical: spacing.s,
        gap: spacing.m,
    },
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
        marginBottom: spacing.m,
        marginTop: spacing.xxl,
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
    providerPillSubtitle: {
        ...typography.caption,
        color: colors.textSecondary,
        marginTop: 2,
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
        gap: spacing.xs,
        marginTop: spacing.xs,
    },
    microChip: {
        paddingHorizontal: spacing.s,
        paddingVertical: spacing.xs,
        borderRadius: 10,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
    },
    microChipText: {
        ...typography.caption,
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
    },
    flex: {
        flex: 1,
    },
    eyeButton: {
        width: 44,
        height: 44,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.backgroundSecondary,
        borderWidth: 1,
        borderColor: colors.border,
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
    resetActionButton: {
        marginTop: spacing.s,
        height: 50,
        borderRadius: 14,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.error,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.s,
    },
    resetActionText: {
        ...typography.button,
        color: colors.error,
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
        marginTop: spacing.m,
    },
    footer: {
        marginTop: spacing.m,
        marginBottom: spacing.l,
    },
    button: {
        borderColor: colors.error,
    },
});
