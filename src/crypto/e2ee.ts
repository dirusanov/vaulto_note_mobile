import * as Crypto from 'expo-crypto';
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';

export const PIN_LENGTH = 8;
export const KEY_BUNDLE_VERSION = 2;
export const CIPHER_VERSION = 'v2';
export const DEFAULT_KDF_ITERATIONS = 150_000;

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

const deriveKey = (material: string, salt: Uint8Array, iterations: number): Uint8Array => {
    const materialBytes = utf8ToBytes(material);
    return pbkdf2(sha256, materialBytes, salt, { c: iterations, dkLen: 32 });
};

export const createKeyBundle = async (pin: string): Promise<{ bundle: KeyBundle; masterKey: Uint8Array }> => {
    const newMasterKey = await Crypto.getRandomBytesAsync(32);
    const bundle = await wrapMasterKey(newMasterKey, pin);

    return { bundle, masterKey: newMasterKey };
};

export const wrapMasterKey = async (masterKey: Uint8Array, pin: string): Promise<KeyBundle> => {
    const salt = await Crypto.getRandomBytesAsync(16);
    const nonce = await Crypto.getRandomBytesAsync(24);
    const key = deriveKey(pin, salt, DEFAULT_KDF_ITERATIONS);
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
    };

    return bundle;
};

export const unwrapMasterKey = (bundle: KeyBundle, pin: string): Uint8Array => {
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

    const primary = tryUnwrap(pin, bundle.kdf, bundle.wrap, bundle.wrapped_key);
    if (primary) return primary;
    throw new Error('Invalid PIN');
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
        typeof value.wrapped_key === 'string'
    );
};
