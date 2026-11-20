/**
 * Where the next recording is processed, as the app will actually do it. Pure, so
 * the labels at the microphone and in Settings can be tested against the real
 * routing (TranscriptionService.transcribeAudio, the editor's offline skip and
 * voiceAgent.resolveVoiceAgentRoute). Change those and this together: the
 * parity tests in tests/micRoute.test.cjs fail when they drift apart.
 */

export type MicProvider = 'vaulto_ai' | 'openai' | 'local_whisper' | 'local_llm' | 'local';

export type MicRouteInputs = {
    provider: MicProvider;
    /** "Only on this device" (on-device transcription preference). */
    privateMode: boolean;
    /** A protected note: its audio and text never leave the phone. */
    protectedNote: boolean;
    /** isDeviceOffline(): definitely no internet. */
    offline: boolean;
    /** On-device speech exists in this build (LOCAL_WHISPER_ENABLED, not web). */
    speechSupported: boolean;
    /** The speech model file is on the phone. */
    speechDownloaded: boolean;
    /** Local models are switched on (Settings → Work without internet). */
    localModelsEnabled: boolean;
    /** The recorder's "To text" choice. */
    transcribe: boolean;
};

/**
 * - audio_only: "To text" is off; saved as audio, text can be made later.
 * - device_private: "Only on this device" or a protected note, model ready.
 * - device_model_missing: phone-only, but no speech model: audio is saved and
 *   text waits for the download (never uploaded instead).
 * - device_offline: no internet, the downloaded model makes the text.
 * - device: an on-device provider is chosen.
 * - cloud: Vaulto cloud (needs internet). `cloudFallback` says whether the phone
 *   takes over when the connection drops or cloud minutes run out.
 * - later: no internet and no model: audio is saved, text when online.
 * - custom: the user's own OpenAI-compatible service.
 */
export type TranscriptionRoute =
    | 'audio_only'
    | 'device_private'
    | 'device_model_missing'
    | 'device_offline'
    | 'device'
    | 'cloud'
    | 'later'
    | 'custom';

const LOCAL_PROVIDERS: ReadonlySet<MicProvider> = new Set<MicProvider>(['local', 'local_llm', 'local_whisper']);

/** isLocalSpeechReady() in TranscriptionService. */
export const isLocalSpeechReady = (i: MicRouteInputs): boolean =>
    i.speechSupported && i.localModelsEnabled && i.speechDownloaded;

export const pickTranscriptionRoute = (i: MicRouteInputs): TranscriptionRoute => {
    if (!i.transcribe) return 'audio_only';
    const localReady = isLocalSpeechReady(i);
    // A privacy choice is a routing restriction: a missing model asks for a
    // download and never turns into an upload.
    if (i.protectedNote || i.privateMode) {
        return i.speechSupported && i.speechDownloaded ? 'device_private' : 'device_model_missing';
    }
    if (localReady && i.offline) return 'device_offline';
    // The editor does not wait for a request that can only time out: offline
    // without a usable model, the recording is saved and queued.
    if (i.offline) return 'later';
    if (i.provider === 'vaulto_ai') return 'cloud';
    if (LOCAL_PROVIDERS.has(i.provider)) return 'device';
    return 'custom';
};

/** Cloud speech falls back to the phone (lost connection, minutes used up). */
export const cloudFallsBackToDevice = (i: MicRouteInputs): boolean => isLocalSpeechReady(i);

/** Whether the audio itself leaves the phone for this route. */
export const routeSendsAudio = (route: TranscriptionRoute): boolean => route === 'cloud' || route === 'custom';

export type VoiceAgentRouteValue = 'cloud' | 'device' | null;

export type VoiceAgentInputs = {
    provider: MicProvider;
    privateMode: boolean;
    protectedNote: boolean;
    signedIn: boolean;
    offline: boolean;
    /** The on-device language model is ready and good enough to tell requests from dictation. */
    deviceAgentReady: boolean;
};

/** Who decides whether a recording is a request: our server, the phone, or nobody (plain dictation). */
export const pickVoiceAgentRoute = (i: VoiceAgentInputs): VoiceAgentRouteValue => {
    if (i.protectedNote) return i.deviceAgentReady ? 'device' : null;
    if (i.provider === 'local' || i.provider === 'local_llm' || i.privateMode) return i.deviceAgentReady ? 'device' : null;
    // Voice-only privacy (no AI model) and Custom AI have no agent.
    if (i.provider === 'local_whisper' || i.provider === 'openai') return null;
    if (i.signedIn && !i.offline) return 'cloud';
    return i.deviceAgentReady ? 'device' : null;
};

// ─── Microphone mode ─────────────────────────────────────────────────────────

