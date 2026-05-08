import * as Crypto from 'expo-crypto';
import { bytesToHex, bytesToUtf8, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { gcm } from '@noble/ciphers/aes';
import { CIPHER_VERSION, getMasterKey, hasMasterKey } from './e2ee';
import { storage, CryptoMode } from '../utils/storage';

export const V3_MASTER_PREFIX = 'v3m.';
export const V3_DEVICE_PREFIX = 'v3d.';
export const V3_COMPAT_PREFIX = 'v3.';

export const V2_MASTER_PREFIX = 'v2m.';
export const V2_DEVICE_PREFIX = 'v2d.';
export const V2_COMPAT_PREFIX = 'v2.';

let cryptoMode: CryptoMode = 'local';
let cachedDeviceKey: Uint8Array | null = null;

export const setCryptoMode = (mode: CryptoMode) => {
    cryptoMode = mode;
};

export const getCryptoMode = () => cryptoMode;

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
    const isV3 = prefix.startsWith('v3');
    const nonceSize = isV3 ? 12 : 24;
    const nonce = await Crypto.getRandomBytesAsync(nonceSize);
    
    let encrypted: Uint8Array;
    if (isV3) {
        const cipher = gcm(key, nonce);
        encrypted = cipher.encrypt(utf8ToBytes(plaintext));
    } else {
        const cipher = xchacha20poly1305(key, nonce);
        encrypted = cipher.encrypt(utf8ToBytes(plaintext));
    }
    
    return `${prefix}${bytesToHex(nonce)}.${bytesToHex(encrypted)}`;
};

const decryptWithKey = (ciphertext: string, key: Uint8Array, prefix: string): string => {
    const isV3 = prefix.startsWith('v3');
    const payload = ciphertext.slice(prefix.length);
    const [nonceHex, dataHex] = payload.split('.');
    if (!nonceHex || !dataHex) {
        throw new Error('Invalid ciphertext format');
    }
    const nonce = hexToBytes(nonceHex);
    const data = hexToBytes(dataHex);
    
    let decrypted: Uint8Array | null;
    if (isV3) {
        const cipher = gcm(key, nonce);
        decrypted = cipher.decrypt(data);
    } else {
        const cipher = xchacha20poly1305(key, nonce);
        decrypted = cipher.decrypt(data);
    }
    
    if (!decrypted) {
        throw new Error('Invalid ciphertext');
    }
    return bytesToUtf8(decrypted);
};

export const isMasterCiphertext = (ciphertext: string): boolean => {
    // Explicitly exclude device-encrypted notes which are NOT master-encrypted
    if (isDeviceCiphertext(ciphertext)) return false;
    
    return (
        ciphertext.startsWith(V3_MASTER_PREFIX) || 
        ciphertext.startsWith(V3_COMPAT_PREFIX) ||
        ciphertext.startsWith(V2_MASTER_PREFIX) || 
        ciphertext.startsWith(V2_COMPAT_PREFIX)
    );
};

export const isDeviceCiphertext = (ciphertext: string): boolean => {
    return ciphertext.startsWith(V3_DEVICE_PREFIX) || ciphertext.startsWith(V2_DEVICE_PREFIX);
};

export const isV3Ciphertext = (ciphertext: string): boolean => {
    return ciphertext.startsWith(V3_MASTER_PREFIX) || ciphertext.startsWith(V3_DEVICE_PREFIX) || ciphertext.startsWith(V3_COMPAT_PREFIX);
};

export const isV2Ciphertext = (ciphertext: string): boolean => {
    return ciphertext.startsWith(V2_MASTER_PREFIX) || ciphertext.startsWith(V2_DEVICE_PREFIX) || ciphertext.startsWith(V2_COMPAT_PREFIX);
};

export async function encrypt(plaintext: string): Promise<string> {
    if (!plaintext) return '';
    try {
        if (cryptoMode === 'e2ee') {
            if (!hasMasterKey()) {
                // If locked, we fall back to device encryption for safety, 
                // OR we could throw. But for local DB, device encryption is better than plaintext.
                const deviceKey = await getOrCreateDeviceKey();
                return await encryptWithKey(plaintext, deviceKey, V3_DEVICE_PREFIX);
            }
            const masterKey = getMasterKey();
            if (!masterKey) throw new Error('Master key missing');
            return await encryptWithKey(plaintext, masterKey, V3_MASTER_PREFIX);
        }

        // Default: Device-local encryption
        const deviceKey = await getOrCreateDeviceKey();
        return await encryptWithKey(plaintext, deviceKey, V3_DEVICE_PREFIX);
    } catch (error) {
        console.error('[encrypt] Encryption failed:', error);
        throw error;
    }
}

