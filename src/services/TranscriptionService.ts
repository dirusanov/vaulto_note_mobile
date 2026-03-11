/**
 * Transcription service for sending audio to OpenAI Whisper API.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { API_URL } from '../utils/env';
import {
    storage,
    getAgentModeEnabled,
    getAIProvider,
    getOpenAIApiKey,
    getOpenAIBaseUrl,
    getTranscriptionLanguage,
} from '../utils/storage';
import { buildOpenAICompatibleUrl, DEFAULT_OPENAI_BASE_URL } from '../utils/openaiCompat';
import { generateUUID } from '../utils/uuid';
import client from '../api/client';
import { prepareAudioForLocalWhisper, transcribeWithLocalWhisper } from './LocalWhisperService';

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 2000; // 2 seconds
// Ensure we don't double up on /gateway if it's already in API_URL
const BASE_URL = API_URL;
const BACKEND_TRANSCRIBE_URL = `${BASE_URL}/ai/transcribe`;
const BACKEND_PROCESS_NOTE_URL = `${BASE_URL}/ai/agent`;

export interface TranscriptionResult {
    text: string;
    success: boolean;
    error?: string;
}

export interface VoiceNoteResult {
    originalText: string;
    processedText?: string | null;
    hasInstruction: boolean;
    instruction?: string | null;
    mode?: string | null;
    titleAction?: 'set' | 'none';
    titleValue?: string | null;
    suggestedTitle?: string | null;
    success: boolean;
    error?: string;
}

/**
 * Transcribe audio file using OpenAI Whisper API
 */
