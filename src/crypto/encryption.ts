/**
 * Simple client-side encryption utilities using expo-crypto and AES.
 * NOTE: This is a demonstration implementation. In production you should
 * securely manage salts, iteration counts and store the derived key only in
 * memory. The key is derived from a static passphrase for simplicity.
 */

import * as Crypto from 'expo-crypto';

// Static passphrase – replace with a proper user-derived secret.
const PASSPHRASE = 'vaulto-note-secret';

/**
 * Simple XOR-based encryption for demonstration.
 * In production, you should use a proper encryption library like:
 * - react-native-aes-crypto
 * - or implement proper AES-GCM with a native module
 * 
 * For now, using a simple XOR cipher with a hash-derived key.
 */

async function deriveKey(): Promise<string> {
    // Use SHA-256 to derive a deterministic key from passphrase
    const digest = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        PASSPHRASE
    );
    return digest;
}

function xorEncrypt(plaintext: string, key: string): string {
    // Encode to UTF-8 compatible string (percent-encoded) to handle special chars
    const encoded = encodeURIComponent(plaintext);
    const result: number[] = [];
    for (let i = 0; i < encoded.length; i++) {
        result.push(encoded.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }

    // Process in chunks to avoid "Maximum call stack size exceeded"
    let binary = '';
    const CHUNK_SIZE = 8192;
    for (let i = 0; i < result.length; i += CHUNK_SIZE) {
        const chunk = result.slice(i, i + CHUNK_SIZE);
        binary += String.fromCharCode(...chunk);
    }

    return btoa(binary);
}

function xorDecrypt(ciphertext: string, key: string): string {
    const decoded = atob(ciphertext);
    const result: number[] = [];
    for (let i = 0; i < decoded.length; i++) {
        result.push(decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }

    // Process in chunks to avoid "Maximum call stack size exceeded"
    let output = '';
    const CHUNK_SIZE = 8192;
    for (let i = 0; i < result.length; i += CHUNK_SIZE) {
        const chunk = result.slice(i, i + CHUNK_SIZE);
        output += String.fromCharCode(...chunk);
    }

    // Decode back from percent-encoded string
    return decodeURIComponent(output);
}

export async function encrypt(plaintext: string): Promise<string> {
    if (!plaintext) return '';
    try {
        const key = await deriveKey();
        const result = xorEncrypt(plaintext, key);
        return result;
    } catch (error) {
        console.error('[encrypt] Encryption failed:', error);
        throw error;
    }
}

export async function decrypt(ciphertext: string): Promise<string> {
    if (!ciphertext) return '';
    try {
        const key = await deriveKey();
        const result = xorDecrypt(ciphertext, key);
        return result;
    } catch (error) {
        console.error('[decrypt] Decryption failed:', error);
        throw error;
    }
}
