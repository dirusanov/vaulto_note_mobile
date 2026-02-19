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
        if (error.response && error.response.status === 401) {
            const requestUrl: string = error.config?.url ?? '';
            const isPublicAuthEndpoint = [
                '/auth/login',
                '/auth/register',
                '/auth/confirm',
                '/auth/password-reset/request',
                '/auth/password-reset/confirm',
                '/auth/google/login',
                '/auth/google/callback',
                '/auth/anonymous',
            ].some((path) => requestUrl.includes(path));

            if (isPublicAuthEndpoint) {
                return Promise.reject(error);
            }

            console.log('[authClient] 401 received, emitting unauthorized event');
            await emitUnauthorizedOnce();
        }
        return Promise.reject(error);
    },
);

export default authClient;
