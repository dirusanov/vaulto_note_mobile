import * as Crypto from 'expo-crypto';
import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { hmac } from '@noble/hashes/hmac';
import { bytesToHex, clean, createView, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { gcm } from '@noble/ciphers/aes';

export const KEY_BUNDLE_VERSION = 3;
export const CIPHER_VERSION = 'v3';
export const DEFAULT_KDF_ITERATIONS = 150_000;
export const PASSPHRASE_MIN_LENGTH = 12;
export const PASSPHRASE_MIN_WORDS = 3;
const INVISIBLE_CHARS_REGEX = /[\u200B-\u200D\uFEFF]/g;
const KDF_ASYNC_TICK_MS = 24;

export type KdfProgressCallback = (progress: number) => void;

// PIN-based wrapping was removed; keep legacy 'pin' only for backward compatibility
// when parsing old key bundles from storage/server.
export type SecretMode = 'passphrase' | 'recovery_code';
export type KeyBundleSecretMode = SecretMode | 'pin';

export type KeyBundleKdf = {
    name: 'PBKDF2-HMAC-SHA256';
    iterations: number;
    salt: string; // hex
};

export type KeyBundleWrap = {
    name: 'AES-256-GCM' | 'XChaCha20-Poly1305';
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

// Recovery Code (Mnemonic) Helpers
export const generateRecoveryCode = async (): Promise<string> => {
    const entropy = await Crypto.getRandomBytesAsync(32);
    return bip39.entropyToMnemonic(entropy, wordlist);
};

export const masterKeyFromRecoveryCode = (recoveryCode: string): Uint8Array => {
    const normalized = recoveryCode.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!bip39.validateMnemonic(normalized, wordlist)) {
        throw new Error('Invalid recovery code format');
    }
    return bip39.mnemonicToEntropy(normalized, wordlist);
};

export const recoveryCodeFromMasterKey = (key: Uint8Array): string => {
    return bip39.entropyToMnemonic(key, wordlist);
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
    mode: SecretMode,
): string | null => {
    const normalized = secret.trim();
    if (!normalized) {
        return mode === 'recovery_code' ? 'Recovery code is required.' : 'Passphrase is required.';
    }

    if (mode === 'recovery_code') {
        return bip39.validateMnemonic(normalized.toLowerCase(), wordlist)
            ? null
            : 'Invalid recovery code. Please check for typos.';
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
    if (mode === 'recovery_code') {
        return cleaned.trim().toLowerCase().replace(/\s+/g, ' ');
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

const yieldToUi = () => new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
});

const deriveKeyAsync = async (
    material: string,
    salt: Uint8Array,
    iterations: number,
    onProgress?: KdfProgressCallback,
): Promise<Uint8Array> => {
    const materialBytes = utf8ToBytes(material);
    const dkLen = 32;
    const derivedKey = new Uint8Array(dkLen);
    const prf = hmac.create(sha256, materialBytes);
    const prfSalt = prf._cloneInto().update(salt);
    let prfWorking: ReturnType<typeof hmac.create> | undefined;
    const arr = new Uint8Array(4);
    const view = createView(arr);
    const u = new Uint8Array(prf.outputLen);
    const blocks = Math.ceil(dkLen / prf.outputLen);
    const totalInnerIterations = Math.max(1, blocks * Math.max(1, iterations - 1));
    let completedInnerIterations = 0;
    let lastYieldAt = Date.now();
    let lastReportedStep = -1;

    const report = () => {
        if (!onProgress) return;
        const progress = Math.max(0, Math.min(1, completedInnerIterations / totalInnerIterations));
        const step = Math.floor(progress * 200);
        if (step !== lastReportedStep) {
            lastReportedStep = step;
            onProgress(progress);
        }
    };

    try {
        for (let ti = 1, pos = 0; pos < dkLen; ti++, pos += prf.outputLen) {
            const target = derivedKey.subarray(pos, pos + prf.outputLen);
            view.setInt32(0, ti, false);
            (prfWorking = prfSalt._cloneInto(prfWorking)).update(arr).digestInto(u);
            target.set(u.subarray(0, target.length));

            for (let ui = 1; ui < iterations; ui++) {
                prf._cloneInto(prfWorking).update(u).digestInto(u);
                for (let i = 0; i < target.length; i++) {
                    target[i] ^= u[i];
                }
                completedInnerIterations++;
                report();

                const elapsed = Date.now() - lastYieldAt;
                if (elapsed >= KDF_ASYNC_TICK_MS || elapsed < 0) {
                    await yieldToUi();
                    lastYieldAt = Date.now();
                }
            }
        }

        completedInnerIterations = totalInnerIterations;
        report();
        return derivedKey;
    } finally {
        prf.destroy();
        prfSalt.destroy();
        prfWorking?.destroy();
        clean(u, arr);
    }
};

export const createKeyBundle = async (
    secret: string,
    mode: SecretMode = 'passphrase',
    onKdfProgress?: KdfProgressCallback,
): Promise<{ bundle: KeyBundle; masterKey: Uint8Array }> => {
    const newMasterKey = await Crypto.getRandomBytesAsync(32);
    const bundle = await wrapMasterKey(newMasterKey, secret, mode, onKdfProgress);

    return { bundle, masterKey: newMasterKey };
};

export const wrapMasterKey = async (
    masterKey: Uint8Array,
    secret: string,
    mode: SecretMode = 'passphrase',
    onKdfProgress?: KdfProgressCallback,
): Promise<KeyBundle> => {
    const salt = await Crypto.getRandomBytesAsync(16);
    const nonce = await Crypto.getRandomBytesAsync(12); // 12 bytes is standard for GCM
    const key = await deriveKeyAsync(secret, salt, DEFAULT_KDF_ITERATIONS, onKdfProgress);
    const cipher = gcm(key, nonce);
    const wrappedKey = cipher.encrypt(masterKey);

    const bundle: KeyBundle = {
        version: KEY_BUNDLE_VERSION,
        kdf: {
            name: 'PBKDF2-HMAC-SHA256',
            iterations: DEFAULT_KDF_ITERATIONS,
            salt: bytesToHex(salt),
        },
        wrap: {
            name: 'AES-256-GCM',
            nonce: bytesToHex(nonce),
        },
        wrapped_key: bytesToHex(wrappedKey),
        created_at: new Date().toISOString(),
        secret_mode: mode,
    };

    return bundle;
};

export const unwrapMasterKeyAsync = async (
    bundle: KeyBundle,
    secret: string,
    onKdfProgress?: KdfProgressCallback,
): Promise<Uint8Array> => {
    const candidates = new Set<string>();
    const addCandidate = (value: string) => {
        if (value) {
            candidates.add(value);
        }
    };
    addCandidate(secret);
    addCandidate(secret.trim());
    if (bundle.secret_mode === 'recovery_code') {
        addCandidate(normalizeSecretInput(secret, 'recovery_code'));
    } else {
        addCandidate(normalizeSecretInput(secret, 'passphrase'));
    }

    const tryUnwrap = async (
        material: string,
        kdf: KeyBundleKdf,
        wrap: KeyBundleWrap,
        wrappedKeyHex: string,
    ): Promise<Uint8Array | null> => {
        try {
            const derived = await deriveKeyAsync(material, hexToBytes(kdf.salt), kdf.iterations, onKdfProgress);
            const nonce = hexToBytes(wrap.nonce);
            const wrappedKey = hexToBytes(wrappedKeyHex);

            if (wrap.name === 'AES-256-GCM') {
                const cipher = gcm(derived, nonce);
                return cipher.decrypt(wrappedKey);
            } else if (wrap.name === 'XChaCha20-Poly1305') {
                const cipher = xchacha20poly1305(derived, nonce);
                return cipher.decrypt(wrappedKey);
            }
            return null;
        } catch (_) {
            return null;
        }
    };

    for (const candidate of candidates) {
        const unwrapped = await tryUnwrap(candidate, bundle.kdf, bundle.wrap, bundle.wrapped_key);
        if (unwrapped) return unwrapped;
    }
    throw new Error('Invalid access key');
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
    if (bundle.secret_mode === 'recovery_code') {
        addCandidate(normalizeSecretInput(secret, 'recovery_code'));
    } else {
        addCandidate(normalizeSecretInput(secret, 'passphrase'));
    }

    const tryUnwrap = (material: string, kdf: KeyBundleKdf, wrap: KeyBundleWrap, wrappedKeyHex: string): Uint8Array | null => {
        try {
            const derived = deriveKey(material, hexToBytes(kdf.salt), kdf.iterations);
            const nonce = hexToBytes(wrap.nonce);
            const wrappedKey = hexToBytes(wrappedKeyHex);

            if (wrap.name === 'AES-256-GCM') {
                const cipher = gcm(derived, nonce);
                return cipher.decrypt(wrappedKey);
            } else if (wrap.name === 'XChaCha20-Poly1305') {
                const cipher = xchacha20poly1305(derived, nonce);
                return cipher.decrypt(wrappedKey);
            }
            return null;
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
            value.secret_mode === 'recovery_code' ||
            value.secret_mode === 'pin')
    );
};
