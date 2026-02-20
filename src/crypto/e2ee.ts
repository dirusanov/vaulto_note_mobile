import * as Crypto from 'expo-crypto';
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';

export const KEY_BUNDLE_VERSION = 2;
export const CIPHER_VERSION = 'v2';
export const DEFAULT_KDF_ITERATIONS = 150_000;
export const PASSPHRASE_MIN_LENGTH = 12;
export const PASSPHRASE_MIN_WORDS = 3;
const INVISIBLE_CHARS_REGEX = /[\u200B-\u200D\uFEFF]/g;

// PIN-based wrapping was removed; keep legacy 'pin' only for backward compatibility
// when parsing old key bundles from storage/server.
export type SecretMode = 'passphrase';
export type KeyBundleSecretMode = SecretMode | 'pin';

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
    secret_mode?: KeyBundleSecretMode;
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

export const getSecretValidationError = (
    secret: string,
    _mode: SecretMode,
): string | null => {
    const normalized = secret.trim();
    if (!normalized) {
        return 'Passphrase is required.';
    }

    return isValidPassphrase(normalized)
        ? null
        : `Passphrase must be at least ${PASSPHRASE_MIN_LENGTH}+ characters or ${PASSPHRASE_MIN_WORDS}+ words.`;
};

export const normalizeSecretInput = (secret: string, mode: SecretMode): string => {
    const cleaned = secret.replace(INVISIBLE_CHARS_REGEX, '').normalize('NFKC');
    if (mode === 'passphrase') {
        return cleaned.trim().replace(/\s+/g, ' ');
    }
    return cleaned.trim();
};

const deriveKey = (
    material: string,
    salt: Uint8Array,
    iterations: number,
): Uint8Array => {
    const materialBytes = utf8ToBytes(material);
    return pbkdf2(sha256, materialBytes, salt, { c: iterations, dkLen: 32 });
};

export const createKeyBundle = async (
    secret: string,
    mode: SecretMode = 'passphrase',
): Promise<{ bundle: KeyBundle; masterKey: Uint8Array }> => {
    const newMasterKey = await Crypto.getRandomBytesAsync(32);
    const bundle = await wrapMasterKey(newMasterKey, secret, mode);

    return { bundle, masterKey: newMasterKey };
};

export const wrapMasterKey = async (
    masterKey: Uint8Array,
    secret: string,
    mode: SecretMode = 'passphrase',
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
    const candidates = new Set<string>();
    const addCandidate = (value: string) => {
        if (value) {
            candidates.add(value);
        }
    };
    addCandidate(secret);
    addCandidate(secret.trim());
    addCandidate(normalizeSecretInput(secret, 'passphrase'));

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
            value.secret_mode === 'passphrase' ||
            value.secret_mode === 'pin')
    );
};
