/**
 * Device Identity Utility
 * 
 * Generates and persists a unique device ID using secure storage.
 * - iOS: Uses Keychain (persists across reinstalls)
 * - Android: Uses Keystore (persists across reinstalls on most devices)
 */
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

const DEVICE_ID_KEY = 'vaulto_device_id';

/**
 * Get or create a persistent device ID.
 * This ID survives app reinstalls on most devices.
 */
export async function getDeviceId(): Promise<string> {
    try {
        // Try to get existing device ID
        const existingId = await SecureStore.getItemAsync(DEVICE_ID_KEY);
        if (existingId) {
            console.log('[DeviceIdentity] Retrieved existing device ID');
            return existingId;
        }

        // Generate new UUID
        const newId = Crypto.randomUUID();
        console.log('[DeviceIdentity] Generated new device ID');

        // Store in secure storage
        await SecureStore.setItemAsync(DEVICE_ID_KEY, newId, {
            keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
        });

        return newId;
    } catch (error) {
        console.error('[DeviceIdentity] Error getting/creating device ID:', error);
        // Fallback: generate a session-only ID (won't persist)
        return Crypto.randomUUID();
    }
}

/**
 * Get the current platform name for device registration
 */
export function getPlatformName(): string {
    return Platform.OS; // 'ios' | 'android' | 'web'
}
