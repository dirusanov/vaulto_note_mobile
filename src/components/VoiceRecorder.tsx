import React, { useState, useEffect } from 'react';
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
import { AudioService, AudioRecording } from '../services/AudioService';

interface VoiceRecorderProps {
    visible: boolean;
    onFinish: (recording: AudioRecording) => void;
    onCancel: () => void;
}

export const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
    visible,
    onFinish,
    onCancel,
}) => {
    const [isRecording, setIsRecording] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [duration, setDuration] = useState(0);
    const [pulseAnim] = useState(new Animated.Value(1));

    useEffect(() => {
        if (isRecording && !isPaused) {
            // Start pulse animation
            Animated.loop(
                Animated.sequence([
                    Animated.timing(pulseAnim, {
                        toValue: 1.2,
                        duration: 800,
                        useNativeDriver: true,
                    }),
                    Animated.timing(pulseAnim, {
                        toValue: 1,
                        duration: 800,
                        useNativeDriver: true,
                    }),
                ])
            ).start();

            // Update duration
            const interval = setInterval(() => {
                setDuration(d => d + 1);
            }, 1000);

            return () => clearInterval(interval);
        }
    }, [isRecording, isPaused]);

    const formatDuration = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const handleStartRecording = async () => {
        try {
            await AudioService.startRecording();
            setIsRecording(true);
            setDuration(0);
        } catch (error) {
            Alert.alert('Ошибка', 'Не удалось начать запись');
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
            Alert.alert('Ошибка', 'Проблема с записью');
        }
    };

    const handleStopRecording = async () => {
        try {
            const recording = await AudioService.stopRecording();
            if (recording) {
                onFinish(recording);
            }
            resetState();
        } catch (error) {
            Alert.alert('Ошибка', 'Не удалось остановить запись');
            console.error(error);
        }
    };

    const handleCancel = async () => {
        try {
            await AudioService.cancelRecording();
            resetState();
            onCancel();
        } catch (error) {
            console.error(error);
        }
    };

    const resetState = () => {
        setIsRecording(false);
        setIsPaused(false);
        setDuration(0);
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
                    <Text style={styles.title}>Голосовая заметка</Text>

                    {/* Timer */}
                    <Text style={styles.timer}>{formatDuration(duration)}</Text>
                    <Text style={styles.maxDuration}>Максимум: 5:00</Text>

                    {/* Record Button */}
                    <View style={styles.recordButtonContainer}>
                        {!isRecording ? (
                            <TouchableOpacity
                                style={styles.startButton}
                                onPress={handleStartRecording}
                            >
                                <Text style={styles.micIcon}>🎤</Text>
                            </TouchableOpacity>
                        ) : (
                            <Animated.View
                                style={[
                                    styles.recordingButton,
                                    {
                                        transform: [{ scale: pulseAnim }],
                                        opacity: isPaused ? 0.5 : 1,
                                    },
                                ]}
                            >
                                <View style={styles.recordingIndicator} />
                            </Animated.View>
                        )}
                    </View>

                    {/* Status */}
                    {isRecording && (
                        <Text style={styles.status}>
                            {isPaused ? '⏸ Пауза' : '● Идёт запись...'}
                        </Text>
                    )}

                    {/* Controls */}
                    <View style={styles.controls}>
                        {isRecording && (
                            <>
                                <TouchableOpacity
                                    style={[styles.controlButton, styles.pauseButton]}
                                    onPress={handlePauseResume}
                                >
                                    <Text style={styles.controlButtonText}>
                                        {isPaused ? '▶️ Продолжить' : '⏸ Пауза'}
                                    </Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={[styles.controlButton, styles.stopButton]}
                                    onPress={handleStopRecording}
                                >
                                    <Text style={[styles.controlButtonText, styles.stopButtonText]}>
                                        ⏹ Готово
                                    </Text>
                                </TouchableOpacity>
                            </>
                        )}
                    </View>

                    {/* Cancel Button */}
                    <TouchableOpacity
                        style={styles.cancelButton}
                        onPress={handleCancel}
                    >
                        <Text style={styles.cancelButtonText}>Отмена</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    container: {
        backgroundColor: colors.surface,
        borderRadius: 24,
        padding: spacing.xl,
        width: '90%',
        maxWidth: 400,
        alignItems: 'center',
    },
    title: {
        ...typography.h2,
        fontSize: 24,
        marginBottom: spacing.l,
    },
    timer: {
        ...typography.h1,
        fontSize: 48,
        fontWeight: '300',
        color: colors.primary,
        marginBottom: spacing.s,
    },
    maxDuration: {
        ...typography.caption,
        color: colors.textMuted,
        marginBottom: spacing.xl,
    },
    recordButtonContainer: {
        marginVertical: spacing.xl,
        alignItems: 'center',
        justifyContent: 'center',
        height: 120,
    },
    startButton: {
        width: 100,
        height: 100,
        borderRadius: 50,
        backgroundColor: colors.primary,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: colors.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 8,
    },
    micIcon: {
        fontSize: 48,
    },
    recordingButton: {
        width: 100,
        height: 100,
        borderRadius: 50,
        backgroundColor: '#ef4444',
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#ef4444',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.4,
        shadowRadius: 12,
        elevation: 8,
    },
    recordingIndicator: {
        width: 24,
        height: 24,
        borderRadius: 4,
        backgroundColor: colors.background,
    },
    status: {
        ...typography.body,
        color: colors.primary,
        marginBottom: spacing.l,
        fontSize: 16,
    },
    controls: {
        flexDirection: 'row',
        gap: spacing.m,
        marginBottom: spacing.l,
    },
    controlButton: {
        paddingHorizontal: spacing.l,
        paddingVertical: spacing.m,
        borderRadius: 8,
        minWidth: 120,
        alignItems: 'center',
    },
    pauseButton: {
        backgroundColor: colors.border,
    },
    stopButton: {
        backgroundColor: colors.primary,
    },
    controlButtonText: {
        ...typography.button,
        color: colors.background,
    },
    stopButtonText: {
        color: colors.background,
    },
    cancelButton: {
        paddingVertical: spacing.m,
        paddingHorizontal: spacing.l,
    },
    cancelButtonText: {
        ...typography.button,
        color: colors.textMuted,
    },
});
