import { useCallback, useRef, useState, useEffect } from 'react';
import { AppState } from 'react-native';
import { Note, NoteImprovement, NotePrivacy, StorageScope } from '../api/notes';
import { encrypt } from '../crypto/encryption';
import { subscribeMasterKey } from '../crypto/e2ee';
import { getCryptoMode } from '../crypto/encryption';
import {
    initDatabase,
    saveNoteLocal,
    getNotesLocal,
    deleteNoteLocal,
    saveImprovementLocal,
    setActiveVariant as setActiveVariantDB,
    getNoteById,
    getVoiceRecordingsLocal,
    deleteVoiceRecordingLocal,
    sanitizeLocalImprovementLabels,
} from '../services/DatabaseService';
import { useAuth } from './useAuth';
import { generateUUID } from '../utils/uuid';
import { syncService } from '../services/SyncService';
import { AudioService } from '../services/AudioService';
import { hasMeaningfulRichContent, richContentToPlainText } from '../utils/richContent';
import { listSearchTerms, matchesListQuery } from '../utils/noteSearch';
import { plainVariantTitle } from '../i18n/variantLabels';
import { sanitizeStepLabel } from '../i18n/variantLabels';

export interface NoteAudio {
    filePath: string;
    duration: number;
    transcription?: string;
}

