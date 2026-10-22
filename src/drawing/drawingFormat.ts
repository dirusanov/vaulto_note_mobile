import { INK_TEXT_LINE_HEIGHT, INK_TOOLS, INK_TOOL_ORDER, InkStroke, InkText, InkTool, outlineToSvgPath, strokeBounds, strokeOutlineFor } from './ink';
import {
    DEFAULT_PAPER,
    PAPER_MARGIN_COLOR,
    PAPER_MARGIN_X,
    PAPER_PATTERNS,
    PaperStyle,
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
};

/** Pattern line colour of the theme paper in the SVG (light theme; dark mode inverts the image). */
const SVG_THEME_LINE = '#DEE2E6';

const escapeXml = (text: string): string =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&apos;');

/** Vertical extent of everything drawn or typed. */
export const drawingBounds = (strokes: InkStroke[], texts: InkText[] = []): { minY: number; maxY: number } | null => {
    const strokeBox = strokeBounds(strokes);
    let minY = strokeBox ? strokeBox.minY : Infinity;
    let maxY = strokeBox ? strokeBox.maxY : -Infinity;
    texts.forEach((item) => {
        const lines = Math.max(1, item.text.split('\n').length);
        minY = Math.min(minY, item.y);
        maxY = Math.max(maxY, item.y + lines * item.size * INK_TEXT_LINE_HEIGHT);
    });
    return Number.isFinite(minY) ? { minY, maxY } : null;
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
const MIN_HEIGHT = 120;

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
        points.push(x / 10, y / 10, (Number(raw[i + 2]) || 50) / 100);
    }
    return {
        tool,
        color: typeof raw[1] === 'string' ? raw[1] : '#1D1D1F',
        size: (Number(raw[2]) || 20) / 10,
        points,
    };
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
                size: (Number(raw[2]) || 180) / 10,
                color: typeof raw[3] === 'string' ? raw[3] : '#1D1D1F',
                text: raw[4],
            }));
        const paper: PaperStyle = Array.isArray(parsed.p)
            ? {
                pattern: PAPER_PATTERNS[Number(parsed.p[0])] || DEFAULT_PAPER.pattern,
                color: typeof parsed.p[1] === 'string' ? parsed.p[1] : null,
            }
            : DEFAULT_PAPER;
        return {
            id: parsed.id,
            width: Number(parsed.w) || 800,
            strokes: (Array.isArray(parsed.s) ? parsed.s : []).map(decodeStroke).filter(Boolean) as InkStroke[],
            texts,
            paper,
        };
    } catch {
        return null;
    }
};

export const buildDrawingSvg = (doc: DrawingDocument): string => {
    const texts = doc.texts || [];
    const paper = doc.paper || DEFAULT_PAPER;
    const hasSheet = !!paper.color || paper.pattern !== 'blank';
    const bounds = drawingBounds(doc.strokes, texts);
    // A drawing on visible paper keeps its full width of sheet from the top,
    // like a page; plain ink is cropped to what was drawn.
    const top = bounds && !hasSheet ? Math.max(0, Math.floor(bounds.minY - PADDING)) : 0;
    const height = Math.max(MIN_HEIGHT, bounds ? Math.ceil(bounds.maxY + PADDING) - top : MIN_HEIGHT);
    const width = Math.round(doc.width);
    const S = SVG_SCALE;
    let sheet = '';
    let sheetDefs = '';
    if (paper.color) {
        sheet += `<rect x='0' y='${top * S}' width='${width * S}' height='${height * S}' fill='${paper.color}'/>`;
    }
    const step = paperStep(paper.pattern);
    if (step) {
        const line = paper.color ? paperLineColor(paper.color, SVG_THEME_LINE) : SVG_THEME_LINE;
        const t = step * S;
        const half = t / 2;
        const tile = paper.pattern === 'dots'
            ? `<circle cx='${half}' cy='${half}' r='${paperDotRadius * S}' fill='${line}'/>`
            : `<path d='M0 ${half}H${t}${paper.pattern === 'grid' || paper.pattern === 'smallGrid' ? `M${half} 0V${t}` : ''}' stroke='${line}' stroke-width='${S}' fill='none'/>`;
        sheetDefs = `<pattern id='p' width='${t}' height='${t}' patternUnits='userSpaceOnUse'>${tile}</pattern>`;
        sheet += `<rect x='0' y='${top * S}' width='${width * S}' height='${height * S}' fill='url(#p)'/>`;
        if (paper.pattern === 'margin') {
            sheet += `<path d='M${PAPER_MARGIN_X * S} ${top * S}V${(top + height) * S}' stroke='${PAPER_MARGIN_COLOR}' stroke-width='${S}'/>`;
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
        const d = outlineToSvgPath(strokeOutlineFor(stroke), SVG_SCALE);
        if (!d) {
            return '';
        }
        const spec = INK_TOOLS[stroke.tool];
        const opacity = spec?.opacity ?? 1;
        return `<path d='${d}' fill='${stroke.color}'${opacity < 1 ? ` fill-opacity='${opacity}'` : ''}${spec?.grain ? " filter='url(#g)'" : ''}/>`;
    }).join('');
    // Same graphite grain as the canvas: noise as an alpha mask over the ink.
    const grain = doc.strokes.some((stroke) => INK_TOOLS[stroke.tool]?.grain)
        ? `<filter id='g'><feTurbulence type='fractalNoise' baseFrequency='${0.9 / SVG_SCALE}' numOctaves='2' seed='3'/>`
            + "<feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 2.6 0 0 0 -0.55'/>"
            + "<feComposite in='SourceGraphic' operator='in'/></filter>"
        : '';
    const defs = grain || sheetDefs ? `<defs>${sheetDefs}${grain}</defs>` : '';
    // class='vp': a sheet with its own colour must not be inverted in dark mode (see drawingEmbeds).
    return `<svg xmlns='http://www.w3.org/2000/svg'${paper.color ? " class='vp'" : ''} width='${width}' height='${height}' viewBox='0 ${top * S} ${width * S} ${height * S}'>${defs}${sheet}${paths}${textNodes}</svg>`;
};

export const buildDrawingSrc = (doc: DrawingDocument): string => {
    const payload = {
        v: 1,
        id: doc.id,
        w: Math.round(doc.width),
        s: doc.strokes.map(encodeStroke),
        ...(doc.texts && doc.texts.length
            ? { t: doc.texts.map((item) => [Math.round(item.x * 10), Math.round(item.y * 10), Math.round(item.size * 10), item.color, item.text]) }
            : {}),
        ...(doc.paper && (doc.paper.color || doc.paper.pattern !== 'blank')
            ? { p: [PAPER_PATTERNS.indexOf(doc.paper.pattern), doc.paper.color] }
            : {}),
    };
    return `data:image/svg+xml;charset=utf-8,${escapeForSrc(buildDrawingSvg(doc))}${DRAWING_MARKER}${escapeForSrc(JSON.stringify(payload))}`;
};
