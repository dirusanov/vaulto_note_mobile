import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { ScreenContainer } from '../components/ScreenContainer';
import { Button } from '../components/Button';
import { TextInput } from '../components/TextInput';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { spacing } from '../theme/spacing';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { authApi } from '../api/auth';
import { useAuth } from '../hooks/useAuth';
import { storage } from '../utils/storage';

export const SignInScreen = () => {
    const navigation = useNavigation<NativeStackNavigationProp<any>>();
    const { signIn } = useAuth();

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSignIn = async () => {
        if (!email || !password) {
            Alert.alert('Error', 'Please fill in all fields');
            return;
        }

        setLoading(true);
        try {
            const data = await authApi.login(email, password);
            await storage.setGuestMode(false);
            await signIn(data.access_token);
            // Navigation is handled by RootNavigator based on auth state
        } catch (error: any) {
            console.error(error);
            Alert.alert('Login Failed', 'Invalid email or password');
        } finally {
            setLoading(false);
        }
    };

    return (
        <ScreenContainer>
            <View style={styles.header}>
                <Text style={styles.title}>Welcome back</Text>
                <Text style={styles.subtitle}>Sign in to access your notes</Text>
            </View>

            <View style={styles.form}>
                <TextInput
                    label="Email"
                    placeholder="name@example.com"
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                />
                <TextInput
                    label="Password"
                    placeholder="Enter your password"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                />

                <Button
                    title="Sign In"
                    onPress={handleSignIn}
                    loading={loading}
                    style={styles.button}
                />

                <Button
                    title="Create account"
                    onPress={() => navigation.navigate('SignUp')}
                    variant="secondary"
                />
            </View>
        </ScreenContainer>
    );
};

const styles = StyleSheet.create({
    header: {
        marginTop: spacing.xl,
        marginBottom: spacing.xl,
    },
    title: {
        ...typography.h1,
        marginBottom: spacing.xs,
    },
    subtitle: {
        ...typography.body,
        color: colors.textMuted,
    },
    form: {
        flex: 1,
    },
    button: {
        marginTop: spacing.m,
        marginBottom: spacing.m,
    },
});
