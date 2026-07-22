import client from './client';

export type DeleteSyncNotesResult = 'deleted' | 'unsupported';
export type StorageScope = 'sync' | 'local_only';
export type NotePrivacy = 'normal' | 'hidden';

export interface NoteImprovement {
    id: string;
    note_id: string;
    encrypted_content: string;
    encrypted_title?: string | null;
    title?: string;
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
    // Audio blob sync state (see DatabaseService.setNoteAudioSyncState).
    audio_synced?: number;
    audio_remote?: number;
    audio_sha256?: string | null;
    is_pinned?: boolean;
    storage_scope?: StorageScope;
    // Local-only copy retained after another device reset the encrypted vault.
    // It never participates in sync until the user explicitly recovers it.
    reset_archived?: boolean;
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
    enc_epoch?: number;
    // Voice-note payload: transcription mirrors content encryption; the audio
    // blob itself is synced separately through the /sync/notes/{id}/audio API.
    transcription_ciphertext?: string | null;
    audio_duration?: number | null;
    has_audio?: boolean;
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
    enc_epoch?: number;
}

export interface SyncNotesRequest {
    changes: SyncChangeRequest[];
    improvement_changes?: SyncImprovementChangeRequest[];
    // Legacy timestamp cursor (kept for back-compat). Prefer since_seq.
    since_updated_at?: string;
    // Monotonic per-user server cursor. Send 0 for a full pull.
    since_seq?: number;
    vault_generation?: number;
    transition_token?: string;
}

export type AudioEncScheme = 'none' | 'e2ee';

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
    server_seq?: number;
    enc_epoch?: number;
    transcription_ciphertext?: string | null;
    audio_duration?: number | null;
    has_audio?: boolean;
    // True when the audio blob is actually present in server object storage.
    audio_available?: boolean;
    audio_size_bytes?: number | null;
    audio_sha256?: string | null;
    audio_enc_scheme?: AudioEncScheme | null;
    audio_enc_epoch?: number | null;
    audio_mime_type?: string | null;
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
    server_seq?: number;
    enc_epoch?: number;
}

export type EncryptionMode = 'off' | 'e2ee';

export interface SyncNotesResponse {
    updated: ServerNote[];
    conflicts: NoteSyncConflict[];
    server_changes: ServerNote[];
    improvement_updates: ServerImprovement[];
    improvement_conflicts: ImprovementSyncConflict[];
    improvement_changes: ServerImprovement[];
    next_cursor?: number | null;
    enc_mode?: EncryptionMode | null;
    key_epoch?: number | null;
    vault_generation?: number | null;
    transition_state?: 'enabling_e2ee' | 'disabling_e2ee' | null;
    transition_owned?: boolean;
}

export type NoteSyncConflict = {
    id: string;
    error: string;
    message?: string;
    conflict_of?: string | null;
    server_updated_at?: string;
    client_updated_at?: string;
    server_version?: number;
    client_base_version?: number;
    server_vault_generation?: number;
    client_vault_generation?: number | null;
};

export type ImprovementSyncConflict = {
    id: string;
    note_id: string;
    error: string;
    message?: string;
    server_updated_at?: string;
    client_updated_at?: string;
    server_version?: number | null;
    client_base_version?: number;
    server_vault_generation?: number;
    client_vault_generation?: number | null;
};

export const notesApi = {
    sync: async (payload: SyncNotesRequest): Promise<SyncNotesResponse> => {
        const response = await client.post('/sync/notes', payload);
        return response.data;
    },
    deleteAllSyncNotes: async (vaultGeneration = 0): Promise<DeleteSyncNotesResult> => {
        const response = await client.delete('/sync/notes', {
            params: { vault_generation: vaultGeneration },
            validateStatus: (status) =>
                (status >= 200 && status < 300) || status === 404 || status === 405,
        });

        if (response.status === 404 || response.status === 405) {
            return 'unsupported';
        }

        return 'deleted';
    },
};
