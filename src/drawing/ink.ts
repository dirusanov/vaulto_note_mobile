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
    /**
     * No pen-down taper at the start: the stroke begins where the eraser cut a
     * longer one, or it is a shape drawn clean.
     */
    cut?: boolean;
    /**
     * A shape straightened from a held stroke: drawn as a plain line of even
     * width with round joins, not as pen ink (no smoothing, nib or pressure).
     */
    shape?: boolean;
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

/** How an ink colour looks on the canvas through SMART_INVERT_MATRIX (dark mode, theme paper). */
export const invertedInkColor = (hex: string): string => {
    const value = parseInt(hex.replace('#', ''), 16) || 0;
    const rgb = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((v) => v / 255);
    const out = [0, 1, 2].map((row) => {
        const m = SMART_INVERT_MATRIX.slice(row * 5, row * 5 + 5);
        const v = m[0] * rgb[0] + m[1] * rgb[1] + m[2] * rgb[2] + m[4];
        return Math.round(Math.min(1, Math.max(0, v)) * 255);
    });
    return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
};

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
 * A stroke's outline being built sample by sample: the smoothed centre line
 * (positions, radii, distance travelled) and the edges of every point that can
 * no longer change. Everything in strokeOutline only looks backwards, so a
 * point's edges are final once the next smoothed point exists; a live stroke
 * of thousands of samples then costs only its newest samples per frame.
 *
 * Plain data and functions, so it lives on the UI thread inside a worklet.
 */
export type InkTrace = {
    size: number;
    thinning: number;
    streamline: number;
    taper: boolean;
    nib: number;
    minRadius: number;
    taperLength: number;
    nibReach: number;
    /** Input samples read so far. */
    consumed: number;
    sx: number;
    sy: number;
    sp: number;
    travelled: number;
    /** Smoothed centre line; the pen's own last point is not in it (see traceTail). */
    xs: number[];
    ys: number[];
    rs: number[];
    dist: number[];
    /** Edges of points 0 .. done - 1: left and right as flat [x, y, ...], direction, radius after the nib. */
    left: number[];
    right: number[];
    dirX: number[];
    dirY: number[];
    radius: number[];
    done: number;
    /** Where the nib direction is measured from, for point `done` (see traceEdge). */
    back: number;
};

export function createTrace(size: number, thinning: number, streamline: number, taper: boolean, nib: number = 0): InkTrace {
    'worklet';
    return {
        size,
        thinning,
        streamline,
        taper,
        nib,
        minRadius: size * 0.08,
        taperLength: size * 2.5,
        // Direction for the nib is taken over this much of the line behind a point,
        // so hand tremor does not flicker the width.
        nibReach: Math.max(1.5, size * 0.6),
        consumed: 0,
        sx: 0,
        sy: 0,
        sp: 0,
        travelled: 0,
        xs: [],
        ys: [],
        rs: [],
        dist: [],
        left: [],
        right: [],
        dirX: [],
        dirY: [],
        radius: [],
        done: 0,
        back: 0,
    };
}

/** Edges of point i of the centre line (xs, ys, rs, dist) with `n` points; `back` is the nib cursor. */
function traceEdge(
    t: InkTrace,
    xs: number[],
    ys: number[],
    rs: number[],
    dist: number[],
    n: number,
    i: number,
    back: number,
    out: number[]
): number {
    'worklet';
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    let dx = xs[b] - xs[a];
    let dy = ys[b] - ys[a];
    const length = Math.hypot(dx, dy) || 1;
    dx /= length;
    dy /= length;
    let r = rs[i];
    if (t.nib > 0) {
        // Width follows the angle between the stroke and a 45° nib edge:
        // thick downstrokes, hairline diagonals, like a real fountain pen.
        while (back < i && dist[i] - dist[back + 1] >= t.nibReach) {
            back += 1;
        }
        const j = back < i ? back : 0;
        const k = back < i ? i : Math.min(n - 1, 1);
        const ndx = xs[k] - xs[j];
        const ndy = ys[k] - ys[j];
        const nl = Math.hypot(ndx, ndy) || 1;
        const across = Math.abs((ndx / nl) * 0.7071 + (ndy / nl) * 0.7071);
        r = Math.max(t.minRadius, r * (1 - t.nib + t.nib * 1.25 * across));
    }
    out[0] = xs[i] - dy * r;
    out[1] = ys[i] + dx * r;
    out[2] = xs[i] + dy * r;
    out[3] = ys[i] - dx * r;
    out[4] = dx;
    out[5] = dy;
    out[6] = r;
    return back;
}

