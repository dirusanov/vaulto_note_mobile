/**
 * How a note card splits its preview text (from richContentToPreviewText) into
 * a bold lead and grey lines. Kept free of app imports so tests can load it.
 */

/** "  ☑ Milk" -> indent, box, text: a ticked item reads as done. */
export const CHECKED_LINE = /^(\s*)(☑ )(.*)$/;
export const TASK_LINE = /^\s*[☐☑] /;

/** A line compared without list markers, case or a trailing ellipsis. */
export const comparableLine = (value: string): string => value
    .replace(/^[\s☐☑•\-*]+/, '')
    .replace(/(\.{3}|…)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();

/**
 * Unticked items first within each checklist, the ticked ones after them,
 * as Keep and Apple Notes list them. Other lines keep their place.
 */
export const uncheckedFirst = (preview: string): string => {
    const lines = preview.split('\n');
    const out: string[] = [];
    let run: string[] = [];
    const flush = () => {
        out.push(...run.filter(line => !CHECKED_LINE.test(line)), ...run.filter(line => CHECKED_LINE.test(line)));
        run = [];
    };
    lines.forEach(line => {
        if (TASK_LINE.test(line)) {
            run.push(line);
        } else {
            flush();
            out.push(line);
        }
    });
    flush();
    return out.join('\n');
};

export interface CardPreviewLayout {
    /**
     * 'title': the stored title, then the preview.
     * 'lead': an untitled note's first line takes the title's place.
     * 'list': an untitled checklist shows its items only, each with its box,
     *   as Keep does - a box on a bold title line read as a stray glyph.
     */
    mode: 'title' | 'lead' | 'list';
    leadLine: string;
    previewString: string;
}

export const layoutCardPreview = (fullPreview: string, title: string, hasStoredTitle: boolean): CardPreviewLayout => {
    const trimmed = fullPreview.trim();
    // Older voice notes saved the first words as the title ("Call Anna about
    // the"): shown above the full first line it read as a cut-off duplicate.
    const firstLine = trimmed.split('\n')[0] ?? '';
    const storedTitleRepeatsText = hasStoredTitle && !!comparableLine(title)
        && comparableLine(firstLine).startsWith(comparableLine(title));
    // Untitled notes show their text, as Keep does: a title derived from the
    // first line would only repeat it.
    const showsText = (!hasStoredTitle || storedTitleRepeatsText) && !!trimmed;
    if (!showsText) {
        return { mode: 'title', leadLine: '', previewString: fullPreview };
    }
    if (TASK_LINE.test(firstLine)) {
        return { mode: 'list', leadLine: '', previewString: trimmed };
    }
    const leadBreak = trimmed.indexOf('\n');
    return {
        mode: 'lead',
        leadLine: leadBreak === -1 ? trimmed : trimmed.slice(0, leadBreak),
        previewString: leadBreak === -1 ? '' : trimmed.slice(leadBreak + 1).replace(/^\s*\n/, ''),
    };
};
