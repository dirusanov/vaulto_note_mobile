import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';

const APP_LOCK_BUNDLE_KEY = 'vaulto_app_lock_bundle_v1';
const APP_LOCK_BIOMETRIC_ENABLED_KEY = 'vaulto_app_lock_biometric_enabled_v1';
const APP_LOCK_BIOMETRIC_GUARD_KEY = 'vaulto_app_lock_biometric_guard_v1';
const APP_LOCK_PIN_BACKOFF_KEY = 'vaulto_app_lock_pin_backoff_v1';
const APP_LOCK_PIN_LENGTH = 6;
const APP_LOCK_KDF_ITERATIONS = 150_000;
const APP_LOCK_PIN_VERIFIER_PREFIX = 'alpv1.';

type AppLockBundle = {
    version: 1;
    kdf: {
        name: 'PBKDF2-HMAC-SHA256';
        iterations: number;
        salt: string;
    };
    pin_verifier: {
        name: 'SHA-256';
        salt: string;
        hash: string;
    };
    created_at: string;
};

type PinBackoffState = {
    failedAttempts: number;
    blockedUntil: number;
};

const DEFAULT_PIN_BACKOFF_STATE: PinBackoffState = {
    failedAttempts: 0,
    blockedUntil: 0,
};

let pinBackoffStateCache: PinBackoffState | null = null;

const assertAppLockSupported = (): void => {
    if (Platform.OS === 'web') {
        throw new Error('App Lock is not supported on web builds.');
    }
};

const secureGet = async (key: string): Promise<string | null> => {
    assertAppLockSupported();
    return await SecureStore.getItemAsync(key);
};

const secureSet = async (key: string, value: string): Promise<void> => {
    assertAppLockSupported();
    await SecureStore.setItemAsync(key, value, {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    });
};

const secureDelete = async (key: string): Promise<void> => {
    assertAppLockSupported();
    await SecureStore.deleteItemAsync(key);
};

const parseBundle = (raw: string | null): AppLockBundle | null => {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as AppLockBundle;
        const isValid =
            parsed.version === 1 &&
            parsed.kdf?.name === 'PBKDF2-HMAC-SHA256' &&
            typeof parsed.kdf?.iterations === 'number' &&
            typeof parsed.kdf?.salt === 'string' &&
            parsed.pin_verifier?.name === 'SHA-256' &&
            typeof parsed.pin_verifier?.salt === 'string' &&
            typeof parsed.pin_verifier?.hash === 'string';
        return isValid ? parsed : null;
    } catch {
        return null;
    }
};

const assertValidPin = (pin: string): void => {
    if (!/^\d+$/.test(pin) || pin.length !== APP_LOCK_PIN_LENGTH) {
        throw new Error(`PIN must be exactly ${APP_LOCK_PIN_LENGTH} digits.`);
    }
};

const derivePinKey = (pin: string, salt: Uint8Array, iterations: number): Uint8Array => {
    return pbkdf2(sha256, utf8ToBytes(pin), salt, {
        c: iterations,
        dkLen: 32,
    });
};

const concatBytes = (a: Uint8Array, b: Uint8Array): Uint8Array => {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
};

const buildPinVerifierHash = (pinKey: Uint8Array, verifierSalt: Uint8Array): string => {
    return `${APP_LOCK_PIN_VERIFIER_PREFIX}${bytesToHex(sha256(concatBytes(verifierSalt, pinKey)))}`;
};

const parsePinBackoffState = (raw: string | null): PinBackoffState => {
    if (!raw) return { ...DEFAULT_PIN_BACKOFF_STATE };
    try {
        const parsed = JSON.parse(raw) as PinBackoffState;
        return {
            failedAttempts:
                typeof parsed.failedAttempts === 'number' && parsed.failedAttempts > 0
                    ? Math.floor(parsed.failedAttempts)
                    : 0,
            blockedUntil:
                typeof parsed.blockedUntil === 'number' && parsed.blockedUntil > 0
                    ? Math.floor(parsed.blockedUntil)
                    : 0,
        };
    } catch {
        return { ...DEFAULT_PIN_BACKOFF_STATE };
    }
};

const getPinBackoffDelayMs = (failedAttempts: number): number => {
    if (failedAttempts >= 7) return 60_000;
    if (failedAttempts >= 5) return 15_000;
    if (failedAttempts >= 3) return 5_000;
    return 0;
};

const loadPinBackoffState = async (): Promise<PinBackoffState> => {
    if (pinBackoffStateCache) return pinBackoffStateCache;
    const raw = await secureGet(APP_LOCK_PIN_BACKOFF_KEY);
    pinBackoffStateCache = parsePinBackoffState(raw);
    return pinBackoffStateCache;
};

const persistPinBackoffState = async (state: PinBackoffState): Promise<void> => {
    pinBackoffStateCache = state;
    if (state.failedAttempts <= 0 && state.blockedUntil <= 0) {
        await secureDelete(APP_LOCK_PIN_BACKOFF_KEY);
        return;
    }
    await secureSet(APP_LOCK_PIN_BACKOFF_KEY, JSON.stringify(state));
};

const ensurePinBackoffAllowsAttempt = async (): Promise<void> => {
    const state = await loadPinBackoffState();
    const now = Date.now();
    if (state.blockedUntil > now) {
        const waitSeconds = Math.ceil((state.blockedUntil - now) / 1000);
        throw new Error(`Too many failed attempts. Try again in ${waitSeconds}s.`);
    }
};

