import { AppState, NativeModules, Platform } from 'react-native';
import { stripWhisperHallucinations } from '../utils/whisperText';
import * as FileSystem from 'expo-file-system/legacy';
import { getLocalWhisperModelKey, setLocalWhisperModelKey } from '../utils/storage';
import { canDeviceRunModel, describeDeviceMemory } from './DeviceCapabilities';
import { releaseLocalLLMContext } from './LocalLLMService';
import {
    createMutex,
    DOWNLOAD_CANCELLED,
    downloadModelFile,
    formatBytes,
    GGML_MAGIC,
    hasRoomForModel,
    ModelDownloadProgress,
} from './modelDownload';

export type LocalWhisperModelKey = 'tiny' | 'base' | 'large' | 'turbo';

export interface LocalWhisperModelDescriptor {
    key: LocalWhisperModelKey;
    label: string;
    sizeLabel: string;
    sizeBytes: number;
    filename: string;
    url: string;
    power: number; // 1-4 scale
    recommended?: boolean;
}

export interface LocalWhisperModelStatus {
    selectedModel: LocalWhisperModelDescriptor;
    isDownloaded: boolean;
    fileUri: string;
    bytesOnDisk: number;
}

export interface RealtimeDictationHandle {
    stop: () => Promise<void>;
}

type WhisperTranscriptPayload = {
    result?: string;
    text?: string;
};

type WhisperRealtimeEvent = {
    isCapturing: boolean;
    code: number;
    error?: string;
    data?: WhisperTranscriptPayload;
};

type WhisperRnContext = {
    transcribe: (
        audioUri: string,
        options?: Record<string, unknown>
    ) => { promise?: Promise<WhisperTranscriptPayload> } | Promise<WhisperTranscriptPayload>;
    transcribeRealtime: (
        options?: Record<string, unknown>
    ) => Promise<{
        stop: () => Promise<void>;
        subscribe: (callback: (event: WhisperRealtimeEvent) => void) => void;
    }>;
    release?: () => Promise<void> | void;
};

type WhisperRnModule = {
    initWhisper: (options: Record<string, unknown>) => Promise<WhisperRnContext>;
};

const hasAsyncTranscript = (
    value: { promise?: Promise<WhisperTranscriptPayload> } | Promise<WhisperTranscriptPayload>
): value is { promise?: Promise<WhisperTranscriptPayload> } => {
    return typeof (value as { promise?: Promise<WhisperTranscriptPayload> }).promise !== 'undefined';
};

const MODELS: Record<LocalWhisperModelKey, LocalWhisperModelDescriptor> = {
    tiny: {
        key: 'tiny',
        label: 'Tiny',
        sizeLabel: '~75 MB',
        sizeBytes: 77691713,
        filename: 'ggml-tiny.bin',
        url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
        power: 1,
    },
    base: {
        key: 'base',
        label: 'Base',
        sizeLabel: '~141 MB',
        sizeBytes: 147951465,
        filename: 'ggml-base.bin',
        url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
        power: 2,
    },
    large: {
        key: 'large',
        label: 'Large',
        sizeLabel: '~2.9 GB',
        sizeBytes: 3095033483,
        filename: 'ggml-large-v3.bin',
        url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin',
        power: 4,
    },
    turbo: {
        key: 'turbo',
        label: 'Turbo',
        sizeLabel: '~547 MB',
        sizeBytes: 574041195,
        filename: 'ggml-large-v3-turbo-q5_0.bin',
        url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin',
        power: 4,
        recommended: true,
    },
};

type AudioTranscodeModuleShape = {
    convertToWav: (inputUri: string) => Promise<string>;
};

const baseDir = FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? null;
const MODELS_DIR = baseDir ? `${baseDir}whisper-models/` : null;

/** whisper.cpp processes audio in 30s chunks; slices below that keep latency low. */
const REALTIME_SLICE_SEC = 20;
/** Upper bound for one dictation session. The old 30s default ended dictation mid-sentence. */
const REALTIME_MAX_SEC = 900;

let activeContext: WhisperRnContext | null = null;
let activeModelUri: string | null = null;
let activeDownloadResumable: FileSystem.DownloadResumable | null = null;
// A cancel that arrives before the download task exists (memory/space checks
// still running) is remembered and applied as soon as the task is created.
let downloadInProgress = false;
let cancelRequested = false;
/** Whisper allows one job per context: a second one entering whisper_full crashes the app. */
let activeJob: 'transcribe' | 'dictation' | null = null;
const withContextLock = createMutex();

