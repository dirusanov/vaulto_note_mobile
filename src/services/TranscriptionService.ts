/**
 * Transcription service for sending audio to OpenAI Whisper API.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { API_URL } from '../utils/env';
import { storage, getAgentModeEnabled, getAIProvider, getOpenAIApiKey, getOpenAIBaseUrl } from '../utils/storage';
import { buildOpenAICompatibleUrl, DEFAULT_OPENAI_BASE_URL } from '../utils/openaiCompat';

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
    const provider = await getAIProvider();
    if (provider === 'secure_llm') {
        return transcribeViaBackend(audioUri, language);
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
                    error: 'OpenAI API key not found',
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
            if (language) {
                formData.append('language', language);
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
        error: lastError?.message || 'Transcription failed after multiple attempts',
    };
}

async function transcribeViaBackend(audioUri: string, language?: string): Promise<TranscriptionResult> {
    const token = await storage.getToken();
    const baseUrl = BACKEND_TRANSCRIBE_URL;

    if (!token) {
        return {
            text: '',
            success: false,
            error: 'Sign in required to use Vaulto AI.',
        };
    }

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

        const makeRequest = async (url: string) => {
            return await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                },
                body: formData,
            });
        };

        let response = await makeRequest(baseUrl);



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
            success: transResult.success,
            error: transResult.error,
        };
    }

    // Fallback for non-backend providers (e.g. direct OpenAI on client)
    // If not using the gateway, we can't use the agent logic easily without re-implementing it here.
    // For now, if provider is 'openai' (client-side), we just transcribe and return no instruction.
    if (provider === 'openai') {
        console.log('[VoiceAgent] Provider is OpenAI. Falling back to simple transcription (no agents).');
        if (preTranscribedText) {
            return {
                originalText: preTranscribedText,
                processedText: null,
                hasInstruction: false,
                instruction: null,
                mode: null,
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
            success: transResult.success,
            error: transResult.error
        };
    }

    // Use Backend (Vaulto AI)
    const token = await storage.getToken();
    const baseUrl = BACKEND_PROCESS_NOTE_URL;
    if (!token) {
        console.log('[VoiceAgent] No auth token found.');
        return { originalText: '', success: false, error: 'Sign in required', hasInstruction: false };
    }

    try {
        console.log('[VoiceAgent] Request URL:', baseUrl);

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



        const makeRequest = async (url: string) => {
            return await fetch(url, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData,
            });
        };

        let response = await makeRequest(baseUrl);

        // Fallback checks
        if (!response.ok) {


            // 2. If STILL failing (or wasn't a URL issue), try standard fallback
            if (!response.ok) {
                if (response.status === 404) {
                    return {
                        originalText: transcriptText,
                        processedText: null,
                        hasInstruction: false,
                        success: true,
                        error: 'Backend endpoint not found, using local transcript'
                    };
                }
                const errorText = await response.text();
                throw new Error(`API error: ${response.status} - ${errorText}`);
            }
        }

        const result = await response.json();
        // Backend returns: { "mode": "...", "raw_note": "...", "improved_markdown": "...", "has_instruction": bool }

        return {
            originalText: result.raw_note || transcriptText || '',
            processedText: result.improved_markdown,
            hasInstruction: typeof result.has_instruction === 'boolean' ? result.has_instruction : (result.mode !== "none"),
            instruction: null,
            mode: result.mode,
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
