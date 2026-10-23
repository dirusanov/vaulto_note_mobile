// richContent reaches react-native through the theme; stub it like the formatting tests do.
const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request) {
    if (request === 'react-native') {
        return {
            Text: () => null,
            StyleSheet: { flatten: (style) => style, create: (styles) => styles },
            Appearance: { getColorScheme: () => 'light', addChangeListener: () => ({ remove() {} }) },
        };
    }
    if (request === 'react') {
        return { createElement: (...args) => ({ args }) };
    }
    return originalLoad.apply(this, arguments);
};

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDrawingSrc, parseDrawingSrc, DRAWING_MARKER } = require('../.test-build/drawing/drawing/drawingFormat');
const {
    richContentToPlainText,
    richContentToPreviewText,
    richContentToAgentMarkdown,
} = require('../.test-build/drawing/utils/richContent');

// A page of handwriting: 300 short strokes of ~60 samples with varying pressure.
const handwritingPage = () => {
    const strokes = [];
    let seed = 7;
    const rand = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
    };
    for (let s = 0; s < 300; s++) {
        const x0 = 20 + (s % 20) * 36;
        const y0 = 40 + Math.floor(s / 20) * 48;
        const points = [];
        for (let i = 0; i < 60; i++) {
            const t = i / 59;
            points.push(
                x0 + t * 28 + Math.sin(t * 9 + s) * 6 + rand() * 0.4,
                y0 + Math.cos(t * 7 + s) * 14 + rand() * 0.4,
                0.3 + 0.5 * Math.sin(t * Math.PI),
            );
        }
        strokes.push({ tool: ['fountain', 'ballpoint', 'pencil', 'brush', 'marker'][s % 5], color: '#1D1D1F', size: 3, points });
    }
    return { id: 'd1', width: 760, strokes };
};

test('strokes survive the round trip within the stored precision', () => {
    const doc = handwritingPage();
    const parsed = parseDrawingSrc(buildDrawingSrc(doc));
    assert.equal(parsed.id, 'd1');
    assert.equal(parsed.width, 760);
    assert.equal(parsed.strokes.length, doc.strokes.length);
    parsed.strokes.forEach((stroke, s) => {
        const original = doc.strokes[s];
        assert.equal(stroke.tool, original.tool);
        assert.equal(stroke.color, original.color);
        assert.equal(stroke.points.length, original.points.length);
        stroke.points.forEach((value, i) => {
            const tolerance = i % 3 === 2 ? 0.006 : 0.051;
            assert.ok(Math.abs(value - original.points[i]) <= tolerance, `stroke ${s} value ${i}`);
        });
    });
});

test('a full page of handwriting stays well under a megabyte', () => {
    const size = buildDrawingSrc(handwritingPage()).length;
    assert.ok(size < 1024 * 1024, `page is ${size} bytes`);
});

