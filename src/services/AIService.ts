import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildTaskExtractionPrompt, parseExtractedTasks, type ExtractedTask } from '../utils/taskExtraction';
import { API_URL } from '../utils/env';
import { getAIProvider, getOpenAIApiKey, getOpenAIBaseUrl, getOpenAIModel, storage } from '../utils/storage';
import { buildOpenAICompatibleUrl, DEFAULT_OPENAI_BASE_URL, modelSupportsTemperature } from '../utils/openaiCompat';
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
    /** Options whose answer is parsed as JSON must put the provider into strict JSON mode. */
    responseFormat?: 'json';
}

export const DEFAULT_IMPROVEMENT_OPTIONS: AIImprovementOption[] = [
    {
        id: 'grammar',
        label: 'Fix Grammar',
        icon: 'spellcheck',
        responseFormat: 'json',
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

const DEFAULT_OPTION_IDS = new Set(DEFAULT_IMPROVEMENT_OPTIONS.map((option) => option.id));

interface StoredPrompts {
    options: AIImprovementOption[];
    /** Built-in options the user deliberately deleted; they must not come back. */
    removedDefaultIds: string[];
}

const readStoredPrompts = (raw: string): StoredPrompts => {
    const parsed = JSON.parse(raw);
    // Legacy shape: a bare array of options.
    if (Array.isArray(parsed)) {
        return { options: parsed, removedDefaultIds: [] };
    }
    return {
        options: Array.isArray(parsed?.options) ? parsed.options : [],
        removedDefaultIds: Array.isArray(parsed?.removedDefaultIds) ? parsed.removedDefaultIds : [],
    };
};

/**
 * Returns a cleaned copy. Never mutates the inputs — callers may pass the shared
 * DEFAULT_IMPROVEMENT_OPTIONS objects, and mutating those corrupts the module constant.
 */
const sanitizeOptions = (
    options: AIImprovementOption[],
    removedDefaultIds: string[] = []
): AIImprovementOption[] => {
    const seenIds = new Set<string>();
    const cleaned: AIImprovementOption[] = [];

    options.forEach((item) => {
        if (!item?.id || !item.label || !item.prompt) return;
        if (seenIds.has(item.id)) return;
        seenIds.add(item.id);
        cleaned.push({
            ...item,
            icon: item.icon || 'bolt',
            prompt: ensureTemplateHasPlaceholder(item.prompt),
        });
    });

    // Restore built-ins the user never removed, so a corrupt entry cannot lose them.
    const removed = new Set(removedDefaultIds);
    DEFAULT_IMPROVEMENT_OPTIONS.forEach((defaultItem) => {
        if (!seenIds.has(defaultItem.id) && !removed.has(defaultItem.id)) {
            cleaned.push({ ...defaultItem });
            seenIds.add(defaultItem.id);
        }
    });

    return cleaned;
};

export const loadImprovementOptions = async (): Promise<AIImprovementOption[]> => {
    try {
        const stored = await AsyncStorage.getItem(AI_PROMPTS_STORAGE_KEY);
        if (!stored) return DEFAULT_IMPROVEMENT_OPTIONS.map((option) => ({ ...option }));

        const { options, removedDefaultIds } = readStoredPrompts(stored);
        return sanitizeOptions(options, removedDefaultIds);
    } catch (e) {
        console.error('Failed to load AI prompts from storage', e);
        return DEFAULT_IMPROVEMENT_OPTIONS.map((option) => ({ ...option }));
    }
};

export const saveImprovementOptions = async (options: AIImprovementOption[]): Promise<void> => {
    try {
        // A built-in missing from the incoming list was deleted on purpose.
        const presentIds = new Set(options.map((option) => option?.id).filter(Boolean));
        const removedDefaultIds = [...DEFAULT_OPTION_IDS].filter((id) => !presentIds.has(id));
        const payload: StoredPrompts = {
            options: sanitizeOptions(options, removedDefaultIds),
            removedDefaultIds,
        };
        await AsyncStorage.setItem(AI_PROMPTS_STORAGE_KEY, JSON.stringify(payload));
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
    // Delimited block instead of bare quotes: note text routinely contains quote
    // characters, which used to break the boundary between instruction and content.
    return withPlaceholder.replace(/{text}/gi, `\n<<<TEXT\n${text}\nTEXT>>>\n`);
};

/**
 * Whether this option's answer must be parsed as JSON. Built-ins declare it;
 * legacy stored copies of the grammar option are recognised by id.
 */
export const optionExpectsJson = (option: AIImprovementOption): boolean =>
    option.responseFormat === 'json' || option.id === 'grammar';

/**
 * Shape the grammar check must answer with. Hosted models follow the prompt, but
 * a 1-2B local model needs the schema enforced during sampling or it replies in prose.
 */
const GRAMMAR_RESPONSE_SCHEMA = {
    type: 'object',
    properties: {
        is_correct: { type: 'boolean' },
        fixed_text: { type: 'string' },
    },
    required: ['is_correct', 'fixed_text'],
};

export async function improveText(text: string, option: AIImprovementOption): Promise<string> {
    if (!option) throw new Error('Invalid option');

    const provider = await getAIProvider();
    if (provider === 'vaulto_ai') {
        return improveViaBackend(text, option);
    }
    
    if (provider === 'local_llm' || provider === 'local') {
        const promptForModel = buildPromptForRequest(option.prompt, text);
        return generateWithLocalLLM(promptForModel, {
            jsonSchema: optionExpectsJson(option) ? GRAMMAR_RESPONSE_SCHEMA : undefined,
        });
    }

    const apiKey = await getOpenAIApiKey();
    if (!apiKey) throw new Error('API key not found');

    try {
        const promptForModel = buildPromptForRequest(option.prompt, text);
        const baseUrl = await getOpenAIBaseUrl();
        const chatUrl = buildOpenAICompatibleUrl(baseUrl || DEFAULT_OPENAI_BASE_URL, '/chat/completions');

        const wantsJson = optionExpectsJson(option);
        const model = await getOpenAIModel();
        const requestBody: any = {
            model,
            messages: [
                {
                    role: 'system',
                    content: wantsJson
                        ? 'You are a precise writing assistant. Follow the output contract in the user message exactly and return ONLY valid JSON.'
                        : 'You are a helpful writing assistant. Return ONLY the improved text, without any conversational filler or explanations.'
                },
                {
                    role: 'user',
                    content: promptForModel
                }
            ],
        };

        if (modelSupportsTemperature(model)) {
            requestBody.temperature = wantsJson ? 0.2 : 0.7;
        }

        if (wantsJson) {
            requestBody.response_format = { type: 'json_object' };
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

    // JSON options carry their own output contract. Prefixing the plain-text
    // instruction here made the two contradict each other and broke the parse.
    const wantsJson = optionExpectsJson(option);
    const instruction = option.prompt.replace(/{text}/gi, '').trim();
    const promptToSend = wantsJson
        ? `You are a precise writing assistant. Return ONLY valid JSON, no prose, no code fences. ${instruction}`.trim()
        : `You are a helpful writing assistant. Return ONLY the improved output, without any conversational filler, explanations, or echoing the original text. ${instruction}`.trim();

    const body = {
        text,
        prompt: promptToSend,
        json_mode: wantsJson,
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

const ASK_NOTES_INSTRUCTION = [
    "You answer questions using ONLY the user's own notes given as numbered excerpts.",
    'Cite the excerpts you rely on inline as [1], [2] (use the numbers given).',
    'Reasonable inferences from the notes are fine (a grocery list answers "what should I buy?"; unchecked checklist items are open tasks).',
    'Lead with the answer itself. Only if nothing in the notes is relevant, say so in one short sentence instead of guessing.',
    'Write the whole answer in the language of the Question line, even when the notes are in another language (translate what you take from them). Be concise; use short Markdown lists for several items.',
    'Never invent facts, dates or names that are not in the notes.',
].join(' ');

/**
 * One instruction over one text, routed to the configured provider. Used by the
 * note-level helpers below (Ask your notes, Find tasks).
 */
async function runInstruction(instruction: string, text: string, { json = false }: { json?: boolean } = {}): Promise<string> {
    const provider = await getAIProvider();

    if (provider === 'local_llm' || provider === 'local') {
        return (await generateWithLocalLLM(`${instruction}\n\n${text}`, {})).trim();
    }

    if (provider === 'vaulto_ai') {
        const token = await storage.getToken();
        if (!token) throw new Error('Sign in required to use Vaulto AI.');
        const response = await fetch(BACKEND_IMPROVE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'Idempotency-Key': await generateUUID(),
            },
            body: JSON.stringify({ text, prompt: instruction, json_mode: json }),
        });
        if (response.status === 403) {
            const { onLimitReached } = await import('../utils/limitEvents');
            onLimitReached.emit();
            throw new Error('Usage limit reached');
        }
        if (!response.ok) {
            throw new Error(`LLM API error: ${response.status} - ${await response.text()}`);
        }
        const data = await response.json();
        if (!data.text) throw new Error('LLM returned empty response');
        return (data.text as string).trim();
    }

    const apiKey = await getOpenAIApiKey();
    if (!apiKey) throw new Error('API key not found');
    const baseUrl = await getOpenAIBaseUrl();
    const model = await getOpenAIModel();
    const body: any = {
        model,
        messages: [
            { role: 'system', content: instruction },
            { role: 'user', content: text },
        ],
    };
    if (modelSupportsTemperature(model)) body.temperature = 0.2;
    const response = await fetch(buildOpenAICompatibleUrl(baseUrl || DEFAULT_OPENAI_BASE_URL, '/chat/completions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        throw new Error(`API Error: ${response.status} - ${await response.text()}`);
    }
    const data = await response.json();
    return (data.choices?.[0]?.message?.content || '').trim();
}

/**
 * Answers a question from note excerpts retrieved on the device. Only the given
 * excerpts leave the device; routing follows the configured AI provider.
 */
export async function answerFromNotes(question: string, sourcesText: string): Promise<string> {
    return runInstruction(`${ASK_NOTES_INSTRUCTION}\n\nQuestion: ${question.trim()}`, `Notes:\n${sourcesText}`);
}

/** Action items of one note, with dates resolved against the device's today. */
export async function extractTasks(noteMarkdown: string, now: Date = new Date()): Promise<ExtractedTask[]> {
    const raw = await runInstruction(buildTaskExtractionPrompt(now), noteMarkdown, { json: true });
    return parseExtractedTasks(raw);
}
