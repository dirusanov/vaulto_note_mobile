import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert, ScrollView, TouchableOpacity, Switch } from 'react-native';
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
    getSelfHostedEnabled,
    getSelfHostedUrl,
    getSelfHostedApiKey,
    resetPrivacyWarning,
    setAIProvider,
    setOpenAIApiKey,
    setSelfHostedEnabled,
    setSelfHostedUrl,
    setSelfHostedApiKey
} from '../utils/storage';
import { testOpenAIConnection } from '../services/TranscriptionService';
import { MaterialIcons } from '@expo/vector-icons';

export const SettingsScreen = () => {
    const navigation = useNavigation<any>();
    const { signOut, isAuthenticated } = useAuth();

    const [apiKey, setApiKeyState] = useState('');
    const [testingConnection, setTestingConnection] = useState(false);
    const [aiProvider, setAiProviderState] = useState<AIProvider>('local');

    // Self-hosted settings
    const [selfHostedEnabled, setSelfHostedEnabledState] = useState(false);
    const [selfHostedUrl, setSelfHostedUrlState] = useState('');
    const [selfHostedApiKey, setSelfHostedApiKeyState] = useState('');

    const usingOpenAI = aiProvider === 'openai';

    useEffect(() => {
        loadPreferences();
    }, []);

    const loadPreferences = async () => {
        const [key, provider, enabled, url, apiKey] = await Promise.all([
            getOpenAIApiKey(),
            getAIProvider(),
            getSelfHostedEnabled(),
            getSelfHostedUrl(),
            getSelfHostedApiKey()
        ]);
        if (key) setApiKeyState(key);
        setAiProviderState(provider);
        setSelfHostedEnabledState(enabled);
        if (url) setSelfHostedUrlState(url);
        if (apiKey) setSelfHostedApiKeyState(apiKey);
    };

    const updateProvider = async (provider: AIProvider) => {
        setAiProviderState(provider);
        try {
            await setAIProvider(provider);
        } catch (e) {
            console.error('Failed to persist AI provider', e);
        }
    };

    const handleToggleLocal = async (value: boolean) => {
        const providerToSet = value ? 'local' : 'openai';
        await updateProvider(providerToSet);
    };

    const handleSaveApiKey = async () => {
        await setOpenAIApiKey(apiKey.trim());
        Alert.alert('Сохранено', 'API ключ OpenAI сохранён');
    };

    const handleTestConnection = async () => {
        if (!usingOpenAI) {
            Alert.alert('Переключите провайдера', 'Для теста подключения выберите OpenAI.');
            return;
        }

        if (!apiKey) {
            Alert.alert('Ошибка', 'Введите API ключ');
            return;
        }

        setTestingConnection(true);
        const isConnected = await testOpenAIConnection();
        setTestingConnection(false);

        if (isConnected) {
            Alert.alert('Успешно', 'Подключение к OpenAI работает!');
        } else {
            Alert.alert('Ошибка', 'Не удалось подключиться к OpenAI. Проверьте API ключ.');
        }
    };

    const handleResetPrivacyWarning = async () => {
        await resetPrivacyWarning();
        Alert.alert('Сброшено', 'Предупреждение будет показано снова');
    };

    const handleToggleSelfHosted = async (value: boolean) => {
        setSelfHostedEnabledState(value);
        await setSelfHostedEnabled(value);
    };

    const handleSaveSelfHostedSettings = async () => {
        await Promise.all([
            setSelfHostedUrl(selfHostedUrl.trim()),
            setSelfHostedApiKey(selfHostedApiKey.trim())
        ]);
        Alert.alert('Сохранено', 'Настройки для Self-Hosted бэкенда сохранены');
    };

    return (
        <ScreenContainer>
            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                <View style={styles.heroCard}>
                    <View style={styles.heroHeader}>
                        <Text style={styles.title}>Settings</Text>
                        <View style={styles.badge}>
                            <MaterialIcons name="shield" size={16} color={colors.primary} />
                            <Text style={styles.badgeText}>Secure LLM</Text>
                        </View>
                    </View>
                    <Text style={styles.subtitle}>Минималистичные настройки с акцентом на приватность и AI.</Text>
                    <View style={styles.heroChips}>
                        <View style={styles.chip}>
                            <MaterialIcons name="lock" size={16} color={colors.text} />
                            <Text style={styles.chipText}>Данные не хранятся</Text>
                        </View>
                        <View style={styles.chip}>
                            <MaterialIcons name="blur-on" size={16} color={colors.text} />
                            <Text style={styles.chipText}>Material vibe</Text>
                        </View>
                    </View>
                </View>

                <View style={styles.card}>
                    <View style={styles.cardHeader}>
                        <Text style={styles.sectionTitle}>AI & Voice</Text>
                        <View style={styles.miniPill}>
                            <MaterialIcons name="verified-user" size={14} color={colors.primary} />
                            <Text style={styles.miniPillText}>Без логов</Text>
                        </View>
                    </View>
                    <Text style={styles.sectionHint}>Выберите, где обрабатываются подсказки и транскрибация.</Text>

                    <TouchableOpacity
                        style={[
                            styles.providerCard,
                            aiProvider === 'local' && styles.providerCardActive,
                        ]}
                        onPress={() => updateProvider('local')}
                        activeOpacity={0.9}
                    >
                        <View style={styles.providerLeft}>
                            <View style={[styles.providerIcon, styles.iconLocal]}>
                                <MaterialIcons name="security" size={20} color={colors.surface} />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.providerTitle}>Our Local AI</Text>
                                <Text style={styles.providerDescription}>
                                    Whisper + LLaMA на вашем сервере (Docker). Всё локально, ничего не улетает в облако.
                                </Text>
                                <View style={styles.chipRow}>
                                    <View style={styles.microChip}>
                                        <Text style={styles.microChipText}>Secure LLM</Text>
                                    </View>
                                    <View style={styles.microChip}>
                                        <Text style={styles.microChipText}>Zero retention</Text>
                                    </View>
                                </View>
                            </View>
                        </View>
                        <Switch
                            value={aiProvider === 'local'}
                            onValueChange={handleToggleLocal}
                            trackColor={{ false: colors.border, true: colors.primary }}
                            thumbColor={colors.surface}
                        />
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[
                            styles.providerCard,
                            aiProvider === 'openai' && styles.providerCardActive,
                        ]}
                        onPress={() => updateProvider('openai')}
                        activeOpacity={0.9}
                    >
                        <View style={styles.providerLeft}>
                            <View style={[styles.providerIcon, styles.iconCloud]}>
                                <MaterialIcons name="cloud-queue" size={20} color={colors.surface} />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.providerTitle}>OpenAI</Text>
                                <Text style={styles.providerDescription}>
                                    Audio → Whisper, Chat → Completions. Быстро, но требует API ключ.
                                </Text>
                                <View style={styles.microRow}>
                                    <MaterialIcons name="audiotrack" size={14} color={colors.textSecondary} />
                                    <Text style={styles.microText}>Audio → STT</Text>
                                    <MaterialIcons name="east" size={14} color={colors.textSecondary} />
                                    <MaterialIcons name="chat" size={14} color={colors.textSecondary} />
                                    <Text style={styles.microText}>LLM</Text>
                                </View>
                            </View>
                        </View>
                        <View style={[styles.radio, aiProvider === 'openai' && styles.radioActive]}>
                            {aiProvider === 'openai' && <View style={styles.radioDot} />}
                        </View>
                    </TouchableOpacity>

                    <View style={[styles.inputBlock, !usingOpenAI && styles.inputBlockDisabled]}>
                        <Text style={styles.label}>OpenAI API Key</Text>
                        <TextInput
                            value={apiKey}
                            onChangeText={setApiKeyState}
                            placeholder="sk-..."
                            secureTextEntry
                            editable={usingOpenAI}
                            style={[styles.input, !usingOpenAI && styles.disabledInput]}
                        />
                        <Text style={styles.helperText}>Audio → Whisper • Chat/Completions → LLM</Text>
                        <View style={styles.buttonRow}>
                            <Button
                                title="Сохранить"
                                onPress={handleSaveApiKey}
                                style={styles.saveButton}
                                disabled={!usingOpenAI}
                            />
                            <Button
                                title={testingConnection ? 'Проверка...' : 'Тест'}
                                onPress={handleTestConnection}
                                variant="outline"
                                disabled={!usingOpenAI || testingConnection}
                                style={styles.testButton}
                            />
                        </View>
                    </View>
                </View>

                <View style={styles.card}>
                    <View style={styles.cardHeader}>
                        <Text style={styles.sectionTitle}>Account</Text>
                        <View style={styles.miniPill}>
                            <MaterialIcons name="fingerprint" size={14} color={colors.primary} />
                            <Text style={styles.miniPillText}>{isAuthenticated ? 'Synced' : 'Гость'}</Text>
                        </View>
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
                        <Text style={styles.sectionTitle}>Self-Hosted Backend</Text>
                        <View style={styles.miniPill}>
                            <MaterialIcons name="cloud-upload" size={14} color={colors.primary} />
                            <Text style={styles.miniPillText}>{selfHostedEnabled ? 'Active' : 'Off'}</Text>
                        </View>
                    </View>
                    <Text style={styles.sectionHint}>
                        Подключитесь к своему серверу с помощью Docker Compose для полной приватности.
                    </Text>

                    <View style={styles.switchRow}>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.providerTitle}>Использовать Self-Hosted</Text>
                            <Text style={styles.providerDescription}>
                                Транскрибация и улучшения будут обрабатываться на вашем сервере
                            </Text>
                        </View>
                        <Switch
                            value={selfHostedEnabled}
                            onValueChange={handleToggleSelfHosted}
                            trackColor={{ false: colors.border, true: colors.primary }}
                            thumbColor={colors.surface}
                        />
                    </View>

                    <View style={[styles.inputBlock, !selfHostedEnabled && styles.inputBlockDisabled]}>
                        <Text style={styles.label}>Server URL</Text>
                        <TextInput
                            value={selfHostedUrl}
                            onChangeText={setSelfHostedUrlState}
                            placeholder="http://192.168.1.100:8000/api/v1"
                            editable={selfHostedEnabled}
                            style={[styles.input, !selfHostedEnabled && styles.disabledInput]}
                        />
                        <Text style={styles.helperText}>Адрес вашего сервера (с портом и /api/v1)</Text>
                    </View>

                    <View style={[styles.inputBlock, !selfHostedEnabled && styles.inputBlockDisabled]}>
                        <Text style={styles.label}>API Secret Key</Text>
                        <TextInput
                            value={selfHostedApiKey}
                            onChangeText={setSelfHostedApiKeyState}
                            placeholder="your_secret_api_key_here"
                            secureTextEntry
                            editable={selfHostedEnabled}
                            style={[styles.input, !selfHostedEnabled && styles.disabledInput]}
                        />
                        <Text style={styles.helperText}>API_SECRET_KEY из вашего .env файла</Text>
                        <Button
                            title="Сохранить настройки"
                            onPress={handleSaveSelfHostedSettings}
                            disabled={!selfHostedEnabled}
                            style={styles.saveButton}
                        />
                    </View>
                </View>


                <View style={styles.card}>
                    <View style={styles.cardHeader}>
                        <Text style={styles.sectionTitle}>Privacy</Text>
                        <View style={styles.miniPill}>
                            <MaterialIcons name="no-accounts" size={14} color={colors.primary} />
                            <Text style={styles.miniPillText}>Zero logs</Text>
                        </View>
                    </View>
                    <Text style={styles.info}>
                        Транскрибация и улучшения не логируются. Вы можете повторно увидеть предупреждение о приватности для голосовых заметок.
                    </Text>
                    <Button
                        title="Сбросить предупреждение"
                        onPress={handleResetPrivacyWarning}
                        variant="outline"
                        style={styles.resetButton}
                    />
                </View>

                <View style={styles.card}>
                    <Text style={styles.sectionTitle}>App Info</Text>
                    <Text style={styles.info}>Version 1.0.0</Text>
                    <Text style={styles.info}>Secure LLM — данные не хранятся, не анализируются.</Text>
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
        paddingVertical: spacing.l,
        gap: spacing.m,
    },
    heroCard: {
        backgroundColor: colors.surface,
        borderRadius: 20,
        padding: spacing.l,
        shadowColor: colors.cardShadow,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.15,
        shadowRadius: 14,
        elevation: 4,
        borderWidth: 1,
        borderColor: colors.border,
    },
    heroHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: spacing.s,
    },
    title: {
        ...typography.h1,
        fontSize: 28,
    },
    subtitle: {
        ...typography.body,
        color: colors.textSecondary,
        marginBottom: spacing.m,
    },
    heroChips: {
        flexDirection: 'row',
        gap: spacing.s,
    },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        paddingHorizontal: spacing.m,
        paddingVertical: spacing.s,
        borderRadius: 12,
        backgroundColor: colors.backgroundSecondary,
    },
    chipText: {
        ...typography.caption,
        color: colors.text,
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
    providerCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: spacing.m,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.background,
        marginBottom: spacing.s,
        gap: spacing.m,
    },
    providerCardActive: {
        borderColor: colors.primary,
        backgroundColor: '#EEF4FF',
    },
    providerLeft: {
        flex: 1,
        flexDirection: 'row',
        gap: spacing.m,
        alignItems: 'flex-start',
    },
    providerIcon: {
        width: 36,
        height: 36,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    iconLocal: {
        backgroundColor: colors.primary,
    },
    iconCloud: {
        backgroundColor: colors.textSecondary,
    },
    providerTitle: {
        ...typography.h3,
        fontSize: 16,
    },
    providerDescription: {
        ...typography.body,
        color: colors.textSecondary,
        marginTop: spacing.xs,
        lineHeight: 20,
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
    inputBlock: {
        marginTop: spacing.m,
    },
    inputBlockDisabled: {
        opacity: 0.6,
    },
    label: {
        ...typography.body,
        fontWeight: '600',
        marginBottom: spacing.xs,
    },
    input: {
        marginBottom: spacing.s,
    },
    disabledInput: {
        backgroundColor: colors.backgroundSecondary,
    },
    helperText: {
        ...typography.caption,
        color: colors.textSecondary,
        marginBottom: spacing.s,
    },
    buttonRow: {
        flexDirection: 'row',
        gap: spacing.m,
    },
    saveButton: {
        flex: 2,
    },
    testButton: {
        flex: 1,
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
    switchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.m,
        marginBottom: spacing.m,
    },
});