test('the src has nothing that breaks the data URI, the marker split or the HTML attribute', () => {
    const src = buildDrawingSrc(handwritingPage());
    const markerAt = src.indexOf(DRAWING_MARKER);
    assert.equal(src.indexOf('#'), markerAt);
    assert.equal(src.lastIndexOf('#'), markerAt);
    assert.ok(!/[<>"&]/.test(src));
});

test('drawings saved in the first prototype format still open', () => {
    const payload = { v: 1, id: 'old', w: 800, s: [[0, '#E53935', 26, 1000, 2000, 50, 10, -5, 60]] };
    const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg/>')}${DRAWING_MARKER}${encodeURIComponent(JSON.stringify(payload))}`;
    const parsed = parseDrawingSrc(src);
    assert.equal(parsed.id, 'old');
    assert.deepEqual(parsed.strokes[0].points, [100, 200, 0.5, 101, 199.5, 0.6]);
});

test('note text, previews and AI context ignore the drawing', () => {
    const src = buildDrawingSrc(handwritingPage());
    const html = `<p>Before</p><img src="${src}"><p>After</p>`;
    assert.equal(richContentToPlainText(html).replace(/\s+/g, ' ').trim(), 'Before After');
    assert.equal(richContentToPreviewText(html).replace(/\s+/g, ' ').trim(), 'Before After');
    assert.ok(!richContentToAgentMarkdown(html).includes('svg'));
});

test('typed labels and the paper survive the round trip and show in the preview', () => {
    const doc = {
        id: 't1',
        width: 760,
        strokes: [],
        texts: [{ x: 40.5, y: 100, text: 'Купить <молоко> & "хлеб" #1\nвторая строка', size: 24, color: '#E53935' }],
        paper: { pattern: 'margin', color: '#FFF8E7', layout: 'canvas' },
    };
    const src = buildDrawingSrc(doc);
    const parsed = parseDrawingSrc(src);
    assert.deepEqual(parsed.texts, doc.texts);
    assert.deepEqual(parsed.paper, doc.paper);
    const svg = decodeURIComponent(src.slice(0, src.indexOf(DRAWING_MARKER)));
    assert.ok(svg.includes("class='vp'"));
    assert.ok(svg.includes("fill='url(#p)'"));
    assert.ok(svg.includes('&lt;молоко&gt; &amp;'));
    assert.ok(svg.includes('вторая строка'));
    assert.ok(!/[<>"&]/.test(src));
});

test('drawings without paper keep the compact, cropped preview', () => {
    const src = buildDrawingSrc({ id: 'p0', width: 400, strokes: [{ tool: 'ballpoint', color: '#1D1D1F', size: 2, points: [10, 300, 0.5, 60, 320, 0.5] }] });
    const parsed = parseDrawingSrc(src);
    assert.deepEqual(parsed.paper, { pattern: 'blank', color: null, layout: 'pages' });
    assert.deepEqual(parsed.texts, []);
    assert.ok(!src.includes('pattern'));
    assert.ok(!src.includes("'vp'"));
});

test('zero pressure and size survive, and quotes in labels stay inside the payload', () => {
    const doc = {
        id: 'q1',
        width: 400,
        strokes: [{ tool: 'ballpoint', color: '#000000', size: 0, points: [10, 20, 0, 30, 40, 0] }],
        texts: [{ x: 1, y: 2, size: 18, color: '#000000', text: "title='vaulto-audio:x' data-audio-path='y'" }],
    };
    const src = buildDrawingSrc(doc);
    const parsed = parseDrawingSrc(src);
    assert.equal(parsed.strokes[0].size, 0);
    assert.deepEqual(parsed.strokes[0].points.filter((_, i) => i % 3 === 2), [0, 0]);
    assert.equal(parsed.texts[0].text, doc.texts[0].text);
    const payload = src.slice(src.indexOf(DRAWING_MARKER));
    assert.ok(!payload.includes("'"));
    assert.ok(!src.includes("title='vaulto-audio"));
});

test('a label that looks like audio attributes does not turn the drawing into an audio card', () => {
    const { richContentToEditorHtml } = require('../.test-build/drawing/utils/richContent');
    const src = buildDrawingSrc({
        id: 'q2',
        width: 400,
        strokes: [],
        texts: [{ x: 1, y: 2, size: 18, color: '#000000', text: "title='vaulto-audio:x'" }],
    });
    const html = richContentToEditorHtml(`<p>a</p><img src="${src}"><p>b</p>`);
    assert.ok(html.includes(DRAWING_MARKER), 'the drawing is still there');
    assert.ok(!html.includes('data-audio-player'), 'no audio card was made of it');
});

test('a drawing can be put into note HTML without the editor', () => {
    const { upsertDrawingInHtml } = require('../.test-build/drawing/drawing/drawingFormat');
    const a1 = buildDrawingSrc({ id: 'a', width: 300, strokes: [{ tool: 'ballpoint', color: '#000000', size: 2, points: [1, 2, 0.5, 3, 4, 0.5] }] });
    const a2 = buildDrawingSrc({ id: 'a', width: 300, strokes: [{ tool: 'ballpoint', color: '#E53935', size: 2, points: [5, 6, 0.5, 7, 8, 0.5] }] });
    const b = buildDrawingSrc({ id: 'b', width: 300, strokes: [] });
    const html = `<p>x</p><img src="${b}"><img src="${a1}"><p>y</p>`;
    const updated = upsertDrawingInHtml(html, 'a', a2);
    assert.ok(updated.includes(a2) && !updated.includes(a1) && updated.includes(b));
    assert.ok(updated.startsWith('<p>x</p>') && updated.endsWith('<p>y</p>'));
    const added = upsertDrawingInHtml('<p>x</p>', 'c', a2);
    assert.equal(added, `<p>x</p><img src="${a2}"><p></p>`);
    assert.equal(upsertDrawingInHtml(html, 'a', null), `<p>x</p><img src="${b}"><p>y</p>`);
    assert.equal(upsertDrawingInHtml('<p>x</p>', 'zzz', null), '<p>x</p>');
});

test('a drawing saved before pages existed opens as a canvas', () => {
    const src = buildDrawingSrc({ id: 'old', width: 400, strokes: [] });
    const at = src.indexOf(DRAWING_MARKER) + DRAWING_MARKER.length;
    const payload = JSON.parse(decodeURIComponent(src.slice(at)));
    assert.deepEqual(payload.p, [0, null, 0]);
    delete payload.p;
    const legacy = src.slice(0, at) + encodeURIComponent(JSON.stringify(payload));
    assert.equal(parseDrawingSrc(legacy).paper.layout, 'canvas');
});

test('a canvas preview frames the drawing wherever it is', () => {
    const src = buildDrawingSrc({
        id: 'c1',
        width: 800,
        strokes: [{ tool: 'ballpoint', color: '#000000', size: 2, points: [-300, -200, 0.5, -100, -150, 0.5] }],
        paper: { pattern: 'grid', color: null, layout: 'canvas' },
    });
    const svg = decodeURIComponent(src.slice(0, src.indexOf(DRAWING_MARKER)));
    const [, x, y, w] = /viewBox='(-?\d+) (-?\d+) (\d+)/.exec(svg).map(Number);
    assert.ok(x < -600 && y < -400, svg.slice(0, 200));
    assert.ok(w < 600);
});

test('pages in the preview are separate sheets, each pattern starting at its page top', () => {
    const src = buildDrawingSrc({
        id: 'pg',
        width: 400,
        // Something on the second page (pitch = 566 + 24).
        strokes: [{ tool: 'ballpoint', color: '#000000', size: 2, points: [20, 700, 0.5, 80, 720, 0.5] }],
        paper: { pattern: 'lines', color: '#FFF8E7', layout: 'pages' },
    });
    const svg = decodeURIComponent(src.slice(0, src.indexOf(DRAWING_MARKER)));
    assert.ok(svg.includes("id='p0'") && svg.includes("id='p1'"));
    assert.ok(svg.includes(`y='${590 * 2}'`));
    assert.equal(parseDrawingSrc(src).paper.layout, 'pages');
});

test('ink already drawn keeps its shape while the stroke goes on', () => {
    const { strokeOutline, INK_TOOLS } = require('../.test-build/drawing/drawing/ink');
    // A wavy handwriting-like stroke with changing pressure.
    const points = [];
    for (let i = 0; i < 160; i++) {
        points.push(i * 1.7, 40 + Math.sin(i / 6) * 18, 0.4 + 0.3 * Math.sin(i / 9));
    }
    for (const tool of Object.keys(INK_TOOLS)) {
        const spec = INK_TOOLS[tool];
        const full = strokeOutline(points, 6, spec.thinning, spec.streamline, spec.taper, spec.nib);
        for (const cut of [20, 60, 120]) {
            const part = strokeOutline(points.slice(0, cut * 3), 6, spec.thinning, spec.streamline, spec.taper, spec.nib);
            // Left edge comes first in the outline; all but the last few samples
            // (the tip under the pen) must match the finished stroke exactly.
            const stable = (cut - 4) * 2;
            assert.deepEqual(part.slice(0, stable), full.slice(0, stable), `${tool} at ${cut}`);
        }
    }
});

test('strokes cut by the eraser keep that mark through a save', () => {
    const doc = {
        id: 'cut',
        width: 400,
        strokes: [
            { tool: 'fountain', color: '#000', size: 3, points: [0, 0, 0.5, 20, 0, 0.5] },
            { tool: 'fountain', color: '#000', size: 3, points: [30, 0, 0.5, 60, 0, 0.5], cut: true },
        ],
    };
    const parsed = parseDrawingSrc(buildDrawingSrc(doc));
    assert.equal(parsed.strokes[0].cut, undefined);
    assert.equal(parsed.strokes[1].cut, true);
    assert.ok(!buildDrawingSrc({ ...doc, strokes: [doc.strokes[0]] }).includes('"c"'), 'no field when nothing was cut');
});

test('a stroke held at the end becomes the clean shape it resembles', () => {
    const { recognizeShape } = require('../.test-build/drawing/drawing/ink');
    // A wobbly hand-drawn circle around (100, 100), radius 50, starting at the right.
    const circle = [];
    for (let i = 0; i <= 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        const r = 50 + Math.sin(i * 1.7) * 2.5;
        circle.push(100 + Math.cos(a) * r, 100 + Math.sin(a) * r, 0.5);
    }
    const round = recognizeShape(circle);
    assert.ok(round, 'circle recognised');
    for (let i = 0; i < round.length; i += 3) {
        assert.ok(Math.abs(Math.hypot(round[i] - 100, round[i + 1] - 100) - 50) < 3, 'on the circle');
    }

    // A rectangle drawn slightly crooked comes out axis-aligned.
    const rect = [];
    const corners = [[10, 10], [210, 13], [208, 110], [12, 108], [11, 12]];
    for (let c = 0; c < 4; c++) {
        for (let k = 0; k < 20; k++) {
            const t = k / 20;
            rect.push(corners[c][0] + (corners[c + 1][0] - corners[c][0]) * t + Math.sin(k) * 0.8,
                corners[c][1] + (corners[c + 1][1] - corners[c][1]) * t, 0.5);
        }
    }
    rect.push(11, 12, 0.5);
    const box = recognizeShape(rect);
    assert.ok(box, 'rectangle recognised');
    const xsOf = (pts) => pts.filter((_, i) => i % 3 === 0);
    const ysOf = (pts) => pts.filter((_, i) => i % 3 === 1);
    assert.equal(new Set(xsOf(box).map(Math.round)).size > 2, true);
    assert.ok(xsOf(box).every((x) => x >= 9 && x <= 211));
    assert.equal(box[0], box[box.length - 3], 'closed');
    assert.equal(box[1], box[box.length - 2], 'closed');

    // A nearly horizontal line is straightened and levelled.
    const line = [];
    for (let i = 0; i <= 40; i++) {
        line.push(20 + i * 5, 50 + i * 0.12 + Math.sin(i) * 0.6, 0.4 + (i % 3) * 0.1);
    }
    const straight = recognizeShape(line);
    assert.ok(straight, 'line recognised');
    assert.ok(ysOf(straight).every((y) => y === straight[1]), 'levelled');

    // Handwriting is left alone.
    const scribble = [];
    for (let i = 0; i <= 80; i++) {
        scribble.push(i * 3, 40 + Math.sin(i * 0.9) * 15 + Math.cos(i * 0.37) * 10, 0.5);
    }
    assert.equal(recognizeShape(scribble), null);
});

test('the notes list can show the first drawing of a note as a thumbnail', () => {
    const { firstDrawingSvg } = require('../.test-build/drawing/drawing/drawingFormat');
    const src = buildDrawingSrc({ id: 'thumb', width: 400, strokes: [{ tool: 'fountain', color: '#000', size: 3, points: [10, 10, 0.5, 90, 40, 0.5] }] });
    const svg = firstDrawingSvg(`<p>Shopping</p><img src="${src}"><p>more</p>`);
    assert.ok(svg.startsWith('<svg'));
    assert.ok(svg.endsWith('</svg>'));
    assert.ok(svg.includes('<path'));
    assert.equal(firstDrawingSvg('<p>no drawing</p>'), null);
});
