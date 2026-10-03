import * as FileSystem from 'expo-file-system/legacy';
import { AppState, NativeModules, Platform, TurboModuleRegistry } from 'react-native';
import { getLocalLLMModelKey, setLocalLLMModelKey } from '../utils/storage';
import { canDeviceRunModel, describeDeviceMemory, getDeviceCapabilities, getInferenceThreadCount } from './DeviceCapabilities';
import { releaseLocalWhisperContext } from './LocalWhisperService';
import {
    createMutex,
    DOWNLOAD_CANCELLED,
    downloadModelFile,
    formatBytes,
    GGUF_MAGIC,
    hasRoomForModel,
    ModelDownloadProgress,
} from './modelDownload';

export type LocalLLMModelKey = 'qwen3.5-0.8b' | 'qwen3.5-2b' | 'qwen3.5-4b';

const DEFAULT_MODEL_KEY: LocalLLMModelKey = 'qwen3.5-2b';

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

// Qwen3.5 (2026): multilingual instruction models that handle Russian and the other
// app languages well at phone sizes. Q4_K_M keeps quality while fitting in RAM.
// Phi-2 / TinyLlama / Gemma 2 / Mistral 7B were dropped: English-centric or too big.
const MODELS: Record<LocalLLMModelKey, LocalLLMModelDescriptor> = {
    'qwen3.5-0.8b': {
        key: 'qwen3.5-0.8b',
        label: 'Qwen3.5 0.8B',
        sizeLabel: '~530 MB',
        sizeBytes: 532517120,
        filename: 'qwen3.5-0.8b-q4_k_m.gguf',
        url: 'https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_K_M.gguf',
        power: 1,
    },
    'qwen3.5-2b': {
        key: 'qwen3.5-2b',
        label: 'Qwen3.5 2B',
        sizeLabel: '~1.3 GB',
        sizeBytes: 1280835840,
        filename: 'qwen3.5-2b-q4_k_m.gguf',
        url: 'https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf',
        power: 2,
        recommended: true,
    },
    'qwen3.5-4b': {
        key: 'qwen3.5-4b',
        label: 'Qwen3.5 4B',
        sizeLabel: '~2.7 GB',
        sizeBytes: 2740937888,
        filename: 'qwen3.5-4b-q4_k_m.gguf',
        url: 'https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf',
        power: 4,
    },
};

const baseDir = FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? null;
const MODELS_DIR = baseDir ? `${baseDir}llm-models/` : null;
const STOP_WORDS = ['</s>', '<|end|>', '<|eot_id|>', '<|end_of_text|>', '<|im_end|>', '<|EOT|>', '<|END_OF_TURN_TOKEN|>', '<|end_of_turn|>', '<|endoftext|>'];

let activeDownloadResumable: FileSystem.DownloadResumable | null = null;
// A cancel that arrives before the transfer starts is remembered (see the Whisper service).
let downloadInProgress = false;
let cancelRequested = false;
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
        // Room for a note (or the chat's excerpts) plus a full rewrite of it.
        n_ctx: 4096,
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
// The weights take up to ~3 GB of RAM. Keep them only while AI is in use: an idle
// minute or two frees the memory for other apps, and reloading takes seconds.
const IDLE_RELEASE_MS = 90_000;
let idleReleaseTimer: ReturnType<typeof setTimeout> | null = null;
const scheduleIdleRelease = () => {
    if (idleReleaseTimer) clearTimeout(idleReleaseTimer);
    idleReleaseTimer = setTimeout(() => {
        idleReleaseTimer = null;
        void releaseLocalLLMContext();
    }, IDLE_RELEASE_MS);
};

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
    // A key stored by an older build (phi-2, tinyllama…) falls back to the default.
    return MODELS[(key as LocalLLMModelKey)] || MODELS[DEFAULT_MODEL_KEY];
};

/**
 * The model to use when the user has not picked one: 4B where memory allows (its
 * answers are close to the cloud models), 2B on mid-range phones, 0.8B below.
 */