export async function encryptForSync(plaintext: string): Promise<string> {
    if (!plaintext) return '';
    if (cryptoMode === 'local') {
        return plaintext;
    }
    if (!hasMasterKey()) {
        throw new Error('E2EE locked');
    }
    const masterKey = getMasterKey();
    if (!masterKey) {
        throw new Error('Master key missing');
    }
    return await encryptWithKey(plaintext, masterKey, V3_MASTER_PREFIX);
}

export async function decrypt(ciphertext: string): Promise<string> {
    if (!ciphertext) return '';
    try {
        if (ciphertext.startsWith(V3_MASTER_PREFIX) || ciphertext.startsWith(V3_COMPAT_PREFIX)) {
            const masterKey = getMasterKey();
            if (!masterKey) throw new Error('E2EE locked');
            const prefix = ciphertext.startsWith(V3_MASTER_PREFIX) ? V3_MASTER_PREFIX : V3_COMPAT_PREFIX;
            return decryptWithKey(ciphertext, masterKey, prefix);
        }
        
        if (ciphertext.startsWith(V2_MASTER_PREFIX) || ciphertext.startsWith(V2_COMPAT_PREFIX)) {
            const masterKey = getMasterKey();
            if (!masterKey) throw new Error('E2EE locked');
            const prefix = ciphertext.startsWith(V2_MASTER_PREFIX) ? V2_MASTER_PREFIX : V2_COMPAT_PREFIX;
            return decryptWithKey(ciphertext, masterKey, prefix);
        }

        if (ciphertext.startsWith(V3_DEVICE_PREFIX)) {
            const deviceKey = await getOrCreateDeviceKey();
            return decryptWithKey(ciphertext, deviceKey, V3_DEVICE_PREFIX);
        }

        if (ciphertext.startsWith(V2_DEVICE_PREFIX)) {
            const deviceKey = await getOrCreateDeviceKey();
            return decryptWithKey(ciphertext, deviceKey, V2_DEVICE_PREFIX);
        }

        // If it doesn't match any known encrypted format, treat as plaintext (legacy).
        return ciphertext;
    } catch (error: any) {
        const message = (error?.message || '').toLowerCase();
        const isExpected = 
            message === 'e2ee locked' || 
            message.includes('invalid tag') || 
            message.includes('ghash tag') ||
            message.includes('invalid ciphertext');

        if (!isExpected) {
            console.error('[decrypt] Decryption failed:', error);
        }
        throw error;
    }
}

export async function decryptFromSync(ciphertext: string): Promise<string> {
    if (!ciphertext) return '';
    
    // Always try full decrypt first — it handles all prefixes (v3m, v3d, v2m, v2d)
    // and falls back to returning plaintext for unrecognized formats.
    // This correctly handles the case where mode switched to 'local' but the server
    // still has old E2EE-encrypted data (v3m. prefix).
    try {
        return await decrypt(ciphertext);
    } catch (error: any) {
        // If master key is missing but the ciphertext is E2EE-encrypted,
        // we cannot decrypt it — propagate the error so the caller can skip it.
        if (
            error?.message === 'E2EE locked' ||
            error?.message === 'Master key missing'
        ) {
            // In local mode with no master key, if ciphertext is a known plaintext-looking
            // string (no encryption prefix), return it as-is.
            if (
                !ciphertext.startsWith(V3_MASTER_PREFIX) &&
                !ciphertext.startsWith(V3_COMPAT_PREFIX) &&
                !ciphertext.startsWith(V2_MASTER_PREFIX) &&
                !ciphertext.startsWith(V2_COMPAT_PREFIX) &&
                !ciphertext.startsWith(V3_DEVICE_PREFIX) &&
                !ciphertext.startsWith(V2_DEVICE_PREFIX)
            ) {
                // Looks like plaintext
                return ciphertext;
            }
            throw error;
        }
        // Unsupported format — treat as legacy plaintext
        if (error?.message === 'Unsupported ciphertext format.') {
            return ciphertext;
        }
        throw error;
    }
}

