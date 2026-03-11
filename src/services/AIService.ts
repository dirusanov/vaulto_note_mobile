import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../utils/env';
import { getAIProvider, getOpenAIApiKey, getOpenAIBaseUrl, storage } from '../utils/storage';
import { buildOpenAICompatibleUrl, DEFAULT_OPENAI_BASE_URL } from '../utils/openaiCompat';
import { generateUUID } from '../utils/uuid';
import { generateWithLocalLLM } from './LocalLLMService';

const BACKEND_IMPROVE_URL = `${API_URL}/ai/improve`;
const AI_PROMPTS_STORAGE_KEY = 'vaulto_ai_prompts_v1';
const FALLBACK_SAMPLE_TEXT = 'your text';
const PLACEHOLDER = '{text}';
export const ensureTemplateHasPlaceholder = (template: string) => {
    if (!template.trim()) return template;
    if (!template.includes(PLACEHOLDER)) {
        return `${template.trim()} ${PLACEHOLDER}`.trim();
    }
    return template;
};

export interface AIImprovementOption {
    id: string;
    label: string;
    icon: string; // Material icon name
    prompt: string;
    isCustom?: boolean;
}

export const DEFAULT_IMPROVEMENT_OPTIONS: AIImprovementOption[] = [
    {
        id: 'grammar',
        label: 'Fix Grammar',
        icon: 'spellcheck',
        prompt: 'Check the following text for grammatical and spelling errors. You MUST return a specific JSON object. Response format: JSON object with keys "is_correct" (boolean) and "fixed_text" (string). You MUST ignore all stylistic choices, including dashes, quotes, and spacing. Only correct actual grammar or spelling mistakes. If the only differences are stylistic or punctuation preferences, or if the text is already correct, set "is_correct": true and "fixed_text": "". If there are errors, set "is_correct": false and "fixed_text": "YOUR_CORRECTED_TEXT_HERE". Do not include markdown formatting or code blocks. Return ONLY the JSON string. Text to check: {text}'
    },
    {
        id: 'professional',
        label: 'Make Professional',
        icon: 'business-center',
        prompt: 'Rewrite the following text in a more professional and business style: {text}'
    },
    {
        id: 'simplify',
        label: 'Simplify Text',
        icon: 'child-care',
        prompt: 'Simplify the following text so it is understandable to a child, use simple words: {text}'
    },
    {
        id: 'summarize',
        label: 'Summarize',
        icon: 'short-text',
        prompt: 'Make a brief summary of the following text, highlighting only the most important points: {text}'
    },
    {
        id: 'structure',
        label: 'Structure',
        icon: 'format-list-bulleted',
        prompt: 'Organize the following text, adding headings and bullet lists where appropriate, for better readability: {text}'
    }
];

// Backward compatibility export
export const IMPROVEMENT_OPTIONS = DEFAULT_IMPROVEMENT_OPTIONS;

const sanitizeOptions = (options: AIImprovementOption[]): AIImprovementOption[] => {
    const mergedIds = new Set<string>();
    const cleaned = options.filter((item) => {
        if (!item.id || !item.label || !item.prompt) return false;
        if (mergedIds.has(item.id)) return false;
        mergedIds.add(item.id);
        if (!item.icon) item.icon = 'bolt';
        item.prompt = ensureTemplateHasPlaceholder(item.prompt);
        return true;
    });

    // Ensure defaults always exist (if user removed them)
    DEFAULT_IMPROVEMENT_OPTIONS.forEach((defaultItem) => {
        if (!mergedIds.has(defaultItem.id)) {
            cleaned.push(defaultItem);
            mergedIds.add(defaultItem.id);
        }
    });

    return cleaned;
};

export const loadImprovementOptions = async (): Promise<AIImprovementOption[]> => {
    try {
        const stored = await AsyncStorage.getItem(AI_PROMPTS_STORAGE_KEY);
        if (!stored) return DEFAULT_IMPROVEMENT_OPTIONS;

        const parsed: AIImprovementOption[] = JSON.parse(stored);
        return sanitizeOptions(parsed);
    } catch (e) {
        console.error('Failed to load AI prompts from storage', e);
        return DEFAULT_IMPROVEMENT_OPTIONS;
    }
};

export const saveImprovementOptions = async (options: AIImprovementOption[]): Promise<void> => {
    try {
        const sanitized = sanitizeOptions(options);
        await AsyncStorage.setItem(AI_PROMPTS_STORAGE_KEY, JSON.stringify(sanitized));
    } catch (e) {
        console.error('Failed to save AI prompts to storage', e);
    }
};

export const buildPromptPreview = (template: string, sampleText: string = FALLBACK_SAMPLE_TEXT): string => {
    if (!template.trim()) return '';

    if (template.includes('{text}')) {
        return template.replace(/{text}/gi, `«${sampleText}»`);
    }

    return `${template}\n\n«${sampleText}»`;
};

const buildPromptForRequest = (template: string, text: string): string => {
    const withPlaceholder = ensureTemplateHasPlaceholder(template);
    return withPlaceholder.replace(/{text}/gi, `"${text}"`);
};

export async function improveText(text: string, option: AIImprovementOption): Promise<string> {
    if (!option) throw new Error('Invalid option');

    const provider = await getAIProvider();
    if (provider === 'vaulto_ai') {
        return improveViaBackend(text, option);
    }
    
    if (provider === 'local_llm' || provider === 'local') {
        const promptForModel = buildPromptForRequest(option.prompt, text);
        return generateWithLocalLLM(promptForModel);
    }

    const apiKey = await getOpenAIApiKey();
    if (!apiKey) throw new Error('API key not found');

    try {
        const promptForModel = buildPromptForRequest(option.prompt, text);
        const baseUrl = await getOpenAIBaseUrl();
        const chatUrl = buildOpenAICompatibleUrl(baseUrl || DEFAULT_OPENAI_BASE_URL, '/chat/completions');

        const requestBody: any = {
            model: 'gpt-3.5-turbo-1106',
            messages: [
                {
                    role: 'system',
                    content: 'You are a helpful writing assistant. Return ONLY the improved text, without any conversational filler or explanations.'
                },
                {
                    role: 'user',
                    content: promptForModel
                }
            ],
            temperature: 0.7,
        };

        if (option.id === 'grammar') {
            requestBody.response_format = { type: 'json_object' };
            requestBody.temperature = 0.2;
        }

        const response = await fetch(chatUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API Error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        return data.choices[0].message.content.trim();
    } catch (error) {
        console.error('AI Improvement failed:', error);
        throw error;
    }
}

async function improveViaBackend(text: string, option: AIImprovementOption): Promise<string> {
    const token = await storage.getToken();
    const baseUrl = BACKEND_IMPROVE_URL;
    const idempotencyKey = await generateUUID();

    if (!token) {
        throw new Error('Sign in required to use Vaulto AI.');
    }

    const promptToSend = `You are a helpful writing assistant. Return ONLY the improved output, without any conversational filler, explanations, or echoing the original text. ${option.prompt.replace(/{text}/gi, '').trim()}`.trim();

    const body = {
        text,
        prompt: promptToSend,
    };

    const response = await fetch(baseUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(body),
    });

    if (response.status === 403) {
        const { onLimitReached } = await import('../utils/limitEvents');
        onLimitReached.emit();
        throw new Error('Usage limit reached');
    }

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LLM API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    if (!data.text) {
        throw new Error('LLM returned empty response');
    }

    return data.text as string;
}
