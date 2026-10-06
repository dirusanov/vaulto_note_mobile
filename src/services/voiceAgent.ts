import { getAIProvider } from '../utils/storage';
import { isDeviceOffline } from '../utils/connectivity';
import { isLocalLLMReady } from './effectiveProvider';
import { generateWithLocalLLM, getSelectedLocalLLMModel } from './LocalLLMService';
import type { VoiceNoteResult } from './TranscriptionService';

/**
 * The voice agent has no switch: every recording is understood as either plain
 * dictation (inserted as is) or a request ("make a checklist", "rename the note").
 *
 * - Online with an account: our server decides (fastest, most accurate).
 * - "Only on this phone", no internet, a protected note or a guest: the on-device
 *   model decides, for short phrases only. Long dictation is never a command, so it
 *   is inserted at once and the phone never spends time on it.
 * - Otherwise (no model on the phone, Custom AI): plain dictation.
 */
export type VoiceAgentRoute = 'cloud' | 'device' | null;

/** Requests are short; anything longer is dictation and skips the on-device model. */
export const DEVICE_AGENT_MAX_WORDS = 40;

/**
 * Qwen3.5 0.8B mistakes plain dictation for list requests (tested 2026-10-06), so
 * with it recordings stay plain text; 2B and 4B tell them apart reliably.
 */
export const modelUnderstandsRequests = (key: string): boolean => key !== 'qwen3.5-0.8b';

export const resolveVoiceAgentRoute = async (options: {
    signedIn: boolean;
    protectedNote?: boolean;
}): Promise<VoiceAgentRoute> => {
    const provider = await getAIProvider();
    const deviceReady = (await isLocalLLMReady())
        && modelUnderstandsRequests((await getSelectedLocalLLMModel().catch(() => null))?.key ?? '');
    // Protected notes never leave the phone.
    if (options.protectedNote) return deviceReady ? 'device' : null;
    if (provider === 'local' || provider === 'local_llm') return deviceReady ? 'device' : null;
    // Voice-only privacy (no AI model) and Custom AI have no agent.
    if (provider === 'local_whisper' || provider === 'openai') return null;
    if (options.signedIn && !(await isDeviceOffline())) return 'cloud';
    return deviceReady ? 'device' : null;
};

const countWords = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

/** Whether the on-device model should look at this transcript at all. */
export const isDeviceAgentCandidate = (transcript: string): boolean => {
    const words = countWords(transcript);
    return words >= 2 && words <= DEVICE_AGENT_MAX_WORDS;
};

const RESPONSE_SCHEMA = {
    type: 'object',
    properties: {
        intent: { type: 'string', enum: ['dictation', 'checklist', 'list', 'rename'] },
        items: { type: 'array', maxItems: 30, items: { type: 'string' } },
        title: { type: 'string' },
        note_title: { type: 'string' },
    },
    required: ['intent', 'items', 'title', 'note_title'],
};

const INSTRUCTION = [
    'A voice note app received the transcript below. Decide whether the user is dictating text for the note,',
    'or directly asking the app to do something with the note.',
    'Return JSON with "intent", "items", "title" and "note_title".',
    '',
    'intent:',
    '- "dictation": the user is just speaking the note content: thoughts, text, a story, a list of words, a question to themselves.',
    '  This is the answer in almost every case. When unsure, answer "dictation".',
    '- "checklist": the user explicitly asks to make a checklist, to-do list or shopping list',
    '  (e.g. "make a checklist", "сделай список покупок: молоко, хлеб", "turn this into tasks").',
    '- "list": the user explicitly asks to make a plain (not to-do) list of ideas, names or points.',
    '- "rename": the user explicitly asks to name or rename the note (e.g. "назови заметку Отпуск", "rename the note to Budget").',
    '',
    'items (checklist or list only): the items, short, in the original language, taken from the transcript;',
    'if the transcript names no items ("make this a checklist"), take them from the current note. Never invent items. Otherwise [].',
    'title (rename only): the exact new title, without quotes. Otherwise "".',
    'note_title: a short title for the whole note after this change, 2 to 5 words, in the note\'s language,',
    'describing its topic (e.g. "Покупки", "Встреча с Андреем"). Never a command phrase.',
].join('\n');

const tokens = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** Small models sometimes invent items: keep only those whose words appear in the source. */
const groundedItems = (items: unknown, source: string): string[] => {
    if (!Array.isArray(items)) return [];
    const known = new Set(tokens(source));
    return items
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.replace(/^\s*(?:[-*•]\s*)?(?:\[[ xX]?\]\s*)?/, '').trim())
        .filter((item) => item.length > 0 && item.length <= 200)
        .filter((item) => {
            const words = tokens(item);
            if (words.length === 0) return false;
            const found = words.filter((w) => known.has(w)).length;
            return found / words.length >= 0.5;
        });
};

const dictation = (transcript: string): VoiceNoteResult => ({
    originalText: transcript,
    processedText: null,
    hasInstruction: false,
    mode: 'none',
    contentAction: 'none',
    needsConfirmation: false,
    confirmationKind: '',
    confirmationMessage: null,
    titleAction: 'none',
    titleValue: null,
    suggestedTitle: null,
    success: true,
});

/**
 * The on-device agent. Same result shape as the server's, limited to what a phone
 * model does reliably: checklists, lists and renaming. Checking items off is
 * handled by the note screen's own checklist matching.
 */
export const processVoiceNoteOnDevice = async (
    transcript: string,
    currentContent: string,
): Promise<VoiceNoteResult> => {
    const text = transcript.trim();
    if (!isDeviceAgentCandidate(text)) return dictation(text);
    const startedAt = Date.now();
    let raw: string;
    try {
        raw = await generateWithLocalLLM(
            `${INSTRUCTION}\n\n<current_note>\n${currentContent.slice(0, 2000)}\n</current_note>\n\n<transcript>\n${text}\n</transcript>`,
            { jsonSchema: RESPONSE_SCHEMA, maxTokens: 384 },
        );
    } catch (error) {
        console.warn('[VoiceAgent] On-device agent failed', error instanceof Error ? error.message : 'unknown');
        return dictation(text);
    }
    let data: { intent?: string; items?: unknown; title?: unknown; note_title?: unknown };
    try {
        data = JSON.parse(raw);
    } catch {
        return dictation(text);
    }
    console.log(`[VoiceAgent] On-device: ${data.intent ?? 'none'} in ${Date.now() - startedAt} ms`);
    const noteTitle = typeof data.note_title === 'string' ? data.note_title.replace(/^["«“']+|["»”']+$/g, '').trim() : '';
    const base = { ...dictation(text), suggestedTitle: noteTitle && noteTitle.length <= 60 ? noteTitle : null };

    if (data.intent === 'rename') {
        // Small models sometimes put the new name into note_title instead.
        const title = (typeof data.title === 'string' ? data.title.replace(/^["«“']+|["»”']+$/g, '').trim() : '') || noteTitle;
        console.log(`[VoiceAgent] Rename: ${title ? 'title found' : 'no title'}`);
        if (!title || title.length > 80) return dictation(text);
        return { ...base, titleAction: 'set', titleValue: title };
    }

    if (data.intent === 'checklist' || data.intent === 'list') {
        const items = groundedItems(data.items, `${text}\n${currentContent}`);
        if (items.length === 0) return base;
        const todo = data.intent === 'checklist';
        return {
            ...base,
            hasInstruction: true,
            mode: todo ? 'todo' : 'list',
            contentAction: 'append',
            processedText: items.map((item) => (todo ? `- [ ] ${item}` : `- ${item}`)).join('\n'),
        };
    }

    return base;
};
