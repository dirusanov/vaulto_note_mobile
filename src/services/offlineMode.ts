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
    const whisperOptions: LocalWhisperModelKey[] = [];
    for (const key of WHISPER_PREFERENCE) {
        if (await isLocalWhisperModelSupportedByDevice(key).catch(() => false)) whisperOptions.push(key);
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

/** Whole-plan progress: bytes across both models. */
export type OfflineProgress = (loadedBytes: number, totalBytes: number) => void;

let cancelled = false;

/**
 * Downloads the plan (speech first: it is useful on its own) and then removes
 * other offline models, so the phone keeps exactly one of each.
 */
export const downloadOfflineModels = async (plan: OfflinePlan, onProgress?: OfflineProgress): Promise<void> => {
    cancelled = false;
    const speechMissing = !(await getLocalWhisperModelStatus(plan.whisperKey).catch(() => null))?.isDownloaded;
    const aiMissing = !!plan.llmKey && !(await getLocalLLMModelStatus(plan.llmKey).catch(() => null))?.isDownloaded;
    const speechBytes = speechMissing ? whisperSize(plan.whisperKey) : 0;
    const total = speechBytes + (aiMissing && plan.llmKey ? llmSize(plan.llmKey) : 0);

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
