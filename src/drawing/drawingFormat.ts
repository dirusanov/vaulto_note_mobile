import { INK_TEXT_LINE_HEIGHT, INK_TOOLS, INK_TOOL_ORDER, InkBounds, InkStroke, InkText, InkTool, outlineToSvgPath, shapeIsClosed, shapeWidth, strokeBounds, strokeOutlineFor } from './ink';
import {
    DEFAULT_PAPER,
    LEGACY_PAPER,
    PAPER_LAYOUTS,
    PAPER_MARGIN_COLOR,
    PAPER_MARGIN_X,
    PAPER_PATTERNS,
    PaperStyle,
    pageHeight,
    pagePitch,
    paperDotRadius,
    paperLineColor,
    paperStep,
} from './paper';

// A drawing lives in the note like the audio card does: an <img> whose src is
// an SVG preview followed by a marker and the editable strokes. Every client
// that renders the note HTML shows the picture; only the canvas reads the strokes.
export const DRAWING_MARKER = '#vaulto-drawing=';
export const DRAWING_OPEN_MESSAGE_TYPE = 'vaulto-open-drawing';

export type DrawingDocument = {
    id: string;
    /** Width of the document coordinate space (the canvas width it was started on). */
    width: number;
    strokes: InkStroke[];
    texts?: InkText[];
    paper?: PaperStyle;
    /**
     * Where the tapped drawing sits in the editor document (not stored). A
     * pasted copy has the same id, so the edit goes back to this exact node.
     */
    pos?: number;
};

/** Pattern line colour of the theme paper in the SVG (light theme; dark mode inverts the image). */
const SVG_THEME_LINE = '#DEE2E6';

const escapeXml = (text: string): string =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&apos;');

/**
 * Extent of everything drawn or typed. Label widths are estimated (the font is
 * not known here): good enough to frame a preview, not to hit-test.
 */
