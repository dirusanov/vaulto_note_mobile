const test = require('node:test');
const assert = require('node:assert/strict');
const {
    INK_TOOLS, strokeOutline, createTrace, traceAppend, traceTail, traceOutline, nextFrozenPiece, liveTailStart, LIVE_OVERLAP,
} = require('../.test-build/drawing/drawing/ink');

// The stroke outline as it was before it became incremental (1.0.102), kept
// verbatim: saved drawings must look exactly as they did.
const REF_CAP_STEPS = 8;

/**
 * Filled outline of a pressure-sensitive stroke as a flat [x, y, ...] polygon.
 *
 * Every step only looks backwards (smoothing, pressure, the taper at the start,
 * the nib direction), so the outline of a stroke's beginning never changes as
 * the stroke grows: the line you wrote stays exactly as it appeared, and
 * lifting the pen changes nothing. Only the last sample or two follow the pen.
 */
function referenceOutline(
    points,
    size,
    thinning,
    streamline,
    taper,
    nib = 0
) {
    const count = Math.floor(points.length / 3);
    if (count === 0) {
        return [];
    }

    const xs = [];
    const ys = [];
    const rs = [];
    const dist = [];
    const minRadius = size * 0.08;
    const taperLength = size * 2.5;
    // Direction for the nib is taken over this much of the line behind a point,
    // so hand tremor does not flicker the width.
    const nibReach = Math.max(1.5, size * 0.6);
    let sx = points[0];
    let sy = points[1];
    let sp = points[2];
    let travelled = 0;
    for (let i = 0; i < count; i++) {
        if (i > 0) {
            sx += (points[i * 3] - sx) * (1 - streamline);
            sy += (points[i * 3 + 1] - sy) * (1 - streamline);
            sp += (points[i * 3 + 2] - sp) * 0.35;
            const last = xs.length - 1;
            const dx = sx - xs[last];
            const dy = sy - ys[last];
            const step2 = dx * dx + dy * dy;
            // Dense samples add nothing but outline points.
            if (step2 < 0.6) {
                continue;
            }
            travelled += Math.sqrt(step2);
        }
        let r = Math.max(minRadius, (size / 2) * (1 + thinning * (sp - 0.5) * 1.6));
        if (taper && travelled < taperLength) {
            // Ease-out so the tip narrows quickly and then holds.
            const t = travelled / taperLength;
            r = Math.max(minRadius, r * (0.3 + 0.7 * (1 - (1 - t) * (1 - t))));
        }
        xs.push(sx);
        ys.push(sy);
        rs.push(r);
        dist.push(travelled);
    }
    if (count > 1) {
        // The smoothed line lags the pen by a fraction of a sample: end exactly
        // under it, so the ink stays attached to the nib.
        const lx = points[(count - 1) * 3];
        const ly = points[(count - 1) * 3 + 1];
        const last = xs.length - 1;
        const gap = Math.hypot(lx - xs[last], ly - ys[last]);
        if (gap > 0.05) {
            xs.push(lx);
            ys.push(ly);
            rs.push(rs[last]);
            dist.push(dist[last] + gap);
        }
    }

    const n = xs.length;
    const outline = [];
    if (n === 1) {
        const r = rs[0];
        for (let i = 0; i < REF_CAP_STEPS * 2; i++) {
            const angle = (i / (REF_CAP_STEPS * 2)) * Math.PI * 2;
            outline.push(xs[0] + Math.cos(angle) * r, ys[0] + Math.sin(angle) * r);
        }
        return outline;
    }

    const left = [];
    const right = [];
    const dirX = [];
    const dirY = [];
    let back = 0;
    for (let i = 0; i < n; i++) {
        const a = Math.max(0, i - 1);
        const b = Math.min(n - 1, i + 1);
        let dx = xs[b] - xs[a];
        let dy = ys[b] - ys[a];
        const length = Math.hypot(dx, dy) || 1;
        dx /= length;
        dy /= length;
        if (nib > 0) {
            // Width follows the angle between the stroke and a 45° nib edge:
            // thick downstrokes, hairline diagonals, like a real fountain pen.
            while (back < i && dist[i] - dist[back + 1] >= nibReach) {
                back += 1;
            }
            const j = back < i ? back : 0;
            const k = back < i ? i : Math.min(n - 1, 1);
            const ndx = xs[k] - xs[j];
            const ndy = ys[k] - ys[j];
            const nl = Math.hypot(ndx, ndy) || 1;
            const across = Math.abs((ndx / nl) * 0.7071 + (ndy / nl) * 0.7071);
            rs[i] = Math.max(minRadius, rs[i] * (1 - nib + nib * 1.25 * across));
        }
        dirX.push(dx);
        dirY.push(dy);
        left.push(xs[i] - dy * rs[i], ys[i] + dx * rs[i]);
        right.push(xs[i] + dy * rs[i], ys[i] - dx * rs[i]);
    }

    for (let i = 0; i < left.length; i++) {
        outline.push(left[i]);
    }
    // Round end cap: from the left edge, around the tip, to the right edge.
    const end = n - 1;
    for (let s = 1; s < REF_CAP_STEPS; s++) {
        const theta = (s / REF_CAP_STEPS) * Math.PI;
        const nx = -dirY[end];
        const ny = dirX[end];
        outline.push(
            xs[end] + rs[end] * (nx * Math.cos(theta) + dirX[end] * Math.sin(theta)),
            ys[end] + rs[end] * (ny * Math.cos(theta) + dirY[end] * Math.sin(theta))
        );
    }
    for (let i = n - 1; i >= 0; i--) {
        outline.push(right[i * 2], right[i * 2 + 1]);
    }
    for (let s = 1; s < REF_CAP_STEPS; s++) {
        const theta = (s / REF_CAP_STEPS) * Math.PI;
        const nx = -dirY[0];
        const ny = dirX[0];
        outline.push(
            xs[0] - rs[0] * (nx * Math.cos(theta) + dirX[0] * Math.sin(theta)),
            ys[0] - rs[0] * (ny * Math.cos(theta) + dirY[0] * Math.sin(theta))
        );
    }
    return outline;
}

