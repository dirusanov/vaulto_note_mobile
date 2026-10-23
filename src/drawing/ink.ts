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
    /** The stroke starts where the eraser cut a longer one: no pen-down taper there. */
    cut?: boolean;
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

// Light smoothing only: a pen is precise, and heavy smoothing rounded letters
// off and made the line trail behind the nib.
export const INK_TOOLS: Record<InkTool, InkToolSpec> = {
    fountain: { thinning: 0.55, streamline: 0.18, taper: true, opacity: 1, nib: 0.6, grain: false, sizes: [2, 3.2, 4.8, 7, 10] },
    ballpoint: { thinning: 0.12, streamline: 0.15, taper: false, opacity: 1, nib: 0, grain: false, sizes: [1.2, 1.9, 2.8, 4, 5.5] },
    pencil: { thinning: 0.35, streamline: 0.12, taper: true, opacity: 0.9, nib: 0, grain: true, sizes: [1.4, 2.2, 3.2, 4.6, 6.5] },
    marker: { thinning: 0, streamline: 0.25, taper: false, opacity: 0.38, nib: 0, grain: false, sizes: [10, 14, 20, 28, 38] },
    brush: { thinning: 1.15, streamline: 0.25, taper: true, opacity: 1, nib: 0, grain: false, sizes: [5, 8, 12, 18, 26] },
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
    'worklet';
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
 *
 * Every step only looks backwards (smoothing, pressure, the taper at the start,
 * the nib direction), so the outline of a stroke's beginning never changes as
 * the stroke grows: the line you wrote stays exactly as it appeared, and
 * lifting the pen changes nothing. Only the last sample or two follow the pen.
 */
export function strokeOutline(
    points: number[],
    size: number,
    thinning: number,
    streamline: number,
    taper: boolean,
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
    const dist: number[] = [];
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

export function strokeOutlineFor(stroke: InkStroke): number[] {
    'worklet';
    const spec = INK_TOOLS[stroke.tool] || INK_TOOLS.fountain;
    return strokeOutline(stroke.points, stroke.size, spec.thinning, spec.streamline, spec.taper && !stroke.cut, spec.nib);
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

export type InkBounds = { minX: number; minY: number; maxX: number; maxY: number };

const boundsCache = new WeakMap<InkStroke, InkBounds | null>();

/** Box of one stroke's samples grown by its width; cached, strokes are never mutated. */
const boundsOf = (stroke: InkStroke): InkBounds | null => {
    let bounds = boundsCache.get(stroke);
    if (bounds === undefined) {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        const pts = stroke.points;
        for (let i = 0; i + 1 < pts.length; i += 3) {
            minX = Math.min(minX, pts[i] - stroke.size);
            maxX = Math.max(maxX, pts[i] + stroke.size);
            minY = Math.min(minY, pts[i + 1] - stroke.size);
            maxY = Math.max(maxY, pts[i + 1] + stroke.size);
        }
        bounds = Number.isFinite(minY) ? { minX, minY, maxX, maxY } : null;
        boundsCache.set(stroke, bounds);
    }
    return bounds;
};

export const strokeBounds = (strokes: InkStroke[]): InkBounds | null => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    strokes.forEach((stroke) => {
        const box = boundsOf(stroke);
        if (box) {
            minX = Math.min(minX, box.minX);
            maxX = Math.max(maxX, box.maxX);
            minY = Math.min(minY, box.minY);
            maxY = Math.max(maxY, box.maxY);
        }
    });
    return Number.isFinite(minY) ? { minX, minY, maxX, maxY } : null;
};

/** True when the eraser circle at (x, y) touches the stroke. */
export const strokeHit = (stroke: InkStroke, x: number, y: number, radius: number): boolean => {
    if (!nearStroke(stroke, x, y, radius)) {
        return false;
    }
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

/** Distance at which the eraser circle touches the ink of the stroke. */
const eraseReach = (stroke: InkStroke, radius: number): number => radius + stroke.size / 2;

// The eraser runs over every stroke many times a second; a box test skips the
// strokes it is nowhere near without walking their points.
/** True when the eraser circle at (x, y) may touch the stroke (its box, grown by the circle). */
const nearStroke = (stroke: InkStroke, x: number, y: number, radius: number): boolean => {
    const box = boundsOf(stroke);
    return !!box && x >= box.minX - radius && x <= box.maxX + radius && y >= box.minY - radius && y <= box.maxY + radius;
};

/**
 * What is left of the stroke after the eraser circle at (x, y) passed over it:
 * null when the circle misses it, otherwise the pieces outside the circle
 * (none when it covered the whole stroke). The line is cut exactly at the edge
 * of the circle, so a fast stroke with sparse samples is cut where it crosses,
 * not at the nearest sample.
 */
export const eraseStroke = (stroke: InkStroke, x: number, y: number, radius: number): InkStroke[] | null => {
    const pts = stroke.points;
    const count = Math.floor(pts.length / 3);
    if (count === 0 || !nearStroke(stroke, x, y, radius)) {
        return null;
    }
    const reach = eraseReach(stroke, radius);
    const reach2 = reach * reach;
    const inside = (i: number) => (pts[i * 3] - x) ** 2 + (pts[i * 3 + 1] - y) ** 2 <= reach2;
    if (count === 1) {
        return inside(0) ? [] : null;
    }
    const pieces: number[][] = [];
    const starts: number[] = [];
    let current: number[] | null = inside(0) ? null : [pts[0], pts[1], pts[2]];
    let currentStart = 0;
    let touched = current === null;
    const at = (i: number, t: number) => [
        pts[i * 3] + (pts[i * 3 + 3] - pts[i * 3]) * t,
        pts[i * 3 + 1] + (pts[i * 3 + 4] - pts[i * 3 + 1]) * t,
        pts[i * 3 + 2] + (pts[i * 3 + 5] - pts[i * 3 + 2]) * t,
    ];
    for (let i = 0; i + 1 < count; i++) {
        const ax = pts[i * 3] - x;
        const ay = pts[i * 3 + 1] - y;
        const dx = pts[i * 3 + 3] - pts[i * 3];
        const dy = pts[i * 3 + 4] - pts[i * 3 + 1];
        // Where the segment runs inside the circle: |a + t·d| ≤ reach for t in [enter, leave].
        const a = dx * dx + dy * dy;
        const b = ax * dx + ay * dy;
        const c = ax * ax + ay * ay - reach2;
        const disc = b * b - a * c;
        let enter = 2;
        let leave = -1;
        if (a > 0 && disc > 0) {
            const root = Math.sqrt(disc);
            enter = Math.max(0, (-b - root) / a);
            leave = Math.min(1, (-b + root) / a);
        } else if (c <= 0) {
            enter = 0;
            leave = 1;
        }
        if (enter > leave) {
            if (current) {
                current.push(pts[i * 3 + 3], pts[i * 3 + 4], pts[i * 3 + 5]);
            } else {
                current = [pts[i * 3 + 3], pts[i * 3 + 4], pts[i * 3 + 5]];
                currentStart = i + 1;
            }
            continue;
        }
        touched = true;
        if (current) {
            if (enter > 0) {
                current.push(...at(i, enter));
            }
            pieces.push(current);
            starts.push(currentStart);
            current = null;
        }
        if (leave < 1) {
            current = [...at(i, leave), pts[i * 3 + 3], pts[i * 3 + 4], pts[i * 3 + 5]];
            currentStart = -1;
        }
    }
    if (!touched) {
        return null;
    }
    if (current) {
        pieces.push(current);
        starts.push(currentStart);
    }
    const kept: InkStroke[] = [];
    pieces.forEach((points, index) => {
        let length = 0;
        for (let i = 3; i + 2 < points.length; i += 3) {
            length += Math.hypot(points[i] - points[i - 3], points[i + 1] - points[i - 2]);
        }
        // Crumbs at the edge of the circle are erased too.
        if (length < Math.max(0.5, stroke.size * 0.25)) {
            return;
        }
        const cut = starts[index] === 0 ? stroke.cut : true;
        kept.push({ tool: stroke.tool, color: stroke.color, size: stroke.size, points, ...(cut ? { cut: true } : {}) });
    });
    return kept;
};
