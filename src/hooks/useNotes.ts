import { useCallback, useRef, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Note, NoteImprovement } from '../api/notes';
import { encrypt } from '../crypto/encryption';
import {
    initDatabase,
    saveNoteLocal,
    getNotesLocal,
    deleteNoteLocal,
    searchNotesLocal,
    saveImprovementLocal,
    setActiveVariant as setActiveVariantDB,
    getNoteById,
} from '../services/DatabaseService';
import { useAuth } from './useAuth';
import { generateUUID } from '../utils/uuid';
import { syncService } from '../services/SyncService';

const DEMO_SEEDED_KEY = 'vaulto_demo_seeded_v1';
const demoSeedNotes = [
    {
        title: 'Focus list for today',
        content: ['Morning sync highlights', 'Review Vaulto mobile design', 'Investor call at 15:00', 'Capture idea for tomorrow']
            .map((item, index) => `${index + 1}. ${item}`)
            .join('\n'),
    },
    {
        title: 'Idea: Calm onboarding',
        content: 'Guide new users with a warm intro, highlight secure sync, and keep the mic button one tap away. Maybe show a quick animation when a transcript arrives.',
    },
];

export interface NoteAudio {
    filePath: string;
    duration: number;
    transcription?: string;
}

export const useNotes = () => {
    const { isAuthenticated, userId } = useAuth();
    const [notes, setNotes] = useState<Note[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const notesRef = useRef<Note[]>([]);

    // Update SyncService auth state
    useEffect(() => {
        syncService.setAuthenticated(isAuthenticated);
        // Inform sync service about current user to migrate local notes if needed
        void syncService.setCurrentUser(userId ?? null);
    }, [isAuthenticated, userId]);

    // Initialize DB on mount
    useEffect(() => {
        initDatabase().catch(err => console.error('[useNotes] Failed to init DB:', err));
    }, []);

    useEffect(() => {
        notesRef.current = notes;
    }, [notes]);

    const buildTitle = useCallback((title?: string | null) => {
        if (title && title.trim().length > 0) {
            return title.trim();
        }
        return '';
    }, []);

    const isEmptyNote = useCallback(
        (note: Partial<Note>) => {
            const plainTitle = (note.title || '').trim();
            const plainContent = (note.content || '').trim();
            const hasAudio = !!note.has_audio || !!note.audio_file_path;
            const hasImprovements = note.improvements && note.improvements.length > 0;
            return !plainTitle && !plainContent && !hasAudio && !hasImprovements;
        },
        [],
    );

    const filterAndCleanupNotes = useCallback(
        async (source: Note[]) => {
            const visible: Note[] = [];
            for (const note of source) {
                if (note.deleted || note.pending_delete) {
                    continue;
                }
                if (isEmptyNote(note)) {
                    await deleteNoteLocal(note.id);
                    continue;
                }
                visible.push(note);
            }
            return visible;
        },
        [isEmptyNote],
    );

    const buildLocalNote = useCallback(
        async (params: {
            id: string;
            title: string;
            content: string;
            audio?: NoteAudio;
            transcription?: string;
        }) => {
            const { id, title, content, audio, transcription } = params;
            const encryptedTitle = await encrypt(title);
            const encryptedContent = await encrypt(content);
            const encryptedTranscription = transcription ? await encrypt(transcription) : undefined;
            const now = new Date().toISOString();
            const localNote: Note = {
                id,
                encrypted_title: encryptedTitle,
                encrypted_content: encryptedContent,
                created_at: now,
                updated_at: now,
                audio_file_path: audio?.filePath,
                audio_duration: audio?.duration,
                encrypted_transcription: encryptedTranscription,
                transcription,
                has_audio: !!audio,
                title,
                content,
                synced: 0,
                dirty: true,
                deleted: false,
                version: 0,
                is_active: true, // New parent notes are active by default
            };
            await saveNoteLocal(localNote);
            return localNote;
        },
        []
    );

    const buildLocalImprovement = useCallback(
        async (params: {
            id: string;
            noteId: string;
            content: string;
            label?: string;
            optionId?: string;
        }): Promise<NoteImprovement> => {
            const { id, noteId, content, label, optionId } = params;
            let encryptedContent = await encrypt(content);

            if (encryptedContent === undefined || encryptedContent === null) {
                console.warn('[useNotes] Encryption returned null/undefined, defaulting to empty string');
                encryptedContent = '';
            }

            const now = new Date().toISOString();
            const improvement: NoteImprovement = {
                id,
                note_id: noteId,
                encrypted_content: encryptedContent,
                label,
                option_id: optionId,
                content,
                created_at: now,
                updated_at: now,
                synced: 0,
                dirty: true,
                deleted: false,
                version: 0,
            };
            await saveImprovementLocal(improvement);
            return improvement;
        },
        []
    );

    const seedDemoNotes = useCallback(async () => {
        try {
            const alreadySeeded = await AsyncStorage.getItem(DEMO_SEEDED_KEY);
            if (alreadySeeded === '1') {
                return false;
            }
            for (const demo of demoSeedNotes) {
                const id = await generateUUID();
                await buildLocalNote({ id, title: demo.title, content: demo.content });
            }
            await AsyncStorage.setItem(DEMO_SEEDED_KEY, '1');
            return true;
        } catch (error) {
            console.error('[useNotes] Failed to seed demo notes:', error);
            return false;
        }
    }, [buildLocalNote]);

    const refreshFromLocal = useCallback(async () => {
        let localNotes = await getNotesLocal();
        let visible = await filterAndCleanupNotes(localNotes);

        if (visible.length === 0) {
            const seeded = await seedDemoNotes();
            if (seeded) {
                localNotes = await getNotesLocal();
                visible = await filterAndCleanupNotes(localNotes);
            }
        }

        setNotes(visible);
        return visible;
    }, [filterAndCleanupNotes, seedDemoNotes]);

    // Subscribe to SyncService updates
    useEffect(() => {
        const unsubscribe = syncService.subscribe(() => {
            console.log('[useNotes] Sync finished, refreshing local notes');
            refreshFromLocal();
        });
        return unsubscribe;
    }, [refreshFromLocal]);

    const fetchNotes = useCallback(async () => {
        console.log('[useNotes] fetchNotes called');
        setLoading(true);
        setError(null);
        try {
            await refreshFromLocal();
            // Trigger sync on fetch (e.g. screen mount)
            if (isAuthenticated) {
                syncService.syncNow('app_start');
            }
        } catch (err) {
            console.error('[useNotes] Error fetching notes:', err);
            setError('Failed to fetch notes');
        } finally {
            setLoading(false);
        }
    }, [refreshFromLocal, isAuthenticated]);

    // Manual sync (pull-to-refresh)
    const syncNotes = useCallback(async () => {
        if (!isAuthenticated) return;
        setLoading(true);
        try {
            await syncService.syncNow('manual');
            await refreshFromLocal();
        } finally {
            setLoading(false);
        }
    }, [isAuthenticated, refreshFromLocal]);

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
            const id = await generateUUID();
            const newLocal = await buildLocalNote({
                id,
                title: titleToUse,
                content: contentToUse,
                audio,
                transcription: audio?.transcription,
            });
            await refreshFromLocal();

            // Schedule auto-sync
            syncService.scheduleAutoSync();

            return newLocal;
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
            const existing = notesRef.current.find(n => n.id === id);
            if (!existing) throw new Error('Note not found');

            const titleToUse = buildTitle(updates.title ?? existing.title);
            const contentToUse = updates.content ?? existing.content ?? '';

            let audioPath = existing.audio_file_path;
            let audioDuration = existing.audio_duration;
            let hasAudio = existing.has_audio;
            let transcription = existing.transcription;
            let encryptedTranscription = existing.encrypted_transcription;

            if (updates.audio) {
                audioPath = updates.audio.filePath;
                audioDuration = updates.audio.duration;
                hasAudio = true;
                if (updates.audio.transcription) {
                    transcription = updates.audio.transcription;
                    encryptedTranscription = await encrypt(updates.audio.transcription);
                }
            } else if (updates.audio === null) {
                audioPath = undefined;
                audioDuration = undefined;
                hasAudio = false;
                transcription = undefined;
                encryptedTranscription = undefined;
            }

            if (updates.audio_file_path !== undefined) {
                audioPath = updates.audio_file_path;
            }
            if (updates.audio_duration !== undefined) {
                audioDuration = updates.audio_duration;
            }
            if (updates.has_audio !== undefined) {
                hasAudio = updates.has_audio;
            }

            if (typeof updates.encrypted_transcription === 'string') {
                transcription = updates.encrypted_transcription;
                encryptedTranscription = await encrypt(updates.encrypted_transcription);
            }

            const hasImprovements = (existing.improvements?.length ?? 0) > 0;
            const willBeEmpty = !titleToUse.trim() && !contentToUse.trim() && !hasAudio;
            if (willBeEmpty && !hasImprovements) {
                await deleteNote(id);
                return existing;
            }

            const encryptedTitle = await encrypt(titleToUse);
            const encryptedContent = await encrypt(contentToUse);
            const updatedAt = new Date().toISOString();
            const updatedLocal: Note = {
                ...existing,
                title: titleToUse,
                content: contentToUse,
                encrypted_title: encryptedTitle,
                encrypted_content: encryptedContent,
                encrypted_transcription: encryptedTranscription,
                transcription,
                audio_file_path: audioPath,
                audio_duration: audioDuration,
                has_audio: hasAudio,
                updated_at: updatedAt,
                synced: 0,
                dirty: true,
                deleted: false,
            };
            await saveNoteLocal(updatedLocal);
            await refreshFromLocal();

            // Schedule auto-sync
            syncService.scheduleAutoSync();

            return updatedLocal;
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
            const existing = notesRef.current.find(n => n.id === id);
            if (!existing) {
                // If not in memory, try to delete from DB anyway (maybe it's hidden)
                await deleteNoteLocal(id);
                await refreshFromLocal();
                return;
            }

            const marked: Note = {
                ...existing,
                deleted: true, // Soft delete
                synced: 0,
                dirty: true,
                updated_at: new Date().toISOString(),
            };
            await saveNoteLocal(marked);
            await refreshFromLocal();

            // Schedule auto-sync
            syncService.scheduleAutoSync();
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
            const filtered = results.filter(note => !note.deleted && !note.pending_delete && !isEmptyNote(note));
            setNotes(filtered);
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

    const createImprovement = useCallback(
        async (
            noteId: string,
            params: { content: string; label?: string; optionId?: string }
        ): Promise<NoteImprovement> => {
            let note = notesRef.current.find(n => n.id === noteId);
            if (!note) {
                // Fallback to DB for fast-following updates
                const dbNote = await getNoteById(noteId);
                if (dbNote) note = dbNote;
            }
            if (!note) throw new Error('Note not found');
            const id = await generateUUID();

            // Ensure content is string
            const safeContent = params.content || '';

            console.log('[useNotes] createImprovement', {
                id,
                noteId,
                contentLength: safeContent.length,
                label: params.label
            });

            const improvement = await buildLocalImprovement({
                id,
                noteId,
                content: safeContent,
                label: params.label,
                optionId: params.optionId,
            });

            if (!improvement) throw new Error('Failed to build local improvement');



            // Update parent note's updated_at so it moves to top of list
            // Ensure we preserve encrypted_content. If not in memory note, refetch from DB.
            if (!note.encrypted_content) {
                const refreshedParent = await getNoteById(noteId);
                if (refreshedParent) {
                    note = refreshedParent;
                }
            }

            const parentUpdate: Note = {
                ...note,
                encrypted_content: note.encrypted_content || '', // Fallback to avoid constraint viol
                updated_at: new Date().toISOString(),
                synced: 0,
                dirty: true,
            };
            await saveNoteLocal(parentUpdate);

            await refreshFromLocal();
            syncService.scheduleAutoSync();
            return improvement;
        },
        [buildLocalImprovement, refreshFromLocal]
    );

    const updateImprovement = useCallback(
        async (
            noteId: string,
            improvementId: string,
            updates: { content?: string; label?: string; optionId?: string; deleted?: boolean }
        ): Promise<NoteImprovement> => {
            console.log('[useNotes] updateImprovement called:', {
                noteId,
                improvementId,
                updates: { ...updates, content: updates.content ? `${updates.content.substring(0, 50)}...` : undefined }
            });

            let note = notesRef.current.find(n => n.id === noteId);
            if (!note) {
                const dbNote = await getNoteById(noteId);
                if (dbNote) note = dbNote;
            }

            if (!note) {
                console.error('[useNotes] Parent note not found:', noteId);
                throw new Error('Note not found');
            }

            console.log('[useNotes] Parent note found, improvements count:', note.improvements?.length || 0);

            const improvement = note.improvements?.find(imp => imp.id === improvementId);
            if (!improvement) {
                console.error('[useNotes] Improvement not found:', {
                    improvementId,
                    availableImprovements: note.improvements?.map(i => ({ id: i.id, label: i.label }))
                });
                throw new Error('Improvement not found');
            }

            console.log('[useNotes] Found improvement to update:', {
                id: improvement.id,
                currentLabel: improvement.label,
                newLabel: updates.label,
                newOptionId: updates.optionId
            });

            let encryptedContent = improvement.encrypted_content;
            let plainContent = improvement.content ?? '';
            if (typeof updates.content === 'string') {
                encryptedContent = await encrypt(updates.content);
                plainContent = updates.content;
            }

            const updated: NoteImprovement = {
                ...improvement,
                note_id: noteId, // Ensure parent ID is preserved
                encrypted_content: encryptedContent,
                content: plainContent,
                label: updates.label ?? improvement.label,
                option_id: updates.optionId ?? improvement.option_id,
                deleted: updates.deleted ?? improvement.deleted ?? false,
                updated_at: new Date().toISOString(),
                synced: 0,
                dirty: true,
            };

            console.log('[useNotes] Saving updated improvement:', {
                id: updated.id,
                label: updated.label,
                option_id: updated.option_id,
                deleted: updated.deleted,
                is_active: updated.is_active
            });

            await saveImprovementLocal(updated);


            // Update parent note's updated_at so it moves to top of list
            const parentUpdate: Note = {
                ...note,
                updated_at: new Date().toISOString(),
                synced: 0,
                dirty: true,
            };
            await saveNoteLocal(parentUpdate);

            await refreshFromLocal();
            syncService.scheduleAutoSync();

            console.log('[useNotes] Improvement update complete');
            return updated;
        },
        [refreshFromLocal]
    );

    const deleteImprovement = useCallback(
        async (noteId: string, improvementId: string) => {
            await updateImprovement(noteId, improvementId, { deleted: true });
        },
        [updateImprovement]
    );

    const setActiveVariant = useCallback(
        async (noteId: string, variantId: string | null) => {
            try {
                await setActiveVariantDB(noteId, variantId);
                await refreshFromLocal();

                // Immediate sync for logged-in users (is_active is user preference)
                if (isAuthenticated) {
                    console.log('[useNotes] Triggering immediate sync for is_active change');
                    syncService.syncNow('variant_switch');
                } else {
                    syncService.scheduleAutoSync();
                }
            } catch (error) {
                console.error('[useNotes] Failed to set active variant', error);
                throw error;
            }
        },
        [refreshFromLocal, isAuthenticated]
    );

    return {
        notes,
        loading,
        error,
        fetchNotes,
        syncNotes,
        createNote,
        updateNote,
        deleteNote,
        searchNotes,
        attachAudioToNote,
        removeAudioFromNote,
        createImprovement,
        updateImprovement,
        deleteImprovement,
        setActiveVariant,
    };
};
