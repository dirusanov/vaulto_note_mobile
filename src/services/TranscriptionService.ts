/**
 * Transcription service for sending audio to OpenAI Whisper API.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { API_URL } from '../utils/env';
import { storage, getAgentModeEnabled, getAIProvider, getOpenAIApiKey } from '../utils/storage';

const OPENAI_WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 2000; // 2 seconds
// Ensure we don't double up on /gateway if it's already in API_URL
const BASE_URL = API_URL.endsWith('/gateway') ? API_URL : `${API_URL}/gateway`;
const BACKEND_TRANSCRIBE_URL = `${BASE_URL}/ai/transcribe`;
const BACKEND_PROCESS_NOTE_URL = `${BASE_URL}/ai/process_voice_note`;

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
    if (provider === 'secure_llm' || provider === 'selfhosted') {
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
            if (language) {
                formData.append('language', language);
            }

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

async function transcribeViaBackend(audioUri: string, language?: string): Promise<TranscriptionResult> {
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

        // Fallback: If 404 and url contained /gateway, try removing it
        if (response.status === 404 && baseUrl.includes('/gateway/')) {
            console.log('[Transcription] 404 on gateway URL, retrying without /gateway prefix...');
            const fallbackUrl = baseUrl.replace('/gateway/', '/');
            response = await makeRequest(fallbackUrl);
        }

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

    // Hard guard: /ai/process_voice_note must only be called when Agent Mode is enabled.
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

        // If we don't have text, ensure audio file exists
        if (!preTranscribedText && Platform.OS !== 'web') {
            const fileInfo = await FileSystem.getInfoAsync(audioUri);
            if (!fileInfo.exists || fileInfo.size === 0) {
                return { originalText: '', success: false, error: 'Audio file error', hasInstruction: false };
            }
        }

        const formData = new FormData();

        // Only append file if we don't have the text script
        if (!preTranscribedText) {
            formData.append('file', {
                uri: audioUri,
                type: 'audio/m4a',
                name: 'audio.m4a',
            } as any);
        }

        if (language) {
            formData.append('language', language);
        }
        if (currentContent) {
            formData.append('current_content', currentContent);
        }
        if (preTranscribedText) {
            formData.append('transcript', preTranscribedText);
            // We might need to send a dummy file or omit it. 
            // Our backend now supports optional file if transcript is present.
            // But to be safe with some fetch implementations, let's just NOT send 'file' key at all.
        }

        if (recentMessages && recentMessages.length > 0) {
            // Take only the last 7 messages as requested
            const limitedMessages = recentMessages.slice(-7);
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
            // 1. URL Fix: If 404 and url contained /gateway, try removing it FIRST
            if (response.status === 404 && baseUrl.includes('/gateway/')) {
                console.log('[VoiceAgent] 404 on gateway URL, retrying without /gateway prefix...');
                const fallbackUrl = baseUrl.replace('/gateway/', '/');
                response = await makeRequest(fallbackUrl);
            }

            // 2. If STILL failing (or wasn't a URL issue), try standard fallback
            if (!response.ok) {
                if (response.status === 404) {
                    if (preTranscribedText) {
                        return {
                            originalText: preTranscribedText,
                            processedText: null,
                            hasInstruction: false,
                            success: true,
                            error: 'Backend endpoint not found, using local transcript'
                        };
                    }
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
        }

        const result = await response.json();
        // Backend returns: { "mode": "...", "raw_note": "...", "improved_markdown": "...", "has_instruction": bool }

        return {
            originalText: result.raw_note || preTranscribedText || '',
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

