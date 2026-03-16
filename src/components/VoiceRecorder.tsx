import React, { useState, useEffect, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Modal,
    Animated,
    Alert,
} from 'react-native';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { AudioService, AudioRecording, MAX_RECORDING_DURATION_MS } from '../services/AudioService';
import {
    AIProvider,
    getAIProvider,
    getAgentModeEnabled,
    getTranscriptionEnabled,
    setAIProvider,
    setAgentModeEnabled,
    setTranscriptionEnabled
} from '../utils/storage';
import { getLocalWhisperModelStatus } from '../services/LocalWhisperService';
import { MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '../hooks/useAuth';
import { useNavigation } from '@react-navigation/native';
import { SignInRequiredModal } from './SignInRequiredModal';
import { AgentModeVaultoGateModal } from './AgentModeVaultoGateModal';

interface VoiceRecorderProps {
    visible: boolean;
    onFinish: (recording: AudioRecording, transcribe: boolean, agentEnabled?: boolean) => void;
    onCancel: () => void;
    autoStart?: boolean;
    micMode?: 'agent' | 'force_text';
    isMainScreen?: boolean;
}


const BAR_COUNT = 20;
const SILENCE_THRESHOLD_DB = -60;
const MIN_VOICE_SAMPLES = 3;
const MAX_RECORDING_DURATION_SECONDS = Math.floor(MAX_RECORDING_DURATION_MS / 1000);

export const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
    visible,
    onFinish,
    onCancel,
    autoStart = false,
    micMode = 'agent',
    isMainScreen = false,
}) => {
    const navigation = useNavigation<any>();
    const { isAuthenticated, isGuest } = useAuth();
    const [showTranscriptionAuthModal, setShowTranscriptionAuthModal] = useState(false);
    const [showAgentVaultoGate, setShowAgentVaultoGate] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [duration, setDuration] = useState(0);
    const [isPaused, setIsPaused] = useState(false);
    const [isStopping, setIsStopping] = useState(false);
    const [isStartPending, setIsStartPending] = useState(false);
    const [transcribe, setTranscribe] = useState(true);
    const [agentModeEnabled, setAgentModeEnabledState] = useState(true);
    const [aiProvider, setAiProvider] = useState<AIProvider>('vaulto_ai');
    const [showModelMissingWarning, setShowModelMissingWarning] = useState(false);
    const warningOpacity = useRef(new Animated.Value(0)).current;
    const warningTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const agentModeToggleTouchedRef = useRef(false);
    const isForceTextMode = micMode === 'force_text';
    const effectiveAgentEnabled = agentModeEnabled && aiProvider === 'vaulto_ai';
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
            getAgentModeEnabled().then(enabled => {
                if (!isAuthenticated || isGuest) {
                    setAgentModeEnabledState(false);
                } else if (isForceTextMode) {
                    // HOLD mode starts with agent disabled by design, but user can enable it.
                    setAgentModeEnabledState(false);
                } else {
                    setAgentModeEnabledState(enabled);
                }
            });
            getAIProvider().then(provider => {
                if (provider) {
                    setAiProvider(provider);
                    if (provider === 'openai' || provider === 'local_whisper') {
                        setAgentModeEnabledState(false);
                    }
                }
            });
            agentModeToggleTouchedRef.current = false;

            getAIProvider().then(async (provider) => {
                const isUserTranscriptionRestricted = (!isAuthenticated || isGuest) && provider === 'vaulto_ai';
                if (isUserTranscriptionRestricted) {
                    setTranscribe(false);
                    return;
                }

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
            agentModeToggleTouchedRef.current = false;
        }
    }, [visible, autoStart, isAuthenticated, isGuest, isForceTextMode]);

    const handleTranscriptionToggle = async (value: boolean) => {
        if ((!isAuthenticated || isGuest) && aiProvider === 'vaulto_ai' && value) {
            setShowTranscriptionAuthModal(true);
            setTranscribe(false);
            return;
        }

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
        if (isAuthenticated && !isGuest) {
            setTranscriptionEnabled(value);
        }
    };

    const handleAgentModeToggle = (value: boolean) => {
        agentModeToggleTouchedRef.current = true;
        if ((!isAuthenticated || isGuest) && value) {
            setShowTranscriptionAuthModal(true);
            setAgentModeEnabledState(false);
            return;
        }
        if ((aiProvider === 'openai' || aiProvider === 'local_whisper') && value) {
            setAgentModeEnabledState(false);
            setAgentModeEnabled(false);
            if (aiProvider === 'openai') {
                setShowAgentVaultoGate(true);
            }
            return;
        }
        setAgentModeEnabledState(value);
        setAgentModeEnabled(value);
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
                        interruptionHandledRef.current = true;
                        setIsRecording(false);
                        setIsPaused(false);
                        setIsStopping(false);
                        Alert.alert(
                            'Recording interrupted',
                            'The recording stopped unexpectedly before it could be sent. Please try again.'
                        );
                        onCancel();
                    }
                } catch (error) {
                    if (disposed) {
                        return;
                    }

                    interruptionHandledRef.current = true;
                    setIsRecording(false);
                    setIsPaused(false);
                    setIsStopping(false);
                    console.warn('[VoiceRecorder] Failed to read recording status', error);
                    Alert.alert(
                        'Recording interrupted',
                        'The recording state was lost. Please try again.'
                    );
                    onCancel();
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
            duration < MAX_RECORDING_DURATION_SECONDS ||
            maxDurationHandledRef.current
        ) {
            return;
        }

        maxDurationHandledRef.current = true;
        Alert.alert(
            'Recording limit reached',
            'A single recording is limited to 5 minutes. Sending the current recording now.'
        );
        void handleStopRecording();
    }, [visible, duration, isRecording, isPaused, isStopping]);

    const formatDuration = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const handleStartRecording = async () => {
        if (isStartPending || isStopping || isRecording) {
            return;
        }
        setIsStartPending(true);
        try {
            currentMetering.current = -160;
            meteringSamples.current = 0;
            voiceSamples.current = 0;
            maxDurationHandledRef.current = false;
            interruptionHandledRef.current = false;
            await AudioService.startRecording((level) => {
                currentMetering.current = level;
                meteringSamples.current += 1;
                if (level > SILENCE_THRESHOLD_DB) {
                    voiceSamples.current += 1;
                }
            });
            setIsRecording(true);
            setIsPaused(false);
            setDuration(0);
            recordingStartAtRef.current = Date.now();
        } catch (error) {
            Alert.alert('Error', 'Could not start recording');
            console.error(error);
        } finally {
            setIsStartPending(false);
        }
    };

    const handlePauseResume = async () => {
        if (!isRecording || isStopping) {
            return;
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

    const handleStopRecording = async () => {
        if (!isRecording || isStopping || isStartPending) {
            return;
        }
        setIsStopping(true);
        try {
            const recording = await AudioService.stopRecording();
            setIsRecording(false);
            setIsPaused(false);
            if (!recording) {
                interruptionHandledRef.current = true;
                Alert.alert(
                    'Recording unavailable',
                    'The recording stopped before it could be saved or transcribed. Please try again.'
                );
                onCancel();
                return;
            }

            const hasMetering = meteringSamples.current > 0;
            const hasVoiceSignal = !hasMetering || voiceSamples.current >= MIN_VOICE_SAMPLES;
            if (!hasVoiceSignal) {
                await AudioService.deleteAudioFile(recording.uri);
                Alert.alert(
                    'No audio captured',
                    'It looks like the microphone is being used by another app (e.g. WhatsApp call) or the input is muted. Please stop the other recording/call and try again.'
                );
                onCancel();
                return;
            }
            // Persist for normal mode, or when user explicitly changed agent state in HOLD mode.
            if (!isForceTextMode || agentModeToggleTouchedRef.current) {
                await setAgentModeEnabled(agentModeEnabled);
            }
            onFinish(recording, transcribe, agentModeEnabled);
            recordingStartAtRef.current = null;
        } catch (error) {
            // Recovery path: if stop failed, the native recorder may already be invalid.
            // Force local UI out of recording state so the modal does not get stuck.
            interruptionHandledRef.current = true;
            setIsRecording(false);
            setIsPaused(false);
            Alert.alert('Error', 'Could not finish recording. Please try again.');
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
        try {
            if (isRecording) {
                await AudioService.cancelRecording();
            }
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
            visible={visible}
            animationType="slide"
            transparent
            onRequestClose={handleCancel}
        >
            <View style={styles.overlay} pointerEvents="box-none">
                <View style={styles.container} pointerEvents="box-none">
                    {/* Toggles Row */}
                    <View style={styles.togglesRow}>
                        <TouchableOpacity
                            style={[
                                styles.badgeToggle,
                                { backgroundColor: transcribe ? colors.primary : colors.surface },
                            ]}
                            onPress={() => handleTranscriptionToggle(!transcribe)}
                            activeOpacity={0.7}
                        >
                            <MaterialIcons
                                name="mic"
                                size={14}
                                color={transcribe ? 'white' : colors.textSecondary}
                            />
                            <Text style={[
                                styles.badgeLabel,
                                { color: transcribe ? 'white' : colors.textSecondary }
                            ]}>
                                Transcribe {transcribe ? 'ON' : 'OFF'}
                            </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[
                                styles.badgeToggle,
                                { backgroundColor: effectiveAgentEnabled ? colors.primary : colors.surface },
                            ]}
                            onPress={() => handleAgentModeToggle(!agentModeEnabled)}
                            activeOpacity={0.7}
                        >
                            <MaterialIcons
                                name="smart-toy"
                                size={14}
                                color={effectiveAgentEnabled ? 'white' : colors.textSecondary}
                            />
                            <Text style={[
                                styles.badgeLabel,
                                { color: effectiveAgentEnabled ? 'white' : colors.textSecondary }
                            ]}>
                                {effectiveAgentEnabled ? 'AI Agent ON' : 'AI Agent OFF'}
                            </Text>
                        </TouchableOpacity>
                    </View>

                    {/* Inline Warning Banner */}
                    {showModelMissingWarning && (
                        <Animated.View style={[styles.inlineWarningContainer, { opacity: warningOpacity }]}>
                            <MaterialIcons name="error-outline" size={16} color={colors.warning} />
                            <Text style={styles.inlineWarningText}>
                                Model not downloaded. Check Settings.
                            </Text>
                        </Animated.View>
                    )}

                    {/* Main Bar */}
                    <View style={[styles.mainBar, isMainScreen && styles.mainBarLarge]}>
                        <TouchableOpacity
                            style={styles.cancelButtonCompact}
                            onPress={handleCancel}
                            disabled={isStopping}
                        >
                            <MaterialIcons name="delete-outline" size={isMainScreen ? 32 : 26} color={colors.textTertiary} />
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
                        >
                            <MaterialIcons name={isPaused ? "play-arrow" : "pause"} size={isMainScreen ? 32 : 26} color={colors.textSecondary} />
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[
                                styles.finishButtonCompact,
                                isMainScreen && styles.finishButtonCompactLarge,
                                (isStopping || !isRecording) && styles.buttonDisabled
                            ]}
                            onPress={handleStopRecording}
                            disabled={isStopping || !isRecording}
                        >
                            <MaterialIcons name="send" size={isMainScreen ? 24 : 20} color="white" />
                        </TouchableOpacity>
                    </View>
                </View>
            </View>

            <SignInRequiredModal
                visible={showTranscriptionAuthModal}
                title="Sign in required"
                message="Transcription is available after you create an account."
                onClose={() => setShowTranscriptionAuthModal(false)}
                onSignIn={() => {
                    setShowTranscriptionAuthModal(false);
                    handleCancel();
                    navigation.navigate('SignIn');
                }}
            />

            <AgentModeVaultoGateModal
                visible={showAgentVaultoGate}
                onClose={() => setShowAgentVaultoGate(false)}
                onPrimaryAction={() => {
                    setAIProvider('vaulto_ai').catch(() => {});
                    setAiProvider('vaulto_ai');
                }}
            />
        </Modal>
    );
};

const styles = StyleSheet.create({
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
    badgeLabel: {
        ...typography.captionBold,
        fontSize: 12,
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
        paddingHorizontal: spacing.m,
        paddingVertical: spacing.m,
        borderRadius: 40,
    },
    cancelButtonCompact: {
        padding: spacing.s,
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
        fontSize: 24,
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
        height: 48,
        gap: 4,
    },
    barCompact: {
        width: 3,
        height: 16,
        backgroundColor: colors.primary,
        borderRadius: 1.5,
    },
    barCompactLarge: {
        width: 4,
        borderRadius: 2,
    },
    pauseButtonCompact: {
        padding: spacing.s,
        justifyContent: 'center',
        alignItems: 'center',
    },
    finishButtonCompact: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: colors.primary,
        justifyContent: 'center',
        alignItems: 'center',
        marginLeft: spacing.xs,
    },
    finishButtonCompactLarge: {
        width: 56,
        height: 56,
        borderRadius: 28,
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
});
