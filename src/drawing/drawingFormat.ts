import { INK_TOOLS, INK_TOOL_ORDER, InkStroke, InkTool, outlineToSvgPath, strokeBounds, strokeOutlineFor } from './ink';

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
        return {
            id: parsed.id,
            width: Number(parsed.w) || 800,
            strokes: (Array.isArray(parsed.s) ? parsed.s : []).map(decodeStroke).filter(Boolean) as InkStroke[],
        };
    } catch {
        return null;
    }
};

export const buildDrawingSvg = (doc: DrawingDocument): string => {
    const bounds = strokeBounds(doc.strokes);
    const top = bounds ? Math.max(0, Math.floor(bounds.minY - PADDING)) : 0;
    const height = Math.max(MIN_HEIGHT, bounds ? Math.ceil(bounds.maxY + PADDING) - top : MIN_HEIGHT);
    const width = Math.round(doc.width);
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
    const defs = doc.strokes.some((stroke) => INK_TOOLS[stroke.tool]?.grain)
        ? `<defs><filter id='g'><feTurbulence type='fractalNoise' baseFrequency='${0.9 / SVG_SCALE}' numOctaves='2' seed='3'/>`
            + "<feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 2.6 0 0 0 -0.55'/>"
            + "<feComposite in='SourceGraphic' operator='in'/></filter></defs>"
        : '';
    return `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}' viewBox='0 ${top * SVG_SCALE} ${width * SVG_SCALE} ${height * SVG_SCALE}'>${defs}${paths}</svg>`;
};

export const buildDrawingSrc = (doc: DrawingDocument): string => {
    const payload = {
        v: 1,
        id: doc.id,
        w: Math.round(doc.width),
        s: doc.strokes.map(encodeStroke),
    };
    return `data:image/svg+xml;charset=utf-8,${escapeForSrc(buildDrawingSvg(doc))}${DRAWING_MARKER}${escapeForSrc(JSON.stringify(payload))}`;
};
