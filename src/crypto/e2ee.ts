import * as Crypto from 'expo-crypto';
import { pbkdf2, pbkdf2Async } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { isValidMnemonic, normalizeMnemonic } from './bip39';

export const PIN_LENGTH = 8;
export const KEY_BUNDLE_VERSION = 2;
export const CIPHER_VERSION = 'v2';
export const DEFAULT_KDF_ITERATIONS = 150_000;
export const PASSPHRASE_MIN_LENGTH = 12;
export const PASSPHRASE_MIN_WORDS = 3;
export const SEED_PHRASE_WORDS = 12;
const INVISIBLE_CHARS_REGEX = /[\u200B-\u200D\uFEFF]/g;
const STRICT_SEED_KDF_ITERATIONS = 300_000;
const STRICT_SEED_DOMAIN_SALT = utf8ToBytes('vaulto.strict-seed.master-key.v1');
const STRICT_SEED_ASYNC_TICK_MS = 1;

export type SecretMode = 'pin' | 'passphrase' | 'seed_phrase';

export type KeyBundleKdf = {
    name: 'PBKDF2-HMAC-SHA256';
    iterations: number;
    salt: string; // hex
};

export type KeyBundleWrap = {
    name: 'XChaCha20-Poly1305';
    nonce: string; // hex
};

export type KeyBundle = {
    version: number;
    kdf: KeyBundleKdf;
    wrap: KeyBundleWrap;
    wrapped_key: string; // hex
    created_at: string;
    secret_mode?: SecretMode;
};

let masterKey: Uint8Array | null = null;

export const setMasterKey = (key: Uint8Array | null) => {
    masterKey = key;
};

export const getMasterKey = () => masterKey;

export const hasMasterKey = () => masterKey !== null;

export const clearMasterKey = () => {
    masterKey = null;
};

export const isValidPin = (pin: string): boolean => {
    return /^\d{8}$/.test(pin);
};

const countPassphraseWords = (passphrase: string): number => {
    return passphrase
        .trim()
        .split(/\s+/)
        .filter((word) => word.length >= 2)
        .length;
};

export const isValidPassphrase = (passphrase: string): boolean => {
    const normalized = passphrase.trim();
    if (!normalized) return false;
    return (
        normalized.length >= PASSPHRASE_MIN_LENGTH ||
        countPassphraseWords(normalized) >= PASSPHRASE_MIN_WORDS
    );
};

export const isValidSeedPhrase = (seedPhrase: string): boolean => {
    return isValidMnemonic(normalizeMnemonic(seedPhrase));
};

export const getSecretValidationError = (
    secret: string,
    mode: SecretMode,
): string | null => {
    const normalized = mode === 'seed_phrase'
        ? normalizeMnemonic(secret)
        : secret.trim();
    if (!normalized) {
        if (mode === 'pin') return 'PIN is required.';
        if (mode === 'seed_phrase') return 'Seed phrase is required.';
        return 'Passphrase is required.';
    }

    if (mode === 'pin') {
        return isValidPin(normalized)
            ? null
            : `PIN must be exactly ${PIN_LENGTH} digits.`;
    }

    if (mode === 'seed_phrase') {
        return isValidSeedPhrase(normalized)
            ? null
            : `Seed phrase must be a valid BIP39 phrase (${SEED_PHRASE_WORDS} words by default).`;
    }

    return isValidPassphrase(normalized)
        ? null
        : `Passphrase must be at least ${PASSPHRASE_MIN_LENGTH}+ characters or ${PASSPHRASE_MIN_WORDS}+ words.`;
};

export const normalizeSecretInput = (secret: string, mode: SecretMode): string => {
    const cleaned = secret.replace(INVISIBLE_CHARS_REGEX, '').normalize('NFKC');
    if (mode === 'seed_phrase') {
        return normalizeMnemonic(cleaned);
    }
    if (mode === 'passphrase') {
        return cleaned.trim().replace(/\s+/g, ' ');
    }
    return cleaned.trim();
};

const deriveKey = (material: string, salt: Uint8Array, iterations: number): Uint8Array => {
    const materialBytes = utf8ToBytes(material);
    return pbkdf2(sha256, materialBytes, salt, { c: iterations, dkLen: 32 });
};

