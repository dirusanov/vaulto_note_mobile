/**
 * Transcription service for sending audio to OpenAI Whisper API.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { API_URL } from '../utils/env';
import { storage, getAIProvider, getOpenAIApiKey } from '../utils/storage';

const OPENAI_WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 2000; // 2 seconds
const BACKEND_TRANSCRIBE_URL = `${API_URL}/ai/transcribe`;
const BACKEND_PROCESS_NOTE_URL = `${API_URL}/ai/process_voice_note`;

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
    language: string = 'ru'
): Promise<TranscriptionResult> {
    const provider = await getAIProvider();
    if (provider === 'local' || provider === 'selfhosted') {
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
                console.log('[Transcription] File info:', fileInfo);

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

            console.log('[Transcription] Uploading file:', file);

            formData.append('file', file);
            formData.append('model', 'whisper-1');
            formData.append('language', language);

            // Send request
            const response = await fetch(OPENAI_WHISPER_URL, {
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

async function transcribeViaBackend(audioUri: string, language: string): Promise<TranscriptionResult> {
    // Check if self-hosted provider is selected
    const provider = await getAIProvider();
    const isSelfHosted = provider === 'selfhosted';

    let token: string | null;
    let baseUrl: string;

    if (isSelfHosted) {
        // Use self-hosted configuration
        const selfHostedUrl = await AsyncStorage.getItem('vaulto_self_hosted_url');
        const selfHostedApiKey = await AsyncStorage.getItem('vaulto_self_hosted_api_key');

        if (!selfHostedUrl || !selfHostedApiKey) {
            return {
                text: '',
                success: false,
                error: 'Self-hosted settings missing. Check URL and API Key.',
            };
        }

        token = selfHostedApiKey;
        baseUrl = `${selfHostedUrl}/ai/transcribe`;
    } else {
        // Use default backend
        token = await storage.getToken();
        baseUrl = BACKEND_TRANSCRIBE_URL;

        if (!token) {
            return {
                text: '',
                success: false,
                error: 'Sign in required to use local Whisper.',
            };
        }
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
        formData.append('language', language);

        const response = await fetch(baseUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
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
        console.error('[Transcription] Backend call failed', error);
        const message = error instanceof Error ? error.message : 'Failed to get transcription from server';
        return { text: '', success: false, error: message };
    }
}

/**
 * Test connection to OpenAI API
 */
export async function testOpenAIConnection(): Promise<boolean> {
    try {
        const provider = await getAIProvider();
        if (provider !== 'openai') {
            return false;
        }

        const apiKey = await getOpenAIApiKey();
        if (!apiKey) {
            return false;
        }

        const response = await fetch('https://api.openai.com/v1/models', {
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
 * Test connection to Self-Hosted backend healthcheck
 */
export async function testSelfHostedConnection(url: string, apiKey: string): Promise<boolean> {
    try {
        if (!url || !apiKey) return false;

        const normalizedUrl = url.replace(/\/+$/, '');
        const healthUrl = `${normalizedUrl}/health`;

        const response = await fetch(healthUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
            },
        });

        return response.ok;
    } catch (error) {
        console.error('Self-hosted connection test failed:', error);
        return false;
    }
}
/**
 * Process voice note using the Smart Agent backend
 */
export async function processVoiceNote(
    audioUri: string,
    language: string = 'ru'
): Promise<VoiceNoteResult> {
    const provider = await getAIProvider();
    console.log('[VoiceAgent] Provider:', provider);

    // Fallback for non-backend providers (e.g. direct OpenAI on client)
    // If not using the gateway, we can't use the agent logic easily without re-implementing it here.
    // For now, if provider is 'openai' (client-side), we just transcribe and return no instruction.
    if (provider === 'openai') {
        console.log('[VoiceAgent] Provider is OpenAI. Falling back to simple transcription (no agents).');
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

    // Use Backend (Self-hosted or Cloud)
    let token: string | null;
    let baseUrl: string;
    const isSelfHosted = provider === 'selfhosted';

    if (isSelfHosted) {
        const selfHostedUrl = await AsyncStorage.getItem('vaulto_self_hosted_url');
        const selfHostedApiKey = await AsyncStorage.getItem('vaulto_self_hosted_api_key');
        if (!selfHostedUrl || !selfHostedApiKey) {
            return { originalText: '', success: false, error: 'Self-hosted settings missing', hasInstruction: false };
        }
        token = selfHostedApiKey;
        baseUrl = `${selfHostedUrl}/ai/process_voice_note`;
    } else {
        token = await storage.getToken();
        baseUrl = BACKEND_PROCESS_NOTE_URL;
        if (!token) {
            console.log('[VoiceAgent] No auth token found.');
            return { originalText: '', success: false, error: 'Sign in required', hasInstruction: false };
        }
    }

    try {
        console.log('[VoiceAgent] Request URL:', baseUrl);
        if (Platform.OS !== 'web') {
            const fileInfo = await FileSystem.getInfoAsync(audioUri);
            if (!fileInfo.exists || fileInfo.size === 0) {
                return { originalText: '', success: false, error: 'Audio file error', hasInstruction: false };
            }
        }

        const formData = new FormData();
        formData.append('file', {
            uri: audioUri,
            type: 'audio/m4a',
            name: 'audio.m4a',
        } as any);
        formData.append('language', language);

        const response = await fetch(baseUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData,
        });

        if (!response.ok) {
            // Fallback: If endpoint 404s (old backend), try standard transcribe
            if (response.status === 404) {
                const transResult = await transcribeAudio(audioUri, language);
                return {
                    originalText: transResult.text,
                    processedText: null,
                    hasInstruction: false,
                    success: transResult.success,
                    error: transResult.error
                };
            }
            const errorText = await response.text();
            throw new Error(`API error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        // Backend returns: { "mode": "...", "raw_note": "...", "improved_markdown": "..." }

        return {
            originalText: result.raw_note || '',
            processedText: result.improved_markdown,
            hasInstruction: result.mode !== "none",
            instruction: null, // Backend doesn't strictly return instruction text anymore, just mode and result
            mode: result.mode,
            success: true
        };

    } catch (error) {
        console.error('[VoiceAgent] Failed', error);
        return {
            originalText: '',
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            hasInstruction: false
        };
    }
}
