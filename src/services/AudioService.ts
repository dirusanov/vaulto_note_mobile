import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
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
    /**
     * Start recording audio
     */
    async startRecording(onMeteringUpdate?: (level: number) => void): Promise<void> {
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
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: true,
                playsInSilentModeIOS: true,
            });

            console.log('[V3] Creating audio recording...');

            // Define recording options for AAC/m4a
            const recordingOptions: Audio.RecordingOptions = {
                isMeteringEnabled: true,
                android: {
                    extension: '.m4a',
                    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
                    audioEncoder: Audio.AndroidAudioEncoder.AAC,
                    sampleRate: 44100,
                    numberOfChannels: 2,
                    bitRate: 128000,
                },
                ios: {
                    extension: '.m4a',
                    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
                    audioQuality: Audio.IOSAudioQuality.MAX,
                    sampleRate: 44100,
                    numberOfChannels: 2,
                    bitRate: 128000,
                    linearPCMBitDepth: 16,
                    linearPCMIsBigEndian: false,
                    linearPCMIsFloat: false,
                },
                web: {
                    mimeType: 'audio/webm',
                    bitsPerSecond: 128000,
                },
            };

            // Create recording - it will use its own temp storage
            const { recording } = await Audio.Recording.createAsync(
                recordingOptions,
                (status) => {
                    if (onMeteringUpdate && status.isRecording && status.metering !== undefined) {
                        onMeteringUpdate(status.metering);
                    }
                },
                100 // Update interval in ms
            );

            console.log('[V3] Recording created successfully');
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
        if (Platform.OS === 'web') return null;
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

            this.recording = null;
            this.recordingStartTime = 0;

            return {
                uri,
                duration,
                mimeType: 'audio/m4a', // AAC audio in M4A container
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
    async readAudioFile(uri: string): Promise<string> {
        if (Platform.OS === 'web') return uri;
        try {
            // Read encrypted data
            const encryptedData = await FileSystem.readAsStringAsync(uri, {
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
            const tempUri = `${cacheDir}temp_${Date.now()}.m4a`;
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
    async cleanupTempFiles(): Promise<void> {
        if (Platform.OS === 'web') return;
        try {
            // @ts-ignore
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
