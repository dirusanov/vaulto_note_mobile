/**
 * PBKDF2-HMAC-SHA256 tuned for the JS engine (Hermes has no JIT).
 *
 * The generic path (`@noble/hashes` hmac + sha256 objects) clones hash state,
 * copies buffers and pads the message on every one of the 2 × 150 000 hash
 * calls of an unlock. Here the HMAC keys are absorbed once, and each iteration
 * is exactly two SHA-256 compressions over fixed-layout 32-bit words with no
 * allocation, which makes an unlock several times faster on a phone. The result
 * is byte-identical to `pbkdf2(sha256, …)` (see tests/e2eeCrypto.test.cjs).
 *
 * Pure (no React Native imports), so tests can load it.
 */

const K = new Int32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

/**
 * One SHA-256 compression: `state` (8 words at `so`) absorbs the 16-word block
 * `block`, the result goes to `out` (8 words at `oo`). `w` is 64 words of scratch.
 */
const compress = (
    state: Int32Array, so: number,
    block: Int32Array,
    out: Int32Array, oo: number,
    w: Int32Array,
): void => {
    let a = state[so], b = state[so + 1], c = state[so + 2], d = state[so + 3];
    let e = state[so + 4], f = state[so + 5], g = state[so + 6], h = state[so + 7];
    for (let i = 0; i < 64; i++) {
        let wi: number;
        if (i < 16) {
            wi = block[i];
        } else {
            const x = w[i - 15];
            const y = w[i - 2];
            wi = (w[i - 16]
                + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3))
                + w[i - 7]
                + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
        }
        w[i] = wi;
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + wi) | 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0;
        d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    out[oo] = (state[so] + a) | 0;
    out[oo + 1] = (state[so + 1] + b) | 0;
    out[oo + 2] = (state[so + 2] + c) | 0;
    out[oo + 3] = (state[so + 3] + d) | 0;
    out[oo + 4] = (state[so + 4] + e) | 0;
    out[oo + 5] = (state[so + 5] + f) | 0;
    out[oo + 6] = (state[so + 6] + g) | 0;
    out[oo + 7] = (state[so + 7] + h) | 0;
};

/** Plain SHA-256 of arbitrary bytes (used for long HMAC keys and the first block). */
const sha256Words = (data: Uint8Array, prefixState?: Int32Array, prefixBytes = 0): Int32Array => {
    const state = new Int32Array(prefixState ?? IV);
    const total = data.length + prefixBytes;
    const padded = new Uint8Array(((data.length + 9 + 63) >> 6) << 6);
    padded.set(data);
    padded[data.length] = 0x80;
    const bits = total * 8;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, Math.floor(bits / 0x100000000), false);
    view.setUint32(padded.length - 4, bits >>> 0, false);
    const block = new Int32Array(16);
    const w = new Int32Array(64);
    for (let off = 0; off < padded.length; off += 64) {
        for (let i = 0; i < 16; i++) block[i] = view.getInt32(off + i * 4, false);
        compress(state, 0, block, state, 0, w);
    }
    return state;
};

const wordsToBytes = (words: Int32Array, out: Uint8Array, offset: number, length: number): void => {
    for (let i = 0; i < length; i++) {
        out[offset + i] = (words[i >> 2] >>> (24 - (i & 3) * 8)) & 0xff;
    }
};

/** Inner and outer HMAC states after absorbing the key XOR ipad / opad. */
const hmacStates = (key: Uint8Array): { inner: Int32Array; outer: Int32Array } => {
    let k = key;
    if (k.length > 64) {
        const digest = new Uint8Array(32);
        wordsToBytes(sha256Words(k), digest, 0, 32);
        k = digest;
    }
    const pad = new Int32Array(16);
    const w = new Int32Array(64);
    const absorb = (xor: number): Int32Array => {
        for (let i = 0; i < 16; i++) {
            let word = 0;
            for (let j = 0; j < 4; j++) {
                const index = i * 4 + j;
                word = (word << 8) | (((index < k.length ? k[index] : 0) ^ xor) & 0xff);
            }
            pad[i] = word;
        }
        const state = new Int32Array(IV);
        compress(state, 0, pad, state, 0, w);
        return state;
    };
    return { inner: absorb(0x36), outer: absorb(0x5c) };
};

