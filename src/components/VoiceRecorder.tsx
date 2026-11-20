import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
    View,
    Platform,
    Text,
    TouchableOpacity,
    Modal,
    Animated,
    Easing,
    ScrollView,
    useWindowDimensions,
    type LayoutChangeEvent,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { AudioService, AudioRecording, MAX_RECORDING_DURATION_MS, MAX_MEETING_DURATION_MS, MEETING_SEGMENT_MS } from '../services/AudioService';
import {
    AIProvider,
    getAIProvider,
    getMicHintSeen,
    getTranscriptionEnabled,
    setMicHintSeen,
    setTranscriptionEnabled
} from '../utils/storage';
import { getLocalWhisperModelStatus } from '../services/LocalWhisperService';
import { MaterialIcons } from '@expo/vector-icons';
import { createStyles } from '../theme/createStyles';
import { haptics } from '../utils/haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { appAlert } from './AppAlert';
import { showMicPermissionDenied } from '../utils/micPermission';
import {
    DISCARD_CONFIRM_AFTER_SECONDS,
    DISCARD_CONFIRM_WINDOW_MS,
    recorderBackAction,
    shownRecordingSeconds,
} from '../utils/recordingClock';
import NetInfo from '@react-native-community/netinfo';
import { MicRoute, readMicRoute } from '../services/micRouteState';
import type { VoiceInputMode } from '../utils/micRoute';
import {
    MicRouteNote,
    micHintKind,
    modeLabel,
    OptionSwitchRow,
    outcomeText,
    routeLabel,
    routeShortLabel,
    VoiceModeSwitch,
} from './MicModeControls';

interface VoiceRecorderProps {
    visible: boolean;
    onFinish: (recording: AudioRecording, transcribe: boolean) => void;
    onCancel: () => void;
    autoStart?: boolean;
    micMode?: 'agent' | 'force_text';
    isMainScreen?: boolean;
    /**
     * 'instruction': a spoken AI instruction that only fills a text field, so the
     * Meeting and To text choices do not apply and are hidden.
     */
    purpose?: 'note' | 'instruction';
    /**
     * Shows where the recording is processed (phone, cloud, saved for later),
     * read the way the recording flow reads it.
     */
    routeContext?: { protectedNote: boolean; signedIn: boolean };
    /** The editor's "Dictate / Edit by voice" choice; switchable while recording. */
    voiceMode?: VoiceInputMode;
    onVoiceModeChange?: (mode: VoiceInputMode) => void;
    /** A voice agent exists for this note, so the choice means something. */
    voiceModeAvailable?: boolean;
}


const BAR_COUNT = 20;
/**
 * At most this many bars (each one is a JS-driven animation loop); on a wide
 * bar they grow a little and spread out to fill it instead of multiplying.
 */
