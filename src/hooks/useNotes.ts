import { useState, useCallback } from 'react';
import { notesApi, Note } from '../api/notes';
import { encrypt, decrypt } from '../crypto/encryption';
import { initDatabase, saveNoteLocal, getNotesLocal, deleteNoteLocal, searchNotesLocal } from '../services/DatabaseService';
import React from 'react';
import { useAuth } from './useAuth';

export interface NoteAudio {
    filePath: string;
    duration: number;
    transcription?: string;
}

export const useNotes = () => {
    const { isAuthenticated } = useAuth();
    const [notes, setNotes] = useState<Note[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const buildTitle = useCallback((title?: string | null) => {
        if (title && title.trim().length > 0) {
            return title.trim();
        }
        return '';
    }, []);

    // Initialize DB on mount
    React.useEffect(() => {
        initDatabase().catch(err => console.error('[useNotes] Failed to init DB:', err));
    }, []);

    const isEmptyNote = (note: Partial<Note>) => {
        const plainTitle = (note.title || '').trim();
        const plainContent = (note.content || '').trim();
        const hasAudio = !!note.has_audio || !!note.audio_file_path;
        return !plainTitle && !plainContent && !hasAudio;
    };

    const fetchNotes = useCallback(async () => {
        console.log('[useNotes] fetchNotes called');
        setLoading(true);
        setError(null);
        try {
            // Try fetching from API first
            console.log('[useNotes] Fetching encrypted notes from API...');
            if (isAuthenticated) {
                try {
                    // SYNC UP: Find local notes that need syncing
                    const allLocal = await getNotesLocal();
                    const unsynced = allLocal.filter(n => (n.id.startsWith('local-') || (n as any).synced === 0) && !isEmptyNote(n));

                    if (unsynced.length > 0) {
                        console.log(`[useNotes] Found ${unsynced.length} unsynced notes. Syncing...`);
                        for (const localNote of unsynced) {
                            try {
                                // Create on server
                                const newNote = await notesApi.create(localNote.encrypted_title || '', localNote.encrypted_content);
                                // Delete local temporary note
                                await deleteNoteLocal(localNote.id);
                                // Save new server note locally (preserving audio info if any)
                                const noteWithExtras: Note = {
                                    ...newNote,
                                    audio_file_path: localNote.audio_file_path,
                                    audio_duration: localNote.audio_duration,
                                    encrypted_transcription: localNote.encrypted_transcription,
                                    has_audio: localNote.has_audio,
                                    synced: 1
                                };
                                await saveNoteLocal(noteWithExtras);
                                console.log(`[useNotes] Synced note ${localNote.id} -> ${newNote.id}`);
                            } catch (syncErr) {
                                console.error(`[useNotes] Failed to sync note ${localNote.id}`, syncErr);
                            }
                        }
                    }

                    const encryptedNotes = await notesApi.getAll();
                    console.log('[useNotes] Received', encryptedNotes.length, 'encrypted notes from API');

                    // Sync to local DB
                    for (const note of encryptedNotes) {
                        await saveNoteLocal(note);
                    }
                } catch (apiError) {
                    console.warn('[useNotes] API fetch failed, falling back to local DB', apiError);
                }
            }

            // Load from local DB (source of truth for UI to ensure offline support)
            const localNotes = await getNotesLocal();
            const filtered = [];
            for (const n of localNotes) {
                if (isEmptyNote(n)) {
                    await deleteNoteLocal(n.id);
                    continue;
                }
                filtered.push(n);
            }
            setNotes(filtered);
            console.log('[useNotes] State updated with', filtered.length, 'notes from local DB');

        } catch (err) {
            console.error('[useNotes] Error fetching/decrypting notes:', err);
            setError('Failed to fetch notes');
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [isAuthenticated]);

    const createNote = async (data: { title?: string; content: string; audio?: NoteAudio }) => {
        const { title, content, audio } = data;
        const titleToUse = buildTitle(title);
        const contentToUse = content || '';
        const isEmpty = !titleToUse.trim() && !contentToUse.trim() && !audio;
        if (isEmpty) {
            console.warn('[useNotes] Skipping creation of empty note');
            return Promise.reject(new Error('Cannot create empty note'));
        }

        setLoading(true);
        setError(null);
        try {
            const encryptedTitle = await encrypt(titleToUse);
            const encryptedContent = await encrypt(contentToUse);
            const encryptedTranscription = audio?.transcription
                ? await encrypt(audio.transcription)
                : undefined;

            let newNote: Note;
            try {
                // Try API first
                if (isAuthenticated) {
                    const newEncryptedNote = await notesApi.create(encryptedTitle, encryptedContent);
                    const noteWithAudio: Note = {
                        ...newEncryptedNote,
                        audio_file_path: audio?.filePath,
                        audio_duration: audio?.duration,
                        encrypted_transcription: encryptedTranscription,
                        has_audio: !!audio,
                        synced: 1
                    };
                    await saveNoteLocal(noteWithAudio);
                    newNote = {
                        ...noteWithAudio,
                        title: titleToUse,
                        content,
                        transcription: audio?.transcription,
                    };
                } else {
                    throw new Error('Offline');
                }
            } catch (apiError) {
                console.warn('[useNotes] API create failed, saving locally only', apiError);
                // Fallback: Generate local ID and save
                const localId = `local-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                const localNote: Note = {
                    id: localId,
                    encrypted_title: encryptedTitle,
                    encrypted_content: encryptedContent,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    audio_file_path: audio?.filePath,
                    audio_duration: audio?.duration,
                    encrypted_transcription: encryptedTranscription,
                    has_audio: !!audio,
                    synced: 0
                };
                await saveNoteLocal(localNote);
                newNote = {
                    ...localNote,
                    title: titleToUse,
                    content,
                    transcription: audio?.transcription,
                };
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

    const updateNote = async (id: string, updates: Partial<Note> & { audio?: NoteAudio | null }) => {
        setLoading(true);
        setError(null);
        try {
            const existing = notes.find(n => n.id === id);
            if (!existing) throw new Error('Note not found');

            const titleToUse = buildTitle(updates.title ?? existing.title);
            const contentToUse = updates.content ?? existing.content ?? '';

            // Handle audio updates
            // If audio is explicitly passed as null, remove it.
            // If updates has audio_file_path, use it.
            // If updates.audio is passed (legacy/helper), use it.

            let audioPath = existing.audio_file_path;
            let audioDuration = existing.audio_duration;
            let hasAudio = existing.has_audio;
            let transcription = existing.transcription;
            let encryptedTranscription = existing.encrypted_transcription;

            if (updates.audio_file_path !== undefined) {
                audioPath = updates.audio_file_path;
                audioDuration = updates.audio_duration;
                hasAudio = updates.has_audio ?? !!audioPath;
            }

            if (updates.encrypted_transcription !== undefined) {
                // If we are updating the encrypted transcription directly (e.g. from NoteEditScreen)
                encryptedTranscription = updates.encrypted_transcription;
                // We assume the caller handles encryption if they pass this field, 
                // OR we might need to encrypt it here if it's raw text?
                // In NoteEditScreen we passed 'transcription.text' to 'encrypted_transcription'.
                // Wait, NoteEditScreen passed raw text to 'encrypted_transcription'. We should encrypt it here.
            }

            // If NoteEditScreen passes raw text as 'encrypted_transcription', we need to fix that naming or logic.
            // NoteEditScreen: encrypted_transcription: transcription.text
            // That is RAW text. So we should encrypt it here.

            if (updates.encrypted_transcription) {
                // It's actually raw text coming from the UI, let's encrypt it
                const rawTrans = updates.encrypted_transcription;
                encryptedTranscription = await encrypt(rawTrans);
                transcription = rawTrans; // Update local state with raw text
            }

            // If note becomes empty (no title/content/audio), delete it instead of saving
            const willBeEmpty = !titleToUse.trim() && !contentToUse.trim() && !hasAudio && !updates.audio_file_path && !updates.audio;
            if (willBeEmpty) {
                try {
                    await notesApi.delete(id);
                } catch (apiError) {
                    console.warn('[useNotes] API delete during empty-update failed, deleting locally only', apiError);
                }
                await deleteNoteLocal(id);
                setNotes((prev) => prev.filter((n) => n.id !== id));
                return existing;
            }

            const encryptedTitle = await encrypt(titleToUse);
            const encryptedContent = await encrypt(contentToUse);

            let updatedNote: Note;
            try {
                const updatedEncryptedNote = await notesApi.update(id, encryptedTitle, encryptedContent);

                const noteWithExtras: Note = {
                    ...updatedEncryptedNote,
                    audio_file_path: audioPath,
                    audio_duration: audioDuration,
                    encrypted_transcription: encryptedTranscription,
                    has_audio: hasAudio,
                };
                await saveNoteLocal(noteWithExtras);

                updatedNote = {
                    ...noteWithExtras,
                    title: titleToUse,
                    content: contentToUse,
                    transcription: transcription,
                };
            } catch (apiError) {
                console.warn('[useNotes] API update failed, saving locally only', apiError);
                const localNote: Note = {
                    ...existing,
                    encrypted_title: encryptedTitle,
                    encrypted_content: encryptedContent,
                    updated_at: new Date().toISOString(),
                    audio_file_path: audioPath,
                    audio_duration: audioDuration,
                    encrypted_transcription: encryptedTranscription,
                    has_audio: hasAudio,
                };
                await saveNoteLocal(localNote);
                updatedNote = {
                    ...localNote,
                    title: titleToUse,
                    content: contentToUse,
                    transcription: transcription,
                };
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

    const attachAudioToNote = async (id: string, audio: NoteAudio) => {
        return updateNote(id, { audio });
    };

    const removeAudioFromNote = async (id: string) => {
        return updateNote(id, { audio: null, has_audio: false, audio_file_path: undefined });
    };

    return {
        notes,
        loading,
        error,
        fetchNotes,
        createNote,
        updateNote,
        deleteNote,
        searchNotes,
        attachAudioToNote,
        removeAudioFromNote,
    };
};
