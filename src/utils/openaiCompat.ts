export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

export const normalizeOpenAIBaseUrl = (value?: string | null): string => {
    const trimmed = (value || '').trim();
    if (!trimmed) return DEFAULT_OPENAI_BASE_URL;
    return trimmed.replace(/\/+$/, '');
};

export const buildOpenAICompatibleUrl = (baseUrl: string, path: string): string => {
    const normalizedBase = normalizeOpenAIBaseUrl(baseUrl);
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${normalizedBase}${normalizedPath}`;
};

/** Kept in sync with the model the backend uses for the same job. */
export const DEFAULT_OPENAI_CHAT_MODEL = 'gpt-5.4-mini';

/**
 * Reasoning models reject an explicit temperature with a 400.
 * Matched by family prefix so a newer model does not silently start failing.
 */
export const modelSupportsTemperature = (model?: string | null): boolean => {
    const normalized = (model || '').trim().toLowerCase();
    if (!normalized) return true;
    return !(
        normalized.startsWith('gpt-5') ||
        normalized.startsWith('o1') ||
        normalized.startsWith('o3') ||
        normalized.startsWith('o4')
    );
};

