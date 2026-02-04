import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ActivityIndicator,
} from 'react-native';
import { Audio } from 'expo-av';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

interface AudioPlayerProps {
    audioUri: string;
    duration: number; // in seconds
    onClose?: () => void;
    hasTranscription?: boolean; // Whether this recording has transcription
    onDelete?: () => void;
}

import { AudioService } from '../services/AudioService';

export const AudioPlayer: React.FC<AudioPlayerProps> = ({ audioUri, duration, onClose, hasTranscription = true, onDelete }) => {
    const [sound, setSound] = useState<Audio.Sound | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [position, setPosition] = useState(0);
    const [audioDuration, setAudioDuration] = useState(duration); // Local state for duration
    const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
    const [isLoading, setIsLoading] = useState(false);
    const [playableUri, setPlayableUri] = useState<string | null>(null);

    useEffect(() => {
        return sound
            ? () => {
                sound.unloadAsync();
            }
            : undefined;
    }, [sound]);

    // Resolve persistent/encrypted URI to playable temp URI
    useEffect(() => {
        let isMounted = true;
        const resolveUri = async () => {
            if (!audioUri) return;

            // If it's already a temp/cache file or web, use as is
            if (audioUri.includes('cache') || audioUri.includes('temp') || audioUri.startsWith('blob:')) {
                setPlayableUri(audioUri);
                return;
            }

            // Assume it's a persistent encrypted file
            try {
                const tempUri = await AudioService.readAudioFile(audioUri);
                if (isMounted) setPlayableUri(tempUri);
            } catch (error: any) {
                // If file is missing (e.g. deleted), don't show scary warning
                if (error?.message?.includes('ENOENT') || error?.code === 'ENOENT') {
                    console.log('Audio file missing (likely deleted):', audioUri);
                } else {
                    console.warn('Failed to resolve audio URI:', error);
                }
                // Fallback to original
                if (isMounted) setPlayableUri(audioUri);
            }
        };
        resolveUri();
        return () => { isMounted = false; };
    }, [audioUri]);

    // Automatically check duration if it's 0 (unknown)
    useEffect(() => {
        let isMounted = true;

        const checkDuration = async () => {
            if (audioDuration === 0 && playableUri) {
                try {
                    const { sound: tempSound, status } = await Audio.Sound.createAsync(
                        { uri: playableUri },
                        { shouldPlay: false }
                    );

                    if (isMounted && status.isLoaded && status.durationMillis) {
                        setAudioDuration(status.durationMillis / 1000);
                    }

                    await tempSound.unloadAsync();
                } catch (error: any) {
                    if (error?.message?.includes('ENOENT') || error?.code === 'ENOENT') {
                        console.log('Audio file missing for duration check:', playableUri);
                        setIsMissing(true);
                        if (onDelete) onDelete();
                    } else {
                        console.log('Error checking audio duration:', error);
                    }
                }
            }
        };

        checkDuration();

        return () => { isMounted = false; };
    }, [playableUri]); // Depend on playableUri

    const [isMissing, setIsMissing] = useState(false);

    const loadAndPlaySound = async () => {
        if (!playableUri) return;
        setIsLoading(true);
        setIsMissing(false);
        try {
            const { sound: newSound } = await Audio.Sound.createAsync(
                { uri: playableUri },
                { shouldPlay: true, rate: playbackSpeed },
                onPlaybackStatusUpdate
            );
            setSound(newSound);
            setIsPlaying(true);
        } catch (error: any) {
            if (error?.message?.includes('ENOENT') || error?.code === 'ENOENT') {
                console.log('Audio file missing for playback:', playableUri);
                setIsMissing(true);
                // Optionally auto-delete if onDelete is safe to call?
                // For now, we will render a "Missing" state.
                if (onDelete) onDelete(); // Auto-remove from view if delete handler provided? 
                // The user requested: "if note has no audio then do not display it".
                // Calling onDelete() here effectively removes it from the parent list/content if the parent handles it.
            } else {
                console.error('Error playing sound:', error);
            }
        } finally {
            setIsLoading(false);
        }
    };

    const onPlaybackStatusUpdate = (status: any) => {
        if (status.isLoaded) {
            setPosition(status.positionMillis / 1000);

            // Update duration if we didn't know it initially
            if (status.durationMillis && audioDuration === 0) {
                setAudioDuration(status.durationMillis / 1000);
            }

            if (status.didJustFinish) {
                setIsPlaying(false);
                setPosition(0);
                sound?.setPositionAsync(0); // Reset position for replay
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

    const cyclePlaybackSpeed = async () => {
        const speeds = [1.0, 1.5, 2.0];
        const currentIndex = speeds.indexOf(playbackSpeed);
        const nextSpeed = speeds[(currentIndex + 1) % speeds.length];
        setPlaybackSpeed(nextSpeed);

        if (sound) {
            await sound.setRateAsync(nextSpeed, true);
        }
    };

    const formatTime = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const [progressBarWidth, setProgressBarWidth] = useState(0);

    const handleSeek = async (event: any) => {
        if (!sound || audioDuration <= 0 || progressBarWidth <= 0) return;

        const { locationX } = event.nativeEvent;
        const percentage = Math.max(0, Math.min(1, locationX / progressBarWidth));
        const seekPosition = percentage * audioDuration;

        setPosition(seekPosition);
        await sound.setPositionAsync(seekPosition * 1000);
    };

    const progress = audioDuration > 0 ? (position / audioDuration) * 100 : 0;

    if (isMissing) return null;

    return (
        <View style={styles.container}>
            <View style={styles.row}>
                <TouchableOpacity
                    style={styles.playButton}
                    onPress={handlePlayPause}
                    disabled={isLoading}
                >
                    {isLoading ? (
                        <ActivityIndicator size="small" color={colors.background} />
                    ) : (
                        <MaterialIcons
                            name={isPlaying ? "pause" : "play-arrow"}
                            size={20} // Smaller size
                            color={colors.background}
                        />
                    )}
                </TouchableOpacity>

                <View style={styles.progressContainer}>
                    <TouchableOpacity
                        activeOpacity={1}
                        onPress={handleSeek}
                        onLayout={(e) => setProgressBarWidth(e.nativeEvent.layout.width)}
                        style={{ height: 30, justifyContent: 'center' }} // Taller touch area
                    >
                        <View style={styles.progressBarBackground}>
                            <View style={[styles.progressBarFill, { width: `${progress}%` }]} />
                        </View>
                    </TouchableOpacity>
                    <Text style={styles.timeText}>
                        {formatTime(position)} / {formatTime(audioDuration)}
                    </Text>
                </View>

                <TouchableOpacity
                    style={styles.speedButton}
                    onPress={cyclePlaybackSpeed}
                >
                    <Text style={styles.speedText}>{playbackSpeed}x</Text>
                </TouchableOpacity>

                {onDelete && (
                    <TouchableOpacity onPress={onDelete} style={styles.closeButton}>
                        <MaterialIcons name="close" size={18} color={colors.textMuted} />
                    </TouchableOpacity>
                )}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        backgroundColor: colors.surface,
        borderRadius: 12, // Reduced radius
        padding: spacing.xs, // Reduced padding
        marginVertical: 4, // Reduced margin
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1,
        borderWidth: 1,
        borderColor: colors.border,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs, // Reduced gap
    },
    playButton: {
        width: 32, // Smaller button
        height: 32,
        borderRadius: 16,
        backgroundColor: colors.text,
        justifyContent: 'center',
        alignItems: 'center',
    },
    progressContainer: {
        flex: 1,
        justifyContent: 'center',
    },
    progressBarBackground: {
        height: 4,
        backgroundColor: colors.border,
        borderRadius: 2,
        overflow: 'hidden',
        marginBottom: 2, // Reduced margin
    },
    progressBarFill: {
        height: '100%',
        backgroundColor: colors.primary,
    },
    timeText: {
        ...typography.caption,
        fontSize: 9, // Smaller font
        color: colors.textMuted,
    },
    speedButton: {
        paddingHorizontal: 6, // Reduced padding
        paddingVertical: 2,
        backgroundColor: colors.background,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
    },
    speedText: {
        fontSize: 10, // Smaller font
        fontWeight: '600',
        color: colors.text,
    },
    closeButton: {
        padding: 4,
    },
});
