/** Small, ordered groups of immutable strokes with a reusable rendering. */
export type InkChunk<T, Picture> = { strokes: T[]; picture: Picture };

export const INK_CHUNK_SIZE = 32;

/**
 * Keep intact groups across cuts, deletions, insertion and undo. Group boundaries
 * follow the surviving objects instead of array indices, which shift on erasing.
 * Rendering order matters for translucent ink and highlighters.
 */
export const updateInkChunks = <T, Picture>(
    previous: InkChunk<T, Picture>[],
    strokes: T[],
    render: (strokes: T[]) => Picture,
): InkChunk<T, Picture>[] => {
    const byFirst = new Map<T, InkChunk<T, Picture>[]>();
    for (const chunk of previous) {
        const matches = byFirst.get(chunk.strokes[0]) || [];
        matches.push(chunk);
        byFirst.set(chunk.strokes[0], matches);
    }
    const reusableAt = (index: number) => byFirst.get(strokes[index])?.find((chunk) =>
        // Grow a partially filled tail when handwriting appends a new stroke.
        !(chunk === previous[previous.length - 1] && chunk.strokes.length < INK_CHUNK_SIZE
            && index + chunk.strokes.length < strokes.length)
        && chunk.strokes.every((stroke, offset) => strokes[index + offset] === stroke));
    const next: InkChunk<T, Picture>[] = [];
    let index = 0;
    while (index < strokes.length) {
        const cached = reusableAt(index);
        if (cached) {
            next.push(cached);
            index += cached.strokes.length;
            continue;
        }
        const start = index++;
        while (index < strokes.length && index - start < INK_CHUNK_SIZE && !reusableAt(index)) {
            index++;
        }
        const group = strokes.slice(start, index);
        next.push({ strokes: group, picture: render(group) });
    }
    return next;
};
