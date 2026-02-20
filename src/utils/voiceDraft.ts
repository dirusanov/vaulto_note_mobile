export const VOICE_PROCESSING_MARKER = '(Processing…)';
export const VOICE_PROCESSING_LABEL = 'Processing…';

export const isVoiceProcessingMarkerLine = (value: string): boolean =>
    (value || '').trim() === VOICE_PROCESSING_MARKER;
