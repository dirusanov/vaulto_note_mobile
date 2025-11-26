import client from './client';

export interface Note {
    id: string;
    encrypted_title?: string;  // Optional since it can be null in DB
    encrypted_content: string;
    created_at?: string;
    updated_at?: string;
    // Audio fields
    audio_file_path?: string;
    audio_duration?: number;
    encrypted_transcription?: string;
    has_audio?: boolean;
    // Decrypted fields will be added at runtime by the client hook
    title?: string;
    content?: string;
    transcription?: string;
}

export const notesApi = {
    getAll: async (): Promise<Note[]> => {
        const response = await client.get('/notes');
        return response.data;
    },

    create: async (encrypted_title: string, encrypted_content: string): Promise<Note> => {
        const response = await client.post('/notes', { encrypted_title, encrypted_content });
        return response.data;
    },

    getById: async (id: string): Promise<Note> => {
        const response = await client.get(`/notes/${id}`);
        return response.data;
    },

    update: async (id: string, encrypted_title: string, encrypted_content: string): Promise<Note> => {
        const response = await client.put(`/notes/${id}`, { encrypted_title, encrypted_content });
        return response.data;
    },

    delete: async (id: string): Promise<void> => {
        await client.delete(`/notes/${id}`);
    },
};
