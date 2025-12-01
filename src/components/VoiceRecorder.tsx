import React, { useState, useEffect, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Modal,
    Animated,
    Alert,
    Dimensions,
} from 'react-native';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { AudioService, AudioRecording } from '../services/AudioService';
import { MaterialIcons } from '@expo/vector-icons';

interface VoiceRecorderProps {
    visible: boolean;
    onFinish: (recording: AudioRecording) => void;
    onCancel: () => void;
    autoStart?: boolean;
}

const { width } = Dimensions.get('window');
const BAR_COUNT = 20;

export const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
    visible,
    onFinish,
    onCancel,
    autoStart = false,
}) => {
    const [isRecording, setIsRecording] = useState(false);
    const [duration, setDuration] = useState(0);
    const [isPaused, setIsPaused] = useState(false);
    const currentMetering = useRef(-160); // Default low dB

    // Waveform animations
    const animations = useRef([...Array(BAR_COUNT)].map(() => new Animated.Value(0.3))).current;

    useEffect(() => {
        if (visible) {
            if (autoStart) {
                handleStartRecording();
            }
        } else {
            // Reset state when closed
            setIsRecording(false);
            setIsPaused(false);
            setDuration(0);
            currentMetering.current = -160;
        }
    }, [visible]);

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
            await AudioService.startRecording((level) => {
                currentMetering.current = level;
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
                onFinish(recording);
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
                    <Text style={styles.title}>{isPaused ? 'PAUSED' : 'RECORDING...'}</Text>

                    {/* Timer */}
                    <Text style={styles.timer} numberOfLines={1} adjustsFontSizeToFit>{formatDuration(duration)}</Text>

                    {/* Waveform Visualization */}
                    <View style={styles.waveformContainer}>
                        {animations.map((anim, index) => (
                            <Animated.View
                                key={index}
                                style={[
                                    styles.bar,
                                    {
                                        transform: [{ scaleY: anim }],
                                        opacity: isRecording && !isPaused ? 1 : 0.3,
                                    },
                                ]}
                            />
                        ))}
                    </View>

                    {/* Controls */}
                    <View style={styles.controls}>
                        <TouchableOpacity
                            style={styles.cancelButton}
                            onPress={handleCancel}
                        >
                            <MaterialIcons name="close" size={28} color={colors.textMuted} />
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.pauseButton}
                            onPress={handlePauseResume}
                        >
                            <MaterialIcons name={isPaused ? "play-arrow" : "pause"} size={32} color="white" />
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.stopButton}
                            onPress={handleStopRecording}
                        >
                            <View style={styles.stopIcon} />
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
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
        ...typography.caption,
        color: colors.primary,
        marginBottom: spacing.s,
        letterSpacing: 1,
        textTransform: 'uppercase',
    },
    timer: {
        ...typography.h1,
        fontSize: 64, // Kept large, but added adjustsFontSizeToFit
        lineHeight: 72, // Explicit line height to prevent clipping
        fontWeight: '200',
        color: colors.text,
        marginBottom: spacing.xl,
        fontVariant: ['tabular-nums'],
        textAlign: 'center',
        width: '100%',
    },
    waveformContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        height: 60,
        marginBottom: spacing.xxl,
        gap: 4,
    },
    bar: {
        width: 4,
        height: 40,
        backgroundColor: colors.primary,
        borderRadius: 2,
    },
    controls: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.l, // Reduced gap to fit more buttons
        width: '100%',
    },
    stopButton: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: '#ef4444', // Red
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#ef4444',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 8,
    },
    stopIcon: {
        width: 24,
        height: 24,
        borderRadius: 4,
        backgroundColor: 'white',
    },
    pauseButton: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: '#3b82f6', // Blue
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#3b82f6',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 8,
    },
    cancelButton: {
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: colors.background,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: colors.border,
    },
});
