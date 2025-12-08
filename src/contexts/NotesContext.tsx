import React, { createContext, useContext, ReactNode } from 'react';
import { Note, NoteImprovement } from '../api/notes';
import { useNotes, NoteAudio } from '../hooks/useNotes';

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
    createImprovement: (noteId: string, params: { content: string; label?: string; optionId?: string }) => Promise<NoteImprovement>;
    updateImprovement: (
        noteId: string,
        improvementId: string,
        updates: { content?: string; label?: string; optionId?: string; deleted?: boolean }
    ) => Promise<NoteImprovement>;
    deleteImprovement: (noteId: string, improvementId: string) => Promise<void>;
    setActiveVariant: (noteId: string, variantId: string | null) => Promise<void>;
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
