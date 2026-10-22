// Handwriting model shared by the drawing canvas (Skia, UI thread) and the
// in-note preview (SVG). Strokes are kept as raw samples - x, y and pressure -
// so they can be re-rendered at any size and edited again later; the filled
// outline is derived from them the same way everywhere.

export type InkTool = 'fountain' | 'ballpoint' | 'pencil' | 'marker' | 'brush';

export type InkStroke = {
    tool: InkTool;
    color: string;
    size: number;
    /** Flat [x, y, pressure, x, y, pressure, ...] in document coordinates. */
    points: number[];
};

/** A typed label on the canvas; (x, y) is its top-left corner in document coordinates. */
export type InkText = {
    x: number;
    y: number;
    text: string;
    size: number;
    color: string;
};

export const INK_TEXT_LINE_HEIGHT = 1.25;

export type InkToolSpec = {
    /** How much pressure changes the width (0 = constant width). */
    thinning: number;
    /** Lag towards the input that smooths hand jitter (0..1). */
    streamline: number;
    taper: boolean;
    opacity: number;
    /** Chisel nib at 45°: share of the width that depends on stroke direction. */
    nib: number;
    /** Graphite grain texture (pencil). */
    grain: boolean;
    sizes: number[];
};

export const INK_TOOLS: Record<InkTool, InkToolSpec> = {
    fountain: { thinning: 0.55, streamline: 0.45, taper: true, opacity: 1, nib: 0.6, grain: false, sizes: [2, 3.2, 4.8, 7, 10] },
    ballpoint: { thinning: 0.12, streamline: 0.4, taper: false, opacity: 1, nib: 0, grain: false, sizes: [1.2, 1.9, 2.8, 4, 5.5] },
    pencil: { thinning: 0.35, streamline: 0.3, taper: true, opacity: 0.9, nib: 0, grain: true, sizes: [1.4, 2.2, 3.2, 4.6, 6.5] },
    marker: { thinning: 0, streamline: 0.55, taper: false, opacity: 0.38, nib: 0, grain: false, sizes: [10, 14, 20, 28, 38] },
    brush: { thinning: 1.15, streamline: 0.55, taper: true, opacity: 1, nib: 0, grain: false, sizes: [5, 8, 12, 18, 26] },
};

export const INK_TOOL_ORDER: InkTool[] = ['fountain', 'ballpoint', 'pencil', 'brush', 'marker'];

// Colours are authored for light paper; dark mode shows the drawing through a
// smart-invert filter (black ink turns white, hues are kept).
export const INK_COLORS = [
    '#1D1D1F', '#5F6368', '#9AA0A6', '#FFFFFF', '#B71C1C', '#E53935', '#F06292', '#D81B60',
    '#8E24AA', '#5E35B1', '#3949AB', '#1E88E5', '#039BE5', '#00ACC1', '#00897B', '#43A047',
    '#7CB342', '#C0CA33', '#FDD835', '#FFB300', '#FB8C00', '#F4511E', '#6D4C41', '#A1887F',
];

export const INK_DEFAULT_COLOR: Record<InkTool, string> = {
    fountain: '#1D1D1F',
    ballpoint: '#1E88E5',
    pencil: '#6B7280',
    marker: '#FDD835',
    brush: '#E53935',
};

/** Invert + 180° hue rotation, i.e. CSS `invert(1) hue-rotate(180deg)`. */
export const SMART_INVERT_MATRIX = [
    0.574, -1.43, -0.144, 0, 1,
    -0.426, -0.43, -0.144, 0, 1,
    -0.426, -1.43, 0.856, 0, 1,
    0, 0, 0, 1, 0,
];

/**
 * Colour matrix applied to fractal noise to get pencil graphite: the ink colour
 * with alpha taken from the noise, so the paper shows through in a grain.
 */
export const pencilGrainMatrix = (hex: string): number[] => {
    const value = parseInt(hex.replace('#', ''), 16) || 0;
    const r = ((value >> 16) & 255) / 255;
    const g = ((value >> 8) & 255) / 255;
    const b = (value & 255) / 255;
    return [
        0, 0, 0, 0, r,
        0, 0, 0, 0, g,
        0, 0, 0, 0, b,
        2.6, 0, 0, 0, -0.55,
    ];
};

const CAP_STEPS = 8;

/**
 * Filled outline of a pressure-sensitive stroke as a flat [x, y, ...] polygon.
 * `complete` is false while the stroke is still being drawn: its end then
 * stays at full width instead of tapering, so the tip does not jump.
 */
