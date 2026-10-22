// The all-on-device provider ("Local"): Whisper for voice and an on-device LLM
// (Qwen3.5) for AI edits, the notes chat and tasks — everything works offline.
export const LOCAL_MODELS_ENABLED = true;

// On-device Whisper on its own (transcription and live dictation), usable with any
// provider, including the cloud ones.
export const LOCAL_WHISPER_ENABLED = true;

// Custom AI (own OpenAI-compatible key or server). Hidden while on-device AI covers
// the private/offline case; the code stays so it can return with one switch.
export const CUSTOM_AI_ENABLED = false;

// Handwriting/drawing canvas in notes. Prototype: development builds and the
// `drawing-preview` test build (EAS profile) only.
export const DRAWING_ENABLED = (typeof __DEV__ !== 'undefined' && __DEV__)
    || process.env.EXPO_PUBLIC_DRAWING_ENABLED === '1';

export const isLocalAIProvider = (value: string | null | undefined): boolean => {
    return value === 'local' || value === 'local_whisper' || value === 'local_llm';
};