export const useNotes = () => {
    const { isAuthenticated, userId } = useAuth();
    const [notes, setNotes] = useState<Note[]>([]);
    // Notes kept on the device that cannot be read without signing in / unlocking.
    const [lockedCount, setLockedCount] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isHydrated, setIsHydrated] = useState(false);
    const [isInitialSyncComplete, setIsInitialSyncComplete] = useState(false);
    const notesRef = useRef<Note[]>([]);
    const allNotesRef = useRef<Note[]>([]);
    const notesSignatureRef = useRef<string>('');
    const hydratedRef = useRef(false);
    const initialSyncRef = useRef(false);
    const lastBootstrapSyncAtRef = useRef<number | null>(null);
    const suppressSyncRefreshRef = useRef(true);
    const pendingSyncRefreshRef = useRef(false);

    const markHydrated = useCallback(() => {
        if (hydratedRef.current) return;
        hydratedRef.current = true;
        setIsHydrated(true);
    }, []);

    const markInitialSyncComplete = useCallback(() => {
        if (initialSyncRef.current) return;
        initialSyncRef.current = true;
        setIsInitialSyncComplete(true);
    }, []);

    const buildNotesSignature = useCallback((source: Note[]) => {
        return source.map((note) => {
            const activeChild = note.improvements?.find(imp => imp.is_active);
            return [
                note.id,
                note.updated_at ?? '',
                note.is_pinned ? '1' : '0',
                note.has_audio ? '1' : '0',
                note.storage_scope ?? '',
                note.privacy ?? '',
                activeChild?.id ?? '',
                activeChild?.updated_at ?? '',
                note.improvements?.length ?? 0,
            ].join(':');
        }).join('|');
    }, []);

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

    const normalizeStorageScope = useCallback((scope?: StorageScope): StorageScope => {
        return scope === 'local_only' ? 'local_only' : 'sync';
    }, []);

    const normalizePrivacy = useCallback((privacy?: NotePrivacy): NotePrivacy => {
        if (privacy === 'hidden') return privacy;
        return 'normal';
    }, []);

    const shouldSyncNote = useCallback((note: Partial<Note>): boolean => {
        const scope = normalizeStorageScope(note.storage_scope);
        if (scope !== 'sync') return false;
        // Same rule as SyncService: protected notes sync only end-to-end encrypted.
        return !note.is_protected || getCryptoMode() === 'e2ee';
    }, [normalizeStorageScope]);

    const isEmptyNote = useCallback(
        (note: Partial<Note>) => {
            const plainTitle = (note.title || '').trim();
            const hasContent = hasMeaningfulRichContent(note.content || '');
            const hasAudio = !!note.has_audio || !!note.audio_file_path;
            const hasImprovements = note.improvements && note.improvements.length > 0;
            return !plainTitle && !hasContent && !hasAudio && !hasImprovements;
        },
        [],
    );

    const filterAndCleanupNotes = useCallback(
        async (source: Note[]) => {
            const main: Note[] = [];
            for (const note of source) {
                if (note.deleted || note.pending_delete) {
                    continue;
                }
                // Undecryptable right now: hidden until the key is back (see Note.locked).
                if (note.locked) {
                    continue;
                }
                const privacy = normalizePrivacy(note.privacy);
                const normalized: Note = {
                    ...note,
                    storage_scope: normalizeStorageScope(note.storage_scope),
                    privacy,
                };

                if (isEmptyNote(note)) {
                    // Do not automatically delete empty notes here as it can lead to data loss during sync/encryption transitions.
                    // Just skip them in the main list if desired, but for now we keep them to be safe.
                }

                // Hidden mode is reserved; keep it out of default list.
                if (privacy === 'hidden') {
                    continue;
                }
                main.push(normalized);
            }
            return main;
        },
        [isEmptyNote, normalizePrivacy, normalizeStorageScope, userId],
    );

    const buildLocalNote = useCallback(
        async (params: {
            id: string;
            title: string;
            content: string;
            audio?: NoteAudio;
            transcription?: string;
            dirty?: boolean;
            storage_scope?: StorageScope;
            privacy?: NotePrivacy;
            is_protected?: boolean;
        }) => {
            if (!userId) throw new Error('Cannot save note without user ID');

            const {
                id,
                title,
                content,
                audio,
                transcription,
                dirty = true,
                storage_scope,
                privacy,
                is_protected = false,
            } = params;
            const normalizedPrivacy = normalizePrivacy(privacy);
            const normalizedScope = normalizeStorageScope(storage_scope);
            const encryptedTitle = await encrypt(title);
            const encryptedContent = await encrypt(content);
            const encryptedTranscription = transcription ? await encrypt(transcription) : undefined;
            const now = new Date().toISOString();
            const syncAllowed = shouldSyncNote({ storage_scope: normalizedScope, is_protected });
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
                dirty: syncAllowed ? dirty : false,
                deleted: false,
                version: 0,
                is_active: true, // New parent notes are active by default
                storage_scope: normalizedScope,
                privacy: normalizedPrivacy,
                is_protected,
                pending_server_delete: false,
            };
            await saveNoteLocal(userId, localNote);
            return localNote;
        },
        [normalizePrivacy, normalizeStorageScope, shouldSyncNote, userId]
    );

    const buildLocalImprovement = useCallback(
        async (params: {
            id: string;
            noteId: string;
            content: string;
            title?: string;
            label?: string;
            optionId?: string;
            storage_scope?: StorageScope;
            privacy?: NotePrivacy;
            // The parent's flag: a protected note's versions follow the same rule.
            is_protected?: boolean;
        }): Promise<NoteImprovement> => {
            if (!userId) throw new Error('Cannot save improvement without user ID');

            const { id, noteId, content, title, label, optionId, storage_scope, privacy, is_protected } = params;
            let encryptedContent = await encrypt(content);
            let encryptedTitle = title ? await encrypt(title) : undefined;

            if (encryptedContent === undefined || encryptedContent === null) {
                console.warn('[useNotes] Encryption returned null/undefined, defaulting to empty string');
                encryptedContent = '';
            }

            const now = new Date().toISOString();
            const improvementSyncAllowed = shouldSyncNote({
                storage_scope: storage_scope ?? 'sync',
                privacy: privacy ?? 'normal',
                is_protected,
            });
            const improvement: NoteImprovement = {
                id,
                note_id: noteId,
                encrypted_content: encryptedContent,
                encrypted_title: encryptedTitle,
                title,
                label,
                option_id: optionId,
                content,
                created_at: now,
                updated_at: now,
                synced: 0,
                dirty: improvementSyncAllowed,
                deleted: false,
                version: 0,
                ...(storage_scope ? { storage_scope } : {}),
                ...(privacy ? { privacy } : {}),
            };
            await saveImprovementLocal(userId, improvement);
            return improvement;
        },
        [shouldSyncNote, userId]
    );

    // Active list search. Notes are encrypted at rest, so searching the database would
    // decrypt every note on every keystroke; the decrypted notes are already in memory.
    const searchTermsRef = useRef<string[]>([]);
    const searchTextCacheRef = useRef(new WeakMap<Note, string>());

    const searchableText = useCallback((note: Note): string => {
        const cached = searchTextCacheRef.current.get(note);
        if (cached !== undefined) return cached;
        const parts = [note.title || '', richContentToPlainText(note.content || ''), note.transcription || ''];
        for (const imp of note.improvements || []) {
            if (imp.deleted) continue;
            parts.push(plainVariantTitle(imp.title) || '', richContentToPlainText(imp.content || ''));
        }
        const text = parts.join('\n');
        searchTextCacheRef.current.set(note, text);
        return text;
    }, []);

    const applyListSearch = useCallback((list: Note[]): Note[] => {
        const terms = searchTermsRef.current;
        if (terms.length === 0) return list;
        return list.filter((note) => matchesListQuery(searchableText(note), terms));
    }, [searchableText]);

    const refreshFromLocal = useCallback(async () => {
        if (!userId) {
            setNotes([]);
            allNotesRef.current = [];
            notesRef.current = [];
            notesSignatureRef.current = '';
            markHydrated();
            markInitialSyncComplete();
            return [];
        }

        const localNotes = await getNotesLocal(userId);
        setLockedCount(localNotes.filter((n) => n.locked && !n.deleted && !n.pending_delete).length);
        const visibleMain = await filterAndCleanupNotes(localNotes);

        const nextSignature = buildNotesSignature(visibleMain);
        const prevSignature = notesSignatureRef.current;
        allNotesRef.current = visibleMain;
        notesRef.current = visibleMain;
        notesSignatureRef.current = nextSignature;
        if (nextSignature !== prevSignature) {
            // A background refresh must not drop an active list search.
            setNotes(applyListSearch(visibleMain));
        }
        markHydrated();
        return visibleMain;
    }, [applyListSearch, buildNotesSignature, filterAndCleanupNotes, markHydrated, markInitialSyncComplete, userId]);

    // The master key is restored asynchronously at startup (and after a JS
    // reload). Notes read before that decrypt to nothing and are filtered out,
    // so re-read as soon as the key becomes available.
    useEffect(() => {
        const unsubscribe = subscribeMasterKey((available) => {
            if (!available) {
                return;
            }
            if (suppressSyncRefreshRef.current) {
                pendingSyncRefreshRef.current = true;
                return;
            }
            void refreshFromLocal();
        });
        return unsubscribe;
    }, [refreshFromLocal]);

    // Subscribe to SyncService updatess
    useEffect(() => {
        const unsubscribe = syncService.subscribe(() => {
            console.log('[useNotes] Sync finished, refreshing local notes');
            if (suppressSyncRefreshRef.current) {
                pendingSyncRefreshRef.current = true;
                return;
            }
            refreshFromLocal();
        });
        return unsubscribe;
    }, [refreshFromLocal]);

    // Re-fetch and run initial sync on user change
    useEffect(() => {
        let cancelled = false;
        const INITIAL_SYNC_TIMEOUT_MS = 8000;

        hydratedRef.current = false;
        initialSyncRef.current = false;
        suppressSyncRefreshRef.current = true;
        pendingSyncRefreshRef.current = false;
        setIsHydrated(false);
        setIsInitialSyncComplete(false);
        lastBootstrapSyncAtRef.current = null;

        const bootstrap = async () => {
            if (userId) {
                // Older versions stored note text in the (unencrypted) label; drop it locally too.
                await sanitizeLocalImprovementLabels(userId);
            }
            await refreshFromLocal();
            if (cancelled || !userId) {
                suppressSyncRefreshRef.current = false;
                pendingSyncRefreshRef.current = false;
                return;
            }

            if (!isAuthenticated) {
                suppressSyncRefreshRef.current = false;
                if (pendingSyncRefreshRef.current) {
                    pendingSyncRefreshRef.current = false;
                    await refreshFromLocal();
                }
                markInitialSyncComplete();
                return;
            }

            let timeoutId: NodeJS.Timeout | null = null;
            try {
                const timeoutPromise = new Promise<void>((resolve) => {
                    timeoutId = setTimeout(resolve, INITIAL_SYNC_TIMEOUT_MS);
                });
                await Promise.race([
                    syncService.syncNow('app_start'),
                    timeoutPromise,
                ]);
            } catch (err) {
                console.warn('[useNotes] Initial sync failed', err);
            } finally {
                if (cancelled) {
                    return;
                }
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
                await refreshFromLocal();
                suppressSyncRefreshRef.current = false;
                if (pendingSyncRefreshRef.current) {
                    pendingSyncRefreshRef.current = false;
                    await refreshFromLocal();
                }
                lastBootstrapSyncAtRef.current = Date.now();
                if (!cancelled) {
                    markInitialSyncComplete();
                }
            }
        };

        void bootstrap();

        return () => {
            cancelled = true;
        };
    }, [isAuthenticated, markInitialSyncComplete, refreshFromLocal, userId]);

    // Periodic Sync Interval (30s)
    useEffect(() => {
        if (!isAuthenticated || !userId) return;

        console.log('[useNotes] Starting periodic sync interval');
        const intervalId = setInterval(async () => {
            if (AppState.currentState !== 'active') return;

            try {
                const hasChanges = await syncService.hasUnsyncedChanges();
                if (hasChanges) {
                    console.log('[useNotes] Periodic check: Found unsynced changes, syncing...');
                    await syncService.syncNow('auto');
                }
            } catch (e) {
                console.warn('[useNotes] Periodic sync check failed', e);
            }
        }, 30000); // 30 seconds

        return () => {
            clearInterval(intervalId);
        };
    }, [isAuthenticated, userId]);

    const fetchNotes = useCallback(async () => {
        console.log('[useNotes] fetchNotes called');
        setLoading(true);
        setError(null);
        try {
            await refreshFromLocal();
            // Trigger sync on fetch (e.g. screen mount)
            if (isAuthenticated && userId) {
                const lastBootstrap = lastBootstrapSyncAtRef.current;
                const now = Date.now();
                const recentlyBootstrapped = !!lastBootstrap && now - lastBootstrap < 8000;
                if (!recentlyBootstrapped) {
                    syncService.syncNow('app_start');
                }
            }
        } catch (err) {
            console.error('[useNotes] Error fetching notes:', err);
            setError('Failed to fetch notes');
        } finally {
            setLoading(false);
        }
    }, [refreshFromLocal, isAuthenticated, userId]);

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

    const createNote = async (data: {
        title?: string;
        content: string;
        audio?: NoteAudio;
        storage_scope?: StorageScope;
        privacy?: NotePrivacy;
        is_protected?: boolean;
    }) => {
        const { title, content, audio, storage_scope, privacy, is_protected } = data;
        const titleToUse = buildTitle(title);
        const contentToUse = content || '';
        const isEmpty = !titleToUse.trim() && !hasMeaningfulRichContent(contentToUse) && !audio;
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
                storage_scope: storage_scope ?? 'sync',
                privacy: privacy ?? 'normal',
                is_protected: !!is_protected,
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
        if (!userId) return Promise.reject(new Error('No user'));

        setLoading(true);
        setError(null);
        try {
            let existing = notesRef.current.find(n => n.id === id) || allNotesRef.current.find(n => n.id === id);
            if (!existing && userId) {
                const dbNote = await getNoteById(userId, id);
                if (dbNote) existing = dbNote;
            }
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
            const willBeEmpty = !titleToUse.trim() && !hasMeaningfulRichContent(contentToUse) && !hasAudio;
            if (willBeEmpty && !hasImprovements) {
                await deleteNote(id);
                return existing;
            }

            const nextPrivacy = normalizePrivacy(updates.privacy ?? existing.privacy);
            const nextScope = normalizeStorageScope((updates.storage_scope ?? existing.storage_scope) as StorageScope);
            const pendingServerDelete = updates.pending_server_delete ?? existing.pending_server_delete ?? false;
            const dirtyFlag = shouldSyncNote({
                storage_scope: nextScope,
                privacy: nextPrivacy,
                is_protected: updates.is_protected ?? existing.is_protected,
            }) || pendingServerDelete;

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
                dirty: dirtyFlag,
                deleted: false,
                storage_scope: nextScope,
                privacy: nextPrivacy,
                pending_server_delete: pendingServerDelete,
            };
            await saveNoteLocal(userId, updatedLocal);
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
        if (!userId) return;
        setLoading(true);
        setError(null);
        try {
            const existing = notesRef.current.find(n => n.id === id) || allNotesRef.current.find(n => n.id === id);
            if (!existing) {
                // If not in memory, try to delete from DB anyway (maybe it's hidden)
                await deleteNoteLocal(userId, id);
                await refreshFromLocal();
                return;
            }

            const audioPaths = new Set<string>();
            if (typeof existing.audio_file_path === 'string' && existing.audio_file_path.length > 0) {
                audioPaths.add(existing.audio_file_path);
            }
            const recordings = await getVoiceRecordingsLocal(userId, id);
            for (const recording of recordings) {
                if (recording.file_path) {
                    audioPaths.add(recording.file_path);
                }
                await deleteVoiceRecordingLocal(userId, recording.id);
            }
            for (const path of audioPaths) {
                try {
                    // Critical: note deletion must physically remove local audio blobs.
                    await AudioService.deleteAudioFile(path);
                } catch (audioError) {
                    console.warn('[useNotes] Failed to delete note audio file', path, audioError);
                }
            }

            const marked: Note = {
                ...existing,
                deleted: true, // Soft delete
                has_audio: false,
                audio_file_path: undefined,
                audio_duration: undefined,
                synced: 0,
                dirty: shouldSyncNote(existing) || !!existing.pending_server_delete,
                updated_at: new Date().toISOString(),
            };
            await saveNoteLocal(userId, marked);
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

    /** Every visible note, regardless of an active list search (which narrows `notes`). */
    const getAllNotes = useCallback((): Note[] => allNotesRef.current, []);

    const searchNotes = async (query: string) => {
        if (!userId) return;
        searchTermsRef.current = listSearchTerms(query);
        setNotes(applyListSearch(allNotesRef.current));
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
            params: { content: string; title?: string; label?: string; optionId?: string }
        ): Promise<NoteImprovement> => {
            if (!userId) throw new Error('No user');

            let note = notesRef.current.find(n => n.id === noteId);
            if (!note) {
                // Fallback to DB for fast-following updates
                const dbNote = await getNoteById(userId, noteId);
                if (dbNote) note = dbNote;
            }
            if (!note) throw new Error('Note not found');
            const id = await generateUUID();

            // Ensure content is string
            const safeContent = params.content || '';

            console.log('[useNotes] createImprovement', {
                id,
                noteId,
                label: params.label
            });

            const uniqueLabel = sanitizeStepLabel(params.label, params.optionId);

            const improvement = await buildLocalImprovement({
                id,
                noteId,
                content: safeContent,
                title: params.title,
                label: uniqueLabel,
                optionId: params.optionId,
                storage_scope: note.storage_scope,
                privacy: note.privacy,
                is_protected: note.is_protected,
            });

            if (!improvement) throw new Error('Failed to build local improvement');

            // Always base parent update on the freshest DB state to avoid clobbering
            // fields like title during concurrent note/improvement updates.
            const refreshedParent = await getNoteById(userId, noteId);
            const parentBase = refreshedParent || note;

            const parentUpdate: Note = {
                ...parentBase,
                encrypted_content: parentBase.encrypted_content || '', // Fallback to avoid constraint viol
                updated_at: new Date().toISOString(),
                synced: 0,
                dirty: shouldSyncNote(parentBase) || !!parentBase.pending_server_delete,
            };
            await saveNoteLocal(userId, parentUpdate);

            await refreshFromLocal();
            syncService.scheduleAutoSync();
            return improvement;
        },
        [buildLocalImprovement, refreshFromLocal, userId]
    );

    const updateImprovement = useCallback(
        async (
            noteId: string,
            improvementId: string,
            updates: { content?: string; title?: string; label?: string; optionId?: string; deleted?: boolean }
        ): Promise<NoteImprovement> => {
            if (!userId) throw new Error('No user');

            console.log('[useNotes] updateImprovement called:', {
                noteId,
                improvementId,
                updates: { ...updates, content: updates.content ? '<hidden>' : undefined }
            });

            let note = notesRef.current.find(n => n.id === noteId);
            if (!note) {
                const dbNote = await getNoteById(userId, noteId);
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

            let encryptedTitle = improvement.encrypted_title;
            if (typeof updates.title === 'string') {
                encryptedTitle = await encrypt(updates.title);
            } else if (updates.title === null) {
                // If it were nullable
            }

            const updated: NoteImprovement = {
                ...improvement,
                note_id: noteId, // Ensure parent ID is preserved
                encrypted_content: encryptedContent,
                encrypted_title: encryptedTitle,
                title: typeof updates.title === 'string' ? updates.title : improvement.title,
                content: plainContent,
                label: sanitizeStepLabel(updates.label ?? improvement.label, updates.optionId ?? improvement.option_id),
                option_id: updates.optionId ?? improvement.option_id,
                deleted: updates.deleted ?? improvement.deleted ?? false,
                updated_at: new Date().toISOString(),
                synced: 0,
                dirty: shouldSyncNote(note) && !note.pending_server_delete,
            };

            await saveImprovementLocal(userId, updated);


            // Use freshest parent from DB to avoid overwriting recently changed title/content.
            const refreshedParent = await getNoteById(userId, noteId);
            const parentBase = refreshedParent || note;

            const parentUpdate: Note = {
                ...parentBase,
                updated_at: new Date().toISOString(),
                synced: 0,
                dirty: shouldSyncNote(parentBase) || !!parentBase.pending_server_delete,
            };
            await saveNoteLocal(userId, parentUpdate);

            await refreshFromLocal();
            syncService.scheduleAutoSync();

            console.log('[useNotes] Improvement update complete');
            return updated;
        },
        [refreshFromLocal, userId]
    );

    const deleteImprovement = useCallback(
        async (noteId: string, improvementId: string) => {
            await updateImprovement(noteId, improvementId, { deleted: true });
        },
        [updateImprovement]
    );

    const setActiveVariant = useCallback(
        async (noteId: string, variantId: string | null) => {
            if (!userId) return;
            try {
                await setActiveVariantDB(userId, noteId, variantId);
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
        [refreshFromLocal, isAuthenticated, userId]
    );

    const pinNote = useCallback(
        async (id: string) => {
            if (!userId) return;
            try {
                const existing = notesRef.current.find(n => n.id === id) || allNotesRef.current.find(n => n.id === id);
                if (!existing) throw new Error('Note not found');

                const updated: Note = {
                    ...existing,
                    is_pinned: true,
                    updated_at: new Date().toISOString(),
                    synced: 0,
                    dirty: shouldSyncNote(existing) || !!existing.pending_server_delete,
                };
                await saveNoteLocal(userId, updated);
                await refreshFromLocal();
                syncService.scheduleAutoSync();
            } catch (error) {
                console.error('[useNotes] Failed to pin note', error);
                throw error;
            }
        },
        [refreshFromLocal, userId]
    );

    const unpinNote = useCallback(
        async (id: string) => {
            if (!userId) return;
            try {
                const existing = notesRef.current.find(n => n.id === id) || allNotesRef.current.find(n => n.id === id);
                if (!existing) throw new Error('Note not found');

                const updated: Note = {
                    ...existing,
                    is_pinned: false,
                    updated_at: new Date().toISOString(),
                    synced: 0,
                    dirty: shouldSyncNote(existing) || !!existing.pending_server_delete,
                };
                await saveNoteLocal(userId, updated);
                await refreshFromLocal();
                syncService.scheduleAutoSync();
            } catch (error) {
                console.error('[useNotes] Failed to unpin note', error);
                throw error;
            }
        },
        [refreshFromLocal, userId]
    );

    const batchPinNotes = useCallback(
        async (ids: string[]) => {
            if (!userId) return;
            try {
                for (const id of ids) {
                    const existing = notesRef.current.find(n => n.id === id) || allNotesRef.current.find(n => n.id === id);
                    if (existing) {
                        const updated: Note = {
                            ...existing,
                            is_pinned: true,
                            updated_at: new Date().toISOString(),
                            synced: 0,
                            dirty: shouldSyncNote(existing) || !!existing.pending_server_delete,
                        };
                        await saveNoteLocal(userId, updated);
                    }
                }
                await refreshFromLocal();
                syncService.scheduleAutoSync();
            } catch (error) {
                console.error('[useNotes] Failed to batch pin notes', error);
                throw error;
            }
        },
        [refreshFromLocal, userId]
    );

    const batchUnpinNotes = useCallback(
        async (ids: string[]) => {
            if (!userId) return;
            try {
                for (const id of ids) {
                    const existing = notesRef.current.find(n => n.id === id) || allNotesRef.current.find(n => n.id === id);
                    if (existing) {
                        const updated: Note = {
                            ...existing,
                            is_pinned: false,
                            updated_at: new Date().toISOString(),
                            synced: 0,
                            dirty: shouldSyncNote(existing) || !!existing.pending_server_delete,
                        };
                        await saveNoteLocal(userId, updated);
                    }
                }
                await refreshFromLocal();
                syncService.scheduleAutoSync();
            } catch (error) {
                console.error('[useNotes] Failed to batch unpin notes', error);
                throw error;
            }
        },
        [refreshFromLocal, userId]
    );

    const batchDeleteNotes = useCallback(
        async (ids: string[]) => {
            if (!userId) return;
            try {
                for (const id of ids) {
                    const existing = notesRef.current.find(n => n.id === id) || allNotesRef.current.find(n => n.id === id);
                    if (existing) {
                        const audioPaths = new Set<string>();
                        if (typeof existing.audio_file_path === 'string' && existing.audio_file_path.length > 0) {
                            audioPaths.add(existing.audio_file_path);
                        }
                        const recordings = await getVoiceRecordingsLocal(userId, id);
                        for (const recording of recordings) {
                            if (recording.file_path) {
                                audioPaths.add(recording.file_path);
                            }
                            await deleteVoiceRecordingLocal(userId, recording.id);
                        }
                        for (const path of audioPaths) {
                            try {
                                // Critical: batch delete must also purge on-disk audio.
                                await AudioService.deleteAudioFile(path);
                            } catch (audioError) {
                                console.warn('[useNotes] Failed to delete note audio file', path, audioError);
                            }
                        }

                        const marked: Note = {
                            ...existing,
                            deleted: true,
                            has_audio: false,
                            audio_file_path: undefined,
                            audio_duration: undefined,
                            synced: 0,
                            dirty: shouldSyncNote(existing) || !!existing.pending_server_delete,
                            updated_at: new Date().toISOString(),
                        };
                        await saveNoteLocal(userId, marked);
                    }
                }
                await refreshFromLocal();
                syncService.scheduleAutoSync();
            } catch (error) {
                console.error('[useNotes] Failed to batch delete notes', error);
                throw error;
            }
        },
        [refreshFromLocal, userId]
    );

    const updateNoteStorageScope = useCallback(
        async (id: string, storageScope: StorageScope) => {
            if (!userId) return;
            const existing = allNotesRef.current.find((n) => n.id === id);
            if (!existing) {
                throw new Error('Note not found');
            }

            const currentPrivacy = normalizePrivacy(existing.privacy);
            const nextScope = normalizeStorageScope(storageScope);
            const wasSync = normalizeStorageScope(existing.storage_scope) === 'sync';
            const hasServerVersion = (existing.synced === 1) || (existing.version ?? 0) > 0;
            const pendingServerDelete = nextScope === 'local_only' && wasSync && hasServerVersion;
            const nextDirty = shouldSyncNote({
                storage_scope: nextScope,
                privacy: currentPrivacy,
            }) || pendingServerDelete;

            const updated: Note = {
                ...existing,
                storage_scope: nextScope,
                privacy: currentPrivacy,
                pending_server_delete: pendingServerDelete,
                updated_at: new Date().toISOString(),
                synced: 0,
                dirty: nextDirty,
            };

            await saveNoteLocal(userId, updated);
            await refreshFromLocal();
            if (nextDirty) {
                syncService.scheduleAutoSync();
            }
        },
        [normalizePrivacy, normalizeStorageScope, refreshFromLocal, shouldSyncNote, userId]
    );

    /**
     * Protect a note (it never leaves the device unencrypted) and choose whether it
     * syncs. When the note stops being syncable — sync turned off, or protected on
     * an account without end-to-end encryption — its server copy is deleted while
     * the local one stays.
     */
    const updateNoteProtection = useCallback(
        async (id: string, next: { isProtected: boolean; sync: boolean }) => {
            if (!userId) return;
            const existing = allNotesRef.current.find((n) => n.id === id);
            if (!existing) {
                throw new Error('Note not found');
            }
            const candidate: Note = {
                ...existing,
                is_protected: next.isProtected,
                storage_scope: next.sync ? 'sync' : 'local_only',
            };
            const wasSyncable = shouldSyncNote(existing);
            const willSync = shouldSyncNote(candidate);
            const hasServerVersion = (existing.synced === 1) || (existing.version ?? 0) > 0;
            const pendingServerDelete = wasSyncable && !willSync && hasServerVersion;

            const updated: Note = {
                ...candidate,
                privacy: normalizePrivacy(existing.privacy),
                // Turning sync back on cancels a server delete that has not gone out yet.
                pending_server_delete: willSync ? false : (pendingServerDelete || !!existing.pending_server_delete),
                updated_at: new Date().toISOString(),
                synced: 0,
                dirty: willSync || pendingServerDelete,
            };

            await saveNoteLocal(userId, updated);
            await refreshFromLocal();
            if (updated.dirty) {
                syncService.scheduleAutoSync();
            }
        },
        [normalizePrivacy, refreshFromLocal, shouldSyncNote, userId]
    );

    const updateNotePrivacy = useCallback(
        async (id: string, privacy: NotePrivacy) => {
            if (!userId) return;
            const existing = allNotesRef.current.find((n) => n.id === id);
            if (!existing) {
                throw new Error('Note not found');
            }

            const nextPrivacy = normalizePrivacy(privacy);
            const currentScope = normalizeStorageScope(existing.storage_scope);
            const nextScope: StorageScope = currentScope;
            const hasServerVersion = (existing.synced === 1) || (existing.version ?? 0) > 0;
            const pendingServerDelete = nextScope === 'local_only' && currentScope === 'sync' && hasServerVersion;

            const nextDirty = shouldSyncNote({
                storage_scope: nextScope,
                privacy: nextPrivacy,
            }) || pendingServerDelete;

            const updated: Note = {
                ...existing,
                storage_scope: nextScope,
                privacy: nextPrivacy,
                pending_server_delete: pendingServerDelete,
                updated_at: new Date().toISOString(),
                synced: 0,
                dirty: nextDirty,
            };
            await saveNoteLocal(userId, updated);

            if (existing.improvements?.length) {
                for (const imp of existing.improvements) {
                    await saveImprovementLocal(userId, {
                        id: imp.id,
                        note_id: existing.id,
                        encrypted_content: imp.encrypted_content,
                        encrypted_title: imp.encrypted_title,
                        content_nonce: imp.content_nonce,
                        label: imp.label,
                        option_id: imp.option_id,
                        created_at: imp.created_at,
                        updated_at: new Date().toISOString(),
                        synced: 0,
                        dirty: nextDirty,
                        deleted: imp.deleted ?? false,
                        version: imp.version ?? 0,
                        is_active: imp.is_active ?? false,
                        storage_scope: nextScope,
                        privacy: nextPrivacy,
                        pending_server_delete: pendingServerDelete,
                    } as any);
                }
            }

            await refreshFromLocal();
            if (nextDirty) {
                syncService.scheduleAutoSync();
            }
        },
        [normalizePrivacy, normalizeStorageScope, refreshFromLocal, shouldSyncNote, userId]
    );

    return {
        notes,
        loading,
        error,
        isHydrated,
        isInitialSyncComplete,
        fetchNotes,
        createNote,
        updateNote,
        deleteNote,
        searchNotes,
        getAllNotes,
        lockedCount,
        syncNotes,
        attachAudioToNote,
        removeAudioFromNote,
        createImprovement,
        updateImprovement,
        deleteImprovement,
        setActiveVariant,
        pinNote,
        unpinNote,
        batchPinNotes,
        batchUnpinNotes,
        batchDeleteNotes,
        updateNoteStorageScope,
        updateNoteProtection,
        updateNotePrivacy,
    };
};
