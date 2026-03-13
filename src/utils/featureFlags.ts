// Temporary kill switch for local AI models. Flip back to true to restore
// the existing local Whisper/LLM wiring without rebuilding it from scratch.
export const LOCAL_MODELS_ENABLED = false;

export const isLocalAIProvider = (value: string | null | undefined): boolean => {
    return value === 'local' || value === 'local_whisper' || value === 'local_llm';
};