/** Deterministic pseudo-random numbers, so a failure can be replayed. */
const random = (seed) => () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
};

/** A handwriting-like stroke: wandering direction, uneven spacing, some dense bursts, changing pressure. */
const makeStroke = (count, seed) => {
    const rnd = random(seed);
    const points = [];
    let x = 100;
    let y = 100;
    let angle = rnd() * Math.PI * 2;
    for (let i = 0; i < count; i++) {
        angle += (rnd() - 0.5) * 0.9;
        const step = rnd() < 0.15 ? rnd() * 0.4 : 0.5 + rnd() * 4;
        x += Math.cos(angle) * step;
        y += Math.sin(angle) * step;
        points.push(x, y, Math.min(1, Math.max(0, 0.5 + Math.sin(i / 7) * 0.35 + (rnd() - 0.5) * 0.1)));
    }
    return points;
};

const specs = Object.keys(INK_TOOLS).flatMap((tool) => {
    const spec = INK_TOOLS[tool];
    return [false, true].map((cut) => ({ name: `${tool}${cut ? ' cut' : ''}`, args: [spec.thinning, spec.streamline, spec.taper && !cut, spec.nib] }));
});

test('the stroke outline is exactly what it was before it became incremental', () => {
    let seed = 1;
    for (const { name, args } of specs) {
        for (const count of [0, 1, 2, 3, 5, 17, 120, 700]) {
            for (const size of [1.2, 4.8, 26]) {
                const points = makeStroke(count, seed++);
                assert.deepEqual(strokeOutline(points, size, ...args), referenceOutline(points, size, ...args), `${name} ${count} pts size ${size}`);
            }
        }
    }
    // A dot, and samples so dense they all collapse into one point.
    const dense = [10, 10, 0.5, 10.1, 10, 0.5, 10.2, 10.05, 0.6];
    for (const { name, args } of specs) {
        assert.deepEqual(strokeOutline(dense, 3, ...args), referenceOutline(dense, 3, ...args), name);
        assert.deepEqual(strokeOutline([5, 5, 0.5], 3, ...args), referenceOutline([5, 5, 0.5], 3, ...args), name);
    }
});