/**
 * Reads the samples of `points` not read yet (a flat [x, y, pressure, ...]
 * that only grows) and fixes the edges of the points that are final now.
 */
export function traceAppend(t: InkTrace, points: number[]): void {
    'worklet';
    const count = Math.floor(points.length / 3);
    const { xs, ys, rs, dist } = t;
    for (let i = t.consumed; i < count; i++) {
        if (i === 0) {
            t.sx = points[0];
            t.sy = points[1];
            t.sp = points[2];
        } else {
            t.sx += (points[i * 3] - t.sx) * (1 - t.streamline);
            t.sy += (points[i * 3 + 1] - t.sy) * (1 - t.streamline);
            t.sp += (points[i * 3 + 2] - t.sp) * 0.35;
            const last = xs.length - 1;
            const dx = t.sx - xs[last];
            const dy = t.sy - ys[last];
            const step2 = dx * dx + dy * dy;
            // Dense samples add nothing but outline points.
            if (step2 < 0.6) {
                continue;
            }
            t.travelled += Math.sqrt(step2);
        }
        let r = Math.max(t.minRadius, (t.size / 2) * (1 + t.thinning * (t.sp - 0.5) * 1.6));
        if (t.taper && t.travelled < t.taperLength) {
            // Ease-out so the tip narrows quickly and then holds.
            const k = t.travelled / t.taperLength;
            r = Math.max(t.minRadius, r * (0.3 + 0.7 * (1 - (1 - k) * (1 - k))));
        }
        xs.push(t.sx);
        ys.push(t.sy);
        rs.push(r);
        dist.push(t.travelled);
    }
    t.consumed = Math.max(t.consumed, count);
    // A point's edges need the point after it; the nib only looks back.
    const edge = [0, 0, 0, 0, 0, 0, 0];
    while (t.done + 1 < xs.length) {
        t.back = traceEdge(t, xs, ys, rs, dist, xs.length, t.done, t.back, edge);
        t.left.push(edge[0], edge[1]);
        t.right.push(edge[2], edge[3]);
        t.dirX.push(edge[4]);
        t.dirY.push(edge[5]);
        t.radius.push(edge[6]);
        t.done += 1;
    }
}

/**
 * Edges of the points that may still change: the newest smoothed point and,
 * when the smoothing lags behind, the pen's own last sample (the ink ends
 * exactly under the nib). `n` is the length of the whole line with them.
 */
export type InkTraceTail = {
    n: number;
    xs: number[];
    ys: number[];
    left: number[];
    right: number[];
    dirX: number[];
    dirY: number[];
    radius: number[];
    /** The line is a single point: drawn as a dot of this radius. */
    dot: number;
};

export function traceTail(t: InkTrace, points: number[]): InkTraceTail {
    'worklet';
    const count = Math.floor(points.length / 3);
    const { xs, ys, rs, dist } = t;
    const smoothed = xs.length;
    const tail: InkTraceTail = { n: smoothed, xs: [], ys: [], left: [], right: [], dirX: [], dirY: [], radius: [], dot: 0 };
    if (smoothed === 0) {
        return tail;
    }
    if (count > 1) {
        // The smoothed line lags the pen by a fraction of a sample: end exactly
        // under it, so the ink stays attached to the nib.
        const lx = points[(count - 1) * 3];
        const ly = points[(count - 1) * 3 + 1];
        const last = smoothed - 1;
        const gap = Math.hypot(lx - xs[last], ly - ys[last]);
        if (gap > 0.05) {
            // Borrowed for a moment: the nib looks back along the whole line.
            xs.push(lx);
            ys.push(ly);
            rs.push(rs[last]);
            dist.push(dist[last] + gap);
        }
    }
    const n = xs.length;
    tail.n = n;
    if (n === 1) {
        tail.xs.push(xs[0]);
        tail.ys.push(ys[0]);
        tail.dot = rs[0];
    } else {
        const edge = [0, 0, 0, 0, 0, 0, 0];
        let back = t.back;
        for (let i = t.done; i < n; i++) {
            back = traceEdge(t, xs, ys, rs, dist, n, i, back, edge);
            tail.xs.push(xs[i]);
            tail.ys.push(ys[i]);
            tail.left.push(edge[0], edge[1]);
            tail.right.push(edge[2], edge[3]);
            tail.dirX.push(edge[4]);
            tail.dirY.push(edge[5]);
            tail.radius.push(edge[6]);
        }
    }
    if (n > smoothed) {
        xs.pop();
        ys.pop();
        rs.pop();
        dist.pop();
    }
    return tail;
}

