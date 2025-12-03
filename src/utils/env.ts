// In a real app, use react-native-dotenv or Expo's env variables.
// Android emulator needs 10.0.2.2 to access localhost.
import { Platform } from 'react-native';

const LOCALHOST = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';

const NOTES_HOST = process.env.EXPO_PUBLIC_NOTES_API_HOST ?? LOCALHOST;
const NOTES_PORT = process.env.EXPO_PUBLIC_NOTES_API_PORT ?? '8000';

const GATEWAY_HOST = process.env.EXPO_PUBLIC_GATEWAY_API_HOST ?? NOTES_HOST;
const GATEWAY_PORT =
    process.env.EXPO_PUBLIC_GATEWAY_API_PORT ?? process.env.EXPO_PUBLIC_NOTES_API_PORT ?? '8000';

export const API_URL = `http://${NOTES_HOST}:${NOTES_PORT}/api/v1`;
export const AUTH_API_URL = `http://${GATEWAY_HOST}:${GATEWAY_PORT}`;
