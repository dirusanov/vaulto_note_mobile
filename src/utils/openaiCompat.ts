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

