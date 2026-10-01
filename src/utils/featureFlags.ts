// The all-on-device provider ("Local"): Whisper for voice and an on-device LLM
// (Qwen3.5) for AI edits, the notes chat and tasks — everything works offline.
export const LOCAL_MODELS_ENABLED = true;

// On-device Whisper on its own (transcription and live dictation), usable with any
// provider, including the cloud ones.
export const LOCAL_WHISPER_ENABLED = true;

// Custom AI (own OpenAI-compatible key or server). Hidden while on-device AI covers
// the private/offline case; the code stays so it can return with one switch.
export const CUSTOM_AI_ENABLED = false;

export const isLocalAIProvider = (value: string | null | undefined): boolean => {
    return value === 'local' || value === 'local_whisper' || value === 'local_llm';
};