export const deriveMasterKeyFromSeed = (seedPhrase: string): Uint8Array => {
    const normalizedSeed = normalizeSecretInput(seedPhrase, 'seed_phrase');
    const validationError = getSecretValidationError(normalizedSeed, 'seed_phrase');
    if (validationError) {
        throw new Error(validationError);
    }
    return deriveKey(normalizedSeed, STRICT_SEED_DOMAIN_SALT, STRICT_SEED_KDF_ITERATIONS);
};

export const deriveMasterKeyFromSeedAsync = async (seedPhrase: string): Promise<Uint8Array> => {
    const normalizedSeed = normalizeSecretInput(seedPhrase, 'seed_phrase');
    const validationError = getSecretValidationError(normalizedSeed, 'seed_phrase');
    if (validationError) {
        throw new Error(validationError);
    }
    const materialBytes = utf8ToBytes(normalizedSeed);
    return await pbkdf2Async(sha256, materialBytes, STRICT_SEED_DOMAIN_SALT, {
        c: STRICT_SEED_KDF_ITERATIONS,
        dkLen: 32,
        asyncTick: STRICT_SEED_ASYNC_TICK_MS,
    });
};

export const createKeyBundle = async (
    secret: string,
    mode: SecretMode = 'pin',
): Promise<{ bundle: KeyBundle; masterKey: Uint8Array }> => {
    const newMasterKey = await Crypto.getRandomBytesAsync(32);
    const bundle = await wrapMasterKey(newMasterKey, secret, mode);

    return { bundle, masterKey: newMasterKey };
};

export const wrapMasterKey = async (
    masterKey: Uint8Array,
    secret: string,
    mode: SecretMode = 'pin',
): Promise<KeyBundle> => {
    const salt = await Crypto.getRandomBytesAsync(16);
    const nonce = await Crypto.getRandomBytesAsync(24);
    const key = deriveKey(secret, salt, DEFAULT_KDF_ITERATIONS);
    const cipher = xchacha20poly1305(key, nonce);
    const wrappedKey = cipher.encrypt(masterKey);

    const bundle: KeyBundle = {
        version: KEY_BUNDLE_VERSION,
        kdf: {
            name: 'PBKDF2-HMAC-SHA256',
            iterations: DEFAULT_KDF_ITERATIONS,
            salt: bytesToHex(salt),
        },
        wrap: {
            name: 'XChaCha20-Poly1305',
            nonce: bytesToHex(nonce),
        },
        wrapped_key: bytesToHex(wrappedKey),
        created_at: new Date().toISOString(),
        secret_mode: mode,
    };

    return bundle;
};

export const unwrapMasterKey = (bundle: KeyBundle, secret: string): Uint8Array => {
    const mode = bundle.secret_mode;
    const candidates = new Set<string>();
    const addCandidate = (value: string) => {
        if (value) {
            candidates.add(value);
        }
    };
    addCandidate(secret);
    addCandidate(secret.trim());
    if (mode === 'passphrase') {
        addCandidate(normalizeSecretInput(secret, 'passphrase'));
    } else if (mode === 'seed_phrase') {
        addCandidate(normalizeSecretInput(secret, 'seed_phrase'));
    }

    const tryUnwrap = (material: string, kdf: KeyBundleKdf, wrap: KeyBundleWrap, wrappedKeyHex: string): Uint8Array | null => {
        try {
            const derived = deriveKey(material, hexToBytes(kdf.salt), kdf.iterations);
            const cipher = xchacha20poly1305(derived, hexToBytes(wrap.nonce));
            const unwrapped = cipher.decrypt(hexToBytes(wrappedKeyHex));
            return unwrapped || null;
        } catch (_) {
            return null;
        }
    };

    for (const candidate of candidates) {
        const unwrapped = tryUnwrap(candidate, bundle.kdf, bundle.wrap, bundle.wrapped_key);
        if (unwrapped) return unwrapped;
    }
    throw new Error('Invalid access key');
};

export const isKeyBundle = (value: any): value is KeyBundle => {
    if (!value || typeof value !== 'object') return false;
    return (
        typeof value.version === 'number' &&
        value.kdf &&
        value.wrap &&
        typeof value.kdf.iterations === 'number' &&
        typeof value.kdf.salt === 'string' &&
        typeof value.wrap.nonce === 'string' &&
        typeof value.wrapped_key === 'string' &&
        (value.secret_mode === undefined ||
            value.secret_mode === 'pin' ||
            value.secret_mode === 'passphrase' ||
            value.secret_mode === 'seed_phrase')
    );
};
