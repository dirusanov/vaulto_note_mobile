import {
    cancelLocalWhisperDownload,
    deleteLocalWhisperModel,
    downloadLocalWhisperModel,
    getAvailableLocalWhisperModels,
    getLocalWhisperModelStatus,
    isLocalWhisperModelSupportedByDevice,
    LocalWhisperModelKey,
    setSelectedLocalWhisperModel,
} from './LocalWhisperService';
import {
    cancelLocalLLMDownload,
    deleteLocalLLMModel,
    downloadLocalLLMModel,
    getAvailableLocalLLMModels,
    getLocalLLMModelStatus,
    getRecommendedLocalLLMModelKey,
    isLocalLLMModelSupportedByDevice,
    isLocalLLMRuntimeAvailable,
    LocalLLMModelKey,
    setSelectedLocalLLMModel,
} from './LocalLLMService';
import { hasRoomForModel } from './modelDownload';
import { getDeviceCapabilities } from './DeviceCapabilities';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAIProvider, getOnDeviceTranscription, setAIProvider } from '../utils/storage';

/**
 * "Offline mode" is one switch: the best speech model and the best on-device AI
 * model this phone can run, downloaded together. Nobody picks models by hand.
 */

// Best first. Whisper Large is left out: Turbo is as accurate at a fifth of the size.
const WHISPER_PREFERENCE: LocalWhisperModelKey[] = ['turbo', 'base', 'tiny'];
const LLM_PREFERENCE: LocalLLMModelKey[] = ['qwen3.5-4b', 'qwen3.5-2b', 'qwen3.5-0.8b'];

export type OfflinePlan = {
    whisperKey: LocalWhisperModelKey;
    llmKey: LocalLLMModelKey | null;
    /** Bytes still to download (models already on the phone count as 0). */
    downloadBytes: number;
};

export type OfflineStatus = {
    speechReady: boolean;
    aiReady: boolean;
    /** This build can run on-device AI at all. */
    aiSupported: boolean;
    /** Bytes the downloaded offline models take on the phone. */
    bytesOnPhone: number;
};

const whisperSize = (key: string) => getAvailableLocalWhisperModels().find((m) => m.key === key)?.sizeBytes ?? 0;
const llmSize = (key: string) => getAvailableLocalLLMModels().find((m) => m.key === key)?.sizeBytes ?? 0;

export const getOfflineStatus = async (): Promise<OfflineStatus> => {
    const aiSupported = isLocalLLMRuntimeAvailable();
    const [speech, ai] = await Promise.all([
        getLocalWhisperModelStatus().catch(() => null),
        aiSupported ? getLocalLLMModelStatus().catch(() => null) : Promise.resolve(null),
    ]);
    let bytesOnPhone = 0;
    for (const m of getAvailableLocalWhisperModels()) {
        if ((await getLocalWhisperModelStatus(m.key).catch(() => null))?.isDownloaded) bytesOnPhone += m.sizeBytes;
    }
    if (aiSupported) {
        for (const m of getAvailableLocalLLMModels()) {
            if ((await getLocalLLMModelStatus(m.key).catch(() => null))?.isDownloaded) bytesOnPhone += m.sizeBytes;
        }
    }
    return {
        speechReady: !!speech?.isDownloaded,
        aiReady: !!ai?.isDownloaded,
        aiSupported,
        bytesOnPhone,
    };
};

/**
 * The strongest pair of models that runs on this phone and fits its free space.
 * Speech wins over AI when space is short: it is the core of a voice-notes app.
 */
export const planOfflineModels = async (): Promise<OfflinePlan | null> => {
    // Speech already on the phone stays as it is: completing offline mode only
    // adds the AI model, it never swaps (and deletes) the speech model in use.
    const current = await getLocalWhisperModelStatus().catch(() => null);
    const whisperOptions: LocalWhisperModelKey[] = [];
    if (current?.isDownloaded) {
        whisperOptions.push(current.selectedModel.key as LocalWhisperModelKey);
    } else {
        const recommended = await getRecommendedWhisperKey();
        for (const key of WHISPER_PREFERENCE.slice(WHISPER_PREFERENCE.indexOf(recommended))) {
            if (await isLocalWhisperModelSupportedByDevice(key).catch(() => false)) whisperOptions.push(key);
        }
    }
    const llmOptions: (LocalLLMModelKey | null)[] = [];
    if (isLocalLLMRuntimeAvailable()) {
        const recommended = await getRecommendedLocalLLMModelKey().catch(() => null);
        const start = recommended ? Math.max(LLM_PREFERENCE.indexOf(recommended), 0) : 0;
        for (const key of LLM_PREFERENCE.slice(start)) {
            if (await isLocalLLMModelSupportedByDevice(key).catch(() => false)) llmOptions.push(key);
        }
    }
    llmOptions.push(null);

    const missing = async (kind: 'speech' | 'ai', key: string) => {
        const status = kind === 'speech'
            ? await getLocalWhisperModelStatus(key).catch(() => null)
            : await getLocalLLMModelStatus(key).catch(() => null);
        if (status?.isDownloaded) return 0;
        return kind === 'speech' ? whisperSize(key) : llmSize(key);
    };

    for (const whisperKey of whisperOptions) {
        for (const llmKey of llmOptions) {
            const downloadBytes = (await missing('speech', whisperKey)) + (llmKey ? await missing('ai', llmKey) : 0);
            if (downloadBytes === 0 || await hasRoomForModel(downloadBytes)) {
                return { whisperKey, llmKey, downloadBytes };
            }
        }
    }
    return null;
};

