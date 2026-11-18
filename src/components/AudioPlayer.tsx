import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
    View,
    Text,
    TouchableOpacity,
    ActivityIndicator,
} from 'react-native';
import { Sound } from '../services/audioPlayback';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import {
    AUDIO_PREVIEW_ACCENT_SOFT,
    AUDIO_PREVIEW_VIEWBOX_HEIGHT,
    AUDIO_PREVIEW_VIEWBOX_WIDTH,
    AUDIO_PREVIEW_SPEED_BACKGROUND,
    AUDIO_PREVIEW_SPEED_BORDER,
    AUDIO_PREVIEW_TRACK,
    AUDIO_PREVIEW_WAVE_HEIGHTS,
    AUDIO_PREVIEW_WAVE_IDLE,
    AUDIO_PREVIEW_WAVE_LOADING,
} from '../utils/audioEmbeds';

interface AudioPlayerProps {
    audioUri: string;
    duration: number; // in seconds
    onClose?: () => void;
    hasTranscription?: boolean; // Whether this recording has transcription
    onDelete?: () => void;
    autoPlay?: boolean;
}

import { AudioService } from '../services/AudioService';
import { createStyles } from '../theme/createStyles';

export const AudioPlayer: React.FC<AudioPlayerProps> = ({ audioUri, duration, onClose, onDelete, autoPlay = false }) => {
    const { t } = useTranslation();
    const [sound, setSound] = useState<Sound | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [position, setPosition] = useState(0);
    const [audioDuration, setAudioDuration] = useState(duration); // Local state for duration
    const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);

    useEffect(() => {
        let closed = false;
        let player: Sound | undefined;
        let ownedUri: string | undefined;

        // Closing while decryption or native loading is pending must never
        // start playback afterwards. Each preview owns just its decrypted copy.
        const prepare = async () => {
            const uri = await AudioService.readAudioFile(audioUri, 'preview');
            if (uri !== audioUri) ownedUri = uri;
            if (closed) return;
            const result = await Sound.createAsync({ uri }, {}, status => {
                if (closed || !status.isLoaded) return;
                if (status.durationMillis) setAudioDuration(status.durationMillis / 1000);
                setPosition((status.didJustFinish ? status.durationMillis ?? status.positionMillis : status.positionMillis) / 1000);
                setIsPlaying(status.isPlaying && !status.didJustFinish);
            });
            player = result.sound;
            if (closed) return;
            if (result.status.durationMillis) setAudioDuration(result.status.durationMillis / 1000);
            setSound(player);
            if (autoPlay) await player.playAsync();
        };
        setSound(null);
        setPosition(0);
        setPlaybackSpeed(1);
        setIsPlaying(false);
        setLoadError(false);
        setIsLoading(true);
        const ready = prepare().catch(() => {
            if (!closed) setLoadError(true);
        }).finally(() => {
            if (!closed) setIsLoading(false);
        });

        return () => {
            closed = true;
            void ready.then(async () => {
                await player?.unloadAsync();
                if (ownedUri) await AudioService.deleteAudioFile(ownedUri);
            }).catch(error => console.warn('Could not release audio preview:', error));
        };
    }, [audioUri, autoPlay]);

    const handlePlayPause = async () => {
        if (!sound) return;
        if (isPlaying) {
            await sound.pauseAsync();
        } else {
            if (audioDuration > 0 && position >= Math.max(0, audioDuration - 0.25)) {
                await sound.setPositionAsync(0);
            }
            await sound.playAsync();
        }
    };

    const cyclePlaybackSpeed = async () => {
        if (!sound) return;
        const speeds = [1, 1.5, 2];
        const nextSpeed = speeds[(speeds.indexOf(playbackSpeed) + 1) % speeds.length];
        await sound.setRateAsync(nextSpeed, true);
        setPlaybackSpeed(nextSpeed);
    };

    const formatTime = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const [progressBarWidth, setProgressBarWidth] = useState(0);
    const [playerWidth, setPlayerWidth] = useState(0);

    const handleSeek = async (event: any) => {
        if (!sound || audioDuration <= 0 || progressBarWidth <= 0) return;

        const { locationX } = event.nativeEvent;
        const percentage = Math.max(0, Math.min(1, locationX / progressBarWidth));
        const seekPosition = percentage * audioDuration;

        setPosition(seekPosition);
        await sound.setPositionAsync(seekPosition * 1000);
    };

    const progressRatio = audioDuration > 0 ? Math.max(0, Math.min(1, position / audioDuration)) : 0;
    const progress = progressRatio * 100;
    const remaining = Math.max(0, audioDuration - position);
    const playedWaveCount = Math.max(
        0,
        Math.min(AUDIO_PREVIEW_WAVE_HEIGHTS.length, Math.round(AUDIO_PREVIEW_WAVE_HEIGHTS.length * progressRatio))
    );
    const handleClose = onClose || onDelete;
    const effectiveWidth = playerWidth > 0 ? playerWidth : 320;
    const scale = effectiveWidth / AUDIO_PREVIEW_VIEWBOX_WIDTH;
    const scaled = (value: number, min: number) => Math.max(min, Math.round(value * scale));
    const cardPaddingHorizontal = scaled(18, 8);
    const cardPaddingVertical = scaled(18, 8);
    const playButtonOuterSize = scaled(104, 48);
    const playButtonInnerSize = scaled(88, 40);
    const playIconSize = scaled(46, 22);
    const waveformHeight = scaled(44, 18);
    const waveBarWidth = scaled(10, 4);
    const waveBarGap = scaled(6, 2);
    const progressKnobSize = scaled(18, 10);
    const progressHeight = scaled(8, 4);
    const progressTouchAreaHeight = scaled(28, 16);
    const speedButtonHeight = scaled(42, 24);
    const speedButtonMinWidth = scaled(104, 60);
    const speedButtonRadius = Math.round(speedButtonHeight / 2);
    const timeFontSize = scaled(22, 12);
    const speedFontSize = scaled(18, 11);
    const closeButtonSize = scaled(32, 20);
    const closeIconSize = scaled(18, 12);
    const contentRightPadding = handleClose ? scaled(44, 24) : 0;
    const horizontalGap = scaled(16, 8);
    const progressToSpeedGap = scaled(8, 4);
    const rowSpacing = scaled(10, 4);
    const progressKnobOffset = progressBarWidth > 0
        ? Math.max(
            0,
            Math.min(
                progressBarWidth - progressKnobSize,
                progressBarWidth * progressRatio - progressKnobSize / 2
            )
        )
        : 0;



    return (
        <View
            style={[
                styles.container,
                {
                    aspectRatio: AUDIO_PREVIEW_VIEWBOX_WIDTH / AUDIO_PREVIEW_VIEWBOX_HEIGHT,
                    borderRadius: scaled(28, 14),
                    paddingVertical: cardPaddingVertical,
                    paddingHorizontal: cardPaddingHorizontal,
                },
            ]}
            onLayout={(event) => {
                const nextWidth = event.nativeEvent.layout.width;
                if (nextWidth > 0 && Math.abs(nextWidth - playerWidth) > 1) {
                    setPlayerWidth(nextWidth);
                }
            }}
        >
            {handleClose && (
                <TouchableOpacity
                    onPress={handleClose}
                    accessibilityRole="button"
                    accessibilityLabel={onClose ? t('a11y.close', 'Close') : t('a11y.deleteRecording', 'Delete recording')}
                    style={[
                        styles.closeButton,
                        {
                            top: scaled(12, 6),
                            right: scaled(12, 6),
                            width: closeButtonSize,
                            height: closeButtonSize,
                            borderRadius: Math.round(closeButtonSize / 2),
                        },
                    ]}
                >
                    <MaterialIcons name="close" size={closeIconSize} color={colors.textSecondary} />
                </TouchableOpacity>
            )}

            {loadError ? (
                <Text accessibilityRole="alert" style={[styles.timeText, { paddingRight: contentRightPadding }]}>{t('edit.toast.audioUnavailable', 'Could not play this recording')}</Text>
            ) : <View style={styles.body}>
                <TouchableOpacity
                    style={[
                        styles.playButtonOuter,
                        {
                            width: playButtonOuterSize,
                            height: playButtonOuterSize,
                            borderRadius: Math.round(playButtonOuterSize / 2),
                            marginRight: horizontalGap,
                        },
                    ]}
                    onPress={handlePlayPause}
                    disabled={isLoading}
                    accessibilityRole="button"
                    accessibilityLabel={isPlaying ? t('a11y.pause', 'Pause') : t('a11y.play', 'Play')}
                    activeOpacity={0.88}
                >
                    <View
                        style={[
                            styles.playButtonInner,
                            {
                                width: playButtonInnerSize,
                                height: playButtonInnerSize,
                                borderRadius: Math.round(playButtonInnerSize / 2),
                            },
                        ]}
                    >
                        {isLoading ? (
                            <ActivityIndicator size="small" color={colors.onPrimary} />
                        ) : (
                            <MaterialIcons
                                name={isPlaying ? "pause" : "play-arrow"}
                                size={playIconSize}
                                color={colors.onPrimary}
                            />
                        )}
                    </View>
                </TouchableOpacity>

                <View style={[styles.content, { paddingRight: contentRightPadding }]}>
                    <View style={styles.contentBody}>
                        <View style={styles.mainColumn}>
                            <TouchableOpacity
                                activeOpacity={1}
                                onPress={handleSeek}
                                accessibilityLabel={t('a11y.playbackPosition', 'Playback position')}
                                onLayout={(e) => setProgressBarWidth(e.nativeEvent.layout.width)}
                            >
                                <View pointerEvents="none" style={[styles.waveformRow, { height: waveformHeight, marginBottom: rowSpacing }]}>
                                    {AUDIO_PREVIEW_WAVE_HEIGHTS.map((height, index) => (
                                        <View
                                            key={`${height}-${index}`}
                                            style={[
                                                styles.waveBar,
                                                {
                                                    width: waveBarWidth,
                                                    height: scaled(height, 6),
                                                    borderRadius: Math.round(waveBarWidth / 2),
                                                    marginRight: index === AUDIO_PREVIEW_WAVE_HEIGHTS.length - 1 ? 0 : waveBarGap,
                                                    backgroundColor: isLoading
                                                        ? AUDIO_PREVIEW_WAVE_LOADING
                                                        : (index < playedWaveCount ? colors.primary : AUDIO_PREVIEW_WAVE_IDLE),
                                                },
                                            ]}
                                        />
                                    ))}
                                </View>

                                <View pointerEvents="none" style={[styles.progressTouchArea, { height: progressTouchAreaHeight, marginBottom: rowSpacing }]}>
                                    <View pointerEvents="none" style={[styles.progressBarBackground, { height: progressHeight, borderRadius: Math.round(progressHeight / 2) }]}>
                                        <View style={[styles.progressBarFill, { width: `${progress}%` }]} />
                                        <View
                                            style={[
                                                styles.progressKnob,
                                                {
                                                    left: progressKnobOffset,
                                                    top: -(progressKnobSize - progressHeight) / 2,
                                                    width: progressKnobSize,
                                                    height: progressKnobSize,
                                                    borderRadius: Math.round(progressKnobSize / 2),
                                                    borderWidth: Math.max(2, scaled(4, 2)),
                                                },
                                            ]}
                                        />
                                    </View>
                                </View>
                            </TouchableOpacity>

                            <View style={styles.timeRow}>
                                <Text style={[styles.timeText, { fontSize: timeFontSize }]}>{formatTime(position)}</Text>
                                <Text style={[styles.timeText, { fontSize: timeFontSize }]}>−{formatTime(remaining)}</Text>
                            </View>
                        </View>

                        <TouchableOpacity
                            style={[
                                styles.speedButton,
                                {
                                    minWidth: speedButtonMinWidth,
                                    height: speedButtonHeight,
                                    borderRadius: speedButtonRadius,
                                    marginLeft: progressToSpeedGap,
                                    paddingHorizontal: scaled(18, 8),
                                },
                            ]}
                            accessibilityRole="button"
                            hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
                            onPress={cyclePlaybackSpeed}
                            activeOpacity={0.88}
                        >
                            <Text style={[styles.speedText, { fontSize: speedFontSize }]}>{playbackSpeed}x</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>}
        </View>
    );
};

