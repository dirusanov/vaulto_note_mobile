// In a real app, use react-native-dotenv or Expo's env variables
// For now, we hardcode the local API URL.
// Android emulator needs 10.0.2.2 to access localhost
import { Platform } from 'react-native';

const LOCALHOST = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';

export const API_URL = `http://${LOCALHOST}:8000/api/v1`;
