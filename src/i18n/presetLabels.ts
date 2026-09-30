import type { TFunction } from 'i18next';
import {
    AIImprovementOption,
    DEFAULT_IMPROVEMENT_OPTIONS,
    ensureTemplateHasPlaceholder,
} from '../services/AIService';

/**
 * Display-time localization for the built-in AI improvement presets.
 *
 * The stored `label` / `prompt` values are persisted (AsyncStorage), used as
 * improvement labels on notes, and sent to the model, so they must stay English.
 * These helpers only translate what the user sees.
 */

import { PRESET_COPY } from './presetCopy';

const DEFAULTS_BY_ID = new Map(DEFAULT_IMPROVEMENT_OPTIONS.map((option) => [option.id, option]));

/** The ad-hoc option built in NoteEditScreen from the custom instruction box. */
const CUSTOM_INSTRUCTION_ID = 'custom_instruction';

/**
 * True only for an unmodified built-in preset. A stored option whose label or
 * prompt differs from the shipped default keeps the user's text.
 */
const isPristineBuiltIn = (option: Pick<AIImprovementOption, 'id' | 'label' | 'prompt' | 'isCustom'>): boolean => {
    if (option.isCustom) return false;
    const builtIn = DEFAULTS_BY_ID.get(option.id);
    if (!builtIn || !PRESET_COPY[option.id]) return false;
    return (
        option.label === builtIn.label
        && ensureTemplateHasPlaceholder(option.prompt || '') === ensureTemplateHasPlaceholder(builtIn.prompt)
    );
};

/** Localized preset title; falls back to the stored label for user-created presets. */
export const getLocalizedPresetLabel = (
    option: Pick<AIImprovementOption, 'id' | 'label' | 'prompt' | 'isCustom'> | null | undefined,
    t: TFunction
): string => {
    if (!option) return '';
    if (option.id === CUSTOM_INSTRUCTION_ID) {
        return t('edit.customInstruction', 'Custom Instruction');
    }
    if (!isPristineBuiltIn(option)) return option.label;
    const copy = PRESET_COPY[option.id];
    return t(copy.labelKey, copy.label);
};

/**
 * Short, human description for a built-in preset. Returns null for user-created
 * (or edited) presets so the caller can keep showing the prompt preview.
 */
export const getLocalizedPresetDescription = (
    option: Pick<AIImprovementOption, 'id' | 'label' | 'prompt' | 'isCustom'> | null | undefined,
    t: TFunction
): string | null => {
    if (!option || !isPristineBuiltIn(option)) return null;
    const copy = PRESET_COPY[option.id];
    return t(copy.descriptionKey, copy.description);
};
