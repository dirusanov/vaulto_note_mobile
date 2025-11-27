import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { ScreenContainer } from '../components/ScreenContainer';
import { Button } from '../components/Button';
import { TextInput } from '../components/TextInput';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { useAuth } from '../hooks/useAuth';
import { useNavigation } from '@react-navigation/native';
import { getOpenAIApiKey, setOpenAIApiKey, resetPrivacyWarning } from '../utils/storage';
import { testOpenAIConnection } from '../services/TranscriptionService';

export const SettingsScreen = () => {
    const navigation = useNavigation<any>();
    const { signOut, isAuthenticated } = useAuth();
    const [apiKey, setApiKeyState] = useState('');
    const [testingConnection, setTestingConnection] = useState(false);

    useEffect(() => {
        loadApiKey();
    }, []);

    const loadApiKey = async () => {
        const key = await getOpenAIApiKey();
        if (key) setApiKeyState(key);
    };

    const handleSaveApiKey = async () => {
        await setOpenAIApiKey(apiKey);
        Alert.alert('Сохранено', 'API ключ OpenAI сохранён');
    };

    const handleTestConnection = async () => {
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

    return (
        <ScreenContainer>
            <View style={styles.header}>
                <Text style={styles.title}>Settings</Text>
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Account</Text>
                {isAuthenticated ? (
                    <Text style={styles.info}>Logged in</Text>
                ) : (
                    <>
                        <Text style={styles.info}>Guest Mode - Notes stored locally</Text>
                        <Button
                            title="Sign In to Sync"
                            onPress={() => navigation.navigate('SignIn')}
                            style={styles.signInButton}
                        />
                    </>
                )}
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Voice Notes</Text>

                <Text style={styles.label}>OpenAI API Key</Text>
                <TextInput
                    value={apiKey}
                    onChangeText={setApiKeyState}
                    placeholder="sk-..."
                    secureTextEntry
                    style={styles.input}
                />

                <View style={styles.buttonRow}>
                    <Button
                        title="Сохранить"
                        onPress={handleSaveApiKey}
                        style={styles.saveButton}
                    />
                    <Button
                        title={testingConnection ? 'Проверка...' : 'Тест'}
                        onPress={handleTestConnection}
                        variant="outline"
                        disabled={testingConnection}
                        style={styles.testButton}
                    />
                </View>

                <Button
                    title="Сбросить предупреждение"
                    onPress={handleResetPrivacyWarning}
                    variant="outline"
                    style={styles.resetButton}
                />

                {!apiKey && !isAuthenticated && (
                    <Text style={styles.warningText}>
                        Voice transcription requires either a custom API key or sign in to use our AI provider.
                    </Text>
                )}
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>App Info</Text>
                <Text style={styles.info}>Version 1.0.0</Text>
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
        </ScreenContainer>
    );
};

const styles = StyleSheet.create({
    header: {
        paddingVertical: spacing.m,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        marginBottom: spacing.l,
    },
    title: {
        ...typography.h1,
    },
    section: {
        marginBottom: spacing.xl,
    },
    sectionTitle: {
        ...typography.h2,
        fontSize: 18,
        marginBottom: spacing.s,
    },
    info: {
        ...typography.body,
        color: colors.textMuted,
    },
    footer: {
        marginTop: 'auto',
        marginBottom: spacing.l,
    },
    button: {
        borderColor: colors.error,
    },
    label: {
        ...typography.body,
        fontWeight: '600',
        marginBottom: spacing.s,
    },
    input: {
        marginBottom: spacing.m,
    },
    buttonRow: {
        flexDirection: 'row',
        gap: spacing.m,
        marginBottom: spacing.m,
    },
    saveButton: {
        flex: 2,
    },
    testButton: {
        flex: 1,
    },
    resetButton: {
        borderColor: colors.textMuted,
    },
    signInButton: {
        marginTop: spacing.m,
    },
    warningText: {
        ...typography.body,
        color: colors.textMuted,
        fontSize: 12,
        marginTop: spacing.m,
        fontStyle: 'italic',
    },
});