export async function transcribeAudio(
    audioUri: string,
    language?: string
): Promise<TranscriptionResult> {
    const selectedLanguage = language || await resolvePreferredTranscriptionLanguage();
    const provider = await getAIProvider();
    if (provider === 'vaulto_ai') {
        return transcribeViaBackend(audioUri, selectedLanguage);
    }
    if (provider === 'local_whisper' || provider === 'local_llm' || provider === 'local') {
        return transcribeViaLocalWhisper(audioUri, selectedLanguage);
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            // Get API key from storage
            const apiKey = await getOpenAIApiKey();
            if (!apiKey) {
                return {
                    text: '',
                    success: false,
                    error: 'Please check your Custom AI configuration in settings.',
                };
            }



            // Read audio file info
            if (Platform.OS !== 'web') {
                const fileInfo = await FileSystem.getInfoAsync(audioUri);
                if (!fileInfo.exists) {
                    return {
                        text: '',
                        success: false,
                        error: 'Audio file not found',
                    };
                }

                if (fileInfo.size === 0) {
                    return {
                        text: '',
                        success: false,
                        error: 'Audio file is empty',
                    };
                }
            }

            // Create form data
            const formData = new FormData();

            // For React Native / Expo, we need to use a special format for file uploads
            const file = {
                uri: audioUri,
                type: 'audio/m4a', // Changed from audio/mp4
                name: 'audio.m4a',
            } as any;

            formData.append('file', file);
            formData.append('model', 'whisper-1');
            if (selectedLanguage) {
                formData.append('language', selectedLanguage);
            }

            const baseUrl = await getOpenAIBaseUrl();
            const whisperUrl = buildOpenAICompatibleUrl(baseUrl || DEFAULT_OPENAI_BASE_URL, '/audio/transcriptions');

            // Send request
            const response = await fetch(whisperUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: formData,
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API error: ${response.status} - ${errorText}`);
            }

            const result = await response.json();
            return {
                text: result.text || '',
                success: true,
            };
        } catch (error) {
            lastError = error as Error;
            console.error(`Transcription attempt ${attempt + 1} failed:`, error);

            // Wait before retrying (exponential backoff)
            if (attempt < MAX_RETRIES - 1) {
                const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    return {
        text: '',
        success: false,
        error: lastError?.message || 'Transcription failed. If using Custom AI, please check your Base URL settings and ensure the provider supports the Whisper API.',
    };
}

async function resolvePreferredTranscriptionLanguage(): Promise<string | undefined> {
    const language = await getTranscriptionLanguage();
    return language === 'auto' ? undefined : language;
}

async function resolvePreferredLocalWhisperLanguage(language?: string): Promise<string> {
    if (language) {
        return language;
    }

    const storedLanguage = await getTranscriptionLanguage();
    return storedLanguage === 'auto' ? 'auto' : storedLanguage;
}

async function transcribeViaLocalWhisper(audioUri: string, language?: string): Promise<TranscriptionResult> {
    let preparedAudioUri: string | null = null;
    try {
        if (Platform.OS === 'web') {
            return {
                text: '',
                success: false,
                error: 'Local Whisper is not supported on web',
            };
        }

        const fileInfo = await FileSystem.getInfoAsync(audioUri);
        if (!fileInfo.exists || fileInfo.size === 0) {
            return {
                text: '',
                success: false,
                error: 'Audio file not found or empty',
            };
        }

        preparedAudioUri = await prepareAudioForLocalWhisper(audioUri);
        const resolvedLanguage = await resolvePreferredLocalWhisperLanguage(language);
        const text = await transcribeWithLocalWhisper(preparedAudioUri, { language: resolvedLanguage });
        return {
            text,
            success: true,
        };
    } catch (error) {
        console.error('[Transcription] Local Whisper failed', error);
        return {
            text: '',
            success: false,
            error: error instanceof Error ? error.message : 'Local Whisper transcription failed',
        };
    } finally {
        if (preparedAudioUri && preparedAudioUri !== audioUri && preparedAudioUri.startsWith('file://')) {
            await FileSystem.deleteAsync(preparedAudioUri, { idempotent: true }).catch(() => undefined);
        }
    }
}

async function transcribeViaBackend(audioUri: string, language?: string): Promise<TranscriptionResult> {
    const idempotencyKey = await generateUUID();

    try {
        if (Platform.OS !== 'web') {
            const fileInfo = await FileSystem.getInfoAsync(audioUri);
            if (!fileInfo.exists || fileInfo.size === 0) {
                return {
                    text: '',
                    success: false,
                    error: 'Audio file not found or empty',
                };
            }
        }

        const formData = new FormData();
        formData.append('file', {
            uri: audioUri,
            type: 'audio/m4a',
            name: 'audio.m4a',
        } as any);
        if (language) {
            formData.append('language', language);
        }

        const response = await client.post(BACKEND_TRANSCRIBE_URL, formData, {
            headers: {
                'Idempotency-Key': idempotencyKey,
            },
            validateStatus: (status) => (status >= 200 && status < 300) || status === 403,
        });

        if (response.status === 403) {
            const { onLimitReached } = await import('../utils/limitEvents');
            onLimitReached.emit();
            return {
                text: '',
                success: false,
                error: 'Usage limit reached',
            };
        }

        const result = response.data;
        return {
            text: result.text || '',
            success: true,
        };
    } catch (error) {
        console.error('[Transcription] Backend call failed', error);
        const message = error instanceof Error ? error.message : 'Failed to get transcription from server';
        return { text: '', success: false, error: message };
    }
}

/**
 * Test connection to OpenAI API
 */
export async function testOpenAIConnection(options?: { baseUrl?: string; apiKey?: string }): Promise<boolean> {
    try {
        const apiKey = options?.apiKey ?? await getOpenAIApiKey();
        if (!apiKey) {
            return false;
        }

        const storedBaseUrl = options?.baseUrl ?? await getOpenAIBaseUrl();
        const modelsUrl = buildOpenAICompatibleUrl(storedBaseUrl || DEFAULT_OPENAI_BASE_URL, '/models');

        const response = await fetch(modelsUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
            },
        });

        return response.ok;
    } catch (error) {
        console.error('OpenAI connection test failed:', error);
        return false;
    }
}



/**
 * Process voice note using the Smart Agent backend
 */
export async function processVoiceNote(
    audioUri: string,
    language?: string,
    currentContent?: string,
    preTranscribedText?: string,
    recentMessages: string[] = []
): Promise<VoiceNoteResult> {
    const [provider, agentModeEnabled] = await Promise.all([
        getAIProvider(),
        getAgentModeEnabled(),
    ]);
    console.log('[VoiceAgent] Provider:', provider, 'Agent mode enabled:', agentModeEnabled);

    // Hard guard: /ai/agent must only be called when Agent Mode is enabled.
    // When Agent Mode is OFF, always fall back to normal transcription (/ai/transcribe or client-side Whisper).
    if (!agentModeEnabled) {
        console.log('[VoiceAgent] Agent mode disabled. Falling back to simple transcription.');
        // If we already have text, return it
        if (preTranscribedText) {
            return {
                originalText: preTranscribedText,
                processedText: null,
                hasInstruction: false,
                instruction: null,
                mode: 'none',
                titleAction: 'none',
                titleValue: null,
                suggestedTitle: null,
                success: true,
            };
        }
        const transResult = await transcribeAudio(audioUri, language);
        return {
            originalText: transResult.text,
            processedText: null,
            hasInstruction: false,
            instruction: null,
            mode: 'none',
            titleAction: 'none',
            titleValue: null,
            suggestedTitle: null,
            success: transResult.success,
            error: transResult.error,
        };
    }

    // Fallback for non-backend providers (e.g. direct OpenAI on client or Local options)
    // If not using the gateway, we can't use the agent logic easily without re-implementing it here.
    if (provider !== 'vaulto_ai') {
        console.log(`[VoiceAgent] Provider is ${provider}. Falling back to simple transcription (no agents).`);
        if (preTranscribedText) {
            return {
                originalText: preTranscribedText,
                processedText: null,
                hasInstruction: false,
                instruction: null,
                mode: null,
                titleAction: 'none',
                titleValue: null,
                suggestedTitle: null,
                success: true
            };
        }
        const transResult = await transcribeAudio(audioUri, language);
        return {
            originalText: transResult.text,
            processedText: null,
            hasInstruction: false,
            instruction: null,
            mode: null,
            titleAction: 'none',
            titleValue: null,
            suggestedTitle: null,
            success: transResult.success,
            error: transResult.error
        };
    }

    // Use Backend (Vaulto AI)
    try {
        console.log('[VoiceAgent] Request URL:', BACKEND_PROCESS_NOTE_URL);

        // Agent endpoint accepts only transcript text.
        // If text was not provided, transcribe first via standard transcription flow.
        let transcriptText = preTranscribedText || '';
        if (!transcriptText) {
            const transResult = await transcribeAudio(audioUri, language);
            if (!transResult.success || !transResult.text) {
                return {
                    originalText: '',
                    success: false,
                    error: transResult.error || 'Failed to transcribe audio before agent processing',
                    hasInstruction: false
                };
            }
            transcriptText = transResult.text;
        }

        const formData = new FormData();
        formData.append('transcript', transcriptText);
        if (currentContent) {
            formData.append('current_content', currentContent);
        }

        if (recentMessages && recentMessages.length > 0) {
            // Take only the last 5 messages for active note session context
            const limitedMessages = recentMessages.slice(-5);
            formData.append('recent_messages', JSON.stringify(limitedMessages));
        }



        const response = await client.post(BACKEND_PROCESS_NOTE_URL, formData, {
            validateStatus: (status) =>
                (status >= 200 && status < 300) || status === 403 || status === 404,
        });

        if (response.status === 403) {
            const { onLimitReached } = await import('../utils/limitEvents');
            onLimitReached.emit();
            return {
                originalText: transcriptText,
                processedText: null,
                hasInstruction: false,
                success: false,
                error: 'Usage limit reached'
            };
        }

        // Fallback checks
        if (response.status === 404) {
            return {
                originalText: transcriptText,
                processedText: null,
                hasInstruction: false,
                success: true,
                error: 'Backend endpoint not found, using local transcript'
            };
        }

        const result = response.data;
        // Backend returns: { "mode": "...", "raw_note": "...", "improved_markdown": "...", "has_instruction": bool }

        return {
            originalText: result.raw_note || transcriptText || '',
            processedText: result.improved_markdown,
            hasInstruction: typeof result.has_instruction === 'boolean' ? result.has_instruction : (result.mode !== "none"),
            instruction: null,
            mode: result.mode,
            titleAction: result.title_action === 'set' ? 'set' : 'none',
            titleValue: typeof result.title_value === 'string' ? result.title_value : null,
            suggestedTitle: typeof result.suggested_title === 'string' ? result.suggested_title : null,
            success: true
        };

    } catch (error) {
        // Use warn instead of error to prevent RedBox overlays in development for network issues
        console.warn('[VoiceAgent] Processing failed:', error instanceof Error ? error.message : error);

        return {
            originalText: preTranscribedText || '',
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            hasInstruction: false
        };
    }
}
