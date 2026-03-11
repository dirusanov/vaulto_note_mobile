import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { getLocalLLMModelKey, setLocalLLMModelKey } from '../utils/storage';

export type LocalLLMModelKey = 'phi-2' | 'tinyllama' | 'gemma-2b' | 'mistral-7b';

export interface LocalLLMModelDescriptor {
    key: LocalLLMModelKey;
    label: string;
    sizeLabel: string;
    sizeBytes: number;
    filename: string;
    url: string;
    power: number; // 1-4 scale
    recommended?: boolean;
}

export interface LocalLLMModelStatus {
    selectedModel: LocalLLMModelDescriptor;
    isDownloaded: boolean;
    fileUri: string;
    bytesOnDisk: number;
}

const MODELS: Record<LocalLLMModelKey, LocalLLMModelDescriptor> = {
    'phi-2': {
        key: 'phi-2',
        label: 'Phi-2',
        sizeLabel: '~1.5 GB',
        sizeBytes: 1500 * 1024 * 1024,
        filename: 'phi-2.bin',
        url: 'https://huggingface.co/TheBloke/phi-2-GGUF/resolve/main/phi-2.Q4_K_M.gguf',
        power: 2,
        recommended: true,
    },
    'tinyllama': {
        key: 'tinyllama',
        label: 'TinyLlama',
        sizeLabel: '~650 MB',
        sizeBytes: 650 * 1024 * 1024,
        filename: 'tinyllama.bin',
        url: 'https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf',
        power: 1,
    },
    'gemma-2b': {
        key: 'gemma-2b',
        label: 'Gemma 2B',
        sizeLabel: '~1.6 GB',
        sizeBytes: 1600 * 1024 * 1024,
        filename: 'gemma-2b.bin',
        url: 'https://huggingface.co/TheBloke/gemma-2b-it-GGUF/resolve/main/gemma-2b-it.Q4_K_M.gguf',
        power: 3,
    },
    'mistral-7b': {
        key: 'mistral-7b',
        label: 'Mistral 7B',
        sizeLabel: '~4.1 GB',
        sizeBytes: 4100 * 1024 * 1024,
        filename: 'mistral-7b.bin',
        url: 'https://huggingface.co/TheBloke/Mistral-7B-Instruct-v0.2-GGUF/resolve/main/mistral-7b-instruct-v0.2.Q4_K_M.gguf',
        power: 4,
    },
};

const baseDir = FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? null;
const MODELS_DIR = baseDir ? `${baseDir}llm-models/` : null;

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

const getDescriptor = (key: string): LocalLLMModelDescriptor => {
    return MODELS[(key as LocalLLMModelKey)] || MODELS['phi-2'];
};

const getFileUriForModel = async (key?: string) => {
    const resolvedKey = key || await getLocalLLMModelKey();
    const model = getDescriptor(resolvedKey);
    await ensureModelsDir();
    return {
        model,
        fileUri: `${MODELS_DIR}${model.filename}`,
    };
};

export const getAvailableLocalLLMModels = (): LocalLLMModelDescriptor[] => {
    return Object.values(MODELS);
};

export const getSelectedLocalLLMModel = async (): Promise<LocalLLMModelDescriptor> => {
    return getDescriptor(await getLocalLLMModelKey());
};

export const setSelectedLocalLLMModel = async (key: LocalLLMModelKey): Promise<void> => {
    await setLocalLLMModelKey(key);
};

export const getLocalLLMModelStatus = async (key?: string): Promise<LocalLLMModelStatus> => {
    const { model, fileUri } = await getFileUriForModel(key);
    const info = await FileSystem.getInfoAsync(fileUri);

    return {
        selectedModel: model,
        isDownloaded: info.exists && (info.size ?? 0) > 0,
        fileUri,
        bytesOnDisk: info.exists ? (info.size ?? 0) : 0,
    };
};

export const downloadLocalLLMModel = async (
    key: LocalLLMModelKey,
    onProgress?: (progress: number, loaded: number, total: number) => void,
): Promise<LocalLLMModelStatus> => {
    if (Platform.OS === 'web') {
        throw new Error('Local LLM is not supported in the browser');
    }

    await setSelectedLocalLLMModel(key);
    const { model, fileUri } = await getFileUriForModel(key);
    const tempUri = `${fileUri}.download`;

    await FileSystem.deleteAsync(tempUri, { idempotent: true });
    await FileSystem.deleteAsync(fileUri, { idempotent: true });

    let activeLocalLLMDownload = FileSystem.createDownloadResumable(
        model.url,
        tempUri,
        {},
        ({ totalBytesExpectedToWrite, totalBytesWritten }) => {
            if (!onProgress || !totalBytesExpectedToWrite) return;
            onProgress(totalBytesWritten / totalBytesExpectedToWrite, totalBytesWritten, totalBytesExpectedToWrite);
        },
    );

    // Save it globally for cancellation
    activeDownloadResumable = activeLocalLLMDownload;

    try {
        const result = await activeLocalLLMDownload.downloadAsync();
        if (!result || !result?.uri) {
            throw new Error('Download cancelled');
        }

        await FileSystem.moveAsync({ from: tempUri, to: fileUri });
        return getLocalLLMModelStatus(key);
    } finally {
        activeDownloadResumable = null;
    }
};

export const cancelLocalLLMDownload = async (): Promise<void> => {
    if (activeDownloadResumable) {
        try {
            await activeDownloadResumable.cancelAsync();
        } catch (e) {
            console.warn('Failed to cancel LLM download', e);
        } finally {
            activeDownloadResumable = null;
        }
    }
};

export const deleteLocalLLMModel = async (key?: string): Promise<void> => {
    const { fileUri } = await getFileUriForModel(key);
    await FileSystem.deleteAsync(fileUri, { idempotent: true });
};

export const generateWithLocalLLM = async (
    prompt: string,
    options?: { maxTokens?: number }
): Promise<string> => {
    if (Platform.OS === 'web') {
        throw new Error('Local LLM is not supported in the browser');
    }

    const status = await getLocalLLMModelStatus();
    if (!status.isDownloaded) {
        throw new Error(`Local LLM model "${status.selectedModel.label}" is not downloaded`);
    }

    // Placeholder: In a real implementation, we would call a native module like react-native-llama
    throw new Error('Local LLM execution is not yet implemented in this build. Please download the preview build with Llama support.');
};