const MAX_BAR_COUNT = 32;
const SILENCE_THRESHOLD_DB = -60;
const MIN_VOICE_SAMPLES = 3;
/** A silent recording at least this long is offered to keep rather than dropped. */
const QUIET_KEEP_MIN_SECONDS = 3;
const MAX_RECORDING_DURATION_SECONDS = Math.floor(MAX_RECORDING_DURATION_MS / 1000);
const MAX_MEETING_DURATION_SECONDS = Math.floor(MAX_MEETING_DURATION_MS / 1000);
const MEETING_SEGMENT_SECONDS = Math.floor(MEETING_SEGMENT_MS / 1000);
/** The timer reads the recorder's clock this often (it shows whole seconds). */
const TIMER_TICK_MS = 250;
const DISCARD_RING_SIZE = 40;
const DISCARD_RING_STROKE = 2.5;
const DISCARD_RING_RADIUS = (DISCARD_RING_SIZE - DISCARD_RING_STROKE) / 2;
const DISCARD_RING_LENGTH = 2 * Math.PI * DISCARD_RING_RADIUS;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
    visible,
    onFinish,
    onCancel,
    autoStart = false,
    micMode = 'agent',
    isMainScreen = false,
    purpose = 'note',
    routeContext,
    voiceMode,
    onVoiceModeChange,
    voiceModeAvailable = false,
}) => {
    const isInstruction = purpose === 'instruction';
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    const { height: windowHeight, fontScale } = useWindowDimensions();
    const bigText = fontScale >= 1.3;
    const [isRecording, setIsRecording] = useState(false);
    const [confirmDiscard, setConfirmDiscard] = useState(false);
    const confirmDiscardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const discardRing = useRef(new Animated.Value(0)).current;
    const [duration, setDuration] = useState(0);
    // Done freezes the timer at once; what it shows then is what is stored,
    // whatever the native recorder and the silence check take afterwards.
    const [frozenSeconds, setFrozenSeconds] = useState<number | null>(null);
    const [isPaused, setIsPaused] = useState(false);
    const [isStopping, setIsStopping] = useState(false);
    const [isStartPending, setIsStartPending] = useState(false);
    const [transcribe, setTranscribe] = useState(true);
    const [aiProvider, setAiProvider] = useState<AIProvider>('vaulto_ai');
    const [showModelMissingWarning, setShowModelMissingWarning] = useState(false);
    const warningOpacity = useRef(new Animated.Value(0)).current;
    const warningTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    // Meeting mode: up to an hour, transcribed as is (no agent), then summarised.
    const [meetingModeChosen, setMeetingMode] = useState(false);
    // A spoken instruction is never a meeting, whatever was chosen for notes.
    const meetingMode = meetingModeChosen && !isInstruction;
    const meetingSegmentsRef = useRef<string[]>([]);
    // Once a meeting has finished parts, it cannot be turned back into a note.
    const [meetingLocked, setMeetingLocked] = useState(false);
    const segmentStartRef = useRef(0);
    const rollingRef = useRef(false);
    const currentMetering = useRef(-160); // Default low dB
    const meteringSamples = useRef(0);
    const voiceSamples = useRef(0);
    const maxDurationHandledRef = useRef(false);
    const interruptionHandledRef = useRef(false);
    const recordingStartAtRef = useRef<number | null>(null);
    // The bin works while the microphone is still starting: the start that
    // lands afterwards is cancelled instead of recording into a closed panel.
    const startCancelledRef = useRef(false);
    const INTERRUPTION_GRACE_MS = 1800;

    // Waveform animations
    const animations = useRef([...Array(MAX_BAR_COUNT)].map(() => new Animated.Value(0.3))).current;
    // The waveform fills its bar (a tablet's wide bar showed a short stub of
    // 20 at its start): as many bars as fit, up to MAX_BAR_COUNT.
    const [barCount, setBarCount] = useState(BAR_COUNT);
    const handleWaveformLayout = (event: LayoutChangeEvent) => {
        const width = event.nativeEvent.layout.width;
        const gap = isMainScreen ? 5 : 3;
        const pitch = (isMainScreen ? 5 : 3) + gap;
        const next = Math.max(8, Math.min(MAX_BAR_COUNT, Math.floor((width + gap) / pitch)));
        setBarCount((prev) => (prev === next ? prev : next));
    };

    useEffect(() => {
        if (visible) {
            getAIProvider().then(async (provider) => {
                if (provider) setAiProvider(provider);
                // Check model status if local
                if (provider === 'local' || provider === 'local_whisper') {
                    const status = await getLocalWhisperModelStatus();
                    if (!status.isDownloaded) {
                        setTranscribe(false);
                        return;
                    }
                }
                getTranscriptionEnabled().then(enabled => {
                    setTranscribe(enabled);
                });
            });

            if (autoStart) {
                handleStartRecording();
            }
        } else {
            // Reset state when closed
            setIsRecording(false);
            setIsPaused(false);
            setIsStopping(false);
            setIsStartPending(false);
            setDuration(0);
            setFrozenSeconds(null);
            setConfirmDiscard(false);
            if (confirmDiscardTimerRef.current) {
                clearTimeout(confirmDiscardTimerRef.current);
            }
            discardRing.stopAnimation();
            setShowModelMissingWarning(false);
            warningOpacity.setValue(0);
            if (warningTimeoutRef.current) {
                clearTimeout(warningTimeoutRef.current);
            }
            currentMetering.current = -160;
            meteringSamples.current = 0;
            voiceSamples.current = 0;
            maxDurationHandledRef.current = false;
            interruptionHandledRef.current = false;
            recordingStartAtRef.current = null;
        }
    }, [visible, autoStart]);

    // Where this recording will be processed. Read again when "To text" or the
    // connection changes, so the line never promises a route that no longer applies.
    const [route, setRoute] = useState<MicRoute | null>(null);
    // Everything that is not the bar itself lives in one panel above it,
    // opened by "⋯" or a tap on the route line. The first recording of each
    // kind explains itself once.
    const [panelOpen, setPanelOpen] = useState(false);
    const [firstUseKinds, setFirstUseKinds] = useState<string[]>([]);
    const firstUseCheckedRef = useRef<Set<string>>(new Set());
    useEffect(() => {
        if (visible) return;
        setPanelOpen(false);
        setFirstUseKinds([]);
        firstUseCheckedRef.current = new Set();
    }, [visible]);
    const routeProtected = !!routeContext?.protectedNote;
    const routeSignedIn = !!routeContext?.signedIn;
    const hasRouteContext = !!routeContext;
    useEffect(() => {
        if (!visible || !hasRouteContext) {
            setRoute(null);
            return;
        }
        let active = true;
        const refresh = () => {
            readMicRoute({ protectedNote: routeProtected, signedIn: routeSignedIn, transcribe })
                .then((next) => { if (active) setRoute(next); })
                .catch(() => undefined);
        };
        refresh();
        const unsubscribe = NetInfo.addEventListener(() => refresh());
        return () => {
            active = false;
            unsubscribe();
        };
    }, [visible, hasRouteContext, routeProtected, routeSignedIn, transcribe]);

    const handleTranscriptionToggle = async (value: boolean) => {
        if (value && (aiProvider === 'local' || aiProvider === 'local_whisper')) {
            const status = await getLocalWhisperModelStatus();
            if (!status.isDownloaded) {
                setShowModelMissingWarning(true);

                // Reset any existing animation and timeout
                warningOpacity.setValue(0);
                if (warningTimeoutRef.current) {
                    clearTimeout(warningTimeoutRef.current);
                }

                Animated.timing(warningOpacity, {
                    toValue: 1,
                    duration: 300,
                    useNativeDriver: true,
                }).start();

                // Auto hide after 3.5 seconds
                warningTimeoutRef.current = setTimeout(() => {
                    Animated.timing(warningOpacity, {
                        toValue: 0,
                        duration: 300,
                        useNativeDriver: true,
                    }).start(() => {
                        setShowModelMissingWarning(false);
                    });
                }, 3500);

                setTranscribe(false);
                return;
            }
        }
        setTranscribe(value);
        setTranscriptionEnabled(value);
    };

    // The timer reads the recorder's own pause-aware clock instead of counting
    // ticks, so it cannot drift from the recording or keep running behind a
    // dialog. It stops the moment Done is tapped (frozenSeconds).
    useEffect(() => {
        if (!isRecording || isPaused || frozenSeconds !== null) return;
        const tick = () => {
            // A meeting segment switch briefly has no recorder.
            if (rollingRef.current) return;
            const seconds = shownRecordingSeconds(AudioService.getRecordedMs());
            setDuration((prev) => (seconds > prev ? seconds : prev));
        };
        tick();
        const interval = setInterval(tick, TIMER_TICK_MS);
        return () => clearInterval(interval);
    }, [isRecording, isPaused, frozenSeconds]);

    // Kept apart from the timer: a new bar count restarts only the bars.
    useEffect(() => {
        const bars = animations.slice(0, barCount);
        if (isRecording && !isPaused && frozenSeconds === null) {
            // Animate bars based on metering
            const animateBar = (anim: Animated.Value) => {
                // Normalize dB (-160 to 0) to (0 to 1)
                // Typically speech is around -30dB to -10dB
                // Noise floor might be -60dB
                let level = currentMetering.current;

                // Increased sensitivity settings
                const minDb = -55; // Raised floor slightly to ignore deep silence
                const maxDb = -5;  // Lowered ceiling so loud-ish sounds hit max easily

                let normalized = (level - minDb) / (maxDb - minDb);
                normalized = Math.max(0, Math.min(1, normalized));

                // Apply a curve to boost mid-range sounds (speech)
                // Power < 1 boosts smaller values
                const boosted = Math.pow(normalized, 0.8);

                // Add some randomness so bars don't look identical
                const jitter = Math.random() * 0.2 - 0.1;

                // Scale up significantly - allow going up to 1.6x height (64px) or 2.5x for main screen
                // Lower minimum to 0.1 for more contrast
                const maxHeight = isMainScreen ? 2.5 : 1.6;
                const multiplier = isMainScreen ? 3.5 : 2.2;
                const targetHeight = Math.max(0.1, Math.min(maxHeight, boosted * multiplier + 0.1 + jitter));

                Animated.sequence([
                    Animated.timing(anim, {
                        toValue: targetHeight,
                        duration: 80, // Slightly faster response
                        useNativeDriver: true,
                    }),
                ]).start(({ finished }) => {
                    if (finished) {
                        animateBar(anim);
                    }
                });
            };

            bars.forEach(anim => animateBar(anim));

            return () => {
                bars.forEach(anim => anim.stopAnimation());
            };
        } else {
            // Reset bars smoothly
            bars.forEach(anim => {
                anim.stopAnimation();
                Animated.timing(anim, {
                    toValue: 0.3,
                    duration: 200,
                    useNativeDriver: true,
                }).start();
            });
        }
    }, [isRecording, isPaused, barCount, frozenSeconds]);

    const promptRecordingInterruption = (message: string) => {
        if (interruptionHandledRef.current) {
            return;
        }
        // A meeting already has finished parts: save them instead of losing them.
        if (meetingSegmentsRef.current.length > 0) {
            interruptionHandledRef.current = true;
            void finishMeeting(null);
            return;
        }
        interruptionHandledRef.current = true;
        setIsRecording(false);
        setIsPaused(false);
        setIsStopping(false);
        setIsStartPending(false);
        recordingStartAtRef.current = null;
        currentMetering.current = -160;
        meteringSamples.current = 0;
        voiceSamples.current = 0;
        void AudioService.cancelRecording().catch(() => undefined);

        appAlert(
            t("voice.recordingInterrupted", "Recording interrupted"),
            message,
            [
                {
                    text: t("voice.retry"),
                    onPress: () => {
                        interruptionHandledRef.current = false;
                        void latestActionsRef.current.start();
                    },
                },
                {
                    text: t("common.close"),
                    style: 'cancel',
                    onPress: () => {
                        onCancel();
                    },
                },
            ],
            { cancelable: false }
        );
    };

    useEffect(() => {
        if (
            !visible ||
            !isRecording ||
            isPaused ||
            isStopping ||
            isStartPending ||
            interruptionHandledRef.current
        ) {
            return;
        }

        let disposed = false;
        const interval = setInterval(() => {
            // A meeting segment switch briefly has no recorder: not an interruption.
            if (rollingRef.current) return;
            void (async () => {
                try {
                    const status = await AudioService.getRecordingStatus();
                    if (disposed || isPaused || isStopping || isStartPending) {
                        return;
                    }

                    const startedAt = recordingStartAtRef.current;
                    if (startedAt && Date.now() - startedAt < INTERRUPTION_GRACE_MS) {
                        return;
                    }

                    const canRecord = typeof (status as any)?.canRecord === 'boolean'
                        ? (status as any).canRecord
                        : true;
                    const isDoneRecording = !!(status as any)?.isDoneRecording;

                    if (!status || isDoneRecording || !canRecord) {
                        promptRecordingInterruption(
                            t("voice.recordingInterruptedDesc", "The recording stopped unexpectedly before it could be sent. Please try again.")
                        );
                    }
                } catch (error) {
                    if (disposed) {
                        return;
                    }
                    console.warn('[VoiceRecorder] Failed to read recording status', error);
                    promptRecordingInterruption(t("voice.recordingStateLost", "The recording state was lost. Please try again."));
                }
            })();
        }, 1200);

        return () => {
            disposed = true;
            clearInterval(interval);
        };
    }, [visible, isRecording, isPaused, isStopping, isStartPending, onCancel]);

    useEffect(() => {
        if (
            !visible ||
            !isRecording ||
            isPaused ||
            isStopping ||
            duration < (meetingMode ? MAX_MEETING_DURATION_SECONDS : MAX_RECORDING_DURATION_SECONDS) ||
            maxDurationHandledRef.current
        ) {
            return;
        }

        maxDurationHandledRef.current = true;
        appAlert(
            t("voice.recordingLimitReached"),
            t("voice.recordingLimitReachedDesc")
        );
        void handleStopRecording();
    }, [visible, duration, isRecording, isPaused, isStopping, meetingMode]);

    // Meeting mode: start a new segment every few minutes so each part can be
    // transcribed on its own (server and on-device limits), then joined.
    useEffect(() => {
        if (!meetingMode || !visible || !isRecording || isPaused || isStopping || rollingRef.current) return;
        if (duration - segmentStartRef.current < MEETING_SEGMENT_SECONDS) return;
        rollingRef.current = true;
        void (async () => {
            try {
                const { uri: finished, restarted } = await AudioService.rollSegment();
                if (finished) {
                    meetingSegmentsRef.current.push(finished);
                    setMeetingLocked(true);
                }
                segmentStartRef.current = duration;
                if (!restarted) {
                    // The microphone could not continue: keep what was recorded.
                    rollingRef.current = false;
                    void finishMeeting(null);
                    return;
                }
            } catch (error) {
                console.warn('[VoiceRecorder] Could not start the next meeting segment', error);
            } finally {
                rollingRef.current = false;
            }
        })();
    }, [meetingMode, visible, isRecording, isPaused, isStopping, duration]);

    const formatDuration = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const handleStartRecording = async () => {
        if (isStartPending || isStopping || isRecording) {
            return;
        }
        haptics.medium();
        setIsStartPending(true);
        startCancelledRef.current = false;
        setFrozenSeconds(null);
        setDuration(0);
        try {
            currentMetering.current = -160;
            meteringSamples.current = 0;
            voiceSamples.current = 0;
            maxDurationHandledRef.current = false;
            interruptionHandledRef.current = false;
            meetingSegmentsRef.current = [];
            segmentStartRef.current = 0;
            setMeetingLocked(false);
            const granted = await AudioService.requestPermissions();
            if (startCancelledRef.current) return;
            if (!granted) {
                showMicPermissionDenied();
                onCancel();
                return;
            }
            await AudioService.startRecording((level) => {
                currentMetering.current = level;
                meteringSamples.current += 1;
                if (level > SILENCE_THRESHOLD_DB) {
                    voiceSamples.current += 1;
                }
            }, meetingMode ? 'meeting' : 'note', { permissionGranted: true });
            if (startCancelledRef.current) {
                await AudioService.cancelRecording().catch(() => undefined);
                return;
            }
            setIsRecording(true);
            setIsPaused(false);
            recordingStartAtRef.current = Date.now();
        } catch (error) {
            if (startCancelledRef.current) return;
            appAlert(t("common.errorTitle"), t("voice.startError", "Could not start recording"));
            console.error(error);
            // Nothing is recording: the panel would sit at "Starting…" for good.
            onCancel();
        } finally {
            setIsStartPending(false);
        }
    };

    const handlePauseResume = async () => {
        if (!isRecording || isStopping) {
            return;
        }
        while (rollingRef.current) {
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        try {
            if (isPaused) {
                await AudioService.resumeRecording();
            } else {
                await AudioService.pauseRecording();
                // The clock stops with the microphone: show the exact second.
                setDuration(shownRecordingSeconds(AudioService.getRecordedMs()));
            }
            setIsPaused(!isPaused);
        } catch (error) {
            console.error('Error toggling pause', error);
        }
    };

    /** Joins the meeting's parts (plus the last one, if any) and hands them on. */
    const finishMeeting = async (last: AudioRecording | null, shownSeconds?: number) => {
        const segments = [...meetingSegmentsRef.current, ...(last?.uri ? [last.uri] : [])];
        meetingSegmentsRef.current = [];
        setIsRecording(false);
        setIsPaused(false);
        if (segments.length === 0) {
            onCancel();
            return;
        }
        let uri = segments[0];
        try {
            uri = segments.length > 1 ? await AudioService.concatSegments(segments) : segments[0];
        } catch (error) {
            // Joining failed: every part is still transcribed; the card plays the first.
            console.warn('[VoiceRecorder] Could not join meeting parts', error);
        }
        const totalSeconds = shownSeconds || last?.duration || duration;
        recordingStartAtRef.current = null;
        onFinish({ uri, duration: totalSeconds, mimeType: 'audio/m4a', meeting: true, segments }, true);
    };

    const handleStopRecording = async () => {
        if (!isRecording || isStopping || isStartPending) {
            return;
        }
        haptics.medium();
        // Freeze what the timer shows before anything slow happens.
        const shownSeconds = shownRecordingSeconds(AudioService.getRecordedMs()) || duration;
        setFrozenSeconds(shownSeconds);
        setDuration(shownSeconds);
        setPanelOpen(false);
        setIsStopping(true);
        try {
            while (rollingRef.current) {
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
            if (meetingMode || meetingSegmentsRef.current.length > 0) {
                // A last part a few milliseconds old may fail to stop; the earlier
                // parts are kept either way.
                const last = await AudioService.stopRecording().catch(() => null);
                setIsRecording(false);
                setIsPaused(false);
                await finishMeeting(last, shownSeconds);
                return;
            }
            const stopped = await AudioService.stopRecording();
            setIsRecording(false);
            setIsPaused(false);
            if (!stopped) {
                interruptionHandledRef.current = true;
                appAlert(
                    t("voice.recordingUnavailable"),
                    t("voice.recordingUnavailableDesc")
                );
                onCancel();
                return;
            }
            // Stored as shown: the chip and the player say what the timer said.
            const recording: AudioRecording = { ...stopped, duration: shownSeconds || stopped.duration };

            const hasMetering = meteringSamples.current > 0;
            const hasVoiceSignal = !hasMetering || voiceSamples.current >= MIN_VOICE_SAMPLES;
            if (!hasVoiceSignal) {
                const discard = async () => {
                    await AudioService.deleteAudioFile(recording.uri);
                    onCancel();
                };
                // A blip is just dropped. A longer recording that heard almost
                // nothing may still hold quiet speech: the user decides, it is
                // not thrown away behind their back.
                if ((recording.duration || 0) < QUIET_KEEP_MIN_SECONDS) {
                    appAlert(t("voice.noAudioCaptured"), t("voice.noAudioCapturedDesc"));
                    await discard();
                    return;
                }
                appAlert(
                    t("voice.quietTitle", "Almost nothing was heard"),
                    t("voice.quietDescAgain", "The microphone picked up only silence. If it is muted or busy with a call, stop that and record again."),
                    // The last one is the main action.
                    [
                        { text: t("common.delete"), style: "destructive", onPress: () => { void discard(); } },
                        // Kept as audio only: transcribing silence would only spend
                        // cloud minutes; it can still be transcribed from Voice recordings.
                        { text: t("voice.keepAnyway", "Keep anyway"), onPress: () => onFinish({ ...recording, noSpeech: true }, false) },
                        {
                            text: t("voice.recordAgain", "Record again"),
                            onPress: () => {
                                void AudioService.deleteAudioFile(recording.uri).catch(() => undefined);
                                void latestActionsRef.current.start();
                            },
                        },
                    ],
                    // One of the three: dismissed, the recorder would sit there with nothing to do.
                    { cancelable: false }
                );
                recordingStartAtRef.current = null;
                return;
            }
            onFinish(recording, transcribe);
            recordingStartAtRef.current = null;
        } catch (error) {
            // Recovery path: if stop failed, the native recorder may already be invalid.
            // Force local UI out of recording state so the modal does not get stuck.
            interruptionHandledRef.current = true;
            setIsRecording(false);
            setIsPaused(false);
            appAlert(t("common.errorTitle"), t("voice.finishError"));
            onCancel();
            console.error(error);
        } finally {
            setIsStopping(false);
        }
    };

    useEffect(() => () => {
        if (confirmDiscardTimerRef.current) clearTimeout(confirmDiscardTimerRef.current);
    }, []);

    const handleDiscardPress = () => {
        if (isStopping) {
            return;
        }
        if (!confirmDiscard && duration >= DISCARD_CONFIRM_AFTER_SECONDS) {
            haptics.medium();
            setConfirmDiscard(true);
            // The ring around the bin drains while the second tap is awaited.
            discardRing.setValue(0);
            Animated.timing(discardRing, {
                toValue: 1,
                duration: DISCARD_CONFIRM_WINDOW_MS,
                easing: Easing.linear,
                useNativeDriver: false,
            }).start();
            confirmDiscardTimerRef.current = setTimeout(() => setConfirmDiscard(false), DISCARD_CONFIRM_WINDOW_MS);
            return;
        }
        handleCancel();
    };

    const handleCancel = async () => {
        if (isStopping) {
            return;
        }
        if (confirmDiscardTimerRef.current) clearTimeout(confirmDiscardTimerRef.current);
        discardRing.stopAnimation();
        setConfirmDiscard(false);
        // The status watchdog would see the recorder stop while we cancel it and
        // report "Recording interrupted" over a deliberate discard.
        interruptionHandledRef.current = true;
        while (rollingRef.current) {
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (isStartPending) startCancelledRef.current = true;
        try {
            if (isRecording) {
                await AudioService.cancelRecording();
            }
            for (const segment of meetingSegmentsRef.current) {
                await AudioService.deleteAudioFile(segment).catch(() => undefined);
            }
            meetingSegmentsRef.current = [];
            setIsRecording(false);
            setIsPaused(false);
            setIsStopping(false);
            setIsStartPending(false);
            recordingStartAtRef.current = null;
            onCancel();
        } catch (error) {
            console.error(error);
        }
    };

    // The choice offered on Back acts on the state at the time it is tapped,
    // not when it was shown (the recording may have stopped in between).
    const latestActionsRef = useRef({ stop: handleStopRecording, cancel: handleCancel, finishMeeting, start: handleStartRecording, isRecording });
    latestActionsRef.current = { stop: handleStopRecording, cancel: handleCancel, finishMeeting, start: handleStartRecording, isRecording };

    // Android Back / back gesture: "close the panel" must not mean "delete the
    // recording". A short take is still just dropped; anything longer, or a
    // meeting with finished parts, asks: continue, save or delete.
    const handleBackRequest = () => {
        if (panelOpen) {
            setPanelOpen(false);
            return;
        }
        const action = recorderBackAction({
            isRecording,
            isStopping,
            durationSeconds: duration,
            meetingSegments: meetingSegmentsRef.current.length,
        });
        if (action === 'ignore') return;
        if (action === 'close') {
            void handleCancel();
            return;
        }
        haptics.medium();
        appAlert(
            t("voice.exitTitle", "Keep this recording?"),
            t("voice.exitDesc", "Going back would delete what you have recorded."),
            [
                { text: t("voice.continueRecording", "Continue recording"), style: 'cancel' },
                {
                    text: t("common.delete"),
                    style: 'destructive',
                    onPress: () => { void latestActionsRef.current.cancel(); },
                },
                {
                    text: t("voice.saveRecording", "Save"),
                    onPress: () => {
                        const latest = latestActionsRef.current;
                        if (latest.isRecording) {
                            void latest.stop();
                        } else if (meetingSegmentsRef.current.length > 0) {
                            void latest.finishMeeting(null);
                        }
                    },
                },
            ],
            // Dismissing the question (Back again, tap outside) keeps recording.
            { cancelable: true }
        );
    };

    // The mode choice only means something when an agent can act on requests.
    const showModeSwitch = !!voiceMode
        && voiceModeAvailable
        && micMode !== 'force_text'
        && !isInstruction
        && !meetingMode
        && transcribe
        && (route === null || route.agent !== null);
    const shownMode: VoiceInputMode | null = micMode === 'force_text'
        ? 'dictate'
        : showModeSwitch
            ? voiceMode ?? null
            : voiceMode && route && route.agent === null
                ? 'dictate'
                : null;

    const hintKind = micHintKind({
        route,
        mode: shownMode,
        meeting: meetingMode && transcribe,
        transcribe: transcribe || micMode === 'force_text',
    });
    // Explain each kind of recording the first time it is made, then keep it
    // for the rest of that recording so the panel does not change under you.
    useEffect(() => {
        if (!visible || !hintKind || isInstruction || !hasRouteContext || !route) return;
        if (firstUseCheckedRef.current.has(hintKind)) return;
        firstUseCheckedRef.current.add(hintKind);
        void getMicHintSeen(hintKind).then((seen) => {
            if (seen) return;
            setFirstUseKinds((prev) => (prev.includes(hintKind) ? prev : [...prev, hintKind]));
            void setMicHintSeen(hintKind);
        });
    }, [visible, hintKind, isInstruction, hasRouteContext, route]);
    const routeInfo = route ? routeLabel(t, route.transcription, route.cloudFallback) : null;
    const showRouteCaption = hasRouteContext && !isInstruction;
    // Nothing to choose for a spoken instruction: no "⋯" there.
    const hasOptions = !isInstruction;
    const starting = !isRecording && frozenSeconds === null;

    // The line under the timer: where it goes, led by the mode when it is not
    // plain dictation ("Edit by voice · Vaulto cloud", "Meeting · On this phone").
    const captionMode = meetingMode
        ? t("voice.chipMeeting", "Meeting")
        : shownMode === 'edit'
            ? modeLabel(t, 'edit')
            : micMode === 'force_text' && voiceMode === 'edit'
                ? t('voice.mode.dictateOnce', 'Dictate once')
                : null;
    const captionText = [captionMode, route ? routeShortLabel(t, route.transcription) : null]
        .filter(Boolean)
        .join(' · ');

    // At most one card above the bar: the options panel, or else an
    // explanation shown on its own when it matters (the first recording of
    // each kind, a warning, the discard question, a spoken instruction).
    const explanationShown = !panelOpen && (
        !!confirmDiscard
        || isInstruction
        || (!!hintKind && firstUseKinds.includes(hintKind))
        || routeInfo?.tone === 'warning'
    );
    // What Done does, in the panel only when the switches below do not say it
    // already (the mode's effect, or text that has to wait).
    const genericOutcome = t("voice.toTextHint", "When you finish, the recording becomes text");
    const panelOutcomeText = route && !meetingMode && transcribe && route.transcription !== 'audio_only'
        ? outcomeText(t, route, shownMode)
        : null;
    const panelOutcome = panelOutcomeText && panelOutcomeText !== genericOutcome ? panelOutcomeText : null;
    const togglePanel = () => {
        haptics.selection();
        setPanelOpen((prev) => !prev);
    };

    const iconSize = isMainScreen ? 32 : 26;

    return (
        <Modal
            visible={visible}
            animationType="slide"
            transparent
            onRequestClose={handleBackRequest}
        >
            {/* On the notes list the panel takes the dock's place (the list hides the dock). */}
            <View
                style={[styles.overlay, isMainScreen && { paddingBottom: Math.max(insets.bottom, spacing.m) + spacing.m }]}
                pointerEvents="box-none"
            >
                <View style={styles.container} pointerEvents="box-none">
                    {explanationShown && (
                        <MicRouteNote
                            route={route}
                            mode={shownMode}
                            // The bar already names the route; the full line only for a warning.
                            showRoute={hasRouteContext && !isInstruction && routeInfo?.tone === 'warning'}
                            alert={confirmDiscard ? t("voice.discardConfirmHint", "Tap the bin again to delete the recording") : null}
                            outcome={isInstruction
                                ? t("voice.instructionHint", "When you finish, the instruction appears in the field")
                                : meetingMode && transcribe
                                    ? t("voice.meetingHint", "Up to 60 minutes, then a summary with decisions and tasks")
                                    : !hasRouteContext
                                        ? (transcribe || micMode === 'force_text'
                                            ? t("voice.toTextHint", "When you finish, the recording becomes text")
                                            : t("voice.audioOnlyHint", "Saved as audio only, without text"))
                                        : null}
                        />
                    )}

                    {panelOpen && (
                        <View style={styles.panel} accessibilityViewIsModal={false}>
                            <ScrollView
                                style={{ maxHeight: windowHeight * 0.55 }}
                                contentContainerStyle={styles.panelContent}
                                bounces={false}
                            >
                                {/* Where it goes and what Done does, with the same icon as the bar. */}
                                {hasRouteContext && (
                                    <View style={styles.panelRoute} accessible accessibilityLiveRegion="polite">
                                        <View style={styles.panelRouteLine}>
                                            <MaterialIcons
                                                name={routeInfo?.icon ?? 'cloud-queue'}
                                                size={18}
                                                color={routeInfo?.tone === 'warning' ? colors.warning : colors.primary}
                                            />
                                            <Text style={styles.panelRouteText}>{routeInfo?.text ?? ' '}</Text>
                                        </View>
                                        {!!panelOutcome && (
                                            <Text style={styles.panelOutcome}>{panelOutcome}</Text>
                                        )}
                                    </View>
                                )}

                                {/* Dictate / Edit by voice: applies when the recording finishes,
                                    so it can still be switched while speaking. */}
                                {showModeSwitch && voiceMode && onVoiceModeChange && (
                                    <View style={styles.panelMode}>
                                        <VoiceModeSwitch value={voiceMode} onChange={onVoiceModeChange} flat />
                                    </View>
                                )}

                                {/* Joining meeting parts is Android-only for now (native AudioConcat). */}
                                {micMode !== 'force_text' && Platform.OS === 'android' && (
                                    <OptionSwitchRow
                                        icon="groups"
                                        label={t("voice.chipMeeting", "Meeting")}
                                        description={t("voice.meetingHint", "Up to 60 minutes, then a summary with decisions and tasks")}
                                        value={meetingMode}
                                        onChange={(next) => setMeetingMode(next)}
                                        disabled={meetingLocked}
                                    />
                                )}
                                {!meetingMode && (
                                    <OptionSwitchRow
                                        icon="short-text"
                                        label={t("voice.chipTranscribe", "To text")}
                                        description={transcribe
                                            ? t("voice.toTextHint", "When you finish, the recording becomes text")
                                            : t("voice.audioOnlyHint", "Saved as audio only, without text")}
                                        value={transcribe}
                                        onChange={(next) => { void handleTranscriptionToggle(next); }}
                                    />
                                )}
                            </ScrollView>
                        </View>
                    )}

                    {/* Inline Warning Banner */}
                    {showModelMissingWarning && (
                        <Animated.View style={[styles.inlineWarningContainer, { opacity: warningOpacity }]}>
                            <MaterialIcons name="error-outline" size={16} color={colors.warning} />
                            <Text style={styles.inlineWarningText}>
                                {t("voice.modelNotDownloaded")}
                            </Text>
                        </Animated.View>
                    )}

                    {/* The bar: bin, timer with the route under it, options, pause, done. */}
                    <View style={[styles.mainBar, isMainScreen && styles.mainBarLarge]}>
                        <TouchableOpacity
                            style={styles.iconButton}
                            onPress={handleDiscardPress}
                            disabled={isStopping}
                            accessibilityRole="button"
                            accessibilityLabel={confirmDiscard
                                ? t("voice.discardConfirmHint", "Tap the bin again to delete the recording")
                                : t("a11y.deleteRecording", "Delete recording")}
                        >
                            {confirmDiscard && (
                                <Svg
                                    width={DISCARD_RING_SIZE}
                                    height={DISCARD_RING_SIZE}
                                    style={styles.discardRing}
                                    pointerEvents="none"
                                >
                                    <AnimatedCircle
                                        cx={DISCARD_RING_SIZE / 2}
                                        cy={DISCARD_RING_SIZE / 2}
                                        r={DISCARD_RING_RADIUS}
                                        stroke={colors.error}
                                        strokeWidth={DISCARD_RING_STROKE}
                                        fill="none"
                                        strokeLinecap="round"
                                        strokeDasharray={`${DISCARD_RING_LENGTH} ${DISCARD_RING_LENGTH}`}
                                        strokeDashoffset={discardRing.interpolate({
                                            inputRange: [0, 1],
                                            outputRange: [0, DISCARD_RING_LENGTH],
                                        })}
                                        transform={`rotate(-90 ${DISCARD_RING_SIZE / 2} ${DISCARD_RING_SIZE / 2})`}
                                    />
                                </Svg>
                            )}
                            <MaterialIcons
                                name={confirmDiscard ? 'delete-forever' : 'delete-outline'}
                                size={confirmDiscard ? 22 : iconSize}
                                color={confirmDiscard ? colors.error : colors.textTertiary}
                            />
                        </TouchableOpacity>

                        {/* Timer and waveform, with where the recording goes underneath:
                            tap for what happens on Done. */}
                        <TouchableOpacity
                            style={styles.centerColumn}
                            onPress={showRouteCaption ? togglePanel : undefined}
                            disabled={!showRouteCaption}
                            activeOpacity={0.6}
                            accessibilityRole={showRouteCaption ? 'button' : undefined}
                            accessibilityState={showRouteCaption ? { expanded: panelOpen } : undefined}
                            accessibilityLabel={starting
                                ? t('voice.starting', 'Starting…')
                                : showRouteCaption && routeInfo ? `${formatDuration(duration)}, ${captionText}` : undefined}
                            accessibilityHint={showRouteCaption ? t('voice.routeDetailsHint', 'Shows what happens to the recording') : undefined}
                        >
                            <View style={styles.centerSection}>
                                {starting ? (
                                    <Text
                                        style={[styles.startingText, isMainScreen && styles.startingTextLarge]}
                                        numberOfLines={1}
                                        accessibilityLiveRegion="polite"
                                    >
                                        {t('voice.starting', 'Starting…')}
                                    </Text>
                                ) : (
                                    <Text style={[styles.timerCompact, isMainScreen && styles.timerCompactLarge, isPaused && { color: colors.error }]}>
                                        {formatDuration(frozenSeconds ?? duration)}
                                    </Text>
                                )}
                                <View
                                    style={[
                                        styles.waveformContainerCompact,
                                        isMainScreen && styles.waveformContainerCompactLarge,
                                        barCount >= MAX_BAR_COUNT && styles.waveformContainerSpread,
                                    ]}
                                    onLayout={handleWaveformLayout}
                                >
                                    {animations.slice(0, barCount).map((anim, index) => (
                                        <Animated.View
                                            key={index}
                                            style={[
                                                styles.barCompact,
                                                isMainScreen && styles.barCompactLarge,
                                                barCount >= MAX_BAR_COUNT && (isMainScreen ? styles.barSpreadLarge : styles.barSpread),
                                                {
                                                    transform: [{ scaleY: anim }],
                                                    opacity: isRecording && !isPaused && frozenSeconds === null ? 1 : 0.2,
                                                },
                                            ]}
                                        />
                                    ))}
                                </View>
                            </View>
                            {showRouteCaption && (
                                // Kept in place while the route is read, so nothing jumps.
                                <View style={[styles.routeCaption, !routeInfo && styles.invisible]}>
                                    <MaterialIcons
                                        name={routeInfo?.icon ?? 'cloud-queue'}
                                        size={13}
                                        color={routeInfo?.tone === 'warning' ? colors.warning : colors.textSecondary}
                                    />
                                    <Text
                                        style={[styles.routeCaptionText, routeInfo?.tone === 'warning' && styles.routeCaptionWarning]}
                                        // Not cut at large text: the mode and route wrap instead.
                                        numberOfLines={bigText ? undefined : 2}
                                    >
                                        {captionText || ' '}
                                    </Text>
                                </View>
                            )}
                        </TouchableOpacity>

                        {hasOptions && (
                            <TouchableOpacity
                                style={[styles.iconButton, styles.moreButton, panelOpen && styles.moreButtonOpen]}
                                onPress={togglePanel}
                                activeOpacity={0.7}
                                accessibilityRole="button"
                                accessibilityState={{ expanded: panelOpen }}
                                accessibilityLabel={t('voice.moreOptions', 'Recording options')}
                            >
                                <MaterialIcons
                                    name="more-horiz"
                                    size={isMainScreen ? 28 : 24}
                                    color={panelOpen ? colors.primary : colors.textSecondary}
                                />
                            </TouchableOpacity>
                        )}

                        <TouchableOpacity
                            style={styles.iconButton}
                            onPress={handlePauseResume}
                            disabled={!isRecording || isStopping || frozenSeconds !== null}
                            accessibilityRole="button"
                            accessibilityLabel={isPaused
                                ? t("a11y.resumeRecording", "Resume recording")
                                : t("a11y.pauseRecording", "Pause recording")}
                        >
                            <MaterialIcons
                                name={isPaused ? "play-arrow" : "pause"}
                                size={iconSize}
                                color={isRecording && frozenSeconds === null ? colors.textSecondary : colors.textTertiary}
                            />
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[
                                styles.finishButtonCompact,
                                isMainScreen && styles.finishButtonCompactLarge,
                                (isStopping || !isRecording) && styles.buttonDisabled
                            ]}
                            onPress={handleStopRecording}
                            disabled={isStopping || !isRecording}
                            accessibilityRole="button"
                            accessibilityLabel={t("a11y.sendRecording", "Finish and send recording")}
                        >
                            <MaterialIcons name="check" size={isMainScreen ? 32 : 22} color="white" />
                        </TouchableOpacity>
                    </View>
                </View>
            </View>

        </Modal>
    );
};

const styles = createStyles(() => ({
    overlay: {
        flex: 1,
        backgroundColor: 'transparent',
        justifyContent: 'flex-end',
        paddingHorizontal: spacing.m,
        paddingBottom: spacing.xxl * 1.5,
    },
    container: {
        backgroundColor: 'transparent',
        alignItems: 'center',
        width: '100%',
        maxWidth: 560,
        alignSelf: 'center',
    },
    panel: {
        alignSelf: 'stretch',
        backgroundColor: colors.surface,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: colors.border,
        marginBottom: spacing.s,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 6,
        overflow: 'hidden',
    },
    panelContent: {
        paddingHorizontal: spacing.m,
        paddingVertical: spacing.s,
    },
    panelRoute: {
        paddingVertical: spacing.s,
        gap: 4,
    },
    panelRouteLine: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
    },
    panelRouteText: {
        ...typography.captionBold,
        fontSize: 14,
        lineHeight: 20,
        color: colors.text,
        flexShrink: 1,
    },
    panelOutcome: {
        fontSize: 13,
        lineHeight: 18,
        color: colors.textSecondary,
        marginLeft: 26,
    },
    panelMode: {
        paddingVertical: spacing.s,
    },
    mainBar: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderRadius: 30,
        paddingHorizontal: spacing.xs,
        paddingVertical: spacing.s,
        width: '100%',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 10,
    },
    mainBarLarge: {
        paddingHorizontal: spacing.s,
        paddingVertical: spacing.m,
        borderRadius: 44,
    },
    iconButton: {
        width: 48,
        height: 48,
        justifyContent: 'center',
        alignItems: 'center',
    },
    moreButton: {
        width: 44,
    },
    moreButtonOpen: {
        borderRadius: 22,
        backgroundColor: colors.primaryLight,
    },
    discardRing: {
        position: 'absolute',
        top: (48 - DISCARD_RING_SIZE) / 2,
        left: (48 - DISCARD_RING_SIZE) / 2,
    },
    centerColumn: {
        flex: 1,
        alignSelf: 'stretch',
        justifyContent: 'center',
        minHeight: 48,
    },
    routeCaption: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: spacing.s,
        marginTop: -2,
    },
    routeCaptionText: {
        ...typography.caption,
        fontSize: 12,
        lineHeight: 16,
        color: colors.textSecondary,
        flexShrink: 1,
    },
    routeCaptionWarning: {
        color: colors.warning,
    },
    invisible: {
        opacity: 0,
    },
    centerSection: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.s,
        gap: spacing.xs,
        overflow: 'hidden',
    },
    timerCompact: {
        ...typography.bodyBold,
        color: colors.text,
        fontVariant: ['tabular-nums'],
    },
    timerCompactLarge: {
        fontSize: 28,
    },
    startingText: {
        ...typography.bodyBold,
        color: colors.textSecondary,
        flexShrink: 1,
    },
    startingTextLarge: {
        fontSize: 20,
    },
    waveformContainerCompact: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-start',
        height: 32,
        gap: 3,
        marginLeft: spacing.xs,
        overflow: 'hidden',
    },
    waveformContainerCompactLarge: {
        height: 56,
        gap: 5,
    },
    waveformContainerSpread: {
        justifyContent: 'space-between',
    },
    barSpread: {
        flexGrow: 1,
        maxWidth: 5,
    },
    barSpreadLarge: {
        flexGrow: 1,
        maxWidth: 8,
    },
    barCompact: {
        width: 3,
        height: 16,
        backgroundColor: colors.primary,
        borderRadius: 1.5,
    },
    barCompactLarge: {
        width: 5,
        borderRadius: 2.5,
    },
    finishButtonCompact: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: colors.primary,
        justifyContent: 'center',
        alignItems: 'center',
        marginLeft: spacing.xs,
    },
    finishButtonCompactLarge: {
        width: 60,
        height: 60,
        borderRadius: 30,
    },
    buttonDisabled: {
        opacity: 0.45,
    },
    inlineWarningContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: `${colors.warning}15`,
        paddingHorizontal: spacing.m,
        paddingVertical: spacing.xs,
        borderRadius: 16,
        marginBottom: spacing.s,
        gap: spacing.xs,
        borderWidth: 1,
        borderColor: `${colors.warning}30`,
    },
    inlineWarningText: {
        ...typography.captionBold,
        color: colors.warning,
        fontSize: 13,
    },
}));
