/**
 * Transcription service for sending audio to OpenAI Whisper API.
 */
import axios from 'axios';
import * as FileSystem from 'expo-file-system/legacy';
import { File as ExpoFile } from 'expo-file-system';
import { Platform } from 'react-native';
import { API_URL } from '../utils/env';
import {
    storage,
    getAgentModeEnabled,
    getAIProvider,
    getOpenAIApiKey,
    getOpenAIBaseUrl,
    getTranscriptionLanguage,
    getOnDeviceTranscription,
} from '../utils/storage';
import { LOCAL_WHISPER_ENABLED } from '../utils/featureFlags';
import { buildOpenAICompatibleUrl, DEFAULT_OPENAI_BASE_URL } from '../utils/openaiCompat';
import { isRichHtmlContent, richContentToAgentMarkdown } from '../utils/richContent';
import { generateUUID } from '../utils/uuid';
import { onUnauthorized } from '../utils/authEvents';
import { refreshSession } from '../api/tokenRefresh';
import { getDeviceId, getPlatformName } from '../utils/deviceIdentity';
import { getLocalWhisperModelStatus, prepareAudioForLocalWhisper, transcribeWithLocalWhisper } from './LocalWhisperService';
import { isDeviceOffline } from '../utils/connectivity';
import { getEffectiveAIProvider } from './effectiveProvider';

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 2000; // 2 seconds
const BACKEND_TRANSCRIBE_PATH = '/ai/transcribe';
const BACKEND_TRANSCRIBE_URL = `${API_URL}${BACKEND_TRANSCRIBE_PATH}`;
const BACKEND_TRANSCRIBE_TIMEOUT_MS = 90000;
const BACKEND_PROCESS_NOTE_PATH = '/ai/agent';
const BACKEND_PROCESS_NOTE_URL = `${API_URL}${BACKEND_PROCESS_NOTE_PATH}`;
// The agent may chain a checklist pass before the main pass, each with its own
// upstream budget, so the client deadline has to sit above the server's worst case.
const BACKEND_AGENT_TIMEOUT_MS = 150000;
const BACKEND_AGENT_MAX_ATTEMPTS = 2;
const BACKEND_AGENT_RETRY_DELAY_MS = 1500;

export interface TranscriptionResult {
    text: string;
    success: boolean;
    error?: string;
}

/** How the returned content relates to the note it was built from. */
export type AgentContentAction = 'append' | 'replace' | 'none';

/** Machine-readable reason for a confirmation, so the UI can localize the prompt. */
export type AgentConfirmationKind =
    | 'clear_content'
    | 'replace_content'
    | 'remove_items'
    | 'checklist_update'
    | '';

const AGENT_CONFIRMATION_KINDS: AgentConfirmationKind[] = [
    'clear_content',
    'replace_content',
    'remove_items',
    'checklist_update',
];

export interface VoiceNoteResult {
    originalText: string;
    processedText?: string | null;
    hasInstruction: boolean;
    instruction?: string | null;
    mode?: string | null;
    /** Server-decided append-vs-replace. Never infer this from content length. */
    contentAction?: AgentContentAction;
    needsConfirmation?: boolean;
    confirmationKind?: AgentConfirmationKind;
    confirmationMessage?: string | null;
    titleAction?: 'set' | 'none';
    titleValue?: string | null;
    suggestedTitle?: string | null;
    success: boolean;
    error?: string;
}

const parseContentAction = (value: unknown): AgentContentAction => {
    if (value === 'append' || value === 'replace' || value === 'none') {
        return value;
    }
    return 'none';
};

const parseConfirmationKind = (value: unknown): AgentConfirmationKind => {
    if (typeof value === 'string' && (AGENT_CONFIRMATION_KINDS as string[]).includes(value)) {
        return value as AgentConfirmationKind;
    }
    return '';
};

