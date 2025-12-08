import axios from 'axios';
import { API_URL } from '../utils/env';
import { storage } from '../utils/storage';
import { onUnauthorized } from '../utils/authEvents';

const client = axios.create({
    baseURL: API_URL,
    timeout: 5000, // 5 seconds timeout
    headers: {
        'Content-Type': 'application/json',
    },
});

// Add a request interceptor to attach the token
client.interceptors.request.use(
    async (config) => {
        const token = await storage.getToken();
        if (token) {
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

        if (error.response && error.response.status === 401 && !originalRequest._retry) {
            console.log('[client] 401 received, attempting refresh...');
            originalRequest._retry = true;

            const refreshToken = await storage.getRefreshToken();
            if (refreshToken) {
                try {
                    // Create a new axios instance to avoid interceptor loops
                    const refreshResponse = await axios.post(`${API_URL}/auth/refresh`, {
                        refresh_token: refreshToken
                    });

                    const { access_token, refresh_token } = refreshResponse.data;

                    console.log('[client] Token refresh successful');

                    await storage.setToken(access_token);
                    await storage.setRefreshToken(refresh_token);

                    // Update auth headers for the original request
                    originalRequest.headers.Authorization = `Bearer ${access_token}`;

                    return client(originalRequest);
                } catch (refreshError) {
                    console.error('[client] Refresh failed:', refreshError);
                    // Fall through to logout logic
                }
            } else {
                console.log('[client] No refresh token available');
            }

            // Token might be expired or invalid and refresh failed
            console.log('[client] 401 unrecoverable, emitting unauthorized event');
            await storage.removeToken();
            await storage.removeRefreshToken();
            // Notify AuthContext to recreate session
            onUnauthorized.emit();
        }
        return Promise.reject(error);
    }
);

export default client;
