import * as FileSystem from 'expo-file-system/legacy';
import { AppState, NativeModules, Platform, TurboModuleRegistry } from 'react-native';
import { getLocalLLMModelKey, setLocalLLMModelKey } from '../utils/storage';
import { canDeviceRunModel, describeDeviceMemory, getInferenceThreadCount } from './DeviceCapabilities';
import {
    createMutex,
    downloadModelFile,
    formatBytes,
    GGUF_MAGIC,
    hasRoomForModel,
    ModelDownloadProgress,
} from './modelDownload';

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

type LlamaCompletionResult = {
    text?: string;
    content?: string;
};

type LlamaContext = {
    completion: (
        params: Record<string, unknown>,
        callback?: (data: unknown) => void
    ) => Promise<LlamaCompletionResult>;
    clearCache?: (clearData?: boolean) => Promise<void>;
    release: () => Promise<void>;
};

type LlamaModule = {
    initLlama: (
        params: Record<string, unknown>,
        onProgress?: (progress: number) => void
    ) => Promise<LlamaContext>;
};

const MODELS: Record<LocalLLMModelKey, LocalLLMModelDescriptor> = {
    'phi-2': {
        key: 'phi-2',
        label: 'Phi-2',
        sizeLabel: '~1.7 GB',
        sizeBytes: 1789239136,
        filename: 'phi-2.gguf',
        url: 'https://huggingface.co/TheBloke/phi-2-GGUF/resolve/main/phi-2.Q4_K_M.gguf',
        power: 2,
        recommended: true,
    },
    'tinyllama': {
        key: 'tinyllama',
        label: 'TinyLlama',
        sizeLabel: '~638 MB',
        sizeBytes: 668788096,
        filename: 'tinyllama.gguf',
        url: 'https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf',
        power: 1,
    },
    'gemma-2b': {
        key: 'gemma-2b',
        label: 'Gemma 2B',
        sizeLabel: '~1.6 GB',
        sizeBytes: 1708582752,
        filename: 'gemma-2b.gguf',
        // TheBloke never published a Gemma GGUF - that repository 404s for every user.
        url: 'https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf',
        power: 3,
    },
    'mistral-7b': {
        key: 'mistral-7b',
        label: 'Mistral 7B',
        sizeLabel: '~4.1 GB',
        sizeBytes: 4368439584,
        filename: 'mistral-7b.gguf',
        url: 'https://huggingface.co/TheBloke/Mistral-7B-Instruct-v0.2-GGUF/resolve/main/mistral-7b-instruct-v0.2.Q4_K_M.gguf',
        power: 4,
    },
};

/** Older builds stored every model under a `.bin` name; they are migrated on first use. */
const LEGACY_FILENAMES: Record<LocalLLMModelKey, string> = {
    'phi-2': 'phi-2.bin',
    'tinyllama': 'tinyllama.bin',
    'gemma-2b': 'gemma-2b.bin',
    'mistral-7b': 'mistral-7b.bin',
};

const baseDir = FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? null;
const MODELS_DIR = baseDir ? `${baseDir}llm-models/` : null;
const STOP_WORDS = ['</s>', '<|end|>', '<|eot_id|>', '<|end_of_text|>', '<|im_end|>', '<|EOT|>', '<|END_OF_TURN_TOKEN|>', '<|end_of_turn|>', '<|endoftext|>'];

let activeDownloadResumable: FileSystem.DownloadResumable | null = null;
let activeContext: LlamaContext | null = null;
let activeModelUri: string | null = null;
/** One completion at a time: a second one entering the same llama context aborts natively. */
const withContextLock = createMutex();

export const isLocalLLMRuntimeAvailable = (): boolean => {
    const nativeModules = NativeModules as Record<string, unknown>;
    return Boolean(
        TurboModuleRegistry.get('RNLlama') ||
        nativeModules.LlamaContext ||
        nativeModules.RNLlama ||
        nativeModules.Llama ||
        nativeModules.LocalLLM
    );
};

const resolveLlamaModule = (): LlamaModule | null => {
    try {
        const pkg = require('llama.rn');
        if (pkg?.initLlama) {
            return pkg as LlamaModule;
        }
    } catch {
        // Optional dependency. If unavailable, runtime support is not present in this build.
    }

    return null;
};

const getReadyContext = async (modelUri: string): Promise<LlamaContext> => {
    if (activeContext && activeModelUri === modelUri) {
        return activeContext;
    }

    // Clear the reference before releasing: if init below throws, the next caller
    // must not receive a context whose native memory is already gone.
    const previous = activeContext;
    activeContext = null;
    activeModelUri = null;
    if (previous) {
        await previous.release().catch(() => undefined);
    }

    const llamaModule = resolveLlamaModule();
    if (!llamaModule) {
        throw new Error('Local LLM runtime is not installed in this build');
    }

    const context = await llamaModule.initLlama({
        model: modelUri,
        use_mmap: true,
        use_mlock: false,
        n_ctx: 2048,
        n_batch: Platform.OS === 'ios' ? 512 : 256,
        n_threads: await getInferenceThreadCount(),
        n_parallel: 1,
        ctx_shift: true,
        n_gpu_layers: Platform.OS === 'ios' ? 99 : 0,
    });
    activeContext = context;
    activeModelUri = modelUri;
    return context;
};

