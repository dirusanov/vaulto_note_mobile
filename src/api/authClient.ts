import axios from 'axios';
import { refreshSession } from './tokenRefresh';
import { AUTH_API_URL } from '../utils/env';
import { storage } from '../utils/storage';
import { onUnauthorized } from '../utils/authEvents';

const authClient = axios.create({
    baseURL: AUTH_API_URL,
    timeout: 15000,
    headers: {
        'Content-Type': 'application/json',
    },
});

let unauthorizedEmitted = false;

const isPublicAuthEndpoint = (requestUrl: string): boolean => {
    return [
        '/auth/login',
        '/auth/register',
        '/auth/confirm',
        '/auth/password-reset/request',
        '/auth/password-reset/confirm',
        '/auth/google/login',
        '/auth/google/callback',
        '/auth/anonymous',
    ].some((path) => requestUrl.includes(path));
};


type RefreshAttemptResult =
    | { kind: 'success'; tokens: { accessToken: string; refreshToken: string } }
    | { kind: 'invalid_refresh' }
    | { kind: 'transient_failure' };

const refreshAccessTokenSafely = async (): Promise<RefreshAttemptResult> => {
    // Shared with every other client: refresh tokens are single-use.
    const result = await refreshSession();
    if (result.kind !== 'success') return result;
    unauthorizedEmitted = false;
    return { kind: 'success', tokens: { accessToken: result.accessToken, refreshToken: result.refreshToken } };
};

const emitUnauthorizedOnce = async () => {
    if (unauthorizedEmitted) return;
    unauthorizedEmitted = true;
    await storage.removeToken();
    await storage.removeRefreshToken();
    onUnauthorized.emit();
};

authClient.interceptors.request.use(
    async (config) => {
        const token = await storage.getToken();
        if (token) {
            unauthorizedEmitted = false;
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => Promise.reject(error),
);

authClient.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;
        if (error.response && error.response.status === 401) {
            const requestUrl: string = originalRequest?.url ?? '';

            if (isPublicAuthEndpoint(requestUrl)) {
                return Promise.reject(error);
            }

            if (originalRequest && !originalRequest._retry) {
                originalRequest._retry = true;
                const refreshResult = await refreshAccessTokenSafely();
                if (refreshResult.kind === 'success') {
                    originalRequest.headers = originalRequest.headers ?? {};
                    originalRequest.headers.Authorization = `Bearer ${refreshResult.tokens.accessToken}`;
                    return authClient(originalRequest);
                }

                if (refreshResult.kind === 'invalid_refresh') {
                    console.log('[authClient] 401 unrecoverable (invalid refresh), emitting unauthorized event');
                    await emitUnauthorizedOnce();
                } else {
                    console.log('[authClient] Refresh failed due to transient issue, keeping current session');
                }
            } else {
                const refreshToken = await storage.getRefreshToken();
                if (!refreshToken) {
                    console.log('[authClient] 401 after retry and no refresh token, emitting unauthorized event');
                    await emitUnauthorizedOnce();
                }
            }
        }
        return Promise.reject(error);
    },
);

export default authClient;
