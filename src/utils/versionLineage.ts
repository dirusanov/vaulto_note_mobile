import { LINEAGE_SEPARATOR, PREVIOUS_ORIGINAL_OPTION_ID, storedStepLabelOf } from '../i18n/variantLabels';
import type { DiffSegment } from './textDiff';

/**
 * Which version a version was made from. Vaulto keeps one recording's original
 * plus derived versions ("Summarize", then "Summarize → Email"); people need to
 * see what they are reading and what the next action will work on.
 */

export const ORIGINAL_VERSION_ID = 'original';

/** From this many versions (the original included) the bar gets a "Versions (N)" header. */
export const VERSIONS_HEADER_MIN_COUNT = 5;

type ImprovementLike = { id: string; label?: string | null; title?: string | null; option_id?: string | null };
type OptionLike = { id: string; label?: string; isCustom?: boolean };

/**
 * The id of the version `variantId` was made from: 'original', another
 * version's id, or null when it is unknown (the source was deleted, a demoted
 * original, an agent result recorded before sources were kept).
 *
 * `knownSources` (version id -> source id) is recorded when a version is made
 * and wins when its source still exists. Otherwise the stored step chain is
 * read: "Professional → Summarize" comes from the closest earlier version
 * labelled "Professional"; a single preset step comes from the original.
 */
export const resolveVersionSource = (
    variantId: string,
    improvements: ImprovementLike[],
    options: { optionsById?: Record<string, OptionLike>; knownSources?: Record<string, string> } = {},
): string | null => {
    if (!variantId || variantId === ORIGINAL_VERSION_ID) return null;
    const index = improvements.findIndex((imp) => imp.id === variantId);
    if (index < 0) return null;
    const improvement = improvements[index];

    const known = options.knownSources?.[variantId];
    if (known && known !== variantId) {
        if (known === ORIGINAL_VERSION_ID) return ORIGINAL_VERSION_ID;
        if (improvements.some((imp) => imp.id === known)) return known;
    }

    const optionId = improvement.option_id || '';
    if (optionId === PREVIOUS_ORIGINAL_OPTION_ID) return null;

    const label = storedStepLabelOf(improvement, options.optionsById);
    if (label.includes(LINEAGE_SEPARATOR)) {
        const steps = label.split(LINEAGE_SEPARATOR);
        const parentLabel = steps.slice(0, -1).join(LINEAGE_SEPARATOR).trim();
        for (let i = index - 1; i >= 0; i -= 1) {
            if (storedStepLabelOf(improvements[i], options.optionsById) === parentLabel) {
                return improvements[i].id;
            }
        }
        return null;
    }
    // Voice-agent results run on whatever version was open: without a record
    // the source is not known, and "Original" would be a guess.
    if (optionId.startsWith('agent')) return null;
    return label || optionId ? ORIGINAL_VERSION_ID : null;
};

/**
 * Text for a source that no longer exists but is still named in the chain:
 * "Professional → Summarize 2" -> "Professional". Empty for a single step.
 */
export const parentStepsOfLabel = (displayLabel: string): string => {
    if (!displayLabel.includes(LINEAGE_SEPARATOR)) return '';
    const steps = displayLabel.split(LINEAGE_SEPARATOR);
    return steps.slice(0, -1).join(LINEAGE_SEPARATOR).trim();
};

/**
 * Bases a version can be compared with: its source first (the step that
 * actually made it, "summary → email" reads against the summary), then the
 * original. The original alone when the version was made from it.
 */
export const compareBasesFor = (variantId: string, sourceId: string | null): string[] => {
    if (!variantId || variantId === ORIGINAL_VERSION_ID) return [];
    if (sourceId && sourceId !== ORIGINAL_VERSION_ID && sourceId !== variantId) {
        return [sourceId, ORIGINAL_VERSION_ID];
    }
    return [ORIGINAL_VERSION_ID];
};

/**
 * The version Improve starts from: the one being read. A version that has
 * since been deleted (or nothing open) falls back to the original.
 */
export const defaultImproveSource = (activeId: string, existingIds: string[]): string =>
    activeId && activeId !== ORIGINAL_VERSION_ID && existingIds.includes(activeId)
        ? activeId
        : ORIGINAL_VERSION_ID;

export interface DiffChange {
    /** First and last segment index of the change (inclusive). */
    start: number;
    end: number;
}

/**
 * Groups diff segments into changes a reader steps through: a replaced phrase
 * ("removed" then "added"), or several edits separated only by spaces, count
 * as one. Whitespace-only edits are not changes.
 */
export const groupDiffChanges = (segments: DiffSegment[]): DiffChange[] => {
    const changes: DiffChange[] = [];
    let current: DiffChange | null = null;
    let lastMeaningful = -1;
    segments.forEach((segment, index) => {
        if (segment.type === 'same') {
            // A space between two edits keeps them together; a word or a line break ends the change.
            if (current && (segment.text.trim().length > 0 || segment.text.includes('\n'))) {
                current.end = lastMeaningful;
                changes.push(current);
                current = null;
            }
            return;
        }
        if (segment.text.trim().length === 0) return;
        if (!current) current = { start: index, end: index };
        lastMeaningful = index;
        current.end = index;
    });
    if (current) changes.push(current);
    return changes;
};

/** Index of the change that contains segment `segmentIndex`, or -1. */
export const changeIndexOfSegment = (changes: DiffChange[], segmentIndex: number): number =>
    changes.findIndex((change) => segmentIndex >= change.start && segmentIndex <= change.end);

/**
 * Splits segments into paragraphs at the line breaks of the newer text so each can be laid out (and
 * scrolled to) on its own. Each piece keeps the index of the segment it came
 * from. A paragraph is an array of pieces; empty lines stay as empty arrays.
 */
export const splitDiffIntoParagraphs = (
    segments: DiffSegment[],
): Array<Array<{ type: DiffSegment['type']; text: string; segmentIndex: number }>> => {
    const paragraphs: Array<Array<{ type: DiffSegment['type']; text: string; segmentIndex: number }>> = [[]];
    segments.forEach((segment, segmentIndex) => {
        // Lines follow the version being read: a removed line break is shown
        // as a space inside the struck text, not as a paragraph of the old layout.
        const text = segment.type === 'removed' ? segment.text.replace(/\n+/g, ' ') : segment.text;
        const lines = text.split('\n');
        lines.forEach((line, lineIndex) => {
            if (lineIndex > 0) paragraphs.push([]);
            if (line.length > 0) paragraphs[paragraphs.length - 1].push({ type: segment.type, text: line, segmentIndex });
        });
    });
    return paragraphs;
};

/** Next/previous change index, clamped to the list (no wrap: the ends are meaningful). */
export const stepChange = (current: number, direction: 1 | -1, total: number): number => {
    if (total <= 0) return -1;
    if (current < 0) return direction > 0 ? 0 : total - 1;
    return Math.min(total - 1, Math.max(0, current + direction));
};
