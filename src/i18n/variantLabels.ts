import type { TFunction } from 'i18next';
import { PRESET_COPY } from './presetCopy';

/**
 * Variant ("improvement") labels describe *how* a version was made, e.g.
 * "Make Professional → Summarize", never what the note says. The `label` field is
 * synced without end-to-end encryption, so it must not carry note content; it is
 * stored in English (readable by older app versions) and localized on display.
 */
export const LINEAGE_SEPARATOR = ' → ';

export const CUSTOM_INSTRUCTION_OPTION_ID = 'custom_instruction';
export const PREVIOUS_ORIGINAL_OPTION_ID = 'previous_original';
/**
 * Stored for a user-created preset instead of its name: prompt names live only on
 * the device and may be personal ("Rewrite for Dr. Cohen"), so they are looked up
 * by option id when displayed rather than synced in plaintext.
 */
export const CUSTOM_PROMPT_STEP = 'Custom prompt';

type StepCopy = { key: string; label: string; icon: string };

/** Variants that do not come from a preset: agent results and demoted originals. */
const SPECIAL_STEPS: Record<string, StepCopy> = {
    agent_todo: { key: 'edit.versions.kind.checklist', label: 'Checklist', icon: 'checklist' },
    agent_list: { key: 'edit.versions.kind.list', label: 'List', icon: 'format-list-bulleted' },
    agent_format: { key: 'edit.versions.kind.formatted', label: 'Formatted', icon: 'auto-fix-high' },
    agent: { key: 'edit.versions.kind.agent', label: 'AI Agent', icon: 'smart-toy' },
    [PREVIOUS_ORIGINAL_OPTION_ID]: { key: 'edit.versions.kind.previousOriginal', label: 'Previous original', icon: 'history' },
    [CUSTOM_INSTRUCTION_OPTION_ID]: { key: 'edit.customInstruction', label: 'Custom Instruction', icon: 'edit-note' },
};
const CUSTOM_PROMPT_COPY: StepCopy = { key: 'edit.versions.kind.customPrompt', label: CUSTOM_PROMPT_STEP, icon: 'auto-awesome' };

export const agentOptionIdForMode = (mode?: string | null): string => {
    const normalized = (mode || '').toLowerCase();
    if (normalized === 'todo') return 'agent_todo';
    if (normalized === 'list') return 'agent_list';
    if (normalized === 'format') return 'agent_format';
    return 'agent';
};

type OptionLike = { id: string; label?: string; isCustom?: boolean };

/** English name of one step, as stored in `label`. */
export const englishStepName = (option: OptionLike | null | undefined): string => {
    if (!option) return '';
    const special = SPECIAL_STEPS[option.id];
    if (special) return special.label;
    const preset = PRESET_COPY[option.id];
    if (preset && !option.isCustom) return preset.label;
    return CUSTOM_PROMPT_STEP;
};

export const buildLineageLabel = (sourceLabel: string | null | undefined, step: string): string => {
    const source = (sourceLabel || '').trim();
    const next = step.trim();
    if (!source) return next;
    if (!next) return source;
    return `${source}${LINEAGE_SEPARATOR}${next}`;
};

const englishToCopy = (): Map<string, StepCopy> => {
    const map = new Map<string, StepCopy>();
    Object.values(PRESET_COPY).forEach((copy) => map.set(copy.label, { key: copy.labelKey, label: copy.label, icon: '' }));
    Object.values(SPECIAL_STEPS).forEach((copy) => map.set(copy.label, copy));
    map.set(CUSTOM_PROMPT_COPY.label, CUSTOM_PROMPT_COPY);
    return map;
};
const KNOWN_STEPS = englishToCopy();

export const isStepLabel = (label: string | null | undefined): boolean => {
    const value = (label || '').trim();
    if (!value) return false;
    return value.split(LINEAGE_SEPARATOR).every((step) => KNOWN_STEPS.has(step.trim()));
};

/**
 * The label to store for a variant: a known step chain as-is, otherwise the step
 * implied by option_id, otherwise nothing. Mirrors the server's sanitizer
 * (claude_gateway_service improvement_labels.py) so no note text is ever synced.
 */
export const sanitizeStepLabel = (label: string | null | undefined, optionId: string | null | undefined): string | undefined => {
    if (isStepLabel(label)) return (label || '').trim();
    if (!optionId) return undefined;
    return englishStepName({ id: optionId }) || undefined;
};

