/**
 * Simple client‑side encryption utilities using the Web Crypto API.
 * NOTE: This is a demonstration implementation. In production you should
 * securely manage salts, iteration counts and store the derived key only in
 * memory. The key is derived from a static passphrase for simplicity.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Static passphrase – replace with a proper user‑derived secret.
const PASSPHRASE = 'vaulto-note-secret';
// Fixed salt – in real apps store a random salt per user.
const SALT = encoder.encode('vaulto-note-salt');
const ITERATIONS = 100000;
const KEY_ALGO = 'AES-GCM'; // algorithm name as string
const IV_LENGTH = 12; // 96‑bit IV recommended for GCM

async function deriveKey(): Promise<CryptoKey> {
    const baseKey = await crypto.subtle.importKey(
        'raw',
        encoder.encode(PASSPHRASE),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: SALT,
            iterations: ITERATIONS,
            hash: 'SHA-256',
        },
        baseKey,
        { name: KEY_ALGO, length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

export async function encrypt(plaintext: string): Promise<string> {
    console.log('[encrypt] Encrypting text, length:', plaintext.length);
    const key = await deriveKey();
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const encrypted = await crypto.subtle.encrypt(
        { name: KEY_ALGO, iv },
        key,
        encoder.encode(plaintext)
    );
    // Concatenate IV + ciphertext and encode as base64 for transport.
    const combined = new Uint8Array(iv.byteLength + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.byteLength);
    // Convert to binary string without using spread operator.
    let binary = '';
    combined.forEach(b => { binary += String.fromCharCode(b); });
    const result = btoa(binary);
    console.log('[encrypt] Encrypted successfully, result length:', result.length);
    return result;
}

export async function decrypt(ciphertext: string): Promise<string> {
    console.log('[decrypt] Decrypting text, length:', ciphertext.length);
    const key = await deriveKey();
    const data = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
    const iv = data.slice(0, IV_LENGTH);
    const enc = data.slice(IV_LENGTH);
    const decrypted = await crypto.subtle.decrypt(
        { name: KEY_ALGO, iv },
        key,
        enc
    );
    const result = decoder.decode(decrypted);
    console.log('[decrypt] Decrypted successfully, result length:', result.length);
    return result;
}
