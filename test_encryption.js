const { webcrypto } = require('node:crypto');
if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const PASSPHRASE = 'vaulto-note-secret';
const SALT = encoder.encode('vaulto-note-salt');
const ITERATIONS = 100000;
const KEY_ALGO = 'AES-GCM';
const IV_LENGTH = 12;

async function deriveKey() {
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

async function encrypt(plaintext) {
    const key = await deriveKey();
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const encrypted = await crypto.subtle.encrypt(
        { name: KEY_ALGO, iv },
        key,
        encoder.encode(plaintext)
    );
    const combined = new Uint8Array(iv.byteLength + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.byteLength);
    let binary = '';
    combined.forEach(b => { binary += String.fromCharCode(b); });
    return btoa(binary);
}

async function decrypt(ciphertext) {
    const key = await deriveKey();
    const data = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
    const iv = data.slice(0, IV_LENGTH);
    const enc = data.slice(IV_LENGTH);
    const decrypted = await crypto.subtle.decrypt(
        { name: KEY_ALGO, iv },
        key,
        enc
    );
    return decoder.decode(decrypted);
}

(async () => {
    try {
        const original = "Secret Note Content";
        console.log("Original:", original);
        const encrypted = await encrypt(original);
        console.log("Encrypted:", encrypted);
        const decrypted = await decrypt(encrypted);
        console.log("Decrypted:", decrypted);

        if (original === decrypted) {
            console.log("SUCCESS: Encryption/Decryption works");
        } else {
            console.log("FAILURE: Decrypted text does not match");
        }
    } catch (e) {
        console.error("ERROR:", e);
    }
})();