/**
 * Outline polygon [x, y, ...] of points `from` .. `to` of the line: the left
 * edge forward, the right edge back. `capEnd` / `capStart` round off that end;
 * without, the piece ends straight across, to be joined to its neighbour (see
 * nextFrozenPiece). Points from `t.done` on come from `tail`.
 */
export function traceOutline(t: InkTrace, tail: InkTraceTail | null, from: number, to: number, capStart: boolean, capEnd: boolean): number[] {
    'worklet';
    const outline: number[] = [];
    if (tail && tail.n === 1) {
        const r = tail.dot;
        for (let i = 0; i < CAP_STEPS * 2; i++) {
            const angle = (i / (CAP_STEPS * 2)) * Math.PI * 2;
            outline.push(tail.xs[0] + Math.cos(angle) * r, tail.ys[0] + Math.sin(angle) * r);
        }
        return outline;
    }
    const done = t.done;
    const fixed = Math.min(to + 1, done);
    for (let i = from; i < fixed; i++) {
        outline.push(t.left[i * 2], t.left[i * 2 + 1]);
    }
    if (tail) {
        for (let i = Math.max(from, done); i <= to; i++) {
            outline.push(tail.left[(i - done) * 2], tail.left[(i - done) * 2 + 1]);
        }
    }
    // Round end cap: from the left edge, around the tip, to the right edge.
    if (capEnd) {
        const e = to - done;
        const cx = e >= 0 && tail ? tail.xs[e] : t.xs[to];
        const cy = e >= 0 && tail ? tail.ys[e] : t.ys[to];
        const r = e >= 0 && tail ? tail.radius[e] : t.radius[to];
        const dx = e >= 0 && tail ? tail.dirX[e] : t.dirX[to];
        const dy = e >= 0 && tail ? tail.dirY[e] : t.dirY[to];
        for (let s = 1; s < CAP_STEPS; s++) {
            const theta = (s / CAP_STEPS) * Math.PI;
            const nx = -dy;
            const ny = dx;
            outline.push(
                cx + r * (nx * Math.cos(theta) + dx * Math.sin(theta)),
                cy + r * (ny * Math.cos(theta) + dy * Math.sin(theta))
            );
        }
    }
    if (tail) {
        for (let i = to; i >= Math.max(from, done); i--) {
            outline.push(tail.right[(i - done) * 2], tail.right[(i - done) * 2 + 1]);
        }
    }
    for (let i = fixed - 1; i >= from; i--) {
        outline.push(t.right[i * 2], t.right[i * 2 + 1]);
    }
    if (capStart) {
        const e = from - done;
        const cx = e >= 0 && tail ? tail.xs[e] : t.xs[from];
        const cy = e >= 0 && tail ? tail.ys[e] : t.ys[from];
        const r = e >= 0 && tail ? tail.radius[e] : t.radius[from];
        const dx = e >= 0 && tail ? tail.dirX[e] : t.dirX[from];
        const dy = e >= 0 && tail ? tail.dirY[e] : t.dirY[from];
        for (let s = 1; s < CAP_STEPS; s++) {
            const theta = (s / CAP_STEPS) * Math.PI;
            const nx = -dy;
            const ny = dx;
            outline.push(
                cx - r * (nx * Math.cos(theta) + dx * Math.sin(theta)),
                cy - r * (ny * Math.cos(theta) + dy * Math.sin(theta))
            );
        }
    }
    return outline;
}

/** Points per frozen piece of a live stroke, and how far each piece reaches back into the one before. */
export const LIVE_PIECE = 32;
export const LIVE_OVERLAP = 3;

/**
 * The next piece of a live stroke to freeze, [from, to], once all its points
 * are final; null while they are not. `frozenTo` is the last point frozen so
 * far (-1 for none). Pieces overlap by LIVE_OVERLAP points and end straight
 * across; filled together (non-zero winding) they cover exactly the outline
 * of the whole stroke, so only the unfrozen tail is rebuilt on each frame.
 */