export const drawingBounds = (strokes: InkStroke[], texts: InkText[] = []): InkBounds | null => {
    const box = strokeBounds(strokes) || { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    texts.forEach((item) => {
        const lines = item.text.split('\n');
        const longest = lines.reduce((max, line) => Math.max(max, line.length), 1);
        box.minX = Math.min(box.minX, item.x);
        box.maxX = Math.max(box.maxX, item.x + longest * item.size * 0.6);
        box.minY = Math.min(box.minY, item.y);
        box.maxY = Math.max(box.maxY, item.y + Math.max(1, lines.length) * item.size * INK_TEXT_LINE_HEIGHT);
    });
    return Number.isFinite(box.minY) ? box : null;
};

const PADDING = 16;
/** SVG coordinates are stored in half pixels: sharp on 2-3x screens, still integers. */
const SVG_SCALE = 2;

// Only what would break the data URI, the marker split or the HTML attribute is
// escaped; full encodeURIComponent tripled the size (every comma and space).
const escapeForSrc = (text: string): string =>
    text
        .replace(/%/g, '%25')
        .replace(/#/g, '%23')
        .replace(/"/g, '%22')
        .replace(/</g, '%3C')
        .replace(/>/g, '%3E')
        .replace(/&/g, '%26');

// The JSON payload carries label text verbatim: a raw ' in it could read as an
// attribute to the legacy audio regexes that scan whole <img> tags. (The SVG
// part needs no such escape: its text is XML-escaped, ' included.)
const escapePayload = (text: string): string => escapeForSrc(text).replace(/'/g, '%27');
const MIN_HEIGHT = 120;

/** The stored number, or the fallback when it is missing (0 is a real value). */
const num = (value: unknown, fallback: number): number => {
    const parsed = Number(value);
    return value !== null && value !== undefined && value !== '' && Number.isFinite(parsed) ? parsed : fallback;
};

// Points are stored as deltas in tenths of a pixel and pressure in hundredths:
// about a third of the size of plain JSON numbers.
const encodeStroke = (stroke: InkStroke): (string | number)[] => {
    const out: (string | number)[] = [INK_TOOL_ORDER.indexOf(stroke.tool), stroke.color, Math.round(stroke.size * 10)];
    let px = 0;
    let py = 0;
    for (let i = 0; i + 2 < stroke.points.length; i += 3) {
        const x = Math.round(stroke.points[i] * 10);
        const y = Math.round(stroke.points[i + 1] * 10);
        out.push(x - px, y - py, Math.round(stroke.points[i + 2] * 100));
        px = x;
        py = y;
    }
    return out;
};

const decodeStroke = (raw: unknown): InkStroke | null => {
    if (!Array.isArray(raw) || raw.length < 3) {
        return null;
    }
    const tool: InkTool = INK_TOOL_ORDER[Number(raw[0])] || 'fountain';
    const points: number[] = [];
    let x = 0;
    let y = 0;
    for (let i = 3; i + 2 < raw.length; i += 3) {
        x += Number(raw[i]) || 0;
        y += Number(raw[i + 1]) || 0;
        points.push(x / 10, y / 10, num(raw[i + 2], 50) / 100);
    }
    return {
        tool,
        color: typeof raw[1] === 'string' ? raw[1] : '#1D1D1F',
        size: num(raw[2], 20) / 10,
        points,
    };
};

const decodeStrokes = (raw: unknown, cuts: unknown, shapes: unknown): InkStroke[] => {
    const cut = new Set(Array.isArray(cuts) ? cuts.map(Number) : []);
    const shape = new Set(Array.isArray(shapes) ? shapes.map(Number) : []);
    const strokes: InkStroke[] = [];
    (Array.isArray(raw) ? raw : []).forEach((item, index) => {
        const stroke = decodeStroke(item);
        if (stroke) {
            strokes.push({
                ...stroke,
                ...(cut.has(index) ? { cut: true } : {}),
                ...(shape.has(index) ? { shape: true } : {}),
            });
        }
    });
    return strokes;
};

export const parseDrawingSrc = (src: string | null | undefined): DrawingDocument | null => {
    const index = (src || '').indexOf(DRAWING_MARKER);
    if (index === -1) {
        return null;
    }
    try {
        const parsed = JSON.parse(decodeURIComponent((src as string).slice(index + DRAWING_MARKER.length)));
        if (!parsed || typeof parsed.id !== 'string') {
            return null;
        }
        const texts: InkText[] = (Array.isArray(parsed.t) ? parsed.t : [])
            .filter((raw: unknown) => Array.isArray(raw) && raw.length >= 5 && typeof raw[4] === 'string')
            .map((raw: any[]) => ({
                x: (Number(raw[0]) || 0) / 10,
                y: (Number(raw[1]) || 0) / 10,
                size: num(raw[2], 180) / 10,
                color: typeof raw[3] === 'string' ? raw[3] : '#1D1D1F',
                text: raw[4],
            }));
        const paper: PaperStyle = Array.isArray(parsed.p)
            ? {
                pattern: PAPER_PATTERNS[Number(parsed.p[0])] || DEFAULT_PAPER.pattern,
                color: typeof parsed.p[1] === 'string' ? parsed.p[1] : null,
                layout: PAPER_LAYOUTS[Number(parsed.p[2])] || LEGACY_PAPER.layout,
            }
            : LEGACY_PAPER;
        return {
            id: parsed.id,
            width: Number(parsed.w) || 800,
            strokes: decodeStrokes(parsed.s, parsed.c, parsed.g),
            texts,
            paper,
        };
    } catch {
        return null;
    }
};

/** SVG pattern tile of the paper, its origin at (0, y) in document coordinates. */
const patternDef = (id: string, paper: PaperStyle, y: number): string => {
    const step = paperStep(paper.pattern);
    const S = SVG_SCALE;
    const line = paper.color ? paperLineColor(paper.color, SVG_THEME_LINE) : SVG_THEME_LINE;
    const t = step * S;
    const half = t / 2;
    const tile = paper.pattern === 'dots'
        ? `<circle cx='${half}' cy='${half}' r='${paperDotRadius * S}' fill='${line}'/>`
        : `<path d='M0 ${half}H${t}${paper.pattern === 'grid' || paper.pattern === 'smallGrid' ? `M${half} 0V${t}` : ''}' stroke='${line}' stroke-width='${S}' fill='none'/>`;
    return `<pattern id='${id}'${y ? ` y='${Math.round(y * S)}'` : ''} width='${t}' height='${t}' patternUnits='userSpaceOnUse'>${tile}</pattern>`;
};

/** Paper of the rectangle (document coordinates) as SVG: sheet colour, pattern, margin line. */
const sheetSvg = (paper: PaperStyle, id: string, x: number, y: number, width: number, height: number): string => {
    const S = SVG_SCALE;
    const rect = `x='${Math.round(x * S)}' y='${Math.round(y * S)}' width='${Math.round(width * S)}' height='${Math.round(height * S)}'`;
    let out = paper.color ? `<rect ${rect} fill='${paper.color}'/>` : '';
    if (paperStep(paper.pattern)) {
        out += `<rect ${rect} fill='url(#${id})'/>`;
        if (paper.pattern === 'margin' && x <= PAPER_MARGIN_X && x + width >= PAPER_MARGIN_X) {
            out += `<path d='M${PAPER_MARGIN_X * S} ${Math.round(y * S)}v${Math.round(height * S)}' stroke='${PAPER_MARGIN_COLOR}' stroke-width='${S}'/>`;
        }
    }
    return out;
};

/** A straightened shape as an SVG line of even width with round joins. */
const shapeSvg = (stroke: InkStroke): string => {
    const S = SVG_SCALE;
    const pts = stroke.points;
    let px = Math.round(pts[0] * S);
    let py = Math.round(pts[1] * S);
    let d = `M${px} ${py}l`;
    let segments = 0;
    for (let i = 3; i + 1 < pts.length; i += 3) {
        const x = Math.round(pts[i] * S);
        const y = Math.round(pts[i + 1] * S);
        if (x === px && y === py) {
            continue;
        }
        d += `${segments && x - px >= 0 ? ' ' : ''}${x - px}${y - py >= 0 ? ' ' : ''}${y - py}`;
        px = x;
        py = y;
        segments += 1;
    }
    if (!segments) {
        return '';
    }
    const spec = INK_TOOLS[stroke.tool];
    const opacity = spec?.opacity ?? 1;
    return `<path d='${d}${shapeIsClosed(pts) ? 'z' : ''}' fill='none' stroke='${stroke.color}' stroke-width='${Math.round(shapeWidth(stroke) * S * 10) / 10}' stroke-linejoin='round' stroke-linecap='round'${opacity < 1 ? ` stroke-opacity='${opacity}'` : ''}${stroke.tool === 'marker' ? " style='mix-blend-mode:multiply'" : ''}/>`;
};

export const buildDrawingSvg = (doc: DrawingDocument): string => {
    const texts = doc.texts || [];
    const paper = doc.paper || DEFAULT_PAPER;
    const hasSheet = !!paper.color || paper.pattern !== 'blank';
    const bounds = drawingBounds(doc.strokes, texts);
    const S = SVG_SCALE;
    let left: number;
    let top: number;
    let width: number;
    let height: number;
    if (paper.layout === 'canvas') {
        // An unbounded sheet: frame what was drawn, wherever it is.
        left = bounds ? Math.floor(bounds.minX - PADDING) : 0;
        top = bounds ? Math.floor(bounds.minY - PADDING) : 0;
        width = bounds ? Math.ceil(bounds.maxX + PADDING) - left : Math.round(doc.width);
        height = Math.max(MIN_HEIGHT, bounds ? Math.ceil(bounds.maxY + PADDING) - top : MIN_HEIGHT);
    } else {
        // Pages keep their full width and, on visible paper, start at the top of
        // the first page; plain ink is cropped to what was drawn.
        left = 0;
        width = Math.round(doc.width);
        top = bounds && !hasSheet ? Math.max(0, Math.floor(bounds.minY - PADDING)) : 0;
        height = Math.max(MIN_HEIGHT, bounds ? Math.ceil(bounds.maxY + PADDING) - top : MIN_HEIGHT);
    }
    let sheet = '';
    let sheetDefs = '';
    if (hasSheet) {
        if (paper.layout === 'canvas') {
            sheetDefs = paperStep(paper.pattern) ? patternDef('p', paper, 0) : '';
            sheet = sheetSvg(paper, 'p', left, top, width, height);
        } else {
            // Each page is its own sheet, the pattern starting at its top edge.
            const pitch = pagePitch(doc.width);
            const sheetHeight = pageHeight(doc.width);
            for (let page = Math.floor(top / pitch); page * pitch < top + height; page++) {
                const pageTop = page * pitch;
                const y = Math.max(top, pageTop);
                const bottom = Math.min(top + height, pageTop + sheetHeight);
                if (bottom <= y) {
                    continue;
                }
                if (paperStep(paper.pattern)) {
                    sheetDefs += patternDef(`p${page}`, paper, pageTop);
                }
                sheet += sheetSvg(paper, `p${page}`, 0, y, width, bottom - y);
            }
        }
    }
    const textNodes = texts.map((item) => item.text.split('\n').map((lineText, index) => {
        if (!lineText) {
            return '';
        }
        const baseline = item.y + item.size * (0.82 + index * INK_TEXT_LINE_HEIGHT);
        return `<text x='${Math.round(item.x * S)}' y='${Math.round(baseline * S)}' font-size='${Math.round(item.size * S)}' font-family='Roboto,Helvetica,Arial,sans-serif' fill='${item.color}'>${escapeXml(lineText)}</text>`;
    }).join('')).join('');
    const paths = doc.strokes.map((stroke) => {
        if (stroke.shape) {
            return shapeSvg(stroke);
        }
        const d = outlineToSvgPath(strokeOutlineFor(stroke), SVG_SCALE);
        if (!d) {
            return '';
        }
        const spec = INK_TOOLS[stroke.tool];
        const opacity = spec?.opacity ?? 1;
        return `<path d='${d}' fill='${stroke.color}'${opacity < 1 ? ` fill-opacity='${opacity}'` : ''}${spec?.grain ? " filter='url(#g)'" : ''}${stroke.tool === 'marker' ? " style='mix-blend-mode:multiply'" : ''}/>`;
    }).join('');
    // Same graphite grain as the canvas: noise as an alpha mask over the ink.
    const grain = doc.strokes.some((stroke) => INK_TOOLS[stroke.tool]?.grain)
        ? `<filter id='g'><feTurbulence type='fractalNoise' baseFrequency='${0.9 / SVG_SCALE}' numOctaves='2' seed='3'/>`
            + "<feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 2.6 0 0 0 -0.55'/>"
            + "<feComposite in='SourceGraphic' operator='in'/></filter>"
        : '';
    const defs = grain || sheetDefs ? `<defs>${sheetDefs}${grain}</defs>` : '';
    // class='vp': a sheet with its own colour must not be inverted in dark mode (see drawingEmbeds).
    return `<svg xmlns='http://www.w3.org/2000/svg'${paper.color ? " class='vp'" : ''} width='${width}' height='${height}' viewBox='${left * S} ${top * S} ${width * S} ${height * S}'>${defs}${sheet}${paths}${textNodes}</svg>`;
};

export const buildDrawingSrc = (doc: DrawingDocument): string => {
    const payload = {
        v: 1,
        id: doc.id,
        w: Math.round(doc.width),
        s: doc.strokes.map(encodeStroke),
        // Strokes the eraser cut (indices into s); older versions ignore it and taper them.
        ...(doc.strokes.some((stroke) => stroke.cut)
            ? { c: doc.strokes.flatMap((stroke, index) => (stroke.cut ? [index] : [])) }
            : {}),
        // Straightened shapes (indices into s); older versions draw them as ink.
        ...(doc.strokes.some((stroke) => stroke.shape)
            ? { g: doc.strokes.flatMap((stroke, index) => (stroke.shape ? [index] : [])) }
            : {}),
        ...(doc.texts && doc.texts.length
            ? { t: doc.texts.map((item) => [Math.round(item.x * 10), Math.round(item.y * 10), Math.round(item.size * 10), item.color, item.text]) }
            : {}),
        // Always stored: a drawing without `p` predates pages and opens as a canvas.
        p: [
            PAPER_PATTERNS.indexOf((doc.paper || DEFAULT_PAPER).pattern),
            (doc.paper || DEFAULT_PAPER).color,
            PAPER_LAYOUTS.indexOf((doc.paper || DEFAULT_PAPER).layout),
        ],
    };
    return `data:image/svg+xml;charset=utf-8,${escapeForSrc(buildDrawingSvg(doc))}${DRAWING_MARKER}${escapePayload(JSON.stringify(payload))}`;
};

/**
 * A picture of the first drawing in note HTML for a thumbnail in the notes
 * list, framed tightly around what is drawn (a page keeps its full width in
 * the note, which would make the thumbnail tiny); null when there is none.
 */
export const firstDrawingSvg = (html: string): string | null => {
    const markerAt = html.indexOf(DRAWING_MARKER);
    if (markerAt === -1) {
        return null;
    }
    const start = html.lastIndexOf('data:image/svg+xml', markerAt);
    const quote = start > 0 ? html[start - 1] : '"';
    const end = html.indexOf(quote === "'" ? "'" : '"', markerAt);
    const doc = start === -1 ? null : parseDrawingSrc(html.slice(start, end === -1 ? undefined : end));
    if (!doc || (!doc.strokes.length && !(doc.texts && doc.texts.length))) {
        return null;
    }
    return buildDrawingSvg({ ...doc, paper: { ...(doc.paper || DEFAULT_PAPER), layout: 'canvas' } });
};

/**
 * Puts a drawing into note HTML without the editor: replaces the <img> of the
 * drawing with this id, or appends it. Used to save a drawing straight to the
 * note when the app goes to the background, where the editor WebView may not
 * answer in time. `src` null removes the drawing.
 */
export const upsertDrawingInHtml = (html: string, id: string, src: string | null): string => {
    let replaced = false;
    const next = html.replace(/<img\b[^>]*>/gi, (tag) => {
        if (replaced) {
            return tag;
        }
        const match = /\ssrc=(["'])(.*?)\1/i.exec(tag);
        if (!match || !match[2].includes(DRAWING_MARKER) || parseDrawingSrc(match[2])?.id !== id) {
            return tag;
        }
        replaced = true;
        return src ? tag.replace(match[0], ` src="${src}"`) : '';
    });
    if (replaced || !src) {
        return next;
    }
    return `${html}<img src="${src}"><p></p>`;
};
