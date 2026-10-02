/** English names and translation keys of the built-in AI presets (no app imports, so tests can load it). */
export type PresetCopy = { labelKey: string; label: string; descriptionKey: string; description: string };

export const PRESET_COPY: Record<string, PresetCopy> = {
    grammar: {
        labelKey: 'edit.presets.grammar.label',
        label: 'Fix Grammar',
        descriptionKey: 'edit.presets.grammar.description',
        description: 'Fix spelling and grammar',
    },
    professional: {
        labelKey: 'edit.presets.professional.label',
        label: 'Make Professional',
        descriptionKey: 'edit.presets.professional.description',
        description: 'Rewrite in a professional, business tone',
    },
    simplify: {
        labelKey: 'edit.presets.simplify.label',
        label: 'Simplify Text',
        descriptionKey: 'edit.presets.simplify.description',
        description: 'Use simple, easy-to-understand words',
    },
    summarize: {
        labelKey: 'edit.presets.summarize.label',
        label: 'Summarize',
        descriptionKey: 'edit.presets.summarize.description',
        description: 'Keep only the most important points',
    },
    structure: {
        labelKey: 'edit.presets.structure.label',
        label: 'Structure',
        descriptionKey: 'edit.presets.structure.description',
        description: 'Add headings and lists for readability',
    },
    meeting: {
        labelKey: 'edit.presets.meeting.label',
        label: 'Meeting Notes',
        descriptionKey: 'edit.presets.meeting.description',
        description: 'Summary, decisions and action items',
    },
};