test('a trace fed sample by sample ends with the same outline as a full rebuild, at every step', () => {
    let seed = 100;
    for (const { name, args } of specs) {
        const size = 3 + (seed % 5);
        const points = makeStroke(400, seed++);
        const rnd = random(seed);
        const trace = createTrace(size, ...args);
        const live = [];
        while (live.length < points.length) {
            // Samples arrive one at a time or in bursts, as from a real pen.
            const burst = 1 + Math.floor(rnd() * 6);
            live.push(...points.slice(live.length, live.length + burst * 3));
            traceAppend(trace, live);
            const tail = traceTail(trace, live);
            assert.deepEqual(traceOutline(trace, tail, 0, tail.n - 1, true, true), referenceOutline(live, size, ...args), `${name} at ${live.length / 3}`);
        }
    }
});

/** Left edge, right edge and the two caps of a full outline with `n` centre points. */
const splitOutline = (outline, n) => {
    const at = (k) => [outline[k * 2], outline[k * 2 + 1]];
    const left = [];
    const right = [];
    for (let i = 0; i < n; i++) {
        left.push(at(i));
        right.push(at(n + 7 + (n - 1 - i)));
    }
    const endCap = Array.from({ length: 7 }, (_, s) => at(n + s));
    const startCap = Array.from({ length: 7 }, (_, s) => at(2 * n + 7 + s));
    return { left, right, endCap, startCap };
};

const pieceExpected = (full, from, to, capStart, capEnd) => {
    const out = [];
    for (let i = from; i <= to; i++) out.push(...full.left[i]);
    if (capEnd) full.endCap.forEach((p) => out.push(...p));
    for (let i = to; i >= from; i--) out.push(...full.right[i]);
    if (capStart) full.startCap.forEach((p) => out.push(...p));
    return out;
};

test('the frozen pieces and the tail of a live stroke are exact parts of the full outline, overlapping, covering all of it', () => {
    let seed = 500;
    for (const { name, args } of specs) {
        const size = 4;
        const points = makeStroke(1500, seed++);
        const trace = createTrace(size, ...args);
        let frozenTo = -1;
        const pieces = [];
        for (let k = 3; k <= points.length; k += 3 * 7) {
            const live = points.slice(0, k);
            traceAppend(trace, live);
            for (let piece = nextFrozenPiece(frozenTo, trace.done); piece; piece = nextFrozenPiece(frozenTo, trace.done)) {
                pieces.push({ from: piece[0], to: piece[1], outline: traceOutline(trace, null, piece[0], piece[1], piece[0] === 0, false) });
                frozenTo = piece[1];
            }
        }
        traceAppend(trace, points);
        const tail = traceTail(trace, points);
        const from = liveTailStart(frozenTo);
        const tailOutline = traceOutline(trace, tail, from, tail.n - 1, from === 0, true);
        const full = splitOutline(referenceOutline(points, size, ...args), tail.n);

        assert.ok(pieces.length > 10, `${name}: a long stroke is mostly frozen`);
        assert.ok(tail.n - 1 - from <= 32 + LIVE_OVERLAP + 2, `${name}: the tail stays short (${tail.n - 1 - from} points)`);
        let reach = -1;
        for (const piece of pieces) {
            assert.deepEqual(piece.outline, pieceExpected(full, piece.from, piece.to, piece.from === 0, false), `${name} piece ${piece.from}-${piece.to}`);
            // Each piece starts inside the one before, so their straight ends lie inside the ink.
            assert.ok(piece.from === 0 || piece.from <= reach - 2, `${name}: pieces overlap`);
            reach = piece.to;
        }
        assert.ok(from <= reach - 2, `${name}: the tail overlaps the frozen part`);
        assert.deepEqual(tailOutline, pieceExpected(full, from, tail.n - 1, from === 0, true), `${name} tail`);
    }
});
