import React, { useEffect, useState } from 'react';
import {
    Alert,
    KeyboardAvoidingView,
    Platform,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScreenContainer } from '../components/ScreenContainer';
import { TextInput } from '../components/TextInput';
import { Button } from '../components/Button';
import { AuthProviderButton } from '../components/AuthProviderButton';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { spacing } from '../theme/spacing';
import { authApi } from '../api/auth';
import { useAuth } from '../hooks/useAuth';
import { getErrorMessage } from '../utils/errorMessage';
import { useGoogleOAuth } from '../hooks/useGoogleOAuth';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';

export const SignInScreen = () => {
    const navigation = useNavigation<NativeStackNavigationProp<any>>();
    const { signIn } = useAuth();
    const { signInWithGoogle, loading: googleLoading } = useGoogleOAuth();

    const handleGoogleSignIn = async () => {
        try {
            await signInWithGoogle();
            navigation.navigate('Settings');
        } catch (err) {
            const message = getErrorMessage(err, 'Google sign-in was cancelled.');
            Alert.alert('Google Sign-In', message);
        }
    };

    return (
        <ScreenContainer>
            <View style={styles.container}>
                <TouchableOpacity
                    style={styles.backButton}
                    onPress={() => navigation.goBack()}
                    activeOpacity={0.8}
                >
                    <MaterialIcons name="arrow-back" size={22} color={colors.text} />
                </TouchableOpacity>

                <View style={styles.content}>
                    <Text style={styles.title}>Welcome Back</Text>
                    <Text style={styles.subtitle}>Sign in to continue</Text>

                    <View style={styles.buttonContainer}>
                        <AuthProviderButton
                            title="Continue with Google"
                            icon={<MaterialCommunityIcons name="google" size={20} color={colors.text} />}
                            onPress={handleGoogleSignIn}
                            loading={googleLoading}
                        />
                    </View>
                </View>
            </View>
        </ScreenContainer>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
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
        marginTop: spacing.l,
        marginLeft: spacing.l,
        alignSelf: 'flex-start',
    },
    content: {
        flex: 1,
        justifyContent: 'center',
        paddingHorizontal: spacing.l,
        paddingBottom: spacing.xxl, // Push content up a bit
    },
    title: {
        ...typography.h1,
        textAlign: 'center',
        marginBottom: spacing.xs,
    },
    subtitle: {
        ...typography.body,
        color: colors.textSecondary,
        textAlign: 'center',
        marginBottom: spacing.xxl,
    },
    buttonContainer: {
        gap: spacing.m,
    },
});
