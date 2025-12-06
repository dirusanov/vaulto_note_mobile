import client from './client';

export interface Note {
    id: string;
    encrypted_title?: string;
    encrypted_content: string;
    created_at?: string;
    updated_at?: string;
    audio_file_path?: string;
    audio_duration?: number;
    encrypted_transcription?: string;
    has_audio?: boolean;
    title?: string;
    content?: string;
    transcription?: string;
    synced?: number;
    version?: number;
    server_updated_at?: string;
    content_nonce?: string | null;
    conflict_of?: string | null;
    pending_delete?: boolean;
    dirty?: boolean;
    deleted?: boolean;
}

export interface SyncChangeRequest {
    id: string;
    content_ciphertext: string;
    content_nonce?: string | null;
    title?: string | null;
    deleted: boolean;
    base_version: number;
    client_updated_at: string;
}

export interface SyncNotesRequest {
    changes: SyncChangeRequest[];
    since_updated_at?: string;
}

export interface ServerNote {
    id: string;
    title: string | null;
    content_ciphertext: string;
    content_nonce?: string | null;
    deleted: boolean;
    version: number;
    conflict_of?: string | null;
    updated_at: string;
}

export interface SyncNotesResponse {
    updated: ServerNote[];
    conflicts: ServerNote[];
    server_changes: ServerNote[];
}

export const notesApi = {
    sync: async (payload: SyncNotesRequest): Promise<SyncNotesResponse> => {
        const response = await client.post('/sync/notes', payload);
        return response.data;
    },
};
