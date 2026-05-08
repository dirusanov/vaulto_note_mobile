import * as LocalAuthentication from 'expo-local-authentication';
import { Alert, Platform } from 'react-native';

export const BiometricService = {
    /**
     * Checks if the device supports biometric authentication and has it enrolled.
     */
    isAvailable: async (): Promise<boolean> => {
        try {
            const hasHardware = await LocalAuthentication.hasHardwareAsync();
            if (!hasHardware) return false;

            const isEnrolled = await LocalAuthentication.isEnrolledAsync();
            return isEnrolled;
        } catch (error) {
            console.error('[BiometricService] Availability check failed:', error);
            return false;
        }
    },

    /**
     * Returns the types of biometric authentication supported (Fingerprint, Face, Iris).
     */
    getSupportedTypes: async (): Promise<LocalAuthentication.AuthenticationType[]> => {
        try {
            return await LocalAuthentication.supportedAuthenticationTypesAsync();
        } catch (error) {
            console.error('[BiometricService] Supported types check failed:', error);
            return [];
        }
    },

    /**
     * Triggers the biometric authentication prompt.
     */
    authenticate: async (reason: string = 'Unlock your digital safe'): Promise<boolean> => {
        try {
            const result = await LocalAuthentication.authenticateAsync({
                promptMessage: reason,
                fallbackLabel: 'Use Passcode',
                cancelLabel: 'Cancel',
                disableDeviceFallback: false,
            });

            return result.success;
        } catch (error) {
            console.error('[BiometricService] Authentication failed:', error);
            return false;
        }
    },
};
