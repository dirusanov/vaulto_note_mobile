import axios from 'axios';
import { AUTH_API_URL } from '../utils/env';
import { storage } from '../utils/storage';

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
            await storage.removeToken();
        }
        return Promise.reject(error);
    },
);

export default authClient;