const normalizeAgentContextContent = (content?: string): string | undefined => {
    if (!content) {
        return undefined;
    }

    const normalized = isRichHtmlContent(content)
        ? richContentToAgentMarkdown(content)
        : content;

    const trimmed = normalized.trim();
    return trimmed || undefined;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let transcriptionUnauthorizedEmitted = false;

const extractErrorText = (payload: unknown): string | undefined => {
    if (!payload || typeof payload !== 'object') {
        return undefined;
    }

    const data = payload as Record<string, unknown>;
    const candidates = [data.detail, data.message, data.error];
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) {
            return candidate.trim();
        }
    }

    return undefined;
};

const emitTranscriptionUnauthorizedOnce = async () => {
    if (transcriptionUnauthorizedEmitted) {
        return;
    }
    transcriptionUnauthorizedEmitted = true;
    await storage.removeToken();
    await storage.removeRefreshToken();
    onUnauthorized.emit();
};

// A guest session has no refresh token: its short-lived access token is
// renewed by signing in anonymously again with the same device id, which
// returns the same guest (and its remaining free minutes).
const renewGuestAccessToken = async (): Promise<string | null> => {
    try {
        const profile = await storage.getUserProfile();
        if (profile?.provider !== 'anonymous') return null;
        const { authApi } = await import('../api/auth');
        const guest = await authApi.anonymousAuth(await getDeviceId(), getPlatformName());
        if (!guest?.access_token) return null;
        await storage.setToken(guest.access_token);
        return guest.access_token;
    } catch (error) {
        console.warn('[Transcription] Guest session renewal failed', error);
        return null;
    }
};

const refreshTranscriptionAccessToken = async (): Promise<string | null> => {
    // Shared with the API clients: refresh tokens are single-use.
    const result = await refreshSession();
    if (result.kind === 'success') {
        transcriptionUnauthorizedEmitted = false;
        return result.accessToken;
    }
    if (result.kind === 'invalid_refresh') {
        const guestToken = await renewGuestAccessToken();
        if (guestToken) {
            transcriptionUnauthorizedEmitted = false;
            return guestToken;
        }
        await emitTranscriptionUnauthorizedOnce();
    }
    return null;
};

const isAbortError = (error: unknown): boolean => {
    return error instanceof Error && error.name === 'AbortError';
};

const isNetworkRequestError = (error: unknown): boolean => {
    if (!(error instanceof Error)) {
        return false;
    }

    if (isAbortError(error)) {
        return true;
    }

    if (error instanceof TypeError) {
        return true;
    }

    const normalizedMessage = error.message.trim().toLowerCase();
    return normalizedMessage === 'network error' || normalizedMessage === 'network request failed';
};

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {
            ...init,
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Since SDK 57 the global fetch is expo/fetch, which cannot serialise React
 * Native's `{ uri, name, type }` file parts and rejects the whole request with
 * "Unsupported FormDataPart implementation". A File from expo-file-system
 * exposes `bytes()`, which it can stream as a proper multipart part.
 */
const appendAudioFilePart = (formData: FormData, audioUri: string) => {
    formData.append('file', new ExpoFile(audioUri) as unknown as Blob, 'audio.m4a');
};

const buildBackendTranscriptionFormData = (audioUri: string, language?: string): FormData => {
    const formData = new FormData();
    appendAudioFilePart(formData, audioUri);
    if (language) {
        formData.append('language', language);
    }
    return formData;
};

async function performBackendTranscriptionRequest(
    audioUri: string,
    idempotencyKey: string,
    accessToken: string,
    language?: string,
): Promise<Response> {
    // Use fetch for native multipart audio uploads to avoid Axios adapter issues and the shared 30s client timeout.
    return fetchWithTimeout(
        BACKEND_TRANSCRIBE_URL,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Idempotency-Key': idempotencyKey,
            },
            body: buildBackendTranscriptionFormData(audioUri, language),
        },
        BACKEND_TRANSCRIBE_TIMEOUT_MS,
    );
}

