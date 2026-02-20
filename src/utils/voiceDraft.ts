export const VOICE_PROCESSING_LABEL = 'Processing…';

export const createVoiceProcessingMarker = (text: string) => {
    const encoded = encodeURIComponent(text).replace(/\(/g, '%28').replace(/\)/g, '%29');
    return `![processing](${encoded})`;
};

export const isVoiceProcessingMarkerLine = (value: string): boolean => {
    return /^\s*!\[processing\]\((.*)\)\s*$/.test(value || '');
};

export const getVoiceProcessingText = (value: string): string => {
    const match = (value || '').match(/^\s*!\[processing\]\((.*)\)\s*$/);
    if (match && match[1]) {
        try {
            return decodeURIComponent(match[1]);
        } catch (e) {
            return match[1];
        }
    }
    return '';
};
