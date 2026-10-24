/**
 * Google Play Integrity token for a new guest session (Android only).
 *
 * Never throws: without Play services (emulators, Huawei, custom ROMs), an old
 * dev client without the native module, or on a timeout, it returns the error
 * code instead and the server decides what the guest gets.
 */
import { Platform } from 'react-native';
import {
    GuestAttestationFields,
    IntegrityChallenge,
    guestRequestHash,
    installIdFromAndroidId,
    integrityErrorCode,
    withTimeout,
} from '../utils/guestIntegrity';

// Warm-up talks to Play services and may take a few seconds on a cold device.
const PREPARE_TIMEOUT_MS = 12000;
const REQUEST_TIMEOUT_MS = 12000;

/** Whether this build can ask Google Play for an integrity token. */
export const canAttestGuest = Platform.OS === 'android';

const readInstallId = (): string | undefined => {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const Application = require('expo-application') as typeof import('expo-application');
        return installIdFromAndroidId(Application.getAndroidId());
    } catch (error) {
        console.warn('[GuestAttestation] Android ID unavailable', error);
        return undefined;
    }
};

export const attestGuest = async (
    { challenge, cloudProjectNumber }: IntegrityChallenge,
    deviceKey: string,
): Promise<GuestAttestationFields> => {
    const installId = readInstallId();
    const fields: GuestAttestationFields = {
        integrity_capable: true,
        integrity_challenge: challenge,
        install_id: installId,
    };
    if (!canAttestGuest) return { ...fields, integrity_error: 'NOT_ANDROID' };
    if (!cloudProjectNumber) return { ...fields, integrity_error: 'NO_PROJECT_NUMBER' };

    try {
        // Loaded lazily: requiring a missing native module throws, and that must
        // not break app start.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const Integrity = require('@expo/app-integrity') as typeof import('@expo/app-integrity');
        await withTimeout(
            Integrity.prepareIntegrityTokenProviderAsync(cloudProjectNumber),
            PREPARE_TIMEOUT_MS,
            'prepareIntegrityTokenProvider',
        );
        const token = await withTimeout(
            Integrity.requestIntegrityCheckAsync(guestRequestHash(challenge, deviceKey, installId)),
            REQUEST_TIMEOUT_MS,
            'requestIntegrityCheck',
        );
        if (!token) return { ...fields, integrity_error: 'EMPTY_TOKEN' };
        return { ...fields, integrity_token: token };
    } catch (error) {
        const code = integrityErrorCode(error);
        console.warn('[GuestAttestation] No Play Integrity token:', code);
        return { ...fields, integrity_error: code };
    }
};
