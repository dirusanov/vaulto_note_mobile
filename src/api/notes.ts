import client from './client';

export interface NoteImprovement {
    id: string;
    note_id: string;
    encrypted_content: string;
    encrypted_title?: string | null;
    content_nonce?: string | null;
    label?: string | null;
    option_id?: string | null;
    created_at?: string;
    updated_at?: string;
    deleted?: boolean;
    synced?: number;
    version?: number;
    content?: string;
    dirty?: boolean;
    server_updated_at?: string;
}

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
    improvements?: NoteImprovement[];
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

export interface SyncImprovementChangeRequest {
    id: string;
    note_id: string;
    content_ciphertext: string;
    content_nonce?: string | null;
    encrypted_title?: string | null;
    label?: string | null;
    option_id?: string | null;
    deleted: boolean;
    base_version: number;
    client_updated_at: string;
}

export interface SyncNotesRequest {
    changes: SyncChangeRequest[];
    improvement_changes?: SyncImprovementChangeRequest[];
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

export interface ServerImprovement {
    id: string;
    note_id: string;
    label?: string | null;
    option_id?: string | null;
    encrypted_title?: string | null;
    content_ciphertext: string;
    content_nonce?: string | null;
    deleted: boolean;
    version: number;
    updated_at: string;
}

export interface SyncNotesResponse {
    updated: ServerNote[];
    conflicts: ServerNote[];
    server_changes: ServerNote[];
    improvement_updates: ServerImprovement[];
    improvement_conflicts: ServerImprovement[];
    improvement_changes: ServerImprovement[];
}

export const notesApi = {
    sync: async (payload: SyncNotesRequest): Promise<SyncNotesResponse> => {
        const response = await client.post('/sync/notes', payload);
        return response.data;
    },
};