export function nextFrozenPiece(frozenTo: number, done: number): [number, number] | null {
    'worklet';
    const from = frozenTo < 0 ? 0 : frozenTo - LIVE_OVERLAP;
    const to = Math.max(0, frozenTo) + LIVE_PIECE;
    return to < done ? [from, to] : null;
}

/** First point of the unfrozen tail of a live stroke (see nextFrozenPiece). */
export function liveTailStart(frozenTo: number): number {
    'worklet';
    return frozenTo < 0 ? 0 : frozenTo - LIVE_OVERLAP;
}

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
    if (Math.floor(points.length / 3) === 0) {
        return [];
    }
    const trace = createTrace(size, thinning, streamline, taper, nib);
    traceAppend(trace, points);
    const tail = traceTail(trace, points);
    return traceOutline(trace, tail, 0, tail.n - 1, true, true);
}

/** Line width of a shape: the tool's width at the pressure the shape was drawn with. */
export function shapeWidth(stroke: InkStroke): number {
    'worklet';
    const spec = INK_TOOLS[stroke.tool] || INK_TOOLS.fountain;
    const pressure = stroke.points.length >= 3 ? stroke.points[2] : 0.5;
    return Math.max(stroke.size * 0.16, stroke.size * (1 + spec.thinning * (pressure - 0.5) * 1.6));
}

/** True when a shape's line comes back to where it started (a closed figure). */
export function shapeIsClosed(points: number[]): boolean {
    'worklet';
    const n = points.length;
    return n >= 9 && Math.hypot(points[0] - points[n - 3], points[1] - points[n - 2]) < 0.5;
}

export function strokeOutlineFor(stroke: InkStroke): number[] {
    'worklet';
    const spec = INK_TOOLS[stroke.tool] || INK_TOOLS.fountain;
    return strokeOutline(stroke.points, stroke.size, spec.thinning, spec.streamline, spec.taper && !stroke.cut, spec.nib);
}

/**
 * Compact SVG path data with the same curve as the canvas: quadratic segments
 * through the midpoints of the outline points (see outlineToSkPath), so the
 * picture in the note is as smooth as the ink was. Integer coordinates in
 * units of 1/`scale` px, relative commands, points closer than one unit dropped.
 */
export const outlineToSvgPath = (outline: number[], scale: number = 2): string => {
    const count = outline.length / 2;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < count; i++) {
        const x = Math.round(outline[i * 2] * scale);
        const y = Math.round(outline[i * 2 + 1] * scale);
        const last = xs.length - 1;
        if (last >= 0 && Math.abs(x - xs[last]) + Math.abs(y - ys[last]) < 2) {
            continue;
        }
        xs.push(x);
        ys.push(y);
    }
    const n = xs.length;
    if (n < 3) {
        return '';
    }
    // Midpoints in doubled units keep them integers.
    const mx = (i: number) => xs[i % n] + xs[(i + 1) % n];
    const my = (i: number) => ys[i % n] + ys[(i + 1) % n];
    const num = (value: number, first: boolean) => (first || value < 0 ? '' : ' ') + (value / 2);
    let px = mx(0);
    let py = my(0);
    let d = `M${px / 2} ${py / 2}q`;
    for (let i = 1; i <= n; i++) {
        const cx = xs[i % n] * 2;
        const cy = ys[i % n] * 2;
        const ex = mx(i);
        const ey = my(i);
        d += num(cx - px, i === 1) + num(cy - py, false) + num(ex - px, false) + num(ey - py, false);
        px = ex;
        py = ey;
    }
    return `${d}z`;
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
        kept.push({
            tool: stroke.tool,
            color: stroke.color,
            size: stroke.size,
            points,
            ...(cut ? { cut: true } : {}),
            ...(stroke.shape ? { shape: true } : {}),
        });
    });
    return kept;
};

// ---------------------------------------------------------------------------
// Shapes: a stroke drawn by hand and held still at the end is replaced by the
// clean shape it resembles (line, ellipse, circle, rectangle, triangle,
// polygon, polyline), as notebook apps do. Everything is in document units.

