import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { ScreenContainer } from '../components/ScreenContainer';
import { Button } from '../components/Button';
import { TextInput } from '../components/TextInput';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { spacing } from '../theme/spacing';
import { useNavigation } from '@react-navigation/native';
import { authApi } from '../api/auth';
import { useAuth } from '../hooks/useAuth';

export const SignUpScreen = () => {
    const navigation = useNavigation();
    const { signIn } = useAuth();

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSignUp = async () => {
        if (!email || !password || !confirmPassword) {
            Alert.alert('Error', 'Please fill in all fields');
            return;
        }

        if (password !== confirmPassword) {
            Alert.alert('Error', 'Passwords do not match');
            return;
        }

        setLoading(true);
        try {
            await authApi.register(email, password);
            // Auto login after register
            const data = await authApi.login(email, password);
            await signIn(data.access_token);
        } catch (error: any) {
            console.error(error);
            Alert.alert('Registration Failed', 'Could not create account. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <ScreenContainer>
            <View style={styles.header}>
                <Text style={styles.title}>Create account</Text>
                <Text style={styles.subtitle}>Start encrypting your notes today</Text>
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
                    placeholder="Create a password"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                />
                <TextInput
                    label="Confirm Password"
                    placeholder="Confirm your password"
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    secureTextEntry
                />

                <Button
                    title="Create account"
                    onPress={handleSignUp}
                    loading={loading}
                    style={styles.button}
                />

                <Button
                    title="Already have an account? Sign In"
                    onPress={() => navigation.goBack()}
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