/** Frees the weights (up to 4 GB of RAM). Safe to call at any time. */
export const releaseLocalLLMContext = async (): Promise<void> => withContextLock(async () => {
    const previous = activeContext;
    activeContext = null;
    activeModelUri = null;
    if (previous) {
        await previous.release().catch(() => undefined);
    }
});

// Holding gigabytes of weights in a backgrounded app is what gets it killed.
AppState.addEventListener('change', (state) => {
    if (state === 'background') {
        void releaseLocalLLMContext();
    }
});

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
    const fileUri = `${MODELS_DIR}${model.filename}`;

    // Rename weights downloaded by older builds instead of re-downloading gigabytes.
    const legacyUri = `${MODELS_DIR}${LEGACY_FILENAMES[model.key]}`;
    if (legacyUri !== fileUri) {
        const [current, legacy] = await Promise.all([
            FileSystem.getInfoAsync(fileUri),
            FileSystem.getInfoAsync(legacyUri),
        ]);
        if (!current.exists && legacy.exists) {
            await FileSystem.moveAsync({ from: legacyUri, to: fileUri }).catch(() => undefined);
        }
    }

    return { model, fileUri };
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

/** Whether this device has the RAM to load the model at all. */
export const isLocalLLMModelSupportedByDevice = async (key: LocalLLMModelKey): Promise<boolean> => {
    return canDeviceRunModel(getDescriptor(key).sizeBytes);
};

export const getLocalLLMModelStatus = async (key?: string): Promise<LocalLLMModelStatus> => {
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

export const downloadLocalLLMModel = async (
    key: LocalLLMModelKey,
    onProgress?: ModelDownloadProgress,
): Promise<LocalLLMModelStatus> => {
    if (Platform.OS === 'web') {
        throw new Error('Local LLM is not supported in the browser');
    }

    const model = getDescriptor(key);

    if (!(await canDeviceRunModel(model.sizeBytes))) {
        throw new Error(
            `${model.label} needs more memory than this device has (${await describeDeviceMemory()} of RAM). Choose a smaller model.`
        );
    }

    if (!(await hasRoomForModel(model.sizeBytes))) {
        throw new Error(`Not enough free space for ${model.label} (${formatBytes(model.sizeBytes)}).`);
    }

    await setSelectedLocalLLMModel(key);
    const { fileUri } = await getFileUriForModel(key);

    try {
        await downloadModelFile(
            { url: model.url, sizeBytes: model.sizeBytes, magic: GGUF_MAGIC },
            fileUri,
            onProgress,
            (task) => { activeDownloadResumable = task; },
        );
    } finally {
        activeDownloadResumable = null;
    }

    // The replaced file may be the one currently loaded natively.
    if (activeModelUri === fileUri) {
        await releaseLocalLLMContext();
    }

    return getLocalLLMModelStatus(key);
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

    if (activeModelUri === fileUri) {
        await releaseLocalLLMContext();
    }

    await FileSystem.deleteAsync(fileUri, { idempotent: true });
};

export const generateWithLocalLLM = async (
    prompt: string,
    options?: { maxTokens?: number; jsonSchema?: object }
): Promise<string> => {
    if (Platform.OS === 'web') {
        throw new Error('Local LLM is not supported in the browser');
    }

    const status = await getLocalLLMModelStatus();
    if (!status.isDownloaded) {
        throw new Error(`Local LLM model "${status.selectedModel.label}" is not downloaded`);
    }

    if (!isLocalLLMRuntimeAvailable()) {
        throw new Error('Local LLM runtime is not included in this build. Install a build with LLM support or switch to Custom AI/Vaulto AI for text improvements.');
    }

    return withContextLock(async () => {
        const context = await getReadyContext(status.fileUri);
        await context.clearCache?.(true).catch(() => undefined);

        const systemInstruction = 'You are a concise writing assistant. Follow the user instruction exactly and return only the requested output without commentary.';

        // Small local models do not reliably follow a "return JSON" instruction, so the
        // schema is enforced by constrained sampling instead of trusting the prompt.
        const responseFormat = options?.jsonSchema
            ? { type: 'json_schema' as const, json_schema: { strict: true, schema: options.jsonSchema } }
            : undefined;

        const sharedParams = {
            n_predict: options?.maxTokens ?? 384,
            temperature: 0.2,
            top_p: 0.9,
            top_k: 40,
            penalty_repeat: 1.1,
            stop: STOP_WORDS,
            ...(responseFormat ? { response_format: responseFormat } : {}),
        };

        let result: LlamaCompletionResult;
        try {
            result = await context.completion({
                messages: [
                    { role: 'system', content: systemInstruction },
                    { role: 'user', content: prompt },
                ],
                ...sharedParams,
                enable_thinking: false,
            });
        } catch (error) {
            // Weights without a chat template (Phi-2 among them) reject the messages form.
            result = await context.completion({
                prompt: `${systemInstruction}\n\n${prompt}`,
                ...sharedParams,
            });
        }

        const text = (result.content || result.text || '').trim();
        if (!text) {
            throw new Error('Local LLM returned empty response');
        }

        return text;
    });
};
