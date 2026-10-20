import { Platform } from 'react-native';

// The initial iOS release is free. Enable store billing only after Apple
// agreements, products and RevenueCat are configured and tested.
export const STORE_PURCHASES_ENABLED = Platform.OS === 'android';

// iOS uses the existing email account flow until native Google and an
// equivalent privacy-preserving login option are configured.
export const GOOGLE_SIGN_IN_ENABLED = Platform.OS === 'android';

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