const ensureModelsDir = async () => {
    if (!MODELS_DIR) {
        throw new Error('Local storage directory is unavailable on this device');
    }

    const info = await FileSystem.getInfoAsync(MODELS_DIR);
    if (!info.exists) {
        await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true });
    }
};

const getDescriptor = (key: string): LocalWhisperModelDescriptor => {
    return MODELS[(key as LocalWhisperModelKey)] || MODELS.tiny;
};

const getFileUriForModel = async (key?: string) => {
    const resolvedKey = key || await getLocalWhisperModelKey();
    const model = getDescriptor(resolvedKey);
    await ensureModelsDir();
    return {
        model,
        fileUri: `${MODELS_DIR}${model.filename}`,
    };
};

const resolveWhisperModule = (): WhisperRnModule | null => {
    try {
        const pkg = require('whisper.rn');
        if (pkg?.initWhisper) {
            return pkg as WhisperRnModule;
        }
    } catch {
        // Dependency is optional until native local transcription is enabled in the build.
    }

    const nativeModule = (NativeModules as Record<string, any>).WhisperContext || (NativeModules as Record<string, any>).RNWhisper;
    if (nativeModule?.initWhisper) {
        return nativeModule as WhisperRnModule;
    }

    return null;
};

export const isLocalWhisperRuntimeAvailable = (): boolean => resolveWhisperModule() !== null;

const resolveAudioTranscodeModule = (): AudioTranscodeModuleShape | null => {
    const nativeModule = (NativeModules as Record<string, unknown>).AudioTranscode;
    if (
        nativeModule &&
        typeof (nativeModule as AudioTranscodeModuleShape).convertToWav === 'function'
    ) {
        return nativeModule as AudioTranscodeModuleShape;
    }
    return null;
};

const beginJob = (kind: 'transcribe' | 'dictation') => {
    if (activeJob) {
        throw new Error(
            activeJob === 'dictation'
                ? 'Dictation is already running. Stop it before starting another recognition.'
                : 'Another recording is being transcribed. Wait for it to finish.'
        );
    }
    activeJob = kind;
};

const endJob = (kind: 'transcribe' | 'dictation') => {
    if (activeJob === kind) {
        activeJob = null;
        scheduleWhisperIdleRelease();
    }
};

const getReadyContext = async (modelUri: string): Promise<WhisperRnContext> => withContextLock(async () => {
    if (activeContext && activeModelUri === modelUri) {
        return activeContext;
    }

    // Drop the old context first: keeping the reference around means a failed
    // init below would hand the next caller an already released native pointer.
    const previous = activeContext;
    activeContext = null;
    activeModelUri = null;
    if (previous?.release) {
        await Promise.resolve(previous.release()).catch(() => undefined);
    }

    const whisperModule = resolveWhisperModule();
    if (!whisperModule) {
        throw new Error('Local Whisper engine is not installed in this build');
    }

    const context = await whisperModule.initWhisper({
        filePath: modelUri,
        // Metal on iOS; Core ML is ignored when the GPU is enabled and we ship no Core ML assets.
        useGpu: Platform.OS === 'ios',
    });
    activeContext = context;
    activeModelUri = modelUri;
    return context;
});

/**
 * The speech model and the AI model together do not fit in a 6 GB phone (the
 * system kills the app). Before loading Whisper, drop the AI model; it reloads
 * in seconds. Done outside this module's lock so the two never wait on each other.
 */
const makeRoomForWhisper = async (modelUri: string) => {
    if (activeContext && activeModelUri === modelUri) return;
    await releaseLocalLLMContext().catch(() => undefined);
};

// Like the AI model: free the weights after a quiet minute, not only on background.
const WHISPER_IDLE_RELEASE_MS = 60_000;
let whisperIdleTimer: ReturnType<typeof setTimeout> | null = null;
const scheduleWhisperIdleRelease = () => {
    if (whisperIdleTimer) clearTimeout(whisperIdleTimer);
    whisperIdleTimer = setTimeout(() => {
        whisperIdleTimer = null;
        void releaseLocalWhisperContext();
    }, WHISPER_IDLE_RELEASE_MS);
};