async function fetchBackendTranscriptionWithAuth(
    audioUri: string,
    idempotencyKey: string,
    language?: string,
): Promise<Response> {
    const accessToken = await storage.getToken();
    if (!accessToken) {
        await emitTranscriptionUnauthorizedOnce();
        throw new Error('Sign in required to use Vaulto AI.');
    }

    transcriptionUnauthorizedEmitted = false;
    const initialResponse = await performBackendTranscriptionRequest(
        audioUri,
        idempotencyKey,
        accessToken,
        language,
    );

    if (initialResponse.status !== 401) {
        return initialResponse;
    }

    const refreshedAccessToken = await refreshTranscriptionAccessToken();
    if (!refreshedAccessToken) {
        return initialResponse;
    }

    return performBackendTranscriptionRequest(
        audioUri,
        idempotencyKey,
        refreshedAccessToken,
        language,
    );
}

async function extractResponseMessage(response: Response): Promise<string | undefined> {
    const contentType = response.headers.get('content-type') ?? '';

    try {
        if (contentType.includes('application/json')) {
            const json = await response.json();
            const detail = extractErrorText(json);
            if (detail) {
                return detail;
            }
        } else {
            const text = (await response.text()).trim();
            if (text) {
                return text;
            }
        }
    } catch {
        return undefined;
    }

    return undefined;
}

const buildBackendAgentFormData = (
    transcript: string,
    currentContent?: string,
    recentMessages: string[] = [],
): FormData => {
    const formData = new FormData();
    formData.append('transcript', transcript);
    if (currentContent) {
        formData.append('current_content', currentContent);
    }

    if (recentMessages.length > 0) {
        formData.append('recent_messages', JSON.stringify(recentMessages.slice(-5)));
    }

    return formData;
};

async function performBackendAgentRequest(
    transcript: string,
    accessToken: string,
    idempotencyKey: string,
    currentContent?: string,
    recentMessages: string[] = [],
): Promise<Response> {
    return fetchWithTimeout(
        BACKEND_PROCESS_NOTE_URL,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                // Retries below must never bill the user twice for the same command.
                'Idempotency-Key': idempotencyKey,
            },
            body: buildBackendAgentFormData(transcript, currentContent, recentMessages),
        },
        BACKEND_AGENT_TIMEOUT_MS,
    );
}

async function fetchBackendAgentWithAuth(
    transcript: string,
    idempotencyKey: string,
    currentContent?: string,
    recentMessages: string[] = [],
): Promise<Response> {
    const accessToken = await storage.getToken();
    if (!accessToken) {
        await emitTranscriptionUnauthorizedOnce();
        throw new Error('Sign in required to use Vaulto AI.');
    }

    transcriptionUnauthorizedEmitted = false;
    const initialResponse = await performBackendAgentRequest(
        transcript,
        accessToken,
        idempotencyKey,
        currentContent,
        recentMessages,
    );

    if (initialResponse.status !== 401) {
        return initialResponse;
    }

    const refreshedAccessToken = await refreshTranscriptionAccessToken();
    if (!refreshedAccessToken) {
        return initialResponse;
    }

    return performBackendAgentRequest(
        transcript,
        refreshedAccessToken,
        idempotencyKey,
        currentContent,
        recentMessages,
    );
}

const isRetryableAgentStatus = (status?: number): boolean => {
    return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
};

const isRetryableAgentError = (error: unknown): boolean => {
    if (isNetworkRequestError(error)) {
        return true;
    }

    if (!axios.isAxiosError(error)) {
        return false;
    }

    if (!error.response) {
        return true;
    }

    return isRetryableAgentStatus(error.response.status);
};

