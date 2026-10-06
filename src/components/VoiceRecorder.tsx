import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
    View,
    Platform,
    Text,
    TouchableOpacity,
    Modal,
    Animated,
    Alert,
} from 'react-native';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { AudioService, AudioRecording, MAX_RECORDING_DURATION_MS, MAX_MEETING_DURATION_MS, MEETING_SEGMENT_MS } from '../services/AudioService';
import {
    AIProvider,
    getAIProvider,
    getTranscriptionEnabled,
    setTranscriptionEnabled
} from '../utils/storage';
import { getLocalWhisperModelStatus } from '../services/LocalWhisperService';
import { MaterialIcons } from '@expo/vector-icons';
import { createStyles } from '../theme/createStyles';
import { haptics } from '../utils/haptics';
import { rtlFlip } from '../i18n/direction';

interface VoiceRecorderProps {
    visible: boolean;
    onFinish: (recording: AudioRecording, transcribe: boolean) => void;
    onCancel: () => void;
    autoStart?: boolean;
    micMode?: 'agent' | 'force_text';
    isMainScreen?: boolean;
}


const BAR_COUNT = 20;
const SILENCE_THRESHOLD_DB = -60;
const MIN_VOICE_SAMPLES = 3;
const MAX_RECORDING_DURATION_SECONDS = Math.floor(MAX_RECORDING_DURATION_MS / 1000);
const MAX_MEETING_DURATION_SECONDS = Math.floor(MAX_MEETING_DURATION_MS / 1000);
const MEETING_SEGMENT_SECONDS = Math.floor(MEETING_SEGMENT_MS / 1000);