/** Frees the native context and its weights (0.5-3 GB of RAM). Safe to call at any time. */
export const releaseLocalWhisperContext = async (): Promise<void> => withContextLock(async () => {
    if (activeJob) return;

    const previous = activeContext;
    activeContext = null;
    activeModelUri = null;
    if (previous?.release) {
        await Promise.resolve(previous.release()).catch(() => undefined);
    }
});

// Whisper weights stay resident until released, which is what gets the app killed
// in the background on Android.
AppState.addEventListener('change', (state) => {
    if (state === 'background') {
        void releaseLocalWhisperContext();
    }
});

export const getAvailableLocalWhisperModels = (): LocalWhisperModelDescriptor[] => {
    return Object.values(MODELS);
};

export const getSelectedLocalWhisperModel = async (): Promise<LocalWhisperModelDescriptor> => {
    return getDescriptor(await getLocalWhisperModelKey());
};

export const setSelectedLocalWhisperModel = async (key: LocalWhisperModelKey): Promise<void> => {
    await setLocalWhisperModelKey(key);
};

/** Whether the device can still fit this model on disk. */
export const canFitLocalWhisperModel = async (key: LocalWhisperModelKey): Promise<boolean> => {
    return hasRoomForModel(getDescriptor(key).sizeBytes);
};

/** Whether this device has the RAM to load the model at all. */
export const isLocalWhisperModelSupportedByDevice = async (key: LocalWhisperModelKey): Promise<boolean> => {
    return canDeviceRunModel(getDescriptor(key).sizeBytes);
};

export const getLocalWhisperModelStatus = async (key?: string): Promise<LocalWhisperModelStatus> => {
    const { model, fileUri } = await getFileUriForModel(key);
    const info = await FileSystem.getInfoAsync(fileUri);
    const bytesOnDisk = info.exists ? info.size ?? 0 : 0;

    return {
        selectedModel: model,
        // A short file is a leftover from an interrupted or rejected download, not a usable model.
        isDownloaded: bytesOnDisk >= Math.round(model.sizeBytes * 0.9),
        fileUri,
        bytesOnDisk,
    };
};

export const downloadLocalWhisperModel = async (
    key: LocalWhisperModelKey,
    onProgress?: ModelDownloadProgress,
): Promise<LocalWhisperModelStatus> => {
    if (Platform.OS === 'web') {
        throw new Error('Local Whisper is not supported in the browser');
    }
    downloadInProgress = true;
    cancelRequested = false;
    try {
        return await downloadLocalWhisperModelInner(key, onProgress);
    } finally {
        downloadInProgress = false;
        cancelRequested = false;
    }
};

const downloadLocalWhisperModelInner = async (
    key: LocalWhisperModelKey,
    onProgress?: ModelDownloadProgress,
): Promise<LocalWhisperModelStatus> => {
    const descriptor = getDescriptor(key);
    if (!(await canDeviceRunModel(descriptor.sizeBytes))) {
        throw new Error(
            `${descriptor.label} needs more memory than this device has (${await describeDeviceMemory()} of RAM). Choose a smaller model.`
        );
    }
    if (!(await hasRoomForModel(descriptor.sizeBytes))) {
        throw new Error(`Not enough free space for ${descriptor.label} (${formatBytes(descriptor.sizeBytes)}).`);
    }

    // The model in use stays selected until the new one is fully on the phone,
    // so transcription keeps working (and a killed download changes nothing).
    const { model, fileUri } = await getFileUriForModel(key);

    try {
        await downloadModelFile(
            { url: model.url, sizeBytes: model.sizeBytes, magic: GGML_MAGIC },
            fileUri,
            onProgress,
            (task) => {
                // Cancelled while the checks ran: stop before the transfer starts.
                if (cancelRequested) throw new Error(DOWNLOAD_CANCELLED);
                activeDownloadResumable = task;
            },
        );
    } finally {
        activeDownloadResumable = null;
    }

    // The replaced file may be the one currently loaded natively.
    if (activeModelUri === fileUri) {
        await releaseLocalWhisperContext();
    }

    await setSelectedLocalWhisperModel(key);
    return getLocalWhisperModelStatus(key);
};

export const cancelLocalWhisperDownload = async (): Promise<void> => {
    if (downloadInProgress) {
        cancelRequested = true;
    }
    if (activeDownloadResumable) {
        try {
            await activeDownloadResumable.cancelAsync();
        } catch (e) {
            console.warn('Failed to cancel whisper download', e);
        } finally {
            activeDownloadResumable = null;
        }
    }
};