const formatAgentRequestError = (error: unknown): string => {
    if (isAbortError(error)) {
        return 'Agent request timed out. Please try again.';
    }

    if (axios.isAxiosError(error)) {
        const detail = extractErrorText(error.response?.data);
        if (detail) {
            return detail;
        }

        if (error.code === 'ECONNABORTED') {
            return 'Agent request timed out. Please try again.';
        }

        if (!error.response) {
            return 'Cannot reach the agent service. Check internet connection and try again.';
        }

        if (error.response.status >= 500) {
            return `Agent service error (${error.response.status}). Please try again.`;
        }
    }

    if (isNetworkRequestError(error)) {
        return 'Cannot reach the agent service. Check internet connection and try again.';
    }

    if (error instanceof Error && error.message.trim()) {
        return error.message;
    }

    return 'Failed to process agent request';
};

/**
 * Recordings are transcribed by the downloaded Whisper model; audio never leaves the
 * device. Same rule as the Settings switch: without the model file it is off.
 */
/**
 * Whether the next transcription runs on this phone: the user turned it on, or
 * there is no internet and the speech model is already downloaded (so a
 * recording made offline is still transcribed instead of waiting for a server).
 */
export async function isOnDeviceTranscriptionActive(): Promise<boolean> {
    if (!LOCAL_WHISPER_ENABLED || Platform.OS === 'web') return false;
    let downloaded = false;
    try {
        downloaded = (await getLocalWhisperModelStatus()).isDownloaded;
    } catch {
        return false;
    }
    if (!downloaded) return false;
    return (await getOnDeviceTranscription()) || (await isDeviceOffline());
}

/**
 * Transcribe audio file using OpenAI Whisper API
 */
export const ON_DEVICE_MODEL_REQUIRED = 'on_device_model_required';