export const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
    visible,
    onFinish,
    onCancel,
    autoStart = false,
    micMode = 'agent',
    isMainScreen = false,
}) => {
    const { t } = useTranslation();
    const [isRecording, setIsRecording] = useState(false);
    const [duration, setDuration] = useState(0);
    const [isPaused, setIsPaused] = useState(false);
    const [isStopping, setIsStopping] = useState(false);
    const [isStartPending, setIsStartPending] = useState(false);
    // With autoStart the panel stays hidden until the microphone permission is
    // settled, instead of showing a live-looking 0:00 recorder behind the
    // system permission dialog.
    const [permissionSettled, setPermissionSettled] = useState(false);
    const [transcribe, setTranscribe] = useState(true);
    const [aiProvider, setAiProvider] = useState<AIProvider>('vaulto_ai');
    const [showModelMissingWarning, setShowModelMissingWarning] = useState(false);
    const warningOpacity = useRef(new Animated.Value(0)).current;
    const warningTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    // Meeting mode: up to an hour, transcribed as is (no agent), then summarised.
    const [meetingMode, setMeetingMode] = useState(false);
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
    const INTERRUPTION_GRACE_MS = 1800;

    // Waveform animations
    const animations = useRef([...Array(BAR_COUNT)].map(() => new Animated.Value(0.3))).current;

    useEffect(() => {
        if (visible) {
            getAIProvider().then(provider => {
                if (provider) setAiProvider(provider);
            });

            getAIProvider().then(async (provider) => {

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
            setPermissionSettled(false);
            setDuration(0);
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

                // Show it
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

    useEffect(() => {
        if (isRecording && !isPaused) {
            // Start timer
            const interval = setInterval(() => {
                setDuration(d => d + 1);
            }, 1000);

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

            animations.forEach(anim => animateBar(anim));

            return () => {
                clearInterval(interval);
                animations.forEach(anim => anim.stopAnimation());
            };
        } else {
            // Reset bars smoothly
            animations.forEach(anim => {
                anim.stopAnimation();
                Animated.timing(anim, {
                    toValue: 0.3,
                    duration: 200,
                    useNativeDriver: true,
                }).start();
            });
        }
    }, [isRecording, isPaused]);

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

        Alert.alert(
            t("voice.recordingInterrupted", "Recording interrupted"),
            message,
            [
                {
                    text: t("voice.retry"),
                    onPress: () => {
                        interruptionHandledRef.current = false;
                        void handleStartRecording();
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
        Alert.alert(
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
            setPermissionSettled(true);
            if (!granted) {
                Alert.alert(t("common.permission", "Permission"), t("voice.micPermissionDenied"));
                onCancel();
                return;
            }
            await AudioService.startRecording((level) => {
                currentMetering.current = level;
                meteringSamples.current += 1;
                if (level > SILENCE_THRESHOLD_DB) {
                    voiceSamples.current += 1;
                }
            }, meetingMode ? 'meeting' : 'note');
            setIsRecording(true);
            setIsPaused(false);
            setDuration(0);
            recordingStartAtRef.current = Date.now();
        } catch (error) {
            Alert.alert(t("common.errorTitle"), t("voice.startError", "Could not start recording"));
            console.error(error);
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
            }
            setIsPaused(!isPaused);
        } catch (error) {
            console.error('Error toggling pause', error);
        }
    };

    /** Joins the meeting's parts (plus the last one, if any) and hands them on. */
    const finishMeeting = async (last: AudioRecording | null) => {
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
        const totalSeconds = last?.duration || duration;
        recordingStartAtRef.current = null;
        onFinish({ uri, duration: totalSeconds, mimeType: 'audio/m4a', meeting: true, segments }, true);
    };

    const handleStopRecording = async () => {
        if (!isRecording || isStopping || isStartPending) {
            return;
        }
        haptics.medium();
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
                await finishMeeting(last);
                return;
            }
            const recording = await AudioService.stopRecording();
            setIsRecording(false);
            setIsPaused(false);
            if (!recording) {
                interruptionHandledRef.current = true;
                Alert.alert(
                    t("voice.recordingUnavailable"),
                    t("voice.recordingUnavailableDesc")
                );
                onCancel();
                return;
            }

            const hasMetering = meteringSamples.current > 0;
            const hasVoiceSignal = !hasMetering || voiceSamples.current >= MIN_VOICE_SAMPLES;
            if (!hasVoiceSignal) {
                await AudioService.deleteAudioFile(recording.uri);
                Alert.alert(
                    t("voice.noAudioCaptured"),
                    t("voice.noAudioCapturedDesc")
                );
                onCancel();
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
            Alert.alert(t("common.errorTitle"), t("voice.finishError"));
            onCancel();
            console.error(error);
        } finally {
            setIsStopping(false);
        }
    };

    const handleCancel = async () => {
        if (isStopping) {
            return;
        }
        while (rollingRef.current) {
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
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

    return (
        <Modal
            visible={visible && (!autoStart || isRecording || permissionSettled)}
            animationType="slide"
            transparent
            onRequestClose={handleCancel}
        >
            <View style={styles.overlay} pointerEvents="box-none">
                <View style={styles.container} pointerEvents="box-none">
                    {/* Toggles Row */}
                    <View style={styles.togglesRow}>
                        {/* Joining meeting parts is Android-only for now (native AudioConcat). */}
                        {micMode !== 'force_text' && Platform.OS === 'android' && (
                            <TouchableOpacity
                                style={[
                                    styles.badgeToggle,
                                    isMainScreen && styles.badgeToggleLarge,
                                    meetingMode ? styles.badgeToggleOn : styles.badgeToggleOff,
                                ]}
                                onPress={() => {
                                    if (meetingLocked) return;
                                    haptics.selection();
                                    setMeetingMode((prev) => !prev);
                                }}
                                disabled={meetingLocked}
                                hitSlop={{ top: 4, bottom: 4 }}
                                activeOpacity={0.7}
                                accessibilityRole="switch"
                                accessibilityLabel={t("voice.chipMeeting", "Meeting")}
                                accessibilityHint={t("voice.meetingHint", "Up to 60 minutes, then a summary with decisions and tasks")}
                                accessibilityState={{ checked: meetingMode }}
                            >
                                <MaterialIcons
                                    name={meetingMode ? 'check' : 'groups'}
                                    size={isMainScreen ? 18 : 14}
                                    color={meetingMode ? colors.onPrimary : colors.textSecondary}
                                />
                                <Text
                                    style={[
                                        styles.badgeLabel,
                                        isMainScreen && styles.badgeLabelLarge,
                                        { color: meetingMode ? colors.onPrimary : colors.textSecondary },
                                    ]}
                                    numberOfLines={1}
                                >
                                    {t("voice.chipMeeting", "Meeting")}
                                </Text>
                            </TouchableOpacity>
                        )}

                        {!meetingMode && (
                            <>
                            <TouchableOpacity
                                style={[
                                    styles.badgeToggle,
                                    isMainScreen && styles.badgeToggleLarge,
                                    transcribe ? styles.badgeToggleOn : styles.badgeToggleOff,
                                ]}
                                onPress={() => handleTranscriptionToggle(!transcribe)}
                                hitSlop={{ top: 4, bottom: 4 }}
                                activeOpacity={0.7}
                                accessibilityRole="switch"
                                accessibilityLabel={t("common.transcribe", "Transcribe")}
                                accessibilityState={{ checked: transcribe }}
                            >
                                <MaterialIcons
                                    name={transcribe ? 'check' : 'mic'}
                                    size={isMainScreen ? 18 : 14}
                                    color={transcribe ? colors.onPrimary : colors.textSecondary}
                                />
                                <Text
                                    style={[
                                        styles.badgeLabel,
                                        isMainScreen && styles.badgeLabelLarge,
                                        { color: transcribe ? colors.onPrimary : colors.textSecondary },
                                    ]}
                                    numberOfLines={1}
                                >
                                    {t("voice.chipTranscribe", "To text")}
                                </Text>
                            </TouchableOpacity>
                            </>
                        )}
                    </View>

                    {meetingMode && (
                        <Text style={styles.meetingHint}>
                            {t("voice.meetingHint", "Up to 60 minutes, then a summary with decisions and tasks")}
                        </Text>
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

                    {/* Main Bar */}
                    <View style={[styles.mainBar, isMainScreen && styles.mainBarLarge]}>
                        <TouchableOpacity
                            style={styles.cancelButtonCompact}
                            onPress={handleCancel}
                            disabled={isStopping}
                            accessibilityRole="button"
                            accessibilityLabel={t("a11y.deleteRecording", "Delete recording")}
                        >
                            <MaterialIcons name="delete-outline" size={isMainScreen ? 36 : 26} color={colors.textTertiary} />
                        </TouchableOpacity>

                        <View style={styles.centerSection}>
                            <Text style={[styles.timerCompact, isMainScreen && styles.timerCompactLarge, isPaused && { color: colors.error }]}>
                                {formatDuration(duration)}
                            </Text>
                            <View style={[styles.waveformContainerCompact, isMainScreen && styles.waveformContainerCompactLarge]}>
                                {animations.map((anim, index) => (
                                    <Animated.View
                                        key={index}
                                        style={[
                                            styles.barCompact,
                                            isMainScreen && styles.barCompactLarge,
                                            {
                                                transform: [{ scaleY: anim }],
                                                opacity: isRecording && !isPaused ? 1 : 0.2,
                                            },
                                        ]}
                                    />
                                ))}
                            </View>
                        </View>

                        <TouchableOpacity
                            style={styles.pauseButtonCompact}
                            onPress={handlePauseResume}
                            disabled={!isRecording || isStopping}
                            accessibilityRole="button"
                            accessibilityLabel={isPaused
                                ? t("a11y.resumeRecording", "Resume recording")
                                : t("a11y.pauseRecording", "Pause recording")}
                        >
                            <MaterialIcons name={isPaused ? "play-arrow" : "pause"} size={isMainScreen ? 36 : 26} color={colors.textSecondary} />
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
                            <MaterialIcons name="send" size={isMainScreen ? 30 : 20} color="white" style={rtlFlip} />
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
    togglesRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.s,
        marginBottom: spacing.m,
        width: '100%',
    },
    badgeToggle: {
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 1,
        minHeight: 44,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        gap: 6,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    meetingHint: {
        fontSize: 13,
        color: colors.textSecondary,
        textAlign: 'center',
        marginTop: -spacing.s,
        marginBottom: spacing.s,
    },
    badgeToggleOn: {
        backgroundColor: colors.primary,
        borderWidth: 1,
        borderColor: colors.primary,
    },
    badgeToggleOff: {
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
    },
    badgeToggleLarge: {
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 24,
        gap: 8,
    },
    badgeLabel: {
        ...typography.captionBold,
        fontSize: 12,
    },
    badgeLabelLarge: {
        fontSize: 14,
    },
    mainBar: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderRadius: 30,
        paddingHorizontal: spacing.s,
        paddingVertical: spacing.s,
        width: '100%',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 10,
    },
    mainBarLarge: {
        paddingHorizontal: spacing.l,
        paddingVertical: spacing.m * 1.2,
        borderRadius: 44,
    },
    cancelButtonCompact: {
        width: 48,
        height: 48,
        justifyContent: 'center',
        alignItems: 'center',
    },
    centerSection: {
        flex: 1,
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
    pauseButtonCompact: {
        width: 48,
        height: 48,
        justifyContent: 'center',
        alignItems: 'center',
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
        width: 64,
        height: 64,
        borderRadius: 32,
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