export const deleteLocalWhisperModel = async (key?: string): Promise<void> => {
    const { fileUri } = await getFileUriForModel(key);

    if (activeModelUri === fileUri) {
        await releaseLocalWhisperContext();
    }

    await FileSystem.deleteAsync(fileUri, { idempotent: true });
};

export const transcribeWithLocalWhisper = async (
    audioUri: string,
    options?: { language?: string }
): Promise<string> => {
    if (Platform.OS === 'web') {
        throw new Error('Local Whisper is not supported in the browser');
    }

    const status = await getLocalWhisperModelStatus();
    if (!status.isDownloaded) {
        throw new Error(`Local Whisper model "${status.selectedModel.label}" is not downloaded`);
    }

    await makeRoomForWhisper(status.fileUri);
    beginJob('transcribe');
    try {
        const context = await getReadyContext(status.fileUri);
        const response = context.transcribe(audioUri, {
            language: options?.language,
            translate: false,
        });

        const result: WhisperTranscriptPayload = hasAsyncTranscript(response)
            ? (await response.promise) ?? {}
            : await response;

        const text = result?.result || result?.text || '';
        return stripWhisperHallucinations(text);
    } finally {
        endJob('transcribe');
    }
};

/**
 * whisper.cpp reads 16 kHz mono WAV only, while notes are recorded as AAC/m4a,
 * so everything but WAV goes through the native transcoder first.
 */
export const prepareAudioForLocalWhisper = async (audioUri: string): Promise<string> => {
    const normalizedUri = audioUri.toLowerCase();
    const isWavInput =
        normalizedUri.endsWith('.wav') ||
        normalizedUri.endsWith('.wave') ||
        normalizedUri.startsWith('data:audio/wav;base64,');

    if (isWavInput) {
        return audioUri;
    }

    if (Platform.OS === 'web') {
        throw new Error('Local Whisper is not supported in the browser');
    }

    const transcodeModule = resolveAudioTranscodeModule();
    if (!transcodeModule) {
        throw new Error('Audio conversion module is not installed in this build');
    }

    return await transcodeModule.convertToWav(audioUri);
};

/**
 * Streams microphone audio through Whisper. `onTranscript` receives the full
 * transcript of the session so far (whisper.rn re-emits the accumulated text on
 * every update), so callers must replace their buffer rather than append to it.
 */
export const startRealtimeDictation = async (
    options: {
        language?: string;
        onTranscript?: (text: string) => void;
        /** Fired when recognition stops on its own: max duration reached, or a native error. */
        onEnd?: (error?: string) => void;
    }
): Promise<RealtimeDictationHandle> => {
    if (Platform.OS === 'web') {
        throw new Error('Local Whisper is not supported in the browser');
    }

    const status = await getLocalWhisperModelStatus();
    if (!status.isDownloaded) {
        throw new Error(`Local Whisper model "${status.selectedModel.label}" is not downloaded`);
    }

    await makeRoomForWhisper(status.fileUri);
    beginJob('dictation');

    let finished = false;
    const finish = (error?: string) => {
        if (finished) return;
        finished = true;
        endJob('dictation');
        options.onEnd?.(error);
    };

    try {
        const context = await getReadyContext(status.fileUri);
        const realtimeJob = await context.transcribeRealtime({
            language: options.language,
            realtimeAudioSec: REALTIME_MAX_SEC,
            realtimeAudioSliceSec: REALTIME_SLICE_SEC,
            realtimeAudioMinSec: 1,
            useVad: true,
            vadMs: 2000,
            audioSessionOnStartIos: {
                category: 'PlayAndRecord',
                options: ['MixWithOthers', 'DefaultToSpeaker'],
                mode: 'Default',
                active: true,
            },
            audioSessionOnStopIos: 'restore',
        });

        realtimeJob.subscribe((event) => {
            if (event.code !== 0 && event.code !== undefined && event.error) {
                finish(event.error);
                return;
            }

            const text = event.data?.result ?? event.data?.text;
            if (typeof text === 'string') {
                options.onTranscript?.(stripWhisperHallucinations(text));
            }

            if (event.isCapturing === false) {
                finish();
            }
        });

        return {
            stop: async () => {
                try {
                    await realtimeJob.stop();
                } finally {
                    finish();
                }
            },
        };
    } catch (error) {
        finish();
        throw error;
    }
};
