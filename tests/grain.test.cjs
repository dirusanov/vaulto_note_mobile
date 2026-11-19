const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { grainAlpha, grainChecksum, GRAIN_SIZE } = require('../.test-build/drawing/drawing/grain');
const { GRAIN_TILE_BASE64 } = require('../.test-build/drawing/drawing/grainTile');

// InkGeometryTest.grainMatchesTheCanvas pins the same checksum for the Kotlin
// port: the native ink layer and the canvas must draw identical graphite.
const CHECKSUM = 599074111;

test('pencil grain tile is deterministic and matches the native layer', () => {
    const bytes = grainAlpha();
    assert.strictEqual(bytes.length, GRAIN_SIZE * GRAIN_SIZE);
    assert.strictEqual(grainChecksum(bytes), CHECKSUM);
});

test('pencil grain tile wraps without a seam', () => {
    const bytes = grainAlpha();
    let edge = 0;
    let inner = 0;
    for (let y = 0; y < GRAIN_SIZE; y++) {
        edge += Math.abs(bytes[y * GRAIN_SIZE] - bytes[y * GRAIN_SIZE + GRAIN_SIZE - 1]);
        inner += Math.abs(bytes[y * GRAIN_SIZE + 100] - bytes[y * GRAIN_SIZE + 101]);
    }
    // Across the wrap the change is like any neighbouring column's, not a jump.
    assert.ok(edge < inner * 2, `edge ${edge} vs inner ${inner}`);
});

test('the shipped tile is grainAlpha()', () => {
    const bytes = grainAlpha();
    const base64 = Buffer.from(bytes).toString('base64');
    if (process.env.UPDATE_GRAIN) {
        const file = path.join(__dirname, '../src/drawing/grainTile.ts');
        fs.writeFileSync(file, `// Generated from grainAlpha() in grain.ts by tests/grain.test.cjs (UPDATE_GRAIN=1); do not edit.\n// The canvas decodes these bytes natively instead of computing the tile in JS.\nexport const GRAIN_TILE_BASE64 =\n    '${base64}';\n`);
    }
    assert.strictEqual(GRAIN_TILE_BASE64, base64);
});
