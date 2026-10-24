import { GoogleSignin, isErrorWithCode, statusCodes } from '@react-native-google-signin/google-signin';
import { useCallback, useEffect, useState } from 'react';
import { authApi, LoginResult } from '../api/auth';
import { getErrorMessage } from '../utils/errorMessage';

let googleConfigured = false;

/**
 * Configures the native Google SDK once. Returns false when it cannot be set up.
 *
 * GoogleSignin.configure() throws synchronously when offlineAccess is requested
 * without a web client id (EXPO_PUBLIC_GOOGLE_CLIENT_ID is optional, see
 * .env.example, and absent in a checkout without .env). Thrown from an effect,
 * that error unmounted SignIn/SignUp in the middle of the stack push and Fabric
 * crashed with "addViewAt: ... View already has a parent". Store builds get the
 * id from eas.json; without it only the Google button is unavailable.
 */
const configureGoogleSignIn = (): boolean => {
    if (googleConfigured) return true;
    const webClientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;
    if (!webClientId) {
        if (__DEV__) console.warn('[GoogleOAuth] EXPO_PUBLIC_GOOGLE_CLIENT_ID is not set; Google sign-in is off.');
        return false;
    }
    try {
        GoogleSignin.configure({
            // Must be the OAuth client the auth server exchanges the code with
            // (GOOGLE_CLIENT_ID there); a code issued for any other client of the
            // project is refused by Google with "unauthorized_client".
            webClientId,
            offlineAccess: true,      // Required to get a Refresh Token (serverAuthCode)
            scopes: ['profile', 'email'],
        });
        googleConfigured = true;
    } catch (error) {
        console.warn('[GoogleOAuth] configure failed:', error);
    }
    return googleConfigured;
};

export const useGoogleOAuth = () => {
    const [loading, setLoading] = useState(false);
    const [lastError, setLastError] = useState<string | null>(null);

    // Initial Configuration
    useEffect(() => {
        configureGoogleSignIn();
    }, []);

    const signInWithGoogle = useCallback(async (): Promise<LoginResult | null> => {
        setLoading(true);
        setLastError(null);
        try {
            if (!configureGoogleSignIn()) {
                throw new Error('Google sign-in is not set up in this build.');
            }
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
            const code = (userInfo as any).data?.serverAuthCode || (userInfo as any).serverAuthCode;

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
            return tokens;

        } catch (error: any) {
            console.error('Google Sign-In Error:', error);

            if (isErrorWithCode(error)) {
                switch (error.code) {
                    case statusCodes.SIGN_IN_CANCELLED:
                        // User cancelled the login flow
                        return null;
                    case statusCodes.IN_PROGRESS:
                        // Operation (e.g. sign in) is in progress already
                        return null;
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
    }, []);

    return {
        signInWithGoogle,
        loading,
        lastError,
        clearLastError: () => setLastError(null),
    };
};