/** Ramer–Douglas–Peucker: indices of the corners of a polyline within `epsilon`, in order. */
const simplify = (xs: number[], ys: number[], epsilon: number): number[] => {
    'worklet';
    const last = xs.length - 1;
    const keep: boolean[] = xs.map(() => false);
    keep[0] = true;
    keep[last] = true;
    // A stack of spans instead of recursion (worklets should not call themselves).
    const spans: number[] = [0, last];
    while (spans.length) {
        const to = spans.pop() as number;
        const from = spans.pop() as number;
        let worst = -1;
        let worstDistance = epsilon;
        const dx = xs[to] - xs[from];
        const dy = ys[to] - ys[from];
        const length = Math.hypot(dx, dy) || 1;
        for (let i = from + 1; i < to; i++) {
            const distance = Math.abs(dy * (xs[i] - xs[from]) - dx * (ys[i] - ys[from])) / length;
            if (distance > worstDistance) {
                worst = i;
                worstDistance = distance;
            }
        }
        if (worst >= 0) {
            keep[worst] = true;
            spans.push(from, worst, worst, to);
        }
    }
    const out: number[] = [];
    keep.forEach((kept, index) => {
        if (kept) {
            out.push(index);
        }
    });
    return out;
};

const segmentDistance = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
    'worklet';
    const abx = bx - ax;
    const aby = by - ay;
    const len2 = abx * abx + aby * aby;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / len2)) : 0;
    return Math.hypot(ax + abx * t - px, ay + aby * t - py);
};

/** Mean distance of the samples to the nearest edge of a polyline [x, y, ...]. */
const polylineError = (xs: number[], ys: number[], corners: number[]): number => {
    'worklet';
    let total = 0;
    for (let i = 0; i < xs.length; i++) {
        let best = Infinity;
        for (let c = 0; c + 3 < corners.length; c += 2) {
            best = Math.min(best, segmentDistance(xs[i], ys[i], corners[c], corners[c + 1], corners[c + 2], corners[c + 3]));
        }
        total += best;
    }
    return total / xs.length;
};

/** Smallest stroke (diagonal of its box, document units) that may become a shape. */
const SHAPE_MIN_SIZE = 56;

/** Angles within this of horizontal, vertical or a diagonal are snapped to it. */
const SNAP_ANGLE = (4 * Math.PI) / 180;

const snapDirection = (dx: number, dy: number): [number, number] => {
    'worklet';
    const length = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const step = Math.PI / 4;
    const nearest = Math.round(angle / step) * step;
    if (Math.abs(angle - nearest) < SNAP_ANGLE) {
        return [Math.cos(nearest) * length, Math.sin(nearest) * length];
    }
    return [dx, dy];
};

/** Samples along a polyline [x, y, ...] every `spacing` units, with one pressure throughout. */
const resample = (corners: number[], spacing: number, pressure: number): number[] => {
    'worklet';
    const out: number[] = [corners[0], corners[1], pressure];
    for (let c = 0; c + 3 < corners.length; c += 2) {
        const ax = corners[c];
        const ay = corners[c + 1];
        const bx = corners[c + 2];
        const by = corners[c + 3];
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / spacing));
        for (let k = 1; k <= steps; k++) {
            out.push(ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps, pressure);
        }
    }
    return out;
};

/**
 * The clean shape a hand-drawn stroke resembles, as new stroke samples, or
 * null when it looks like none (handwriting, scribbles). Closed shapes end
 * where they start; the pressure is the stroke's average, so the line keeps
 * the weight it was drawn with.
 */