export function strokeOutline(
    points: number[],
    size: number,
    thinning: number,
    streamline: number,
    taper: boolean,
    complete: boolean,
    nib: number = 0
): number[] {
    'worklet';
    const count = Math.floor(points.length / 3);
    if (count === 0) {
        return [];
    }

    const xs: number[] = [];
    const ys: number[] = [];
    const rs: number[] = [];
    const minRadius = size * 0.08;
    let sx = points[0];
    let sy = points[1];
    let sp = points[2];
    for (let i = 0; i < count; i++) {
        const x = points[i * 3];
        const y = points[i * 3 + 1];
        const p = points[i * 3 + 2];
        if (i > 0) {
            sx += (x - sx) * (1 - streamline);
            sy += (y - sy) * (1 - streamline);
            sp += (p - sp) * 0.35;
            const last = xs.length - 1;
            const dx = sx - xs[last];
            const dy = sy - ys[last];
            // Dense samples add nothing but outline points.
            if (dx * dx + dy * dy < 0.6 && i < count - 1) {
                continue;
            }
        }
        xs.push(sx);
        ys.push(sy);
        rs.push(Math.max(minRadius, (size / 2) * (1 + thinning * (sp - 0.5) * 1.6)));
    }
    if (complete && count > 1) {
        // The streamlined line lags the pen; finish exactly where it lifted.
        xs.push(points[(count - 1) * 3]);
        ys.push(points[(count - 1) * 3 + 1]);
        rs.push(rs[rs.length - 1]);
    }

    const n = xs.length;
    if (taper && n > 2) {
        let total = 0;
        const dist: number[] = [0];
        for (let i = 1; i < n; i++) {
            total += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
            dist.push(total);
        }
        const taperLength = Math.min(size * 3, total / 2);
        if (taperLength > 0) {
            for (let i = 0; i < n; i++) {
                const fromStart = Math.min(1, dist[i] / taperLength);
                const fromEnd = complete ? Math.min(1, (total - dist[i]) / taperLength) : 1;
                const t = Math.min(fromStart, fromEnd);
                // Ease-out so the tip narrows quickly and then holds.
                const eased = 1 - (1 - t) * (1 - t);
                rs[i] = Math.max(minRadius, rs[i] * (0.25 + 0.75 * eased));
            }
        }
    }

    const outline: number[] = [];
    if (n === 1) {
        const r = rs[0];
        for (let i = 0; i < CAP_STEPS * 2; i++) {
            const angle = (i / (CAP_STEPS * 2)) * Math.PI * 2;
            outline.push(xs[0] + Math.cos(angle) * r, ys[0] + Math.sin(angle) * r);
        }
        return outline;
    }

    const left: number[] = [];
    const right: number[] = [];
    const dirX: number[] = [];
    const dirY: number[] = [];
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
            const across = Math.abs(dx * 0.7071 + dy * 0.7071);
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
    for (let s = 1; s < CAP_STEPS; s++) {
        const theta = (s / CAP_STEPS) * Math.PI;
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
    for (let s = 1; s < CAP_STEPS; s++) {
        const theta = (s / CAP_STEPS) * Math.PI;
        const nx = -dirY[0];
        const ny = dirX[0];
        outline.push(
            xs[0] - rs[0] * (nx * Math.cos(theta) + dirX[0] * Math.sin(theta)),
            ys[0] - rs[0] * (ny * Math.cos(theta) + dirY[0] * Math.sin(theta))
        );
    }
    return outline;
}

export function strokeOutlineFor(stroke: InkStroke, complete: boolean = true): number[] {
    'worklet';
    const spec = INK_TOOLS[stroke.tool] || INK_TOOLS.fountain;
    return strokeOutline(stroke.points, stroke.size, spec.thinning, spec.streamline, spec.taper, complete, spec.nib);
}

/**
 * Compact SVG path data: integer coordinates in units of 1/`scale` px, relative
 * line segments, and samples closer than one unit dropped. The outline is dense
 * enough that straight segments look smooth, at a fraction of the size.
 */
export const outlineToSvgPath = (outline: number[], scale: number = 2): string => {
    const n = outline.length / 2;
    if (n < 3) {
        return '';
    }
    let px = Math.round(outline[0] * scale);
    let py = Math.round(outline[1] * scale);
    let d = `M${px} ${py}l`;
    let segments = 0;
    for (let i = 1; i < n; i++) {
        const x = Math.round(outline[i * 2] * scale);
        const y = Math.round(outline[i * 2 + 1] * scale);
        const dx = x - px;
        const dy = y - py;
        if (Math.abs(dx) + Math.abs(dy) < 2 && i < n - 1) {
            continue;
        }
        if (dx === 0 && dy === 0) {
            continue;
        }
        // A minus sign separates numbers on its own.
        d += `${segments && dx >= 0 ? ' ' : ''}${dx}${dy >= 0 ? ' ' : ''}${dy}`;
        px = x;
        py = y;
        segments += 1;
    }
    return segments >= 2 ? `${d}z` : '';
};

export const strokeBounds = (strokes: InkStroke[]): { minY: number; maxY: number } | null => {
    let minY = Infinity;
    let maxY = -Infinity;
    strokes.forEach((stroke) => {
        for (let i = 1; i < stroke.points.length; i += 3) {
            minY = Math.min(minY, stroke.points[i] - stroke.size);
            maxY = Math.max(maxY, stroke.points[i] + stroke.size);
        }
    });
    return Number.isFinite(minY) ? { minY, maxY } : null;
};

/** True when the eraser circle at (x, y) touches the stroke. */
export const strokeHit = (stroke: InkStroke, x: number, y: number, radius: number): boolean => {
    const reach = radius + stroke.size / 2;
    const reach2 = reach * reach;
    const pts = stroke.points;
    for (let i = 0; i + 2 < pts.length; i += 3) {
        const dx = pts[i] - x;
        const dy = pts[i + 1] - y;
        if (dx * dx + dy * dy <= reach2) {
            return true;
        }
        if (i + 5 < pts.length) {
            // Distance to the segment, so fast strokes with sparse samples still erase.
            const ax = pts[i];
            const ay = pts[i + 1];
            const bx = pts[i + 3];
            const by = pts[i + 4];
            const abx = bx - ax;
            const aby = by - ay;
            const len2 = abx * abx + aby * aby;
            if (len2 > 0) {
                const t = Math.max(0, Math.min(1, ((x - ax) * abx + (y - ay) * aby) / len2));
                const px = ax + abx * t - x;
                const py = ay + aby * t - y;
                if (px * px + py * py <= reach2) {
                    return true;
                }
            }
        }
    }
    return false;
};
