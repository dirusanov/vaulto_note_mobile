// Writes tests/fixtures/inkNative.txt: strokes and what src/drawing/ink.ts makes
// of them (outline, shape). The native ink layer's port (InkGeometry.kt) is
// tested against it (InkGeometryTest.kt), so the stroke drawn under the pen is
// the stroke the canvas commits. Run `npm run test:ink-native` after changing ink.ts.
const fs = require('node:fs');
const path = require('node:path');
const { INK_TOOLS, strokeOutline, recognizeShape } = require('../.test-build/drawing/drawing/ink');

let seed = 7;
const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
};

/** A handwriting-like stroke: a wandering line with varying pressure and sample spacing. */
const scribble = (count, step) => {
    const points = [];
    let x = 100 + random() * 200;
    let y = 100 + random() * 200;
    let angle = random() * Math.PI * 2;
    let pressure = 0.3 + random() * 0.4;
    for (let i = 0; i < count; i++) {
        points.push(x, y, pressure);
        angle += (random() - 0.5) * 0.9;
        const d = step * (0.2 + random() * 1.6);
        x += Math.cos(angle) * d;
        y += Math.sin(angle) * d;
        pressure = Math.min(1, Math.max(0.05, pressure + (random() - 0.5) * 0.12));
    }
    return points;
};

const shapeStroke = (corners, per, jitter) => {
    const points = [];
    for (let c = 0; c + 3 < corners.length; c += 2) {
        for (let k = 0; k < per; k++) {
            const t = k / per;
            points.push(
                corners[c] + (corners[c + 2] - corners[c]) * t + (random() - 0.5) * jitter,
                corners[c + 1] + (corners[c + 3] - corners[c + 1]) * t + (random() - 0.5) * jitter,
                0.5 + (random() - 0.5) * 0.1
            );
        }
    }
    points.push(corners[corners.length - 2], corners[corners.length - 1], 0.5);
    return points;
};

const circle = (cx, cy, rx, ry, count, jitter) => {
    const points = [];
    for (let k = 0; k <= count; k++) {
        const a = (k / count) * Math.PI * 2 + 0.3;
        points.push(cx + Math.cos(a) * rx + (random() - 0.5) * jitter, cy + Math.sin(a) * ry + (random() - 0.5) * jitter, 0.55);
    }
    return points;
};

const lines = [];
const num = (v) => (Object.is(v, -0) ? '0' : String(v));
const emit = (header, input, expected) => {
    lines.push(header, input.map(num).join(' '), expected === null ? 'null' : expected.map(num).join(' '));
};

const sizes = { fountain: 3.2, ballpoint: 1.9, pencil: 2.2, marker: 20, brush: 12 };
for (const tool of Object.keys(INK_TOOLS)) {
    const spec = INK_TOOLS[tool];
    for (const [count, step] of [[1, 1], [2, 0.3], [5, 2], [40, 1.5], [300, 0.8], [1200, 1.2]]) {
        for (const cut of [false, true]) {
            const points = scribble(count, step);
            const size = sizes[tool];
            emit(`outline ${tool} ${size} ${spec.thinning} ${spec.streamline} ${spec.taper} ${spec.nib} ${cut}`,
                points, strokeOutline(points, size, spec.thinning, spec.streamline, spec.taper && !cut, spec.nib));
        }
    }
}

const shapes = [
    shapeStroke([100, 100, 400, 104], 60, 2),
    shapeStroke([100, 100, 300, 300], 60, 2),
    shapeStroke([100, 100, 400, 100, 400, 300, 100, 300, 100, 100], 40, 3),
    shapeStroke([100, 100, 380, 140, 200, 360, 100, 100], 40, 3),
    shapeStroke([100, 300, 200, 100, 300, 300], 40, 2),
    circle(250, 250, 120, 118, 120, 3),
    circle(250, 250, 160, 80, 120, 3),
    scribble(200, 2),
    scribble(30, 0.5),
];
shapes.forEach((points) => emit('shape', points, recognizeShape(points)));

fs.mkdirSync(path.join(__dirname, 'fixtures'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'fixtures', 'inkNative.txt'), `${lines.join('\n')}\n`);
console.log(`ink fixtures: ${lines.length / 3} cases`);
