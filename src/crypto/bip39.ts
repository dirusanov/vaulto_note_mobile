import * as Crypto from 'expo-crypto';
import { sha256 } from '@noble/hashes/sha256';
import { BIP39_EN_WORDLIST } from './bip39Wordlist';

const VALID_WORD_COUNTS = new Set([12, 15, 18, 21, 24]);
const ENTROPY_BYTES_BY_WORD_COUNT: Record<number, number> = {
    12: 16,
    15: 20,
    18: 24,
    21: 28,
    24: 32,
};

const WORD_TO_INDEX = new Map<string, number>(
    BIP39_EN_WORDLIST.map((word, index) => [word, index]),
);

const bytesToBinary = (bytes: Uint8Array): string => {
    return Array.from(bytes)
        .map((b) => b.toString(2).padStart(8, '0'))
        .join('');
};

const deriveChecksumBits = (entropy: Uint8Array): string => {
    const hash = sha256(entropy);
    const checksumLength = (entropy.length * 8) / 32;
    return bytesToBinary(hash).slice(0, checksumLength);
};

export const normalizeMnemonic = (value: string): string => {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
};

export const entropyToMnemonic = (entropy: Uint8Array): string => {
    if (!Object.values(ENTROPY_BYTES_BY_WORD_COUNT).includes(entropy.length)) {
        throw new Error('Invalid entropy length for BIP39');
    }

    const entropyBits = bytesToBinary(entropy);
    const checksumBits = deriveChecksumBits(entropy);
    const bits = entropyBits + checksumBits;

    const chunks = bits.match(/.{1,11}/g);
    if (!chunks || chunks.some((chunk) => chunk.length !== 11)) {
        throw new Error('Failed to split entropy into BIP39 words');
    }

    return chunks
        .map((chunk) => {
            const index = Number.parseInt(chunk, 2);
            return BIP39_EN_WORDLIST[index];
        })
        .join(' ');
};

export const mnemonicToEntropy = (mnemonic: string): Uint8Array => {
    const normalized = normalizeMnemonic(mnemonic);
    if (!normalized) {
        throw new Error('Seed phrase is required.');
    }

    const words = normalized.split(' ');
    if (!VALID_WORD_COUNTS.has(words.length)) {
        throw new Error('Seed phrase must be 12, 15, 18, 21, or 24 words.');
    }

    const bits = words
        .map((word) => {
            const index = WORD_TO_INDEX.get(word);
            if (index === undefined) {
                throw new Error(`Invalid seed word: ${word}`);
            }
            return index.toString(2).padStart(11, '0');
        })
        .join('');

    const totalLength = bits.length;
    const entropyLength = Math.floor((totalLength * 32) / 33);
    const checksumLength = totalLength - entropyLength;

    const entropyBits = bits.slice(0, entropyLength);
    const checksumBits = bits.slice(entropyLength);

    const entropyBytes = (entropyBits.match(/.{1,8}/g) || []).map((byte) => Number.parseInt(byte, 2));
    const entropy = Uint8Array.from(entropyBytes);

    const expectedChecksum = deriveChecksumBits(entropy).slice(0, checksumLength);
    if (checksumBits !== expectedChecksum) {
        throw new Error('Invalid seed phrase checksum.');
    }

    return entropy;
};

export const isValidMnemonic = (mnemonic: string): boolean => {
    try {
        mnemonicToEntropy(mnemonic);
        return true;
    } catch (_) {
        return false;
    }
};

export const generateMnemonic = async (wordCount: 12 | 15 | 18 | 21 | 24 = 12): Promise<string> => {
    const entropyBytes = ENTROPY_BYTES_BY_WORD_COUNT[wordCount];
    if (!entropyBytes) {
        throw new Error('Unsupported seed phrase size');
    }
    const entropy = await Crypto.getRandomBytesAsync(entropyBytes);
    return entropyToMnemonic(entropy);
};
