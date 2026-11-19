/**
 * Pencil graphite: the alpha of a repeating tile of value noise, in document
 * units. The native ink layer (InkLiveView.kt, grainAlpha) builds the very same
 * bytes, so a pencil stroke keeps its grain when the pen lifts and the canvas
 * takes it over. Integer hashing and double arithmetic only, in the same
 * order on both sides: tests/grain.test.cjs and InkGeometryTest pin the bytes.
 */

/** Tile size in document units, and pixels per unit. */
export const GRAIN_UNITS = 64;
export const GRAIN_PER_UNIT = 8;
export const GRAIN_SIZE = GRAIN_UNITS * GRAIN_PER_UNIT;

/** A grid value in -1..1 for cell (x, y) of grid `seed`. */
const hash = (x: number, y: number, seed: number): number => {
    'worklet';
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return ((h >>> 0) / 4294967295) * 2 - 1;
};

/** Smooth value noise of a grid of n × n cells that wraps around, at (u, v) in cells. */
const sample = (n: number, seed: number, u: number, v: number): number => {
    'worklet';
    const x0 = Math.floor(u);
    const y0 = Math.floor(v);
    const fx = u - x0;
    const fy = v - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const xa = x0 % n;
    const xb = (x0 + 1) % n;
    const ya = y0 % n;
    const yb = (y0 + 1) % n;
    const a = hash(xa, ya, seed);
    const b = hash(xb, ya, seed);
    const c = hash(xa, yb, seed);
    const d = hash(xb, yb, seed);
    const top = a + (b - a) * sx;
    const bottom = c + (d - c) * sx;
    return top + (bottom - top) * sy;
};

/** Alpha (0..255) of every pixel of the tile, row by row. */
export const grainAlpha = (): Uint8Array => {
    'worklet';
    const out = new Uint8Array(GRAIN_SIZE * GRAIN_SIZE);
    for (let y = 0; y < GRAIN_SIZE; y++) {
        const v = y / GRAIN_PER_UNIT;
        for (let x = 0; x < GRAIN_SIZE; x++) {
            const u = x / GRAIN_PER_UNIT;
            // Cells of half and a quarter unit: grain finer than a document unit.
            const noise = sample(GRAIN_UNITS * 2, 1, u * 2, v * 2) * 0.5 + sample(GRAIN_UNITS * 4, 2, u * 4, v * 4) * 0.35;
            const value = 0.54 + noise * 0.5;
            const alpha = Math.min(1, Math.max(0, 2.6 * value - 0.55));
            out[y * GRAIN_SIZE + x] = Math.floor(alpha * 255);
        }
    }
    return out;
};

/** FNV-1a of the tile, to compare the two implementations. */
export const grainChecksum = (bytes: Uint8Array): number => {
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) {
        h = Math.imul(h ^ bytes[i], 16777619);
    }
    return h >>> 0;
};