export type Pbkdf2Progress = (done: number) => void;

/**
 * PBKDF2-HMAC-SHA256. `pause` is awaited between slices of about `sliceMs`
 * milliseconds so the UI stays responsive; `onProgress` gets 0..1.
 */
export const pbkdf2Sha256Async = async (
    password: Uint8Array,
    salt: Uint8Array,
    iterations: number,
    dkLen: number,
    options: {
        onProgress?: Pbkdf2Progress;
        pause?: () => Promise<void>;
        sliceMs?: number;
        now?: () => number;
    } = {},
): Promise<Uint8Array> => {
    if (iterations < 1) throw new Error('PBKDF2: iterations must be at least 1');
    const { onProgress, pause, sliceMs = 24, now = Date.now } = options;
    const { inner, outer } = hmacStates(password);
    const blocks = Math.ceil(dkLen / 32);
    const result = new Uint8Array(dkLen);
    const w = new Int32Array(64);
    // Message block for the inner hash of a 32-byte U: U, 0x80, zeros, length (64 + 32 bytes).
    const innerBlock = new Int32Array(16);
    innerBlock[8] = 0x80000000 | 0;
    innerBlock[15] = (64 + 32) * 8;
    // Message block for the outer hash of the 32-byte inner digest.
    const outerBlock = new Int32Array(16);
    outerBlock[8] = 0x80000000 | 0;
    outerBlock[15] = (64 + 32) * 8;
    const acc = new Int32Array(8);
    const total = blocks * Math.max(1, iterations - 1);
    let done = 0;
    let sliceStart = now();
    let lastReport = -1;

    for (let blockIndex = 1; blockIndex <= blocks; blockIndex++) {
        // U1 = HMAC(P, salt || INT(i)).
        const first = new Uint8Array(salt.length + 4);
        first.set(salt);
        new DataView(first.buffer).setUint32(salt.length, blockIndex, false);
        const innerDigest = sha256Words(first, inner, 64);
        for (let i = 0; i < 8; i++) outerBlock[i] = innerDigest[i];
        compress(outer, 0, outerBlock, innerBlock, 0, w);
        for (let i = 0; i < 8; i++) acc[i] = innerBlock[i];

        for (let n = 1; n < iterations; n++) {
            // U(n+1) = HMAC(P, U(n)); innerBlock[0..7] holds U(n).
            compress(inner, 0, innerBlock, outerBlock, 0, w);
            compress(outer, 0, outerBlock, innerBlock, 0, w);
            acc[0] ^= innerBlock[0]; acc[1] ^= innerBlock[1];
            acc[2] ^= innerBlock[2]; acc[3] ^= innerBlock[3];
            acc[4] ^= innerBlock[4]; acc[5] ^= innerBlock[5];
            acc[6] ^= innerBlock[6]; acc[7] ^= innerBlock[7];
            done++;
            if ((done & 255) === 0) {
                if (onProgress) {
                    const step = Math.floor((done / total) * 1000);
                    if (step !== lastReport) {
                        lastReport = step;
                        onProgress(done / total);
                    }
                }
                if (pause && now() - sliceStart >= sliceMs) {
                    await pause();
                    sliceStart = now();
                }
            }
        }
        const offset = (blockIndex - 1) * 32;
        wordsToBytes(acc, result, offset, Math.min(32, dkLen - offset));
    }
    acc.fill(0);
    innerBlock.fill(0);
    outerBlock.fill(0);
    w.fill(0);
    onProgress?.(1);
    return result;
};
