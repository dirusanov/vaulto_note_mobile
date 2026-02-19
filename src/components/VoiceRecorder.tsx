import React, { useState, useEffect, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Modal,
    Animated,
    Alert,
    Switch,
} from 'react-native';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { AudioService, AudioRecording } from '../services/AudioService';
import {
    getAgentModeEnabled,
    getTranscriptionEnabled,
    setAgentModeEnabled,
    setTranscriptionEnabled
} from '../utils/storage';
import { MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '../hooks/useAuth';
import { useNavigation } from '@react-navigation/native';
import { SignInRequiredModal } from './SignInRequiredModal';

interface VoiceRecorderProps {
    visible: boolean;
    onFinish: (recording: AudioRecording, transcribe: boolean) => void;
    onCancel: () => void;
    autoStart?: boolean;
    micMode?: 'agent' | 'force_text';
}


const BAR_COUNT = 20;
const SILENCE_THRESHOLD_DB = -60;
const MIN_VOICE_SAMPLES = 3;

export const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
    visible,
    onFinish,
    onCancel,
    autoStart = false,
    micMode = 'agent',
}) => {
    const navigation = useNavigation<any>();
    const { isAuthenticated, isGuest } = useAuth();
    const [showTranscriptionAuthModal, setShowTranscriptionAuthModal] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [duration, setDuration] = useState(0);
    const [isPaused, setIsPaused] = useState(false);
    const [transcribe, setTranscribe] = useState(true);
    const [agentModeEnabled, setAgentModeEnabledState] = useState(true);
    const isForceTextMode = micMode === 'force_text';
    const effectiveAgentEnabled = !isForceTextMode && agentModeEnabled;
    const currentMetering = useRef(-160); // Default low dB
    const meteringSamples = useRef(0);
    const voiceSamples = useRef(0);

    // Waveform animations
    const animations = useRef([...Array(BAR_COUNT)].map(() => new Animated.Value(0.3))).current;

    useEffect(() => {
        if (visible) {
            getAgentModeEnabled().then(enabled => {
                if (!isAuthenticated || isGuest) {
                    setAgentModeEnabledState(false);
                } else {
                    setAgentModeEnabledState(enabled);
                }
            });

            if (!isAuthenticated || isGuest) {
                // Anonymous users cannot use transcription; keep toggle OFF.
                setTranscribe(false);
            } else {
                // Load preference
                getTranscriptionEnabled().then(enabled => {
                    setTranscribe(enabled);
                });
            }

            if (autoStart) {
                handleStartRecording();
            }
        } else {
            // Reset state when closed
            // Don't reset transcribe here, keep user preference or reload next open
            setIsRecording(false);
            setIsPaused(false);
            setDuration(0);
            currentMetering.current = -160;
            meteringSamples.current = 0;
            voiceSamples.current = 0;
        }
    }, [visible, autoStart, isAuthenticated, isGuest]);

    const handleTranscriptionToggle = (value: boolean) => {
        if ((!isAuthenticated || isGuest) && value) {
            setShowTranscriptionAuthModal(true);
            setTranscribe(false);
            return;
        }
        setTranscribe(value);
        if (isAuthenticated && !isGuest) {
            setTranscriptionEnabled(value);
        }
    };

    const handleAgentModeToggle = (value: boolean) => {
        if (isForceTextMode) return;
        if ((!isAuthenticated || isGuest) && value) {
            setShowTranscriptionAuthModal(true);
            setAgentModeEnabledState(false);
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

                // Scale up significantly - allow going up to 1.6x height (64px)
                // Lower minimum to 0.1 for more contrast
                const targetHeight = Math.max(0.1, Math.min(1.6, boosted * 2.2 + 0.1 + jitter));

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

    const formatDuration = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const handleStartRecording = async () => {
        try {
            currentMetering.current = -160;
            meteringSamples.current = 0;
            voiceSamples.current = 0;
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
        } catch (error) {
            Alert.alert('Error', 'Could not start recording');
            console.error(error);
        }
    };

    const handlePauseResume = async () => {
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
        try {
            const recording = await AudioService.stopRecording();
            setIsRecording(false);
            setIsPaused(false);
            if (recording) {
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
                // Persist the current switch state before handing off recording flow.
                if (!isForceTextMode) {
                    await setAgentModeEnabled(agentModeEnabled);
                }
                onFinish(recording, transcribe);
            }
        } catch (error) {
            Alert.alert('Error', 'Could not stop recording');
            console.error(error);
        }
    };

    const handleCancel = async () => {
        try {
            if (isRecording) {
                await AudioService.cancelRecording();
            }
            setIsRecording(false);
            setIsPaused(false);
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
            <View style={styles.overlay}>
                <View style={styles.container}>
                    {/* Header */}
                    <Text style={styles.title}>{isPaused ? 'Recording Paused' : 'Recording Audio...'}</Text>

                    {/* Waveform Visualization */}
                    <View style={styles.waveformContainer}>
                        {animations.map((anim, index) => (
                            <Animated.View
                                key={index}
                                style={[
                                    styles.bar,
                                    {
                                        transform: [{ scaleY: anim }],
                                        opacity: isRecording && !isPaused ? 1 : 0.2,
                                    },
                                ]}
                            />
                        ))}
                    </View>

                    {/* Timer */}
                    <Text style={styles.timer} numberOfLines={1} adjustsFontSizeToFit>{formatDuration(duration)}</Text>

                    {/* Toggles Row */}
                    <View style={styles.togglesRow}>
                        {/* Agent Toggle Badge */}
                        <TouchableOpacity
                            style={[
                                styles.badgeToggle,
                                { backgroundColor: effectiveAgentEnabled ? colors.primary + '15' : colors.backgroundSecondary },
                                isForceTextMode && styles.badgeToggleDisabled,
                            ]}
                            onPress={() => handleAgentModeToggle(!agentModeEnabled)}
                            disabled={isForceTextMode}
                            activeOpacity={0.7}
                        >
                            <MaterialIcons
                                name="smart-toy"
                                size={20}
                                color={effectiveAgentEnabled ? colors.primary : colors.textTertiary}
                            />
                            <Text style={[
                                styles.badgeLabel,
                                { color: effectiveAgentEnabled ? colors.primary : colors.textSecondary }
                            ]}>
                                {effectiveAgentEnabled ? 'AI Agent ON' : 'AI Agent OFF'}
                            </Text>
                        </TouchableOpacity>

                        {/* Transcription Toggle Badge */}
                        <TouchableOpacity
                            style={[
                                styles.badgeToggle,
                                { backgroundColor: transcribe ? colors.primary + '15' : colors.backgroundSecondary }
                            ]}
                            onPress={() => handleTranscriptionToggle(!transcribe)}
                            activeOpacity={0.7}
                        >
                            <MaterialIcons
                                name="mic"
                                size={20}
                                color={transcribe ? colors.primary : colors.textTertiary}
                            />
                            <Text style={[
                                styles.badgeLabel,
                                { color: transcribe ? colors.primary : colors.textSecondary }
                            ]}>
                                Transcribe {transcribe ? 'ON' : 'OFF'}
                            </Text>
                        </TouchableOpacity>
                    </View>

                    {/* Controls */}
                    <View style={styles.controls}>
                        <TouchableOpacity
                            style={styles.cancelButton}
                            onPress={handleCancel}
                        >
                            <MaterialIcons name="close" size={32} color={colors.textSecondary} />
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.pauseButton}
                            onPress={handlePauseResume}
                        >
                            <MaterialIcons name={isPaused ? "play-arrow" : "pause"} size={40} color={colors.text} />
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.finishButton}
                            onPress={handleStopRecording}
                        >
                            <MaterialIcons name="check" size={36} color="white" />
                        </TouchableOpacity>
                    </View>
                </View>
            </View>

            <SignInRequiredModal
                visible={showTranscriptionAuthModal}
                title="Sign in to enable"
                message="Transcription is available after you create an account."
                onClose={() => setShowTranscriptionAuthModal(false)}
                onSignIn={() => {
                    setShowTranscriptionAuthModal(false);
                    handleCancel();
                    navigation.navigate('SignIn');
                }}
            />
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        justifyContent: 'flex-end',
    },
    container: {
        backgroundColor: colors.surface,
        borderTopLeftRadius: 32,
        borderTopRightRadius: 32,
        padding: spacing.xl,
        paddingBottom: spacing.xxl * 2,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 20,
    },
    title: {
        ...typography.captionBold,
        color: colors.textSecondary,
        marginBottom: spacing.xl,
        textTransform: 'uppercase',
        letterSpacing: 1.5,
    },
    timer: {
        ...typography.h1,
        fontSize: 72,
        lineHeight: 80,
        fontWeight: '300',
        color: colors.text,
        marginBottom: spacing.l,
        fontVariant: ['tabular-nums'],
        textAlign: 'center',
        width: '100%',
    },
    togglesRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.s,
        marginBottom: spacing.xxl,
        width: '100%',
    },
    badgeToggle: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderRadius: 24,
        gap: 8,
        minWidth: 120,
        justifyContent: 'center',
    },
    badgeToggleDisabled: {
        opacity: 0.8,
    },

    badgeLabel: {
        ...typography.captionBold,
        fontSize: 14,
    },
    waveformContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        height: 80,
        marginBottom: spacing.l,
        gap: 6,
    },
    bar: {
        width: 3.5,
        height: 48,
        backgroundColor: colors.primary,
        borderRadius: 2,
    },
    controls: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xl,
        width: '100%',
    },
    finishButton: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: colors.success,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: colors.success,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
        elevation: 8,
    },
    pauseButton: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: colors.backgroundSecondary,
        justifyContent: 'center',
        alignItems: 'center',
    },
    cancelButton: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: colors.backgroundSecondary,
        justifyContent: 'center',
        alignItems: 'center',
    },
});