const registerFailedPinAttempt = async (): Promise<void> => {
    const current = await loadPinBackoffState();
    const failedAttempts = current.failedAttempts + 1;
    const delayMs = getPinBackoffDelayMs(failedAttempts);
    const blockedUntil = delayMs > 0 ? Date.now() + delayMs : 0;
    await persistPinBackoffState({ failedAttempts, blockedUntil });
};

const resetPinBackoffState = async (): Promise<void> => {
    await persistPinBackoffState({ ...DEFAULT_PIN_BACKOFF_STATE });
};

const clearBiometricState = async (): Promise<void> => {
    if (Platform.OS === 'web') return;
    await secureDelete(APP_LOCK_BIOMETRIC_ENABLED_KEY);
    await SecureStore.deleteItemAsync(APP_LOCK_BIOMETRIC_GUARD_KEY);
};

export const getAppLockPinLength = (): number => APP_LOCK_PIN_LENGTH;

export const hasAppLockPinConfigured = async (): Promise<boolean> => {
    if (Platform.OS === 'web') return false;
    const raw = await secureGet(APP_LOCK_BUNDLE_KEY);
    return !!parseBundle(raw);
};

export const configureAppLockPin = async (pin: string): Promise<void> => {
    assertAppLockSupported();
    assertValidPin(pin);
    const kdfSalt = await Crypto.getRandomBytesAsync(16);
    const verifierSalt = await Crypto.getRandomBytesAsync(16);
    const pinKey = derivePinKey(pin, kdfSalt, APP_LOCK_KDF_ITERATIONS);
    const bundle: AppLockBundle = {
        version: 1,
        kdf: {
            name: 'PBKDF2-HMAC-SHA256',
            iterations: APP_LOCK_KDF_ITERATIONS,
            salt: bytesToHex(kdfSalt),
        },
        pin_verifier: {
            name: 'SHA-256',
            salt: bytesToHex(verifierSalt),
            hash: buildPinVerifierHash(pinKey, verifierSalt),
        },
        created_at: new Date().toISOString(),
    };
    await secureSet(APP_LOCK_BUNDLE_KEY, JSON.stringify(bundle));
    await clearBiometricState();
    await resetPinBackoffState();
};

export const verifyAppLockPin = async (pin: string): Promise<void> => {
    assertAppLockSupported();
    assertValidPin(pin);
    const raw = await secureGet(APP_LOCK_BUNDLE_KEY);
    const bundle = parseBundle(raw);
    if (!bundle) {
        throw new Error('App Lock PIN is not configured.');
    }
    await ensurePinBackoffAllowsAttempt();

    const pinKey = derivePinKey(pin, hexToBytes(bundle.kdf.salt), bundle.kdf.iterations);
    const verifierSalt = hexToBytes(bundle.pin_verifier.salt);
    const expectedHash = buildPinVerifierHash(pinKey, verifierSalt);
    if (expectedHash !== bundle.pin_verifier.hash) {
        await registerFailedPinAttempt();
        throw new Error('Incorrect PIN.');
    }

    await resetPinBackoffState();
};

export const changeAppLockPin = async (currentPin: string, newPin: string): Promise<void> => {
    await verifyAppLockPin(currentPin);
    await configureAppLockPin(newPin);
};

export const resetAppLockPin = async (): Promise<void> => {
    pinBackoffStateCache = null;
    if (Platform.OS === 'web') return;
    await secureDelete(APP_LOCK_BUNDLE_KEY);
    await secureDelete(APP_LOCK_PIN_BACKOFF_KEY);
    await clearBiometricState();
};

export const isAppLockBiometricAvailable = (): boolean => {
    if (Platform.OS === 'web') return false;
    try {
        return SecureStore.canUseBiometricAuthentication();
    } catch {
        return false;
    }
};

export const isAppLockBiometricEnabled = async (): Promise<boolean> => {
    if (!isAppLockBiometricAvailable()) return false;
    const value = await secureGet(APP_LOCK_BIOMETRIC_ENABLED_KEY);
    return value === '1';
};

export const setAppLockBiometricEnabled = async (enabled: boolean): Promise<void> => {
    if (!enabled) {
        await clearBiometricState();
        return;
    }

    assertAppLockSupported();
    if (!isAppLockBiometricAvailable()) {
        throw new Error('Biometric authentication is not available on this device.');
    }
    const configured = await hasAppLockPinConfigured();
    if (!configured) {
        throw new Error('Set App Lock PIN before enabling biometrics.');
    }

    const probe = bytesToHex(await Crypto.getRandomBytesAsync(16));
    await SecureStore.setItemAsync(APP_LOCK_BIOMETRIC_GUARD_KEY, probe, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED,
        requireAuthentication: true,
        authenticationPrompt: 'Enable App Lock biometrics',
    });
    await secureSet(APP_LOCK_BIOMETRIC_ENABLED_KEY, '1');
};

export const unlockAppWithBiometrics = async (): Promise<void> => {
    assertAppLockSupported();
    if (!isAppLockBiometricAvailable()) {
        throw new Error('Biometric authentication is not available on this device.');
    }
    const enabled = await isAppLockBiometricEnabled();
    if (!enabled) {
        throw new Error('Biometric unlock is not enabled.');
    }

    const guardValue = await SecureStore.getItemAsync(APP_LOCK_BIOMETRIC_GUARD_KEY, {
        requireAuthentication: true,
        authenticationPrompt: 'Unlock App',
    });
    if (!guardValue) {
        await clearBiometricState();
        throw new Error('Biometric unlock is unavailable. Unlock with PIN and enable biometrics again.');
    }
    await resetPinBackoffState();
};
