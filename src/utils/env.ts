// In a real app, use react-native-dotenv or Expo's env variables.
// Android emulator needs 10.0.2.2 to access localhost.
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const LOCALHOST = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';

const extractHost = (value?: string | null) => {
    if (!value) return null;
    const host = value.split(':')[0];
    if (!host || host === '127.0.0.1') {
        return null;
    }
    return host;
};

// Try to reuse the Expo dev server host so that a physical device can hit a local API without extra config.
const detectedDevServerHost =
    extractHost(Constants.expoConfig?.hostUri) ||
    extractHost((Constants.expoGoConfig as Record<string, any> | undefined)?.debuggerHost) ||
    extractHost((Constants.manifest as Record<string, any> | undefined)?.debuggerHost) ||
    extractHost(
        (Constants.manifest2 as Record<string, any> | undefined)?.extra?.expoClient?.hostUri,
    );

const DEFAULT_HOST = detectedDevServerHost ?? LOCALHOST;
const DEFAULT_GATEWAY_PORT = '8000';

const GATEWAY_HOST = process.env.EXPO_PUBLIC_GATEWAY_API_HOST ?? DEFAULT_HOST;
const GATEWAY_PORT = process.env.EXPO_PUBLIC_GATEWAY_API_PORT ?? DEFAULT_GATEWAY_PORT;

const sanitizeBaseUrl = (value: string) => value.replace(/\/+$/, '');

const DEFAULT_SCHEME = __DEV__ ? 'http' : 'https';
const DEFAULT_GATEWAY_BASE = `${DEFAULT_SCHEME}://${GATEWAY_HOST}:${GATEWAY_PORT}`;

// Prioritize the full Base URL if provided
const GATEWAY_BASE_URL = sanitizeBaseUrl(
    process.env.EXPO_PUBLIC_GATEWAY_API_BASE_URL ?? DEFAULT_GATEWAY_BASE,
);

export const API_URL = GATEWAY_BASE_URL;
export const AUTH_API_URL = GATEWAY_BASE_URL;

if (!__DEV__ && !GATEWAY_BASE_URL.startsWith('https://')) {
    throw new Error(`[ENV] Non-HTTPS API URL is not allowed in production: ${GATEWAY_BASE_URL}`);
}

console.log('[ENV] Raw EXPO_PUBLIC_GATEWAY_API_BASE_URL:', process.env.EXPO_PUBLIC_GATEWAY_API_BASE_URL);
console.log('[ENV] Resolved AUTH_API_URL:', AUTH_API_URL);
console.log('[ENV] Resolved API_URL:', API_URL);