export async function transcribeAudio(
    audioUri: string,
    language?: string,
    options: { onDeviceOnly?: boolean } = {},
): Promise<TranscriptionResult> {
    const selectedLanguage = language || await resolvePreferredTranscriptionLanguage();
    if (options.onDeviceOnly) {
        // Protected notes: the audio never leaves the device, whatever the settings.
        const status = await getLocalWhisperModelStatus().catch(() => null);
        if (!LOCAL_WHISPER_ENABLED || Platform.OS === 'web' || !status?.isDownloaded) {
            return { text: '', success: false, error: ON_DEVICE_MODEL_REQUIRED };
        }
        return transcribeViaLocalWhisper(audioUri, selectedLanguage);
    }
    if (await isOnDeviceTranscriptionActive()) {
        return transcribeViaLocalWhisper(audioUri, selectedLanguage);
    }
    const provider = await getAIProvider();
    if (provider === 'vaulto_ai') {
        // Out of cloud minutes with the speech model on the phone: transcribe here
        // instead of stopping at the limit sheet. The sheet shows only without one.
        const localReady = LOCAL_WHISPER_ENABLED && Platform.OS !== 'web'
            && !!(await getLocalWhisperModelStatus().catch(() => null))?.isDownloaded;
        const cloud = await transcribeViaBackend(audioUri, selectedLanguage, { announceLimit: !localReady });
        if (localReady && cloud.error === USAGE_LIMIT_REACHED) {
            return transcribeViaLocalWhisper(audioUri, selectedLanguage);
        }
        return cloud;
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

            appendAudioFilePart(formData, audioUri);
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

const USAGE_LIMIT_REACHED = 'Usage limit reached';

async function transcribeViaBackend(
    audioUri: string,
    language?: string,
    options: { announceLimit?: boolean } = {},
): Promise<TranscriptionResult> {
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

        const response = await fetchBackendTranscriptionWithAuth(audioUri, idempotencyKey, language);

        if (response.status === 403) {
            if (options.announceLimit !== false) {
                const { onLimitReached } = await import('../utils/limitEvents');
                onLimitReached.emit();
            }
            return {
                text: '',
                success: false,
                error: USAGE_LIMIT_REACHED,
            };
        }

        if (!response.ok) {
            const detail = await extractResponseMessage(response);
            const error =
                response.status === 401
                    ? 'Session expired. Please sign in again.'
                    : detail || `Transcription request failed (${response.status})`;
            return {
                text: '',
                success: false,
                error,
            };
        }

        const result = await response.json();
        return {
            text: result.text || '',
            success: true,
        };
    } catch (error) {
        console.error('[Transcription] Backend call failed', error);
        const message = isAbortError(error)
            ? 'Transcription request timed out. Please try again.'
            : error instanceof Error
                ? error.message
                : 'Failed to get transcription from server';
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
        getEffectiveAIProvider(),
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
                contentAction: 'none',
                needsConfirmation: false,
                confirmationKind: '',
                confirmationMessage: null,
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
            contentAction: 'none',
            needsConfirmation: false,
            confirmationKind: '',
            confirmationMessage: null,
            titleAction: 'none',
            titleValue: null,
            suggestedTitle: null,
            success: transResult.success,
            error: transResult.error,
        };
    }

    console.log('[VoiceAgent] Request URL:', BACKEND_PROCESS_NOTE_URL);
    const normalizedCurrentContent = normalizeAgentContextContent(currentContent);

    // Agent endpoint accepts only transcript text.
    // If text was not provided, transcribe first via standard transcription flow.
    // One key per logical command: retries below reuse it so quota is charged once.
    const agentIdempotencyKey = await generateUUID();

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

    for (let attempt = 1; attempt <= BACKEND_AGENT_MAX_ATTEMPTS; attempt += 1) {
        try {
            const response = await fetchBackendAgentWithAuth(
                transcriptText,
                agentIdempotencyKey,
                normalizedCurrentContent,
                recentMessages,
            );

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

            if (!response.ok) {
                if (attempt < BACKEND_AGENT_MAX_ATTEMPTS && isRetryableAgentStatus(response.status)) {
                    await sleep(BACKEND_AGENT_RETRY_DELAY_MS * attempt);
                    continue;
                }

                const detail = await extractResponseMessage(response);
                return {
                    originalText: transcriptText || preTranscribedText || '',
                    success: false,
                    error: response.status === 401
                        ? 'Session expired. Please sign in again.'
                        : detail || `Agent request failed (${response.status})`,
                    hasInstruction: false
                };
            }

            const result = await response.json();
            // Backend returns: { mode, raw_note, improved_markdown, has_instruction,
            //   content_action, needs_confirmation, confirmation_kind, confirmation_message,
            //   title_action, title_value, suggested_title }

            return {
                originalText: result.raw_note || transcriptText || '',
                processedText: result.improved_markdown,
                hasInstruction: typeof result.has_instruction === 'boolean' ? result.has_instruction : (result.mode !== "none"),
                instruction: null,
                mode: result.mode,
                contentAction: parseContentAction(result.content_action),
                needsConfirmation: typeof result.needs_confirmation === 'boolean' ? result.needs_confirmation : false,
                confirmationKind: parseConfirmationKind(result.confirmation_kind),
                confirmationMessage: typeof result.confirmation_message === 'string' ? result.confirmation_message : null,
                titleAction: result.title_action === 'set' ? 'set' : 'none',
                titleValue: typeof result.title_value === 'string' ? result.title_value : null,
                suggestedTitle: typeof result.suggested_title === 'string' ? result.suggested_title : null,
                success: true
            };
        } catch (error) {
            const formattedError = formatAgentRequestError(error);
            const shouldRetry = attempt < BACKEND_AGENT_MAX_ATTEMPTS && isRetryableAgentError(error);

            console.warn(
                `[VoiceAgent] Processing attempt ${attempt} failed:`,
                error instanceof Error ? error.message : error,
            );

            if (shouldRetry) {
                await sleep(BACKEND_AGENT_RETRY_DELAY_MS * attempt);
                continue;
            }

            return {
                originalText: transcriptText || preTranscribedText || '',
                success: false,
                error: formattedError,
                hasInstruction: false
            };
        }
    }

    return {
        originalText: transcriptText || preTranscribedText || '',
        success: false,
        error: 'Failed to process agent request',
        hasInstruction: false
    };
}