/**
 * Speech model that stays fast on this phone. Turbo transcribes a minute of audio
 * in seconds on 4 GB+ phones; below that it gets slow, so lighter ones are advised.
 */
export const getRecommendedWhisperKey = async (): Promise<LocalWhisperModelKey> => {
    const { totalMemoryBytes } = await getDeviceCapabilities();
    if (!totalMemoryBytes || totalMemoryBytes >= 3.6e9) return 'turbo';
    if (totalMemoryBytes >= 2.4e9) return 'base';
    return 'tiny';
};

export type ModelTier = 'fast' | 'balanced' | 'best';

export type ModelChoice = {
    key: string;
    tier: ModelTier;
    /** Technical name, shown small: "Whisper Turbo", "Qwen3.5 2B". */
    name: string;
    sizeBytes: number;
    /** The phone has the memory to load it at all (a bigger one gets the app killed). */
    supported: boolean;
    /** Best fit for this phone. */
    recommended: boolean;
    /** Loads, but heavier than this phone handles well: slower answers. */
    heavy: boolean;
    /** In use now. */
    current: boolean;
};

const TIERS: ModelTier[] = ['fast', 'balanced', 'best'];

/** Every model the user may pick, lightest first, with how it suits this phone. */
export const getModelChoices = async (): Promise<{ speech: ModelChoice[]; ai: ModelChoice[] }> => {
    const speechKeys = [...WHISPER_PREFERENCE].reverse();
    const recommendedSpeech = await getRecommendedWhisperKey();
    const currentSpeech = await getLocalWhisperModelStatus().catch(() => null);
    const speech: ModelChoice[] = [];
    for (const [index, key] of speechKeys.entries()) {
        const descriptor = getAvailableLocalWhisperModels().find((m) => m.key === key);
        if (!descriptor) continue;
        speech.push({
            key,
            tier: TIERS[index],
            name: `Whisper ${descriptor.label}`,
            sizeBytes: descriptor.sizeBytes,
            supported: await isLocalWhisperModelSupportedByDevice(key).catch(() => false),
            recommended: key === recommendedSpeech,
            heavy: speechKeys.indexOf(key) > speechKeys.indexOf(recommendedSpeech),
            current: !!currentSpeech?.isDownloaded && currentSpeech.selectedModel.key === key,
        });
    }

    const ai: ModelChoice[] = [];
    if (isLocalLLMRuntimeAvailable()) {
        const aiKeys = [...LLM_PREFERENCE].reverse();
        const recommendedAI = await getRecommendedLocalLLMModelKey().catch(() => 'qwen3.5-2b' as LocalLLMModelKey);
        const currentAI = await getLocalLLMModelStatus().catch(() => null);
        for (const [index, key] of aiKeys.entries()) {
            const descriptor = getAvailableLocalLLMModels().find((m) => m.key === key);
            if (!descriptor) continue;
            ai.push({
                key,
                tier: TIERS[index],
                name: descriptor.label,
                sizeBytes: descriptor.sizeBytes,
                supported: await isLocalLLMModelSupportedByDevice(key).catch(() => false),
                recommended: key === recommendedAI,
                heavy: aiKeys.indexOf(key) > aiKeys.indexOf(recommendedAI),
                current: !!currentAI?.isDownloaded && currentAI.selectedModel.key === key,
            });
        }
    }
    return { speech, ai };
};

/** A plan for exactly these models (the user's pick); null when they do not fit. */
export const planModelSwitch = async (
    whisperKey: LocalWhisperModelKey,
    llmKey: LocalLLMModelKey | null,
): Promise<OfflinePlan | null> => {
    const speechStatus = await getLocalWhisperModelStatus(whisperKey).catch(() => null);
    const aiStatus = llmKey ? await getLocalLLMModelStatus(llmKey).catch(() => null) : null;
    const downloadBytes = (speechStatus?.isDownloaded ? 0 : whisperSize(whisperKey))
        + (llmKey && !aiStatus?.isDownloaded ? llmSize(llmKey) : 0);
    if (downloadBytes > 0 && !(await hasRoomForModel(downloadBytes))) return null;
    return { whisperKey, llmKey, downloadBytes };
};

/** Whole-plan progress: bytes across both models. */
export type OfflineProgress = (loadedBytes: number, totalBytes: number) => void;

let cancelled = false;
// One offline download at a time, app-wide (Settings may be left and reopened).
let running: Promise<void> | null = null;
let progressListener: OfflineProgress | undefined;
let lastProgress: { loaded: number; total: number } | null = null;

