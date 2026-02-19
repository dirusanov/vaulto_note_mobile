import axios from 'axios';
import { API_URL } from '../utils/env';
import { storage } from '../utils/storage';
import { onUnauthorized } from '../utils/authEvents';

const client = axios.create({
    baseURL: API_URL,
    timeout: 30000, // 30 seconds timeout
    headers: {
        'Content-Type': 'application/json',
    },
});

let refreshPromise: Promise<{ accessToken: string; refreshToken: string } | null> | null = null;
let unauthorizedEmitted = false;

const refreshAccessToken = async (): Promise<{ accessToken: string; refreshToken: string } | null> => {
    if (refreshPromise) {
        return refreshPromise;
    }

    refreshPromise = (async () => {
        const refreshToken = await storage.getRefreshToken();
        if (!refreshToken) {
            console.log('[client] No refresh token available');
            return null;
        }

        try {
            const refreshResponse = await axios.post(`${API_URL}/auth/refresh`, {
                refresh_token: refreshToken,
            });

            const { access_token, refresh_token } = refreshResponse.data;
            await storage.setToken(access_token);
            await storage.setRefreshToken(refresh_token);
            unauthorizedEmitted = false;
            console.log('[client] Token refresh successful');

            return {
                accessToken: access_token,
                refreshToken: refresh_token,
            };
        } catch (refreshError) {
            console.error('[client] Refresh failed:', refreshError);
            return null;
        } finally {
            refreshPromise = null;
        }
    })();

    return refreshPromise;
};

const emitUnauthorizedOnce = async () => {
    if (unauthorizedEmitted) {
        return;
    }
    unauthorizedEmitted = true;
    await storage.removeToken();
    await storage.removeRefreshToken();
    onUnauthorized.emit();
};

// Add a request interceptor to attach the token
client.interceptors.request.use(
    async (config) => {
        const token = await storage.getToken();
        if (token) {
            // A fresh token exists (e.g. after manual sign-in), allow future unauthorized handling again.
            unauthorizedEmitted = false;
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// Add a response interceptor to handle 401s
client.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;

        if (error.response && error.response.status === 401 && originalRequest && !originalRequest._retry) {
            console.log('[client] 401 received, attempting refresh...');
            originalRequest._retry = true;

            const refreshedTokens = await refreshAccessToken();
            if (refreshedTokens) {
                originalRequest.headers = originalRequest.headers ?? {};
                originalRequest.headers.Authorization = `Bearer ${refreshedTokens.accessToken}`;
                return client(originalRequest);
            }

            console.log('[client] 401 unrecoverable, emitting unauthorized event');
            await emitUnauthorizedOnce();
        }

        // Expanded logging for Network Errors
        if (axios.isAxiosError(error)) {
            console.error('[client] Axios Error:', {
                message: error.message,
                code: error.code,
                url: originalRequest?.url,
                baseURL: originalRequest?.baseURL,
                finalUrl: originalRequest?.baseURL ? `${originalRequest.baseURL}${originalRequest.url}` : originalRequest?.url,
                method: originalRequest?.method,
                status: error.response?.status
            });
        }

        return Promise.reject(error);
    }
);

export default client;
