import { Audio } from 'expo-av';
// Use legacy API for stable, typed access to document/cache directories and read/write helpers
import * as FileSystem from 'expo-file-system/legacy';
import { encrypt, decrypt } from '../crypto/encryption';

const MAX_DURATION_MS = 5 * 60 * 1000; // 5 minutes in milliseconds

export interface AudioRecording {
    uri: string;
    duration: number; // in seconds
    mimeType: string;
}

class AudioServiceClass {
    private recording: Audio.Recording | null = null;
    private recordingStartTime: number = 0;
    private getAudioDir(): string {
        const baseDir = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
        if (!baseDir) {
            throw new Error('File system unavailable for audio recording');
        }
        return `${baseDir}audio/`;
    }

    /**
     * Initialize the audio directory
     */
    async init(): Promise<void> {
        const audioDir = this.getAudioDir();
        const dirInfo = await FileSystem.getInfoAsync(audioDir);
        if (!dirInfo.exists) {
            await FileSystem.makeDirectoryAsync(audioDir, { intermediates: true });
        }
    }

    /**
     * Request audio recording permissions
     */
    async requestPermissions(): Promise<boolean> {
        try {
            const { status } = await Audio.requestPermissionsAsync();
            return status === 'granted';
        } catch (error) {
            console.error('Error requesting audio permissions:', error);
            return false;
        }
    }

    /**
     * Start recording audio
     */
    async startRecording(): Promise<void> {
        try {
            // Initialize audio directory
            await this.init();

            // Request permissions
            const hasPermission = await this.requestPermissions();
            if (!hasPermission) {
                throw new Error('Audio recording permission not granted');
            }

            // Set audio mode for recording
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: true,
                playsInSilentModeIOS: true,
            });

            // Create recording
            const { recording } = await Audio.Recording.createAsync(
                Audio.RecordingOptionsPresets.HighQuality
            );

            this.recording = recording;
            this.recordingStartTime = Date.now();

            // Set up duration limit
            setTimeout(async () => {
                if (this.recording) {
                    await this.stopRecording();
                }
            }, MAX_DURATION_MS);
        } catch (error) {
            console.error('Failed to start recording:', error);
            throw error;
        }
    }

    /**
     * Stop recording and return the audio file
     */
    async stopRecording(): Promise<AudioRecording | null> {
        try {
            if (!this.recording) {
                return null;
            }

            await this.recording.stopAndUnloadAsync();
            const uri = this.recording.getURI();

            if (!uri) {
                return null;
            }

            // Calculate duration
            const duration = Math.floor((Date.now() - this.recordingStartTime) / 1000);

            // Get file info
            const fileInfo = await FileSystem.getInfoAsync(uri);

            this.recording = null;
            this.recordingStartTime = 0;

            return {
                uri,
                duration,
                mimeType: 'audio/mp4', // AAC audio in MP4 container
            };
        } catch (error) {
            console.error('Error stopping recording:', error);
            throw error;
        }
    }

    /**
     * Pause recording
     */
    async pauseRecording(): Promise<void> {
        if (this.recording) {
            await this.recording.pauseAsync();
        }
    }

    /**
     * Resume recording
     */
    async resumeRecording(): Promise<void> {
        if (this.recording) {
            await this.recording.startAsync();
        }
    }

    /**
     * Get current recording status
     */
    async getRecordingStatus(): Promise<Audio.RecordingStatus | null> {
        if (!this.recording) {
            return null;
        }
        return await this.recording.getStatusAsync();
    }

    /**
     * Cancel recording and clean up
     */
    async cancelRecording(): Promise<void> {
        if (this.recording) {
            await this.recording.stopAndUnloadAsync();
            const uri = this.recording.getURI();
            if (uri) {
                await this.deleteAudioFile(uri);
            }
            this.recording = null;
            this.recordingStartTime = 0;
        }
    }

    /**
     * Save audio file permanently with encryption
     */
    async saveAudioFile(tempUri: string): Promise<string> {
        try {
            // Generate unique filename
            const filename = `audio_${Date.now()}.m4a`;
            const targetUri = `${this.getAudioDir()}${filename}`;

            // Read the audio file
            const audioData = await FileSystem.readAsStringAsync(tempUri, {
                encoding: FileSystem.EncodingType.Base64,
            });

            // Encrypt the audio data
            const encryptedData = await encrypt(audioData);

            // Save encrypted data
            await FileSystem.writeAsStringAsync(targetUri, encryptedData, {
                encoding: FileSystem.EncodingType.UTF8,
            });

            // Delete temp file
            await FileSystem.deleteAsync(tempUri, { idempotent: true });

            return targetUri;
        } catch (error) {
            console.error('Error saving audio file:', error);
            throw error;
        }
    }

    /**
     * Read and decrypt audio file
     */
    async readAudioFile(uri: string): Promise<string> {
        try {
            // Read encrypted data
            const encryptedData = await FileSystem.readAsStringAsync(uri, {
                encoding: FileSystem.EncodingType.UTF8,
            });

            // Decrypt
            const decryptedData = await decrypt(encryptedData);

            // Create temp file for playback
            const cacheDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
            if (!cacheDir) {
                throw new Error('No cache directory available for audio playback');
            }
            const tempUri = `${cacheDir}temp_${Date.now()}.m4a`;
            await FileSystem.writeAsStringAsync(tempUri, decryptedData, {
                encoding: FileSystem.EncodingType.Base64,
            });

            return tempUri;
        } catch (error) {
            console.error('Error reading audio file:', error);
            throw error;
        }
    }

    /**
     * Delete audio file
     */
    async deleteAudioFile(uri: string): Promise<void> {
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
    async cleanupTempFiles(): Promise<void> {
        try {
            const cacheDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
            if (!cacheDir) return;

            const files = await FileSystem.readDirectoryAsync(cacheDir);
            const tempAudioFiles = files.filter(f => f.startsWith('temp_') && f.endsWith('.m4a'));

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
