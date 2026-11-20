import { Platform } from 'react-native';
import { getAIProvider, getLocalModelsEnabled, getOnDeviceTranscription } from '../utils/storage';
import { isDeviceOffline } from '../utils/connectivity';
import { LOCAL_WHISPER_ENABLED } from '../utils/featureFlags';
import { getLocalWhisperModelStatus } from './LocalWhisperService';
import { getSelectedLocalLLMModel } from './LocalLLMService';
import { isLocalLLMReady } from './effectiveProvider';
import { modelUnderstandsRequests } from './voiceAgent';
import {
    cloudFallsBackToDevice,
    MicProvider,
    MicRouteInputs,
    pickTranscriptionRoute,
    pickVoiceAgentRoute,
    ProcessingSummary,
    summarizeProcessing,
    TranscriptionRoute,
    VoiceAgentRouteValue,
} from '../utils/micRoute';

export type MicRoute = {
    transcription: TranscriptionRoute;
    /** Cloud speech is backed by the phone's model (offline, minutes used up). */
    cloudFallback: boolean;
    /** Who acts on voice requests; null: every recording is dictation. */
    agent: VoiceAgentRouteValue;
};

const readLocalState = async () => {
    const [provider, privateMode, localModelsEnabled, speechDownloaded, aiReady] = await Promise.all([
        getAIProvider().catch(() => 'vaulto_ai' as MicProvider),
        getOnDeviceTranscription().catch(() => false),
        getLocalModelsEnabled().catch(() => false),
        getLocalWhisperModelStatus().then((s) => !!s.isDownloaded).catch(() => false),
        isLocalLLMReady().catch(() => false),
    ]);
    const deviceAgentReady = aiReady
        && modelUnderstandsRequests((await getSelectedLocalLLMModel().catch(() => null))?.key ?? '');
    return {
        provider: (provider || 'vaulto_ai') as MicProvider,
        privateMode,
        localModelsEnabled,
        speechDownloaded,
        speechSupported: LOCAL_WHISPER_ENABLED && Platform.OS !== 'web',
        aiReady,
        deviceAgentReady,
    };
};

/** Where the next recording goes, read the same way the recording flow reads it. */
export const readMicRoute = async (options: {
    protectedNote: boolean;
    signedIn: boolean;
    transcribe: boolean;
}): Promise<MicRoute> => {
    const local = await readLocalState();
    const offline = await isDeviceOffline();
    const inputs: MicRouteInputs = { ...local, protectedNote: options.protectedNote, offline, transcribe: options.transcribe };
    return {
        transcription: pickTranscriptionRoute(inputs),
        cloudFallback: cloudFallsBackToDevice(inputs),
        agent: pickVoiceAgentRoute({ ...local, protectedNote: options.protectedNote, signedIn: options.signedIn, offline }),
    };
};

/** Settings: "Does my recording leave the phone?" for the current configuration. */
export const readProcessingSummary = async (options: {
    signedIn: boolean;
    syncEnabled: boolean;
    e2ee: boolean;
}): Promise<ProcessingSummary> => {
    const local = await readLocalState();
    return summarizeProcessing({
        ...local,
        aiDownloaded: local.aiReady,
        deviceAgentCapable: local.deviceAgentReady,
        ...options,
    });
};
