import { GoogleSignin, isErrorWithCode, statusCodes } from '@react-native-google-signin/google-signin';
import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { useAuth } from './useAuth';
import { authApi } from '../api/auth';
import { getErrorMessage } from '../utils/errorMessage';

export const useGoogleOAuth = () => {
    const { signIn } = useAuth();
    const [loading, setLoading] = useState(false);
    const [lastError, setLastError] = useState<string | null>(null);

    // Initial Configuration
    useEffect(() => {
        const webClientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;

        GoogleSignin.configure({
            webClientId: webClientId, // Required for backend to verify the token
            offlineAccess: true,      // Required to get a Refresh Token (serverAuthCode)
            scopes: ['profile', 'email'],
        });

        // DEBUG: Verify Client ID
        Alert.alert("Debug Config", `ClientID: ${webClientId}`);
    }, []);

    const signInWithGoogle = useCallback(async () => {
        setLoading(true);
        setLastError(null);
        try {
            await GoogleSignin.hasPlayServices();

            // Force sign out to ensure the account picker always shows
            try {
                await GoogleSignin.signOut();
            } catch (e) {
                // Ignore if not signed in or other minor errors during signout
            }

            // Native Sign In
            const userInfo = await GoogleSignin.signIn();

            // For backend verification we need the Server Auth Code
            const code = userInfo.data?.serverAuthCode || userInfo.serverAuthCode;

            if (!code) {
                throw new Error("No server auth code returned from Google.");
            }

            // Exchange code for tokens on backend
            // Native flow does NOT use PKCE (code_verifier), so we send empty string
            const tokens = await authApi.completeGoogleLogin({
                code: code,
                state: 'native_android', // State is less relevant for native flow
                code_verifier: '',       // Native SDK handles security, no PKCE needed
            });

            await signIn(tokens.access_token, tokens.refresh_token);

        } catch (error: any) {
            console.error('Google Sign-In Error:', error);

            if (isErrorWithCode(error)) {
                switch (error.code) {
                    case statusCodes.SIGN_IN_CANCELLED:
                        // User cancelled the login flow
                        break;
                    case statusCodes.IN_PROGRESS:
                        // Operation (e.g. sign in) is in progress already
                        break;
                    case statusCodes.PLAY_SERVICES_NOT_AVAILABLE:
                        setLastError("Google Play Services not available or outdated.");
                        break;
                    default:
                        setLastError(getErrorMessage(error, 'Sign in failed'));
                }
            } else {
                setLastError(getErrorMessage(error, 'Sign in failed'));
            }
            throw error;
        } finally {
            setLoading(false);
        }
    }, [signIn]);

    return {
        signInWithGoogle,
        loading,
        lastError,
        clearLastError: () => setLastError(null),
    };
};
