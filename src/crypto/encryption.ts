import * as Crypto from 'expo-crypto';
import { bytesToHex, bytesToUtf8, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { CIPHER_VERSION, getMasterKey, hasMasterKey } from './e2ee';
import { storage, CryptoMode } from '../utils/storage';

const LEGACY_PASSPHRASE = 'vaulto-note-secret';
export const V2_MASTER_PREFIX = `${CIPHER_VERSION}m.`;
export const V2_DEVICE_PREFIX = `${CIPHER_VERSION}d.`;
export const V2_COMPAT_PREFIX = `${CIPHER_VERSION}.`;

let cryptoMode: CryptoMode = 'local';
let cachedDeviceKey: Uint8Array | null = null;

export const setCryptoMode = (mode: CryptoMode) => {
    cryptoMode = mode;
};

export const getCryptoMode = () => cryptoMode;

const deriveLegacyKey = async (): Promise<string> => {
    const digest = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        LEGACY_PASSPHRASE
    );
    return digest;
};

const xorEncrypt = (plaintext: string, key: string): string => {
    const encoded = encodeURIComponent(plaintext);
    const result: number[] = [];
    for (let i = 0; i < encoded.length; i++) {
        result.push(encoded.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }

    let binary = '';
    const CHUNK_SIZE = 8192;
    for (let i = 0; i < result.length; i += CHUNK_SIZE) {
        const chunk = result.slice(i, i + CHUNK_SIZE);
        binary += String.fromCharCode(...chunk);
    }

    return btoa(binary);
};

const xorDecrypt = (ciphertext: string, key: string): string => {
    const decoded = atob(ciphertext);
    const result: number[] = [];
    for (let i = 0; i < decoded.length; i++) {
        result.push(decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }

    let output = '';
    const CHUNK_SIZE = 8192;
    for (let i = 0; i < result.length; i += CHUNK_SIZE) {
        const chunk = result.slice(i, i + CHUNK_SIZE);
        output += String.fromCharCode(...chunk);
    }

    return decodeURIComponent(output);
};

const getOrCreateDeviceKey = async (): Promise<Uint8Array> => {
    if (cachedDeviceKey) return cachedDeviceKey;
    const existing = await storage.getDeviceKey();
    if (existing) {
        cachedDeviceKey = hexToBytes(existing);
        return cachedDeviceKey;
    }
    const randomKey = await Crypto.getRandomBytesAsync(32);
    const hex = bytesToHex(randomKey);
    await storage.setDeviceKey(hex);
    cachedDeviceKey = randomKey;
    return randomKey;
};

const encryptWithKey = async (plaintext: string, key: Uint8Array, prefix: string): Promise<string> => {
    const nonce = await Crypto.getRandomBytesAsync(24);
    const cipher = xchacha20poly1305(key, nonce);
    const encrypted = cipher.encrypt(utf8ToBytes(plaintext));
    return `${prefix}${bytesToHex(nonce)}.${bytesToHex(encrypted)}`;
};

const decryptWithKey = (ciphertext: string, key: Uint8Array, prefix: string): string => {
    const payload = ciphertext.slice(prefix.length);
    const [nonceHex, dataHex] = payload.split('.');
    if (!nonceHex || !dataHex) {
        throw new Error('Invalid ciphertext format');
    }
    const nonce = hexToBytes(nonceHex);
    const data = hexToBytes(dataHex);
    const cipher = xchacha20poly1305(key, nonce);
    const decrypted = cipher.decrypt(data);
    if (!decrypted) {
        throw new Error('Invalid ciphertext');
    }
    return bytesToUtf8(decrypted);
};

export const isMasterCiphertext = (ciphertext: string): boolean => {
    return ciphertext.startsWith(V2_MASTER_PREFIX) || ciphertext.startsWith(V2_COMPAT_PREFIX);
};

export const isDeviceCiphertext = (ciphertext: string): boolean => {
    return ciphertext.startsWith(V2_DEVICE_PREFIX);
};

export const isV2Ciphertext = (ciphertext: string): boolean => {
    return isMasterCiphertext(ciphertext) || isDeviceCiphertext(ciphertext);
};

export async function encrypt(plaintext: string): Promise<string> {
    if (!plaintext) return '';
    try {
        const deviceKey = await getOrCreateDeviceKey();
        return await encryptWithKey(plaintext, deviceKey, V2_DEVICE_PREFIX);
    } catch (error) {
        console.error('[encrypt] Encryption failed:', error);
        throw error;
    }
}

export async function encryptForSync(plaintext: string): Promise<string> {
    if (!plaintext) return '';
    if (!hasMasterKey()) {
        throw new Error('E2EE locked');
    }
    const masterKey = getMasterKey();
    if (!masterKey) {
        throw new Error('Master key missing');
    }
    return await encryptWithKey(plaintext, masterKey, V2_MASTER_PREFIX);
}

export async function decrypt(ciphertext: string): Promise<string> {
    if (!ciphertext) return '';
    try {
        if (ciphertext.startsWith(V2_MASTER_PREFIX) || ciphertext.startsWith(V2_COMPAT_PREFIX)) {
            if (!hasMasterKey()) {
                throw new Error('E2EE locked');
            }
            const masterKey = getMasterKey();
            if (!masterKey) {
                throw new Error('Master key missing');
            }
            const prefix = ciphertext.startsWith(V2_MASTER_PREFIX) ? V2_MASTER_PREFIX : V2_COMPAT_PREFIX;
            return decryptWithKey(ciphertext, masterKey, prefix);
        }

        if (ciphertext.startsWith(V2_DEVICE_PREFIX)) {
            const deviceKey = await getOrCreateDeviceKey();
            return decryptWithKey(ciphertext, deviceKey, V2_DEVICE_PREFIX);
        }

        const key = await deriveLegacyKey();
        return xorDecrypt(ciphertext, key);
    } catch (error) {
        console.error('[decrypt] Decryption failed:', error);
        throw error;
    }
}

export async function decryptFromSync(ciphertext: string): Promise<string> {
    if (!ciphertext) return '';
    if (!hasMasterKey()) {
        throw new Error('E2EE locked');
    }
    const masterKey = getMasterKey();
    if (!masterKey) {
        throw new Error('Master key missing');
    }
    if (ciphertext.startsWith(V2_MASTER_PREFIX) || ciphertext.startsWith(V2_COMPAT_PREFIX)) {
        const prefix = ciphertext.startsWith(V2_MASTER_PREFIX) ? V2_MASTER_PREFIX : V2_COMPAT_PREFIX;
        return decryptWithKey(ciphertext, masterKey, prefix);
    }
    // Fallback for legacy/invalid data.
    return await decrypt(ciphertext);
}
