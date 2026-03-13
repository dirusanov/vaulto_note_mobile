import * as FileSystem from 'expo-file-system/legacy';
import { NativeModules, Platform } from 'react-native';
import { getLocalWhisperModelKey, setLocalWhisperModelKey } from '../utils/storage';

export type LocalWhisperModelKey = 'tiny' | 'base' | 'large';

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

type WhisperRnContext = {
    transcribe: (
        audioUri: string,
        options?: Record<string, unknown>
    ) => { promise?: Promise<WhisperTranscriptPayload> } | Promise<WhisperTranscriptPayload>;
    release?: () => Promise<void> | void;
};

type WhisperRnModule = {
    initWhisper: (options: Record<string, unknown>) => Promise<WhisperRnContext>;
};

type WhisperTranscriptPayload = {
    result?: string;
    text?: string;
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
        sizeBytes: 75 * 1024 * 1024,
        filename: 'ggml-tiny.bin',
        url: 'https://huggingface.com/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
        power: 1,
        recommended: true,
    },
    base: {
        key: 'base',
        label: 'Base',
        sizeLabel: '~142 MB',
        sizeBytes: 142 * 1024 * 1024,
        filename: 'ggml-base.bin',
        url: 'https://huggingface.com/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
        power: 2,
    },
    large: {
        key: 'large',
        label: 'Large',
        sizeLabel: '~2.9 GB',
        sizeBytes: 2900 * 1024 * 1024,
        filename: 'ggml-large-v3.bin',
        url: 'https://huggingface.com/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin',
        power: 4,
    },
};

type AudioTranscodeModuleShape = {
    convertToWav: (inputUri: string) => Promise<string>;
};

const baseDir = FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? null;
const MODELS_DIR = baseDir ? `${baseDir}whisper-models/` : null;

let activeContext: WhisperRnContext | null = null;
let activeModelUri: string | null = null;
let activeDownloadResumable: FileSystem.DownloadResumable | null = null;

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

const getReadyContext = async (modelUri: string): Promise<WhisperRnContext> => {
    if (activeContext && activeModelUri === modelUri) {
        return activeContext;
    }

    if (activeContext?.release) {
        await activeContext.release();
    }

    const whisperModule = resolveWhisperModule();
    if (!whisperModule) {
        throw new Error('Local Whisper engine is not installed in this build');
    }

    activeContext = await whisperModule.initWhisper({
        filePath: modelUri,
        modelPath: modelUri,
        useGpu: false,
        useCoreMLIos: true,
    });
    activeModelUri = modelUri;
    return activeContext;
};

export const getAvailableLocalWhisperModels = (): LocalWhisperModelDescriptor[] => {
    return Object.values(MODELS);
};

export const getSelectedLocalWhisperModel = async (): Promise<LocalWhisperModelDescriptor> => {
    return getDescriptor(await getLocalWhisperModelKey());
};

export const setSelectedLocalWhisperModel = async (key: LocalWhisperModelKey): Promise<void> => {
    await setLocalWhisperModelKey(key);
};

export const getLocalWhisperModelStatus = async (key?: string): Promise<LocalWhisperModelStatus> => {
    const { model, fileUri } = await getFileUriForModel(key);
    const info = await FileSystem.getInfoAsync(fileUri);

    return {
        selectedModel: model,
        isDownloaded: info.exists && (info.size ?? 0) > 0,
        fileUri,
        bytesOnDisk: info.exists ? (info.size ?? 0) : 0,
    };
};

export const downloadLocalWhisperModel = async (
    key: LocalWhisperModelKey,
    onProgress?: (progress: number, loaded: number, total: number) => void,
): Promise<LocalWhisperModelStatus> => {
    if (Platform.OS === 'web') {
        throw new Error('Local Whisper is not supported in the browser');
    }

    await setSelectedLocalWhisperModel(key);
    const { model, fileUri } = await getFileUriForModel(key);
    const tempUri = `${fileUri}.download`;

    await FileSystem.deleteAsync(tempUri, { idempotent: true });
    await FileSystem.deleteAsync(fileUri, { idempotent: true });

    let activeLocalWhisperDownload = FileSystem.createDownloadResumable(
        model.url,
        tempUri,
        {},
        ({ totalBytesExpectedToWrite, totalBytesWritten }) => {
            if (!onProgress || !totalBytesExpectedToWrite) return;
            onProgress(totalBytesWritten / totalBytesExpectedToWrite, totalBytesWritten, totalBytesExpectedToWrite);
        },
    );

    // Save it globally for cancellation
    activeDownloadResumable = activeLocalWhisperDownload;

    try {
        const result = await activeLocalWhisperDownload.downloadAsync();
        if (!result || !result?.uri) {
            throw new Error('Download cancelled');
        }

        await FileSystem.moveAsync({ from: tempUri, to: fileUri });
        return getLocalWhisperModelStatus(key);
    } finally {
        activeDownloadResumable = null;
    }
};

export const cancelLocalWhisperDownload = async (): Promise<void> => {
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
        await activeContext?.release?.();
        activeContext = null;
        activeModelUri = null;
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

    const context = await getReadyContext(status.fileUri);
    const response = context.transcribe(audioUri, {
        language: options?.language,
        translate: false,
    });

    const result: WhisperTranscriptPayload = hasAsyncTranscript(response)
        ? (await response.promise) ?? {}
        : await response;

    const text = result?.result || result?.text || '';
    return text.trim();
};

export const prepareAudioForLocalWhisper = async (audioUri: string): Promise<string> => {
    const normalizedUri = audioUri.toLowerCase();
    const isWavInput =
        normalizedUri.endsWith('.wav') ||
        normalizedUri.endsWith('.wave') ||
        normalizedUri.startsWith('data:audio/wav;base64,');

    if (isWavInput) {
        return audioUri;
    }

    if (Platform.OS !== 'android') {
        throw new Error('Local Whisper currently requires WAV input on this platform');
    }

    const transcodeModule = resolveAudioTranscodeModule();
    if (!transcodeModule) {
        throw new Error('Audio conversion module is not installed in this build');
    }

    return await transcodeModule.convertToWav(audioUri);
};
