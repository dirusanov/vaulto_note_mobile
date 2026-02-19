import axios from 'axios';
import { AUTH_API_URL } from '../utils/env';
import { storage } from '../utils/storage';
import { onUnauthorized } from '../utils/authEvents';

const authClient = axios.create({
    baseURL: AUTH_API_URL,
    timeout: 5000,
    headers: {
        'Content-Type': 'application/json',
    },
});

let unauthorizedEmitted = false;
let refreshPromise: Promise<{ accessToken: string; refreshToken: string } | null> | null = null;
let lastRefreshFailureWasInvalid = false;

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

const isInvalidRefreshStatus = (status?: number): boolean => {
    return status === 400 || status === 401 || status === 403;
};

type RefreshAttemptResult =
    | { kind: 'success'; tokens: { accessToken: string; refreshToken: string } }
    | { kind: 'invalid_refresh' }
    | { kind: 'transient_failure' };

const refreshAccessToken = async (): Promise<{ accessToken: string; refreshToken: string } | null> => {
    if (refreshPromise) {
        return refreshPromise;
    }

    refreshPromise = (async () => {
        lastRefreshFailureWasInvalid = false;
        const refreshToken = await storage.getRefreshToken();
        if (!refreshToken) {
            lastRefreshFailureWasInvalid = true;
            return null;
        }

        try {
            const refreshResponse = await axios.post(`${AUTH_API_URL}/auth/refresh`, {
                refresh_token: refreshToken,
            });

            const { access_token, refresh_token } = refreshResponse.data;
            await storage.setToken(access_token);
            await storage.setRefreshToken(refresh_token);
            unauthorizedEmitted = false;

            return {
                accessToken: access_token,
                refreshToken: refresh_token,
            };
        } catch (refreshError) {
            if (axios.isAxiosError(refreshError)) {
                lastRefreshFailureWasInvalid = isInvalidRefreshStatus(refreshError.response?.status);
            } else {
                lastRefreshFailureWasInvalid = false;
            }
            return null;
        } finally {
            refreshPromise = null;
        }
    })();

    return refreshPromise;
};

const refreshAccessTokenSafely = async (): Promise<RefreshAttemptResult> => {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
        return { kind: 'success', tokens: refreshed };
    }
    if (lastRefreshFailureWasInvalid) {
        return { kind: 'invalid_refresh' };
    }
    return { kind: 'transient_failure' };
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
