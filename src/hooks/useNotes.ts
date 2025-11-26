import { useState, useCallback } from 'react';
import { notesApi, Note } from '../api/notes';
import { encrypt, decrypt } from '../crypto/encryption';
import { initDatabase, saveNoteLocal, getNotesLocal, deleteNoteLocal, searchNotesLocal } from '../services/DatabaseService';
import React from 'react';

export const useNotes = () => {
    const [notes, setNotes] = useState<Note[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Initialize DB on mount
    React.useEffect(() => {
        initDatabase().catch(err => console.error('[useNotes] Failed to init DB:', err));
    }, []);

    const fetchNotes = useCallback(async () => {
        console.log('[useNotes] fetchNotes called');
        setLoading(true);
        setError(null);
        try {
            // Try fetching from API first
            console.log('[useNotes] Fetching encrypted notes from API...');
            try {
                const encryptedNotes = await notesApi.getAll();
                console.log('[useNotes] Received', encryptedNotes.length, 'encrypted notes from API');

                // Sync to local DB
                for (const note of encryptedNotes) {
                    await saveNoteLocal(note);
                }
            } catch (apiError) {
                console.warn('[useNotes] API fetch failed, falling back to local DB', apiError);
            }

            // Load from local DB (source of truth for UI to ensure offline support)
            const localNotes = await getNotesLocal();
            setNotes(localNotes);
            console.log('[useNotes] State updated with', localNotes.length, 'notes from local DB');

        } catch (err) {
            console.error('[useNotes] Error fetching/decrypting notes:', err);
            setError('Failed to fetch notes');
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, []);

    const createNote = async (content: string) => {
        setLoading(true);
        setError(null);
        try {
            const lines = content.trim().split('\n');
            const titlePlain = lines[0] || 'Untitled';
            const encryptedTitle = await encrypt(titlePlain);
            const encryptedContent = await encrypt(content);

            // Optimistic update or wait for API? 
            // Let's wait for API to get ID, then save local.
            // If offline, we might need to generate ID locally (UUID) and sync later.
            // For now, assuming online for creation as per original scope, but saving local copy.

            let newNote: Note;
            try {
                // Try API first
                const newEncryptedNote = await notesApi.create(encryptedTitle, encryptedContent);
                await saveNoteLocal(newEncryptedNote);
                newNote = { ...newEncryptedNote, title: titlePlain, content };
            } catch (apiError) {
                console.warn('[useNotes] API create failed, saving locally only', apiError);
                // Fallback: Generate local ID and save
                const localId = `local-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                const localNote: Note = {
                    id: localId,
                    encrypted_title: encryptedTitle,
                    encrypted_content: encryptedContent,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };
                await saveNoteLocal(localNote);
                newNote = { ...localNote, title: titlePlain, content };
            }

            setNotes((prev) => [newNote, ...prev]);
            return newNote;
        } catch (err) {
            setError('Failed to create note');
            console.error(err);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    const updateNote = async (id: string, content: string) => {
        setLoading(true);
        setError(null);
        try {
            const lines = content.trim().split('\n');
            const titlePlain = lines[0] || 'Untitled';
            const encryptedTitle = await encrypt(titlePlain);
            const encryptedContent = await encrypt(content);

            let updatedNote: Note;
            try {
                const updatedEncryptedNote = await notesApi.update(id, encryptedTitle, encryptedContent);
                await saveNoteLocal(updatedEncryptedNote);
                updatedNote = { ...updatedEncryptedNote, title: titlePlain, content };
            } catch (apiError) {
                console.warn('[useNotes] API update failed, saving locally only', apiError);
                // Update local DB
                const noteToUpdate = notes.find(n => n.id === id);
                const localNote: Note = {
                    ...(noteToUpdate || { id, created_at: new Date().toISOString() }),
                    id,
                    encrypted_title: encryptedTitle,
                    encrypted_content: encryptedContent,
                    updated_at: new Date().toISOString()
                };
                await saveNoteLocal(localNote);
                updatedNote = { ...localNote, title: titlePlain, content };
            }

            setNotes((prev) => prev.map((n) => (n.id === id ? updatedNote : n)));
            return updatedNote;
        } catch (err) {
            setError('Failed to update note');
            console.error(err);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    const deleteNote = async (id: string) => {
        setLoading(true);
        setError(null);
        try {
            try {
                await notesApi.delete(id);
            } catch (apiError) {
                console.warn('[useNotes] API delete failed, deleting locally only', apiError);
            }
            await deleteNoteLocal(id);
            setNotes((prev) => prev.filter((n) => n.id !== id));
        } catch (err) {
            setError('Failed to delete note');
            console.error(err);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    const searchNotes = async (query: string) => {
        setLoading(true);
        try {
            const results = await searchNotesLocal(query);
            setNotes(results);
        } catch (err) {
            console.error('[useNotes] Search failed', err);
            setError('Search failed');
        } finally {
            setLoading(false);
        }
    };

    return { notes, loading, error, fetchNotes, createNote, updateNote, deleteNote, searchNotes };
};
