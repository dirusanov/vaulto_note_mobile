import { createAudioPlayer, type AudioPlayer, type AudioStatus } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * Thin `expo-av`-style `Sound` wrapper over `expo-audio`'s `AudioPlayer`.
 *
 * `expo-av` was removed in Expo SDK 55; this keeps the async, millisecond-based
 * API the players in this app were written against so they don't need to be
 * rewritten around expo-audio's hook-first, seconds-based API.
 */

export interface PlaybackStatus {
    isLoaded: boolean;
    isPlaying: boolean;
    positionMillis: number;
    durationMillis?: number;
    didJustFinish: boolean;
}

export type PlaybackStatusListener = (status: PlaybackStatus) => void;

export interface SoundCreateOptions {
    shouldPlay?: boolean;
    rate?: number;
    progressUpdateIntervalMillis?: number;
}

const LOAD_TIMEOUT_MS = 5000;
const DURATION_GRACE_MS = 1000;

function toPlaybackStatus(status: AudioStatus): PlaybackStatus {
    const durationMillis = Number.isFinite(status.duration) && status.duration > 0
        ? Math.round(status.duration * 1000)
        : undefined;
    return {
        isLoaded: !!status.isLoaded,
        isPlaying: !!status.playing,
        positionMillis: Number.isFinite(status.currentTime) ? Math.max(0, status.currentTime * 1000) : 0,
        durationMillis,
        didJustFinish: !!status.didJustFinish,
    };
}

async function assertFileExists(uri: string): Promise<void> {
    if (!uri.startsWith('file://') && !uri.startsWith('/')) {
        return;
    }
    try {
        const info = await FileSystem.getInfoAsync(uri);
        if (info.exists) {
            return;
        }
    } catch {
        // If the check itself fails, let the player surface the real error.
        return;
    }
    const error = new Error(`ENOENT: audio file not found: ${uri}`) as Error & { code?: string };
    error.code = 'ENOENT';
    throw error;
}

export class Sound {
    private player: AudioPlayer;
    private subscription: { remove(): void } | null = null;
    private released = false;
    private lastStatus: PlaybackStatus = {
        isLoaded: false,
        isPlaying: false,
        positionMillis: 0,
        didJustFinish: false,
    };

    private constructor(player: AudioPlayer, onStatusUpdate?: PlaybackStatusListener) {
        this.player = player;
        this.subscription = player.addListener('playbackStatusUpdate', (status: AudioStatus) => {
            this.lastStatus = toPlaybackStatus(status);
            onStatusUpdate?.(this.lastStatus);
        });
    }

    static async createAsync(
        source: { uri: string },
        options: SoundCreateOptions = {},
        onStatusUpdate?: PlaybackStatusListener
    ): Promise<{ sound: Sound; status: PlaybackStatus }> {
        await assertFileExists(source.uri);

        const player = createAudioPlayer(
            { uri: source.uri },
            { updateInterval: options.progressUpdateIntervalMillis ?? 100 }
        );
        const sound = new Sound(player, onStatusUpdate);

        try {
            const status = await sound.waitForLoad();
            if (options.rate && options.rate !== 1) {
                player.setPlaybackRate(options.rate, 'high');
            }
            if (options.shouldPlay) {
                player.play();
            }
            return { sound, status };
        } catch (error) {
            await sound.unloadAsync();
            throw error;
        }
    }

    private waitForLoad(): Promise<PlaybackStatus> {
        return new Promise((resolve) => {
            let settled = false;
            let durationTimer: ReturnType<typeof setTimeout> | null = null;

            const finish = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                if (durationTimer) clearTimeout(durationTimer);
                probe.remove();
                resolve(this.getStatusSync());
            };

            const check = () => {
                const status = this.getStatusSync();
                if (!status.isLoaded) return;
                if (status.durationMillis) {
                    finish();
                } else if (!durationTimer) {
                    // Loaded, but duration not reported yet – give it a moment.
                    durationTimer = setTimeout(finish, DURATION_GRACE_MS);
                }
            };

            const probe = this.player.addListener('playbackStatusUpdate', check);
            const timeout = setTimeout(finish, LOAD_TIMEOUT_MS);
            check();
        });
    }

    private getStatusSync(): PlaybackStatus {
        if (this.released) {
            return { ...this.lastStatus, isLoaded: false, isPlaying: false };
        }
        try {
            const current = this.player.currentStatus;
            if (current) {
                this.lastStatus = toPlaybackStatus(current);
            }
        } catch {
            // Player already gone; fall back to last known status.
        }
        return this.lastStatus;
    }

    async getStatusAsync(): Promise<PlaybackStatus> {
        return this.getStatusSync();
    }

    async playAsync(): Promise<void> {
        if (this.released) return;
        this.player.play();
    }

    async pauseAsync(): Promise<void> {
        if (this.released) return;
        this.player.pause();
    }

    async setPositionAsync(positionMillis: number): Promise<void> {
        if (this.released) return;
        await this.player.seekTo(Math.max(0, positionMillis) / 1000);
    }

    async setRateAsync(rate: number, shouldCorrectPitch: boolean = true): Promise<void> {
        if (this.released) return;
        this.player.setPlaybackRate(rate, shouldCorrectPitch ? 'high' : undefined);
    }

    async unloadAsync(): Promise<void> {
        if (this.released) return;
        this.released = true;
        this.subscription?.remove();
        this.subscription = null;
        try {
            this.player.pause();
        } catch {
            // ignore – player may already be released
        }
        try {
            this.player.remove();
        } catch {
            // ignore
        }
    }
}