/** What the editor microphone does with speech: insert it, or let the agent act on requests. */
export type VoiceInputMode = 'dictate' | 'edit';

export const DEFAULT_VOICE_INPUT_MODE: VoiceInputMode = 'edit';

export const parseVoiceInputMode = (value: unknown): VoiceInputMode =>
    value === 'dictate' || value === 'edit' ? value : DEFAULT_VOICE_INPUT_MODE;

/**
 * The mode a recording is processed in. Without an agent every recording is
 * dictation whatever was chosen; a meeting is always transcribed as is.
 */
export const effectiveVoiceInputMode = (
    chosen: VoiceInputMode,
    agent: VoiceAgentRouteValue,
    options: { meeting?: boolean; holdToDictate?: boolean } = {},
): VoiceInputMode => {
    if (options.meeting || options.holdToDictate || agent === null) return 'dictate';
    return chosen;
};

// ─── Settings summary: "Does my recording leave the phone?" ──────────────────

export type ProcessingSummaryInputs = {
    provider: MicProvider;
    privateMode: boolean;
    speechSupported: boolean;
    speechDownloaded: boolean;
    localModelsEnabled: boolean;
    /** The on-device language model is downloaded, switched on and runnable. */
    aiDownloaded: boolean;
    /** It is good enough for voice requests (not the smallest model). */
    deviceAgentCapable: boolean;
    signedIn: boolean;
    syncEnabled: boolean;
    e2ee: boolean;
    /**
     * The account's notes are end-to-end encrypted on the server but this
     * phone's vault is locked: nothing new syncs until it is unlocked.
     */
    vaultLocked?: boolean;
};

/**
 * sync_locked: notes already on the server stay there, encrypted; new ones
 * wait on this phone until the vault is unlocked (UX review 2026-11-20, P2-14:
 * the card said "on this phone only" while Sync said "encrypted on the server").
 */
export type StorageSummary = 'device' | 'sync_e2ee' | 'sync' | 'sync_locked';
/** Settled behaviour, independent of whether the phone happens to be online now. */
export type SpeechSummary =
    | 'device_always'
    | 'device_model_missing'
    | 'device'
    | 'cloud_device_offline'
    | 'cloud'
    | 'custom';
export type AISummary =
    | 'device'
    | 'cloud_device_offline'
    | 'cloud'
    | 'device_needs_model'
    | 'sign_in'
    | 'custom'
    | 'none';
export type LeavesPhone = 'no' | 'sync_only' | 'for_text';

export type ProcessingSummary = {
    storage: StorageSummary;
    speech: SpeechSummary;
    ai: AISummary;
    /** The headline answer about the audio. AI actions send text, never audio. */
    audioLeaves: LeavesPhone;
};

export const summarizeProcessing = (i: ProcessingSummaryInputs): ProcessingSummary => {
    const storage: StorageSummary = !i.signedIn
        ? 'device'
        : i.e2ee && i.vaultLocked
            ? 'sync_locked'
            : !i.syncEnabled ? 'device' : i.e2ee ? 'sync_e2ee' : 'sync';
    const localSpeech = i.speechSupported && i.localModelsEnabled && i.speechDownloaded;

    let speech: SpeechSummary;
    if (i.privateMode) speech = i.speechSupported && i.speechDownloaded ? 'device_always' : 'device_model_missing';
    else if (i.provider === 'vaulto_ai') speech = localSpeech ? 'cloud_device_offline' : 'cloud';
    else if (LOCAL_PROVIDERS.has(i.provider)) speech = 'device';
    else speech = 'custom';

    // AIService follows getEffectiveAIProvider(): a phone-only choice or no
    // internet uses the downloaded model, otherwise the chosen provider.
    let ai: AISummary;
    if (i.provider === 'local' || i.provider === 'local_llm') ai = i.aiDownloaded ? 'device' : 'device_needs_model';
    else if (i.provider === 'local_whisper') ai = 'none';
    else if (i.privateMode && i.aiDownloaded) ai = 'device';
    else if (i.provider === 'openai') ai = 'custom';
    // Cloud AI needs an account; a guest's downloaded model is used offline or
    // with "Only on this device" on.
    else if (!i.signedIn) ai = 'sign_in';
    else ai = i.aiDownloaded ? 'cloud_device_offline' : 'cloud';

    const speechUploads = speech === 'cloud' || speech === 'cloud_device_offline' || speech === 'custom';
    // A locked vault uploads nothing: new recordings stay here until unlocked.
    const audioLeaves: LeavesPhone = speechUploads
        ? 'for_text'
        : storage === 'sync_e2ee' || storage === 'sync' ? 'sync_only' : 'no';
    return { storage, speech, ai, audioLeaves };
};
