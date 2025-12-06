import React, { createContext, useContext, ReactNode } from 'react';
import { useNotes, NoteAudio } from '../hooks/useNotes';

export interface Note {
    id: string;
    title?: string;
    content?: string;
    created_at?: string;
    updated_at?: string;
    audio_file_path?: string;
    audio_duration?: number;
    has_audio?: boolean;
    encrypted_transcription?: string;
}

interface NotesContextType {
    notes: Note[];
    loading: boolean;
    error: string | null;
    fetchNotes: () => Promise<void>;
    syncNotes: () => Promise<void>;
    createNote: (data: { title?: string; content: string; audio?: NoteAudio }) => Promise<Note>;
    updateNote: (id: string, updates: Partial<Note> & { audio?: NoteAudio | null }) => Promise<Note>;
    deleteNote: (id: string) => Promise<void>;
    searchNotes: (query: string) => Promise<void>;
    attachAudioToNote: (id: string, audio: NoteAudio) => Promise<Note>;
    removeAudioFromNote: (id: string) => Promise<Note>;
    // decrypt removed – decryption is handled inside useNotes hook
}

const NotesContext = createContext<NotesContextType | undefined>(undefined);

export const NotesProvider = ({ children }: { children: ReactNode }) => {
    const notesData = useNotes();
    return (
        <NotesContext.Provider value={notesData}>
            {children}
        </NotesContext.Provider>
    );
};

export const useNotesContext = () => {
    const context = useContext(NotesContext);
    if (!context) {
        throw new Error('useNotesContext must be used within NotesProvider');
    }
    return context;
};
