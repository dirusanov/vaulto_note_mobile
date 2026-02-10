import client from './client';

export type DeleteSyncNotesResult = 'deleted' | 'unsupported';
export type StorageScope = 'sync' | 'local_only';
export type NotePrivacy = 'normal' | 'hidden';

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
    is_active?: boolean; // Added: Track which improvement is currently active
}

export interface Note {
    is_active: boolean;
    parent_id?: string | null;
    label?: string | null;
    option_id?: string | null;

    // Existing fields
    id: string;
    encrypted_title?: string;
    encrypted_content: string;
    created_at?: string;
    updated_at?: string;
    audio_file_path?: string;
    audio_duration?: number;
    encrypted_transcription?: string;
    has_audio?: boolean;
    is_pinned?: boolean;
    storage_scope?: StorageScope;
    privacy?: NotePrivacy;
    pending_server_delete?: boolean;
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
    voice_files?: VoiceRecording[];
    improvements?: Note[]; // Changed from NoteImprovement[] to Note[]
}

export interface VoiceRecording {
    id: string;
    note_id: string;
    file_path: string;
    duration: number;
    transcription?: string;
    created_at: string;
    iso_code?: string; // language code
}

export interface SyncChangeRequest {
    id: string;
    content_ciphertext: string;
    content_nonce?: string | null;
    title?: string | null;
    deleted: boolean;
    base_version: number;
    client_updated_at: string;
    is_active?: boolean;
    is_pinned?: boolean;
    last_variant_id?: string | null;
    pending_server_delete?: boolean;
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
    is_active?: boolean;
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
    last_variant_id?: string | null;
    is_active?: boolean;
    is_pinned?: boolean;
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
    is_active?: boolean;
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
    deleteAllSyncNotes: async (): Promise<DeleteSyncNotesResult> => {
        const response = await client.delete('/sync/notes', {
            validateStatus: (status) =>
                (status >= 200 && status < 300) || status === 404 || status === 405,
        });

        if (response.status === 404 || response.status === 405) {
            return 'unsupported';
        }

        return 'deleted';
    },
};
