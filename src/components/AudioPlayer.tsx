import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
} from 'react-native';
import { Audio } from 'expo-av';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

interface AudioPlayerProps {
    audioUri: string;
    duration: number; // in seconds
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({ audioUri, duration }) => {
    const [sound, setSound] = useState<Audio.Sound | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [position, setPosition] = useState(0);
    const [playbackSpeed, setPlaybackSpeed] = useState(1.0);

    useEffect(() => {
        return sound
            ? () => {
                sound.unloadAsync();
            }
            : undefined;
    }, [sound]);

    const loadAndPlaySound = async () => {
        try {
            const { sound: newSound } = await Audio.Sound.createAsync(
                { uri: audioUri },
                { shouldPlay: true, rate: playbackSpeed },
                onPlaybackStatusUpdate
            );
            setSound(newSound);
            setIsPlaying(true);
        } catch (error) {
            console.error('Error playing sound:', error);
        }
    };

    const onPlaybackStatusUpdate = (status: any) => {
        if (status.isLoaded) {
            setPosition(status.positionMillis / 1000);
            if (status.didJustFinish) {
                setIsPlaying(false);
                setPosition(0);
            }
        }
    };

    const handlePlayPause = async () => {
        if (!sound) {
            await loadAndPlaySound();
        } else {
            if (isPlaying) {
                await sound.pauseAsync();
                setIsPlaying(false);
            } else {
                await sound.playAsync();
                setIsPlaying(true);
            }
        }
    };

    const handleStop = async () => {
        if (sound) {
            await sound.stopAsync();
            setIsPlaying(false);
            setPosition(0);
        }
    };

    const cyclePlaybackSpeed = async () => {
        const speeds = [1.0, 1.5, 2.0];
        const currentIndex = speeds.indexOf(playbackSpeed);
        const nextSpeed = speeds[(currentIndex + 1) % speeds.length];
        setPlaybackSpeed(nextSpeed);

        if (sound && isPlaying) {
            await sound.setRateAsync(nextSpeed, true);
        }
    };

    const formatTime = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const progress = duration > 0 ? (position / duration) * 100 : 0;

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.icon}>🎙️</Text>
                <Text style={styles.label}>Голосовая заметка</Text>
            </View>

            {/* Progress bar */}
            <View style={styles.progressContainer}>
                <View style={styles.progressBar}>
                    <View style={[styles.progressFill, { width: `${progress}%` }]} />
                </View>
                <Text style={styles.time}>
                    {formatTime(position)} / {formatTime(duration)}
                </Text>
            </View>

            {/* Controls */}
            <View style={styles.controls}>
                <TouchableOpacity
                    style={styles.controlButton}
                    onPress={handlePlayPause}
                >
                    <Text style={styles.controlIcon}>
                        {isPlaying ? '⏸' : '▶️'}
                    </Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={styles.controlButton}
                    onPress={handleStop}
                    disabled={!sound}
                >
                    <Text style={[styles.controlIcon, !sound && styles.disabled]}>
                        ⏹
                    </Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={styles.speedButton}
                    onPress={cyclePlaybackSpeed}
                >
                    <Text style={styles.speedText}>{playbackSpeed}x</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        backgroundColor: colors.surface,
        borderRadius: 12,
        padding: spacing.m,
        marginVertical: spacing.m,
        borderWidth: 1,
        borderColor: colors.border,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: spacing.m,
    },
    icon: {
        fontSize: 20,
        marginRight: spacing.s,
    },
    label: {
        ...typography.body,
        fontWeight: '600',
    },
    progressContainer: {
        marginBottom: spacing.m,
    },
    progressBar: {
        height: 4,
        backgroundColor: colors.border,
        borderRadius: 2,
        overflow: 'hidden',
        marginBottom: spacing.s,
    },
    progressFill: {
        height: '100%',
        backgroundColor: colors.primary,
    },
    time: {
        ...typography.caption,
        color: colors.textMuted,
    },
    controls: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.m,
    },
    controlButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: colors.primary,
        justifyContent: 'center',
        alignItems: 'center',
    },
    controlIcon: {
        fontSize: 20,
    },
    disabled: {
        opacity: 0.5,
    },
    speedButton: {
        paddingHorizontal: spacing.m,
        paddingVertical: spacing.s,
        borderRadius: 16,
        backgroundColor: colors.border,
    },
    speedText: {
        ...typography.caption,
        fontWeight: '600',
        color: colors.text,
    },
});