export const getRecommendedLocalLLMModelKey = async (): Promise<LocalLLMModelKey> => {
    const { totalMemoryBytes } = await getDeviceCapabilities();
    if (!totalMemoryBytes) return DEFAULT_MODEL_KEY;
    // 4B needs ~3 GB resident: recommend it from 8 GB phones (they report ~7.3-7.7 GB).
    if (totalMemoryBytes >= 7e9) return 'qwen3.5-4b';
    if (totalMemoryBytes >= 3.2e9) return 'qwen3.5-2b';
    return 'qwen3.5-0.8b';
};

const resolveModelKey = async (key?: string): Promise<string> => {
    const stored = key || await getLocalLLMModelKey();
    return stored && MODELS[stored as LocalLLMModelKey] ? stored : getRecommendedLocalLLMModelKey();
};

const getFileUriForModel = async (key?: string) => {
    const resolvedKey = await resolveModelKey(key);
    const model = getDescriptor(resolvedKey);
    await ensureModelsDir();
    const fileUri = `${MODELS_DIR}${model.filename}`;

    return { model, fileUri };
};

export const getAvailableLocalLLMModels = (): LocalLLMModelDescriptor[] => {
    return Object.values(MODELS);
};

export const getSelectedLocalLLMModel = async (): Promise<LocalLLMModelDescriptor> => {
    return getDescriptor(await resolveModelKey());
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
    if (downloadInProgress) {
        // A second transfer into the same temp file would corrupt the first.
        throw new Error('A model is already downloading. Wait for it to finish.');
    }
    downloadInProgress = true;
    cancelRequested = false;
    try {
        return await downloadLocalLLMModelInner(key, onProgress);
    } finally {
        downloadInProgress = false;
        cancelRequested = false;
    }
};

const downloadLocalLLMModelInner = async (
    key: LocalLLMModelKey,
    onProgress?: ModelDownloadProgress,
): Promise<LocalLLMModelStatus> => {
    const model = getDescriptor(key);

    if (!(await canDeviceRunModel(model.sizeBytes))) {
        throw new Error(
            `${model.label} needs more memory than this device has (${await describeDeviceMemory()} of RAM). Choose a smaller model.`
        );
    }

    if (!(await hasRoomForModel(model.sizeBytes))) {
        throw new Error(`Not enough free space for ${model.label} (${formatBytes(model.sizeBytes)}).`);
    }

    // The model in use stays selected until the new one is fully on the phone.
    const { fileUri } = await getFileUriForModel(key);

    try {
        await downloadModelFile(
            { url: model.url, sizeBytes: model.sizeBytes, magic: GGUF_MAGIC },
            fileUri,
            onProgress,
            (task) => {
                if (cancelRequested) throw new Error(DOWNLOAD_CANCELLED);
                activeDownloadResumable = task;
            },
        );
    } finally {
        activeDownloadResumable = null;
    }

    // The replaced file may be the one currently loaded natively.
    if (activeModelUri === fileUri) {
        await releaseLocalLLMContext();
    }

    await setSelectedLocalLLMModel(key);
    return getLocalLLMModelStatus(key);
};

export const cancelLocalLLMDownload = async (): Promise<void> => {
    if (downloadInProgress) {
        cancelRequested = true;
    }
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

    if (idleReleaseTimer) {
        clearTimeout(idleReleaseTimer);
        idleReleaseTimer = null;
    }
    // Both models at once get the app killed on 6 GB phones: drop the speech
    // model first (outside our lock, so the two modules never wait on each other).
    if (!activeContext || activeModelUri !== status.fileUri) {
        await releaseLocalWhisperContext().catch(() => undefined);
    }
    return withContextLock(async () => {
        const context = await getReadyContext(status.fileUri);
        await context.clearCache?.(true).catch(() => undefined);

        // Small models translate and embellish unless told not to, so the rules
        // that larger cloud models follow implicitly are spelled out here.
        const systemInstruction = [
            'You are a careful writing assistant working on the user\'s private notes.',
            'Follow the instruction exactly and return only the requested output, without commentary.',
            'Write in the same language as the note; keep words in other languages as they are. Never translate unless asked.',
            'Never add facts, names, numbers, events or details that are not in the note.',
        ].join(' ');

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
    }).finally(scheduleIdleRelease);
};
