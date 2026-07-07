import * as Crypto from 'expo-crypto';
import { base64 } from '@scure/base';
import { bytesToHex, bytesToUtf8, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { gcm } from '@noble/ciphers/aes';
import { getMasterKey, hasMasterKey } from './e2ee';
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

// ---------------------------------------------------------------------------
// Binary audio encryption for sync (E2EE accounts).
//
// Text notes travel as hex-encoded `v3m.` strings; audio blobs are too large
// for hex doubling, so they use a compact binary framing that is uploaded to
// object storage as raw bytes: magic 'VAE1' (4) || nonce (12) || AES-256-GCM
// ciphertext. Base64 is only used at the JS boundary because React Native file
// APIs exchange binary data as base64 strings.
// ---------------------------------------------------------------------------

export const AUDIO_E2EE_MAGIC = 'VAE1';
const AUDIO_MAGIC_BYTES = utf8ToBytes(AUDIO_E2EE_MAGIC);
const AUDIO_NONCE_SIZE = 12;

const hasAudioMagic = (raw: Uint8Array): boolean => {
    if (raw.length < AUDIO_MAGIC_BYTES.length + AUDIO_NONCE_SIZE + 16) return false;
    for (let i = 0; i < AUDIO_MAGIC_BYTES.length; i++) {
        if (raw[i] !== AUDIO_MAGIC_BYTES[i]) return false;
    }
    return true;
};

/** Encrypts plaintext audio (base64 of the m4a bytes) with the master key. */
export async function encryptAudioBase64ForSync(plainBase64: string): Promise<string> {
    const masterKey = getMasterKey();
    if (!masterKey) throw new Error('E2EE locked');
    const data = base64.decode(plainBase64);
    const nonce = await Crypto.getRandomBytesAsync(AUDIO_NONCE_SIZE);
    const ciphertext = gcm(masterKey, nonce).encrypt(data);
    const framed = new Uint8Array(AUDIO_MAGIC_BYTES.length + AUDIO_NONCE_SIZE + ciphertext.length);
    framed.set(AUDIO_MAGIC_BYTES, 0);
    framed.set(nonce, AUDIO_MAGIC_BYTES.length);
    framed.set(ciphertext, AUDIO_MAGIC_BYTES.length + AUDIO_NONCE_SIZE);
    return base64.encode(framed);
}

/**
 * Decrypts a downloaded audio payload (base64 of the stored bytes) back to the
 * base64 of the plain m4a. Payloads without the VAE1 magic are plaintext audio
 * from a non-encrypted account and pass through unchanged.
 */
export function decryptAudioBase64FromSync(payloadBase64: string): string {
    const raw = base64.decode(payloadBase64);
    if (!hasAudioMagic(raw)) {
        return payloadBase64;
    }
    const masterKey = getMasterKey();
    if (!masterKey) throw new Error('E2EE locked');
    const nonce = raw.subarray(AUDIO_MAGIC_BYTES.length, AUDIO_MAGIC_BYTES.length + AUDIO_NONCE_SIZE);
    const ciphertext = raw.subarray(AUDIO_MAGIC_BYTES.length + AUDIO_NONCE_SIZE);
    const plain = gcm(masterKey, nonce).decrypt(ciphertext);
    if (!plain) throw new Error('Invalid ciphertext');
    return base64.encode(plain);
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
