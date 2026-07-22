import client from './client';
import { AudioEncScheme, ServerNote } from './notes';

export interface AudioUploadTarget {
    url: string;
    method: 'PUT';
    headers: Record<string, string>;
    expires_in: number;
    max_size_bytes: number;
    /** Scheme the server will accept on commit ('e2ee' for encrypted accounts). */
    required_enc_scheme: AudioEncScheme;
    key_epoch: number;
    vault_generation: number;
    upload_id?: string;
}

export interface AudioCommitRequest {
    upload_id?: string;
    enc_scheme: AudioEncScheme;
    enc_epoch: number;
    mime_type: string;
    sha256?: string | null;
    duration?: number | null;
    vault_generation?: number;
    transition_token?: string;
}

export interface AudioDownloadTarget {
    url: string;
    expires_in: number;
    enc_scheme: AudioEncScheme | null;
    enc_epoch: number | null;
    size_bytes: number | null;
    sha256: string | null;
    mime_type: string | null;
    duration: number | null;
}

/**
 * Audio blobs travel directly between the device and S3-compatible storage via
 * presigned URLs; the API only issues URLs and records the blob descriptor on
 * the note (which then reaches other devices through the regular notes sync).
 */
export const audioApi = {
    getUploadUrl: async (
        noteId: string,
        mimeType: string,
        sizeBytes?: number,
        vaultGeneration = 0,
        transitionToken?: string | null,
    ): Promise<AudioUploadTarget> => {
        const response = await client.post(`/sync/notes/${noteId}/audio/upload-url`, {
            mime_type: mimeType,
            size_bytes: sizeBytes,
            supports_versioned_upload: true,
            vault_generation: vaultGeneration,
            transition_token: transitionToken ?? undefined,
        });
        return response.data;
    },
    commit: async (noteId: string, payload: AudioCommitRequest): Promise<ServerNote> => {
        const response = await client.post(`/sync/notes/${noteId}/audio/commit`, payload);
        return response.data;
    },
    getDownloadUrl: async (noteId: string, transitionToken?: string | null): Promise<AudioDownloadTarget> => {
        const response = await client.get(`/sync/notes/${noteId}/audio/download-url`, {
            headers: transitionToken
                ? { 'X-Encryption-Transition-Token': transitionToken }
                : undefined,
        });
        return response.data;
    },
    deleteAudio: async (noteId: string, vaultGeneration = 0, transitionToken?: string | null): Promise<void> => {
        await client.delete(`/sync/notes/${noteId}/audio`, {
            params: {
                vault_generation: vaultGeneration,
            },
            headers: transitionToken
                ? { 'X-Encryption-Transition-Token': transitionToken }
                : undefined,
        });
    },
};