export function recognizeShape(points: number[]): number[] | null {
    'worklet';
    const count = Math.floor(points.length / 3);
    if (count < 3) {
        return null;
    }
    const xs: number[] = [];
    const ys: number[] = [];
    let pressure = 0;
    let length = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < count; i++) {
        const x = points[i * 3];
        const y = points[i * 3 + 1];
        if (i > 0) {
            length += Math.hypot(x - xs[i - 1], y - ys[i - 1]);
        }
        xs.push(x);
        ys.push(y);
        pressure += points[i * 3 + 2];
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
    }
    pressure /= count;
    const size = Math.hypot(maxX - minX, maxY - minY);
    // Letters are small: an "o" or an "l" held for a moment stays handwriting.
    if (size < SHAPE_MIN_SIZE) {
        return null;
    }
    const spacing = 2;
    const n = count - 1;
    const chord = Math.hypot(xs[n] - xs[0], ys[n] - ys[0]);

    // A line: everything close to the chord from the first sample to the last.
    if (chord > size * 0.9) {
        let worst = 0;
        for (let i = 0; i < count; i++) {
            worst = Math.max(worst, segmentDistance(xs[i], ys[i], xs[0], ys[0], xs[n], ys[n]));
        }
        if (worst < Math.max(3, chord * 0.06)) {
            const [dx, dy] = snapDirection(xs[n] - xs[0], ys[n] - ys[0]);
            return resample([xs[0], ys[0], xs[0] + dx, ys[0] + dy], spacing, pressure);
        }
    }

    const closed = chord < size * 0.25 && length > size * 1.5;
    const epsilon = size * 0.06;
    const indices = simplify(xs, ys, epsilon);
    const corners: number[] = [];
    indices.forEach((i) => corners.push(xs[i], ys[i]));

    if (closed) {
        // Ellipse through the box of the stroke; a circle when nearly round.
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        let rx = (maxX - minX) / 2;
        let ry = (maxY - minY) / 2;
        let ellipseError = 0;
        for (let i = 0; i < count; i++) {
            ellipseError += Math.abs(Math.hypot((xs[i] - cx) / (rx || 1), (ys[i] - cy) / (ry || 1)) - 1);
        }
        ellipseError /= count;

        // Polygon: the corners found above, the last one merged with the first.
        corners.splice(-2, 2);
        // A wobble along a side is not a corner: drop vertices where the line
        // barely turns, so a hand-drawn rectangle has four corners, not five.
        for (let changed = true; changed && corners.length > 6;) {
            changed = false;
            const count2 = corners.length / 2;
            for (let c = 0; c < count2; c++) {
                const p = ((c - 1 + count2) % count2) * 2;
                const q = ((c + 1) % count2) * 2;
                const a1 = Math.atan2(corners[c * 2 + 1] - corners[p + 1], corners[c * 2] - corners[p]);
                const a2 = Math.atan2(corners[q + 1] - corners[c * 2 + 1], corners[q] - corners[c * 2]);
                let turn = Math.abs(a2 - a1);
                turn = Math.min(turn, Math.PI * 2 - turn);
                if (turn < (25 * Math.PI) / 180) {
                    corners.splice(c * 2, 2);
                    changed = true;
                    break;
                }
            }
        }
        const sides = corners.length / 2;
        if (sides >= 3 && sides <= 5) {
            const ring = [...corners, corners[0], corners[1]];
            const polygonError = polylineError(xs, ys, ring) / size;
            if (polygonError < 0.035 && polygonError * 2.5 < ellipseError) {
                if (sides === 4) {
                    // Nearly square corners and edges near the axes: a true rectangle.
                    let square = true;
                    for (let c = 0; c < 4; c++) {
                        const [ax, ay] = [ring[c * 2], ring[c * 2 + 1]];
                        const [bx, by] = [ring[c * 2 + 2], ring[c * 2 + 3]];
                        const angle = Math.abs(Math.atan2(by - ay, bx - ax)) % (Math.PI / 2);
                        if (Math.min(angle, Math.PI / 2 - angle) > (12 * Math.PI) / 180) {
                            square = false;
                        }
                    }
                    if (square) {
                        return resample([minX, minY, maxX, minY, maxX, maxY, minX, maxY, minX, minY], spacing, pressure);
                    }
                }
                return resample(ring, spacing, pressure);
            }
        }
        if (ellipseError < 0.1) {
            if (Math.abs(rx - ry) < Math.max(rx, ry) * 0.08) {
                rx = (rx + ry) / 2;
                ry = rx;
            }
            // Starts where the hand started, going round the same way.
            const start = Math.atan2((ys[0] - cy) / (ry || 1), (xs[0] - cx) / (rx || 1));
            let turn = 0;
            for (let i = 1; i < count; i++) {
                turn += (xs[i - 1] - cx) * (ys[i] - cy) - (ys[i - 1] - cy) * (xs[i] - cx);
            }
            const direction = turn >= 0 ? 1 : -1;
            const steps = Math.max(24, Math.ceil((Math.PI * (rx + ry)) / spacing));
            const out: number[] = [];
            for (let k = 0; k <= steps; k++) {
                const angle = start + direction * ((k / steps) * Math.PI * 2);
                out.push(cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry, pressure);
            }
            return out;
        }
        return null;
    }

    // An open polyline of a few straight parts (a corner, a zigzag, an arrow's shaft and head).
    const parts = corners.length / 2 - 1;
    if (parts >= 2 && parts <= 4 && polylineError(xs, ys, corners) / size < 0.025) {
        return resample(corners, spacing, pressure);
    }
    return null;
}
