import { getOpenAIApiKey } from '../utils/storage';

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';

export interface AIImprovementOption {
    id: string;
    label: string;
    icon: string; // Material icon name
    prompt: string;
}

export const IMPROVEMENT_OPTIONS: AIImprovementOption[] = [
    {
        id: 'grammar',
        label: 'Исправить грамматику',
        icon: 'spellcheck',
        prompt: 'Исправь грамматические и орфографические ошибки в следующем тексте, сохранив исходный язык и стиль:'
    },
    {
        id: 'professional',
        label: 'Сделать профессиональным',
        icon: 'business-center',
        prompt: 'Перепиши следующий текст в более профессиональном и деловом стиле:'
    },
    {
        id: 'simplify',
        label: 'Упростить текст',
        icon: 'child-care',
        prompt: 'Упрости следующий текст, чтобы он был понятен даже ребенку, используй простые слова:'
    },
    {
        id: 'summarize',
        label: 'Кратко пересказать',
        icon: 'short-text',
        prompt: 'Сделай краткий пересказ (summary) следующего текста, выделив только самое главное:'
    },
    {
        id: 'structure',
        label: 'Структурировать',
        icon: 'format-list-bulleted',
        prompt: 'Организуй следующий текст, добавив заголовки и маркированные списки там, где это уместно, для лучшей читаемости:'
    }
];

export async function improveText(text: string, optionId: string): Promise<string> {
    const option = IMPROVEMENT_OPTIONS.find(o => o.id === optionId);
    if (!option) throw new Error('Invalid option');

    const apiKey = await getOpenAIApiKey();
    if (!apiKey) throw new Error('OpenAI API key not found');

    try {
        const response = await fetch(OPENAI_CHAT_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: 'gpt-3.5-turbo',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a helpful writing assistant. Return ONLY the improved text, without any conversational filler or explanations.'
                    },
                    {
                        role: 'user',
                        content: `${option.prompt}\n\n"${text}"`
                    }
                ],
                temperature: 0.7,
            }),
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
