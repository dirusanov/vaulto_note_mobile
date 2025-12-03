import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';
import { authApi } from '../api/auth';
import { useAuth } from './useAuth';
import { getErrorMessage } from '../utils/errorMessage';

const OAUTH_TIMEOUT_MS = 2 * 60 * 1000;

interface OAuthParams {
    code?: string;
    state?: string;
    error?: string;
    error_description?: string;
}

const parseOAuthParams = (url: string): OAuthParams => {
    const queryIndex = url.indexOf('?');
    const hashIndex = url.indexOf('#');
    const query = queryIndex !== -1 ? url.substring(queryIndex + 1, hashIndex !== -1 ? hashIndex : undefined) : '';
    const hash = hashIndex !== -1 ? url.substring(hashIndex + 1) : '';
    const combined = [query, hash].filter(Boolean).join('&');
    const params = new URLSearchParams(combined);

    return {
        code: params.get('code') ?? undefined,
        state: params.get('state') ?? undefined,
        error: params.get('error') ?? undefined,
        error_description: params.get('error_description') ?? undefined,
    };
};

export const useGoogleOAuth = () => {
    const { signIn } = useAuth();
    const [loading, setLoading] = useState(false);
    const [lastError, setLastError] = useState<string | null>(null);
    const subscriptionRef = useRef<ReturnType<typeof Linking.addEventListener> | null>(null);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const cleanup = useCallback(() => {
        if (subscriptionRef.current) {
            subscriptionRef.current.remove();
            subscriptionRef.current = null;
        }
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
    }, []);

    useEffect(() => cleanup, [cleanup]);

    const waitForRedirect = useCallback(
        (expectedState: string) =>
            new Promise<{ code: string; state: string }>((resolve, reject) => {
                cleanup();

                const handleUrl = (event: { url: string }) => {
                    const params = parseOAuthParams(event.url);
                    if (!params.state) {
                        return;
                    }

                    if (params.error) {
                        cleanup();
                        reject(new Error(params.error_description || 'Google authentication was cancelled.'));
                        return;
                    }

                    if (params.state !== expectedState) {
                        cleanup();
                        reject(new Error('Security check failed. Please try Google sign-in again.'));
                        return;
                    }

                    if (!params.code) {
                        return;
                    }

                    cleanup();
                    resolve({ code: params.code, state: params.state });
                };

                subscriptionRef.current = Linking.addEventListener('url', handleUrl);
                timeoutRef.current = setTimeout(() => {
                    cleanup();
                    reject(new Error('Google sign-in timed out. Please try again.'));
                }, OAUTH_TIMEOUT_MS);
            }),
        [cleanup],
    );

    const signInWithGoogle = useCallback(async () => {
        setLoading(true);
        setLastError(null);
        try {
            const { authorization_url, state } = await authApi.initGoogleLogin();
            const redirectPromise = waitForRedirect(state);

            const supported = await Linking.canOpenURL(authorization_url);
            if (!supported) {
                throw new Error('Unable to open Google sign-in in browser.');
            }

            await Linking.openURL(authorization_url);
            const payload = await redirectPromise;
            const tokens = await authApi.completeGoogleLogin(payload);
            await signIn(tokens.access_token);
        } catch (error) {
            const message = getErrorMessage(error, 'Unable to complete Google sign-in.');
            setLastError(message);
            throw new Error(message);
        } finally {
            cleanup();
            setLoading(false);
        }
    }, [cleanup, signIn, waitForRedirect]);

    return {
        signInWithGoogle,
        loading,
        lastError,
        clearLastError: () => setLastError(null),
    };
};
