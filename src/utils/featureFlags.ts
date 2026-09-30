// Temporary kill switch for local AI models. Flip back to true to restore
// the existing local Whisper/LLM wiring without rebuilding it from scratch.
export const LOCAL_MODELS_ENABLED = false;

// On-device Whisper on its own (transcription and live dictation), independent of
// the all-local provider above, whose small LLM is not good enough for AI edits.
export const LOCAL_WHISPER_ENABLED = true;

export const isLocalAIProvider = (value: string | null | undefined): boolean => {
    return value === 'local' || value === 'local_whisper' || value === 'local_llm';
};
