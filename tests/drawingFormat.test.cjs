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
        paper: { pattern: 'margin', color: '#FFF8E7' },
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
    assert.deepEqual(parsed.paper, { pattern: 'blank', color: null });
    assert.deepEqual(parsed.texts, []);
    assert.ok(!src.includes('pattern'));
    assert.ok(!src.includes("'vp'"));
});