export const getOfflineDownloadProgress = () => (running ? lastProgress ?? { loaded: 0, total: 0 } : null);

/** Follows a running download (e.g. after Settings was reopened); returns its promise. */
export const attachOfflineDownload = (onProgress?: OfflineProgress): Promise<void> | null => {
    progressListener = onProgress;
    return running;
};

/**
 * Downloads the plan (speech first: it is useful on its own) and then removes
 * other offline models, so the phone keeps exactly one of each.
 */
export const downloadOfflineModels = (plan: OfflinePlan, onProgress?: OfflineProgress): Promise<void> => {
    progressListener = onProgress;
    if (running) return running;
    lastProgress = { loaded: 0, total: plan.downloadBytes };
    // Remembered until it ends: if the app is closed meanwhile, the next launch
    // picks the same transfer up (on Android it keeps running in the system).
    void AsyncStorage.setItem(PLAN_KEY, JSON.stringify(plan)).catch(() => undefined);
    running = runDownload(plan, (loaded, total) => {
        const clamped = Math.min(loaded, total);
        lastProgress = { loaded: clamped, total };
        progressListener?.(clamped, total);
    }).finally(() => {
        running = null;
        lastProgress = null;
        void AsyncStorage.removeItem(PLAN_KEY).catch(() => undefined);
    });
    return running;
};

const PLAN_KEY = 'vaulto_offline_download_plan_v1';

/** Called at app start: continues an offline download the app was closed during. */
export const resumeOfflineDownload = async (): Promise<void> => {
    if (running) return;
    let plan: OfflinePlan | null = null;
    try {
        plan = JSON.parse((await AsyncStorage.getItem(PLAN_KEY)) || 'null');
    } catch {
        plan = null;
    }
    if (!plan?.whisperKey) return;
    console.log('[OfflineMode] Resuming the offline download');
    await downloadOfflineModels(plan).catch((error) => {
        console.warn('[OfflineMode] Resumed download stopped', error instanceof Error ? error.message : 'unknown');
    });
};

const runDownload = async (plan: OfflinePlan, onProgress?: OfflineProgress): Promise<void> => {
    cancelled = false;
    const speechMissing = !(await getLocalWhisperModelStatus(plan.whisperKey).catch(() => null))?.isDownloaded;
    const aiMissing = !!plan.llmKey && !(await getLocalLLMModelStatus(plan.llmKey).catch(() => null))?.isDownloaded;
    const speechBytes = speechMissing ? whisperSize(plan.whisperKey) : 0;
    const total = speechBytes + (aiMissing && plan.llmKey ? llmSize(plan.llmKey) : 0);

    if (cancelled) throw new Error('Download cancelled');
    if (speechMissing) {
        await downloadLocalWhisperModel(plan.whisperKey, (_p, loaded) => onProgress?.(loaded, total));
    } else {
        await setSelectedLocalWhisperModel(plan.whisperKey);
    }
    if (cancelled) throw new Error('Download cancelled');

    if (plan.llmKey) {
        if (aiMissing) {
            await downloadLocalLLMModel(plan.llmKey, (_p, loaded) => onProgress?.(speechBytes + loaded, total));
        } else {
            await setSelectedLocalLLMModel(plan.llmKey);
        }
    }

    // "Only on this phone" was on with speech only: AI joins it now (also when
    // the download finished after the app was reopened, with Settings closed).
    if (plan.llmKey && (await getOnDeviceTranscription().catch(() => false))) {
        const provider = await getAIProvider().catch(() => null);
        if (provider !== 'local' && provider !== 'local_whisper') await setAIProvider('local').catch(() => undefined);
    }

    // Keep one model of each kind.
    for (const m of getAvailableLocalWhisperModels()) {
        if (m.key !== plan.whisperKey && (await getLocalWhisperModelStatus(m.key).catch(() => null))?.isDownloaded) {
            await deleteLocalWhisperModel(m.key).catch(() => undefined);
        }
    }
    if (plan.llmKey) {
        for (const m of getAvailableLocalLLMModels()) {
            if (m.key !== plan.llmKey && (await getLocalLLMModelStatus(m.key).catch(() => null))?.isDownloaded) {
                await deleteLocalLLMModel(m.key).catch(() => undefined);
            }
        }
    }
};

export const cancelOfflineDownload = async (): Promise<void> => {
    cancelled = true;
    await Promise.all([cancelLocalWhisperDownload(), cancelLocalLLMDownload()]);
};

/** Removes every offline model from the phone. */
export const removeOfflineModels = async (): Promise<void> => {
    for (const m of getAvailableLocalWhisperModels()) {
        if ((await getLocalWhisperModelStatus(m.key).catch(() => null))?.isDownloaded) {
            await deleteLocalWhisperModel(m.key);
        }
    }
    for (const m of getAvailableLocalLLMModels()) {
        if ((await getLocalLLMModelStatus(m.key).catch(() => null))?.isDownloaded) {
            await deleteLocalLLMModel(m.key);
        }
    }
};
