import React, { createContext, useContext, ReactNode } from 'react';
import { useNotes } from '../hooks/useNotes';
import { Note } from '../api/notes';

interface NotesContextType {
    notes: Note[];
    loading: boolean;
    error: string | null;
    fetchNotes: () => Promise<void>;
    createNote: (content: string) => Promise<Note>;
    updateNote: (id: string, content: string) => Promise<Note>;
    deleteNote: (id: string) => Promise<void>;
    searchNotes: (query: string) => Promise<void>;
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