const localizeStep = (step: string, t: TFunction): string => {
    const copy = KNOWN_STEPS.get(step.trim());
    return copy ? t(copy.key, copy.label) : step.trim();
};

/**
 * A name the user gave a version is kept in its title, which is end-to-end
 * encrypted like the content (the label is not). An invisible marker tells it
 * apart from the AI-derived title; older app versions just show the name.
 */
const USER_NAMED_MARKER = '\u2063';

export const markUserVariantName = (name: string): string => {
    const trimmed = name.trim();
    return trimmed ? `${USER_NAMED_MARKER}${trimmed}` : '';
};

export const userVariantName = (title: string | null | undefined): string | null => {
    const value = title || '';
    if (!value.startsWith(USER_NAMED_MARKER)) return null;
    const name = value.slice(USER_NAMED_MARKER.length).trim();
    return name || null;
};

/** Visible title without the user-name marker. */
export const plainVariantTitle = (title: string | null | undefined): string =>
    (title || '').split(USER_NAMED_MARKER).join('').trim();

/** Chip text: a derived version shows only its own step; the full chain lives in the list. */
export const chipTextForLabel = (label: string): string => {
    if (!label.includes(LINEAGE_SEPARATOR)) return label;
    const steps = label.split(LINEAGE_SEPARATOR);
    return steps[steps.length - 1].trim();
};

export const isDerivedLabel = (label: string): boolean => label.includes(LINEAGE_SEPARATOR);

type ImprovementLike = { id: string; label?: string | null; title?: string | null; option_id?: string | null };

/**
 * The stored lineage label of a variant, recovering one for variants created
 * before labels described the step (their label was a content-derived title).
 */
export const storedStepLabelOf = (
    improvement: ImprovementLike | null | undefined,
    optionsById: Record<string, OptionLike> = {},
): string => {
    if (!improvement) return '';
    const label = (improvement.label || '').trim();
    // Only a chain of known steps counts: an old content title such as
    // "Moscow → Paris trip" must not be extended into a new label.
    if (isStepLabel(label)) return label;
    const optionId = improvement.option_id || '';
    if (optionId) {
        const fromOption = englishStepName(optionsById[optionId] || { id: optionId });
        if (fromOption) return fromOption;
    }
    return '';
};

/**
 * Localized chip text per variant id. Duplicate names get an ordinal
 * ("Summarize", "Summarize 2") so identical steps stay tellable apart.
 */
export const buildVariantDisplayLabels = (
    improvements: ImprovementLike[],
    t: TFunction,
    optionsById: Record<string, OptionLike> = {},
    fallbackText: (index: number) => string = (index) => `${index + 1}`,
): Record<string, string> => {
    const result: Record<string, string> = {};
    const seen = new Map<string, number>();
    improvements.forEach((improvement, index) => {
        const userName = userVariantName(improvement.title);
        if (userName) {
            result[improvement.id] = userName;
            return;
        }
        const stepLabel = storedStepLabelOf(improvement, optionsById);
        let text: string;
        if (stepLabel) {
            const steps = stepLabel.split(LINEAGE_SEPARATOR).map((step) => step.trim());
            text = steps.map((step, stepIndex) => {
                // The last custom step is this variant's own prompt: show its local name.
                if (step === CUSTOM_PROMPT_STEP && stepIndex === steps.length - 1) {
                    // A built-in preset the server did not know yet was stored as
                    // "Custom prompt": show the preset's translated name.
                    const preset = PRESET_COPY[improvement.option_id || ''];
                    if (preset) return t(preset.labelKey, preset.label);
                    const customName = (optionsById[improvement.option_id || '']?.label || '').trim();
                    if (customName) return customName;
                }
                return localizeStep(step, t);
            }).join(LINEAGE_SEPARATOR);
        } else {
            // Never show a label or title that is not a step: that would be note text.
            text = fallbackText(index);
        }
        const count = (seen.get(text) || 0) + 1;
        seen.set(text, count);
        result[improvement.id] = count > 1 ? `${text} ${count}` : text;
    });
    return result;
};

/** Icon for a variant: the last step's preset icon, or a special-step icon. */
export const variantIconFor = (
    improvement: ImprovementLike,
    optionIcons: Record<string, string>,
): string => {
    const optionId = improvement.option_id || '';
    if (optionId && optionIcons[optionId]) return optionIcons[optionId];
    if (optionId && SPECIAL_STEPS[optionId]?.icon) return SPECIAL_STEPS[optionId].icon;
    return 'auto-awesome';
};
