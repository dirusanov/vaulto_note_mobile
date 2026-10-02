import {
    AudioModule,
    RecordingPresets,
    requestRecordingPermissionsAsync,
    setAudioModeAsync,
    type AudioRecorder,
    type RecorderState,
    type RecordingOptions,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { NativeModules, Platform } from 'react-native';
import { encrypt, decrypt } from '../crypto/encryption';

export const MAX_RECORDING_DURATION_MS = 5 * 60 * 1000; // 5 minutes in milliseconds



/** A meeting may run up to an hour; it is recorded in short segments (see rollSegment). */
export const MAX_MEETING_DURATION_MS = 60 * 60 * 1000;
/** Each meeting segment stays well under what one transcription request handles. */
export const MEETING_SEGMENT_MS = 4.5 * 60 * 1000;

export interface AudioRecording {
    uri: string;
    duration: number; // in seconds
    mimeType: string;
    /** Meeting mode: the recording is a meeting; transcribe per segment, then summarise. */
    meeting?: boolean;
    /** Meeting mode: the short files `uri` was joined from, in order (for transcription). */
    segments?: string[];
}

/**
 * `AudioModule.AudioRecorder` expects the per-platform options already flattened
 * (the same thing expo-audio's `useAudioRecorder` hook does before constructing it).
 */
function flattenRecordingOptions(options: RecordingOptions): Partial<RecordingOptions> {
    const common = {
        extension: options.extension,
        sampleRate: options.sampleRate,
        numberOfChannels: options.numberOfChannels,
        bitRate: options.bitRate,
        isMeteringEnabled: options.isMeteringEnabled ?? false,
    };
    if (Platform.OS === 'ios') {
        return { ...common, ...options.ios };
    }
    if (Platform.OS === 'android') {
        return { ...common, ...options.android };
    }
    return { ...common, ...options.web };
}

class AudioServiceClass {
    private recording: AudioRecorder | null = null;
    private recordingStartTime: number = 0;
    private meteringTimer: ReturnType<typeof setInterval> | null = null;

    private stopMetering(): void {
        if (this.meteringTimer) {
            clearInterval(this.meteringTimer);
            this.meteringTimer = null;
        }
    }

    private async releaseRecorder(recorder: AudioRecorder): Promise<void> {
        this.stopMetering();
        try {
            if (recorder.isRecording) {
                await recorder.stop();
            }
        } catch (error) {
            console.warn('[AudioService] Failed to stop recorder during release:', error);
        }
        try {
            recorder.release();
        } catch {
            // Already released
        }
    }

    private async encryptAudioPayload(payloadBase64: string): Promise<string> {
        return await encrypt(payloadBase64);
    }

    private async decryptAudioPayload(payload: string): Promise<string> {
        return await decrypt(payload);
    }

    private async getAudioDir(): Promise<string> {
        if (Platform.OS === 'web') {
            throw new Error('Audio recording not supported on web');
        }

        // Try to get base directory, with fallback
        // @ts-ignore
        let baseDir = FileSystem.documentDirectory;

        if (!baseDir) {
            // @ts-ignore
            baseDir = FileSystem.cacheDirectory;
        }

        if (!baseDir) {
            // Last resort: use a default path that Expo GO can handle
            // This path will be created by FileSystem when needed
            console.warn('Using fallback audio directory');
            return 'file:///data/user/0/host.exp.exponent/cache/audio/';
        }

        return `${baseDir}audio/`;
    }

    /**
     * Initialize the audio directory
     */
    async init(): Promise<void> {
        if (Platform.OS === 'web') return;
        try {
            const audioDir = await this.getAudioDir();
            const dirInfo = await FileSystem.getInfoAsync(audioDir);
            if (!dirInfo.exists) {
                await FileSystem.makeDirectoryAsync(audioDir, { intermediates: true });
            }
        } catch (error) {
            console.warn('Could not initialize audio directory, will use temp storage:', error);
            // Don't throw - let Recording handle its own temp storage
        }
    }

    /**
     * Request audio recording permissions
     */
    async requestPermissions(): Promise<boolean> {
        if (Platform.OS === 'web') return false;
        try {
            const { granted } = await requestRecordingPermissionsAsync();
            return granted;
        } catch (error) {
            console.error('Error requesting audio permissions:', error);
            return false;
        }
    }

    /**
     * Start recording audio
     */
    /**
     * Start recording audio
     */
    private lastMeteringCallback?: (level: number) => void;
    private lastRecordingMode: 'note' | 'meeting' = 'note';

    async startRecording(
        onMeteringUpdate?: (level: number) => void,
        mode: 'note' | 'meeting' = 'note',
    ): Promise<void> {
        this.lastMeteringCallback = onMeteringUpdate;
        this.lastRecordingMode = mode;
        if (Platform.OS === 'web') {
            alert('Audio recording is not supported in the browser. Please use the mobile app.');
            return;
        }
        try {
            // Request permissions
            const hasPermission = await this.requestPermissions();
            if (!hasPermission) {
                throw new Error('Audio recording permission not granted');
            }

            // Set audio mode for recording
            await setAudioModeAsync({
                allowsRecording: true,
                playsInSilentMode: true,
            });

            console.log('[V3] Creating audio recording...');

            // AAC/m4a, 44.1 kHz stereo @ 128 kbps – identical to the HIGH_QUALITY preset
            // Meetings: mono 64 kbps keeps an hour near 30 MB (speech loses nothing).
            const recordingOptions: RecordingOptions = mode === 'meeting'
                ? {
                    ...RecordingPresets.HIGH_QUALITY,
                    numberOfChannels: 1,
                    bitRate: 64000,
                    android: { ...RecordingPresets.HIGH_QUALITY.android, numberOfChannels: 1, bitRate: 64000 } as any,
                    ios: { ...RecordingPresets.HIGH_QUALITY.ios, numberOfChannels: 1, bitRate: 64000 } as any,
                    isMeteringEnabled: true,
                }
                : {
                    ...RecordingPresets.HIGH_QUALITY,
                    isMeteringEnabled: true,
                };

            // Ensure any existing recording is released before creating a new one
            if (this.recording) {
                console.log('[AudioService] Cleaning up dangling recording instance');
                await this.releaseRecorder(this.recording);
                this.recording = null;
            }

            // Create recording - it will use its own temp storage
            const recording = new AudioModule.AudioRecorder(flattenRecordingOptions(recordingOptions));
            await recording.prepareToRecordAsync();
            recording.record();

            if (onMeteringUpdate) {
                this.meteringTimer = setInterval(() => {
                    try {
                        const status = recording.getStatus();
                        if (status.isRecording && status.metering !== undefined) {
                            onMeteringUpdate(status.metering);
                        }
                    } catch {
                        this.stopMetering();
                    }
                }, 100);
            }

            console.log('[V3] Recording created successfully');
            this.recording = recording;
            this.recordingStartTime = Date.now();
        } catch (error) {
            console.error('Failed to start recording:', error);
            throw error;
        }
    }

    /**
     * Stop recording and return the audio file
     */
    async stopRecording(): Promise<AudioRecording | null> {
        if (Platform.OS === 'web') return null;
        try {
            if (!this.recording) {
                return null;
            }

            const recorder = this.recording;
            this.stopMetering();
            await recorder.stop();
            const uri = recorder.uri;
            recorder.release();

            if (!uri) {
                return null;
            }

            // Calculate duration
            const duration = Math.floor((Date.now() - this.recordingStartTime) / 1000);

            return {
                uri,
                duration,
                mimeType: 'audio/m4a', // AAC audio in M4A container
            };
        } catch (error) {
            console.error('Error stopping recording:', error);
            throw error;
        } finally {
            this.recording = null;
            this.recordingStartTime = 0;
        }
    }

    /**
     * Pause recording
     */
    /**
     * Meeting mode: closes the current segment and continues recording into a
     * new one with the same settings; returns the finished segment's file.
     * The gap is a few milliseconds.
     */
    async rollSegment(): Promise<string | null> {
        if (!this.recording) return null;
        const recorder = this.recording;
        this.stopMetering();
        await recorder.stop();
        const uri = recorder.uri;
        recorder.release();
        this.recording = null;
        const startedAt = this.recordingStartTime;
        await this.startRecording(this.lastMeteringCallback, this.lastRecordingMode);
        // The caller tracks the total length; keep the original start for it.
        this.recordingStartTime = startedAt;
        return uri ?? null;
    }

    /** Joins meeting segments into one .m4a (Android); returns the first file elsewhere. */
    async concatSegments(uris: string[]): Promise<string> {
        if (uris.length === 1) return uris[0];
        const native = NativeModules.AudioConcat as { concatM4a?: (uris: string[]) => Promise<string> } | undefined;
        if (Platform.OS === 'android' && native?.concatM4a) {
            return native.concatM4a(uris);
        }
        throw new Error('Joining audio segments is not supported on this platform yet');
    }

    async pauseRecording(): Promise<void> {
        if (this.recording) {
            this.recording.pause();
        }
    }

    /**
     * Resume recording
     */
    async resumeRecording(): Promise<void> {
        if (this.recording) {
            this.recording.record();
        }
    }

    /**
     * Get current recording status
     */
    async getRecordingStatus(): Promise<RecorderState | null> {
        if (!this.recording) {
            return null;
        }
        return this.recording.getStatus();
    }

    /**
     * Cancel recording and clean up
     */
    async cancelRecording(): Promise<void> {
        if (this.recording) {
            try {
                const recorder = this.recording;
                this.stopMetering();
                await recorder.stop();
                const uri = recorder.uri;
                recorder.release();
                if (uri) {
                    await this.deleteAudioFile(uri);
                }
            } catch (err) {
                console.error('Error cancelling recording:', err);
            } finally {
                this.recording = null;
                this.recordingStartTime = 0;
            }
        }
    }

    /**
     * Save audio file permanently with encryption
     */
    async saveAudioFile(
        tempUri: string,
        shouldDeleteOriginal: boolean = true
    ): Promise<string> {
        if (Platform.OS === 'web') return tempUri;
        try {
            // Generate unique filename
            const filename = `audio_${Date.now()}.m4a`;
            const audioDir = await this.getAudioDir();

            // Ensure directory exists
            const dirInfo = await FileSystem.getInfoAsync(audioDir);
            if (!dirInfo.exists) {
                await FileSystem.makeDirectoryAsync(audioDir, { intermediates: true });
            }

            const targetUri = `${audioDir}${filename}`;

            // Read the audio file
            const audioData = await FileSystem.readAsStringAsync(tempUri, {
                encoding: 'base64',
            });

            // Encrypt the audio data
            const encryptedData = await this.encryptAudioPayload(audioData);

            // Save encrypted data
            await FileSystem.writeAsStringAsync(targetUri, encryptedData, {
                encoding: 'utf8',
            });

            // Delete temp file if requested
            if (shouldDeleteOriginal) {
                await FileSystem.deleteAsync(tempUri, { idempotent: true });
            }

            return targetUri;
        } catch (error) {
            console.error('Error saving audio file:', error);
            throw error;
        }
    }

    /**
     * Read and decrypt audio file
     */
    async readAudioFile(uri: string, tempPrefix: string = 'temp'): Promise<string> {
        if (Platform.OS === 'web') return uri;
        try {
            // Robust path handling for Android absolute paths
            let sourceUri = uri;
            if (Platform.OS === 'android' && sourceUri.startsWith('/') && !sourceUri.startsWith('file://')) {
                sourceUri = `file://${sourceUri}`;
            }

            // Read encrypted data
            const encryptedData = await FileSystem.readAsStringAsync(sourceUri, {
                encoding: 'utf8',
            });

            // Decrypt
            const decryptedData = await this.decryptAudioPayload(encryptedData);

            // Create temp file for playback
            // @ts-ignore
            const cacheDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
            if (!cacheDir) {
                throw new Error('No cache directory available for audio playback');
            }
            const sanitizedPrefix = (tempPrefix || 'temp').replace(/[^a-z0-9_-]/gi, '') || 'temp';
            const tempUri = `${cacheDir}${sanitizedPrefix}_${Date.now()}.m4a`;
            await FileSystem.writeAsStringAsync(tempUri, decryptedData, {
                encoding: 'base64',
            });


            return tempUri;
        } catch (error: any) {
            // Suppress RedBox for file not found errors
            if (error?.message?.includes('ENOENT') || error?.code === 'ENOENT' || error?.message?.includes('No such file')) {
                console.log('[AudioService] File not found (likely deleted):', uri);
            } else {
                console.error('Error reading audio file:', error);
            }
            throw error;
        }
    }

    /**
     * Read a locally stored (encrypted) audio file and return the plaintext
     * audio as base64. Used by the sync engine to prepare uploads.
     */
    async readAudioBase64(uri: string): Promise<string> {
        if (Platform.OS === 'web') throw new Error('Audio sync not supported on web');
        let sourceUri = uri;
        if (Platform.OS === 'android' && sourceUri.startsWith('/') && !sourceUri.startsWith('file://')) {
            sourceUri = `file://${sourceUri}`;
        }
        const encryptedData = await FileSystem.readAsStringAsync(sourceUri, { encoding: 'utf8' });
        return await this.decryptAudioPayload(encryptedData);
    }

    /**
     * Persist plaintext audio (base64) as a new encrypted local audio file and
     * return its path. Used by the sync engine after downloading a blob.
     */
    async writeAudioBase64(plainBase64: string): Promise<string> {
        if (Platform.OS === 'web') throw new Error('Audio sync not supported on web');
        const filename = `audio_${Date.now()}.m4a`;
        const audioDir = await this.getAudioDir();
        const dirInfo = await FileSystem.getInfoAsync(audioDir);
        if (!dirInfo.exists) {
            await FileSystem.makeDirectoryAsync(audioDir, { intermediates: true });
        }
        const targetUri = `${audioDir}${filename}`;
        const encryptedData = await this.encryptAudioPayload(plainBase64);
        await FileSystem.writeAsStringAsync(targetUri, encryptedData, { encoding: 'utf8' });
        return targetUri;
    }

    async reencryptAudioFile(uri: string): Promise<void> {
        if (Platform.OS === 'web') return;
        const encryptedData = await FileSystem.readAsStringAsync(uri, {
            encoding: 'utf8',
        });
        const decryptedData = await this.decryptAudioPayload(encryptedData);
        const reencrypted = await this.encryptAudioPayload(decryptedData);
        await FileSystem.writeAsStringAsync(uri, reencrypted, {
            encoding: 'utf8',
        });
    }

    /**
     * Delete audio file
     */
    async deleteAudioFile(uri: string): Promise<void> {
        if (Platform.OS === 'web') return;
        try {
            const fileInfo = await FileSystem.getInfoAsync(uri);
            if (fileInfo.exists) {
                await FileSystem.deleteAsync(uri);
            }
        } catch (error) {
            console.error('Error deleting audio file:', error);
            throw error;
        }
    }

    /**
     * Get audio file size in bytes
     */
    async getFileSize(uri: string): Promise<number> {
        if (Platform.OS === 'web') return 0;
        try {
            const fileInfo = await FileSystem.getInfoAsync(uri);
            return fileInfo.exists && 'size' in fileInfo ? fileInfo.size : 0;
        } catch (error) {
            console.error('Error getting file size:', error);
            return 0;
        }
    }

    /**
     * Clean up old temporary files
     */
    async cleanupTempFiles(prefixes: string[] = ['temp']): Promise<void> {
        if (Platform.OS === 'web') return;
        try {
            // @ts-ignore
            const cacheDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
            if (!cacheDir) return;

            const files = await FileSystem.readDirectoryAsync(cacheDir);
            const normalizedPrefixes = prefixes
                .map((prefix) => (prefix || '').replace(/[^a-z0-9_-]/gi, ''))
                .filter(Boolean);
            const tempAudioFiles = files.filter((file) => (
                file.endsWith('.m4a')
                && normalizedPrefixes.some((prefix) => file.startsWith(`${prefix}_`))
            ));

            for (const file of tempAudioFiles) {
                const uri = `${cacheDir}${file}`;
                await FileSystem.deleteAsync(uri, { idempotent: true });
            }
        } catch (error) {
            console.error('Error cleaning up temp files:', error);
        }
    }
}

export const AudioService = new AudioServiceClass();
