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

authClient.interceptors.request.use(
    async (config) => {
        const token = await storage.getToken();
        if (token) {
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
            console.log('[authClient] 401 received, emitting unauthorized event');
            await storage.removeToken();
            onUnauthorized.emit();
        }
        return Promise.reject(error);
    },
);

export default authClient;

