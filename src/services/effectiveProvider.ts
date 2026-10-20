import { getAIProvider, getOnDeviceTranscription } from '../utils/storage';
import { isDeviceOffline } from '../utils/connectivity';
import { LOCAL_MODELS_ENABLED } from '../utils/featureFlags';
import { getLocalLLMModelStatus, isLocalLLMRuntimeAvailable } from './LocalLLMService';

type Provider = Awaited<ReturnType<typeof getAIProvider>>;

const LOCAL_PROVIDERS = new Set(['local', 'local_llm']);

/** Whether the on-device language model is downloaded and can run here. */
export const isLocalLLMReady = async (): Promise<boolean> => {
    if (!LOCAL_MODELS_ENABLED || !isLocalLLMRuntimeAvailable()) return false;
    try {
        return (await getLocalLLMModelStatus()).isDownloaded;
    } catch {
        return false;
    }
};

/**
 * The provider that will actually answer right now. A cloud choice falls back
 * to the on-device model when there is no internet and the model is on the
 * phone, so editing, the notes chat and tasks keep working offline.
 */
export const getEffectiveAIProvider = async (): Promise<Provider> => {
    const provider = await getAIProvider();
    if (provider && LOCAL_PROVIDERS.has(provider)) return provider;
    if (provider === 'local_whisper') return provider;
    // A phone-only choice stays local when AI becomes available again, including
    // after restored model files, even if the saved provider has not caught up.
    if (((await getOnDeviceTranscription()) || (await isDeviceOffline())) && (await isLocalLLMReady())) {
        return 'local' as Provider;
    }
    return provider;
};