const styles = createStyles(() => ({
    container: {
        width: '100%',
        alignSelf: 'stretch',
        backgroundColor: colors.surface,
        borderRadius: 28,
        paddingVertical: 18,
        paddingHorizontal: 18,
        marginVertical: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.06,
        shadowRadius: 18,
        elevation: 3,
        borderWidth: 1,
        borderColor: colors.border,
    },
    body: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    content: {
        flex: 1,
    },
    contentBody: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    mainColumn: {
        flex: 1,
        minWidth: 0,
    },
    playButtonOuter: {
        backgroundColor: AUDIO_PREVIEW_ACCENT_SOFT,
        alignItems: 'center',
        justifyContent: 'center',
    },
    playButtonInner: {
        backgroundColor: colors.primary,
        justifyContent: 'center',
        alignItems: 'center',
    },
    waveformRow: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 44,
        marginBottom: 10,
        overflow: 'hidden',
    },
    waveBar: {
        alignSelf: 'center',
    },
    progressTouchArea: {
        justifyContent: 'center',
    },
    progressBarBackground: {
        backgroundColor: AUDIO_PREVIEW_TRACK,
        position: 'relative',
    },
    progressBarFill: {
        height: '100%',
        backgroundColor: colors.primary,
        borderRadius: 999,
    },
    progressKnob: {
        position: 'absolute',
        backgroundColor: colors.surface,
        borderColor: colors.primary,
    },
    timeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    timeText: {
        fontWeight: '600',
        color: colors.textSecondary,
        letterSpacing: -0.1,
    },
    speedButton: {
        backgroundColor: AUDIO_PREVIEW_SPEED_BACKGROUND,
        borderWidth: 1,
        borderColor: AUDIO_PREVIEW_SPEED_BORDER,
        alignItems: 'center',
        justifyContent: 'center',
    },
    speedText: {
        fontWeight: '700',
        color: colors.text,
        letterSpacing: -0.2,
    },
    closeButton: {
        position: 'absolute',
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1,
    },
}));
