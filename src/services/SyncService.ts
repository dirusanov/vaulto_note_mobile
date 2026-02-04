import { AppState, AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    notesApi,
    Note,
    ServerNote,
    ServerImprovement,
    SyncChangeRequest,
    SyncImprovementChangeRequest,
} from '../api/notes';
import {
    getNotesLocal,
    saveNoteLocal,
    deleteNoteLocal,
    getAllImprovementsLocal,
    saveImprovementLocal,
} from './DatabaseService';
import { decrypt, encrypt } from '../crypto/encryption';
import { isUUID } from '../utils/uuid';

const SYNC_SINCE_KEY = 'vaulto_last_sync_time';
const SYNC_DEBOUNCE_MS = 5000;
const RESUME_SYNC_THRESHOLD_MS = 30000; // 30 seconds

type SyncReason = 'app_start' | 'resume' | 'auto' | 'manual' | 'variant_switch';
type SyncListener = () => void;

class SyncService {
    private isSyncing = false;
    private lastSyncAt: number = 0;
    private syncTimeout: NodeJS.Timeout | null = null;
    private listeners: SyncListener[] = [];
    private isAuthenticated = false;
    private currentUserId: string | null = null;

    constructor() {
        // Load last sync time from storage
        AsyncStorage.getItem(SYNC_SINCE_KEY).then(val => {
            if (val) {
                this.lastSyncAt = parseInt(val, 10);
            }
        });

        // App State Listener
        AppState.addEventListener('change', this.handleAppStateChange);
    }

    public setAuthenticated(auth: boolean) {
        this.isAuthenticated = auth;
    }

    public async setCurrentUser(userId: string | null, previousUserId?: string | null) {
        // Wait for any in-flight sync to avoid racing migrations
        while (this.isSyncing) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        const lastKnown = previousUserId ?? this.currentUserId;
        if (userId === lastKnown) {
            this.currentUserId = userId;
            return;
        }

        if (userId) {
            await this.migrateLocalNotesToUser();
            this.currentUserId = userId;
        } else {
            this.currentUserId = null;
        }
    }

    public subscribe(listener: SyncListener) {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    private notifyListeners() {
        this.listeners.forEach(l => l());
    }

    private handleAppStateChange = (nextAppState: AppStateStatus) => {
        if (nextAppState === 'active') {
            const now = Date.now();
            if (now - this.lastSyncAt > RESUME_SYNC_THRESHOLD_MS) {
                this.syncNow('resume');
            }
        }
    };

    public scheduleAutoSync() {
        if (this.syncTimeout) {
            clearTimeout(this.syncTimeout);
        }
        this.syncTimeout = setTimeout(() => {
            this.syncNow('auto');
        }, SYNC_DEBOUNCE_MS);
    }

    public async syncNow(reason: SyncReason) {
        if (this.isSyncing) {
            console.log(`[SyncService] Sync already in progress. Reason: ${reason} ignored.`);
            return;
        }

        if (!this.isAuthenticated) {
            console.log('[SyncService] Not authenticated. Skipping sync.');
            return;
        }

        console.log(`[SyncService] Starting sync. Reason: ${reason}`);
        this.isSyncing = true;

        try {
            // 1. Gather local changes
            const allNotes = await getNotesLocal();
            const allImprovements = await getAllImprovementsLocal();
            const dirtyNotes = allNotes.filter(n => n.dirty || n.deleted || n.pending_delete);
            const dirtyImprovements = allImprovements.filter(imp => imp.dirty || imp.deleted);
            const hasLocalNotes = allNotes.length > 0;

            // 2. Prepare changes for server
            const changes: SyncChangeRequest[] = [];
            const improvementChanges: SyncImprovementChangeRequest[] = [];
            const noteMap = new Map<string, Note>();
            const improvementMap = new Map<string, typeof dirtyImprovements[number]>();

            for (const note of dirtyNotes) {
                // Ensure UUID
                if (!isUUID(note.id)) {
                    // If it's a temp ID, we should have already replaced it, but let's be safe
                    // Actually useNotes handles ID generation. We assume IDs are valid UUIDs here or handled before.
                    // If we encounter a non-UUID here, it might be tricky without updating the ID in DB first.
                    // For now, assume useNotes ensures UUIDs.
                }

                noteMap.set(note.id, note);

                // Encrypt title for valid E2E
                // Ideally note.encrypted_title is already set/up-to-date.
                // If not, we generate it now.
                const titleToSync = note.encrypted_title || await encrypt(note.title || '');

                changes.push({
                    id: note.id,
                    content_ciphertext: note.encrypted_content,
                    content_nonce: note.content_nonce ?? null,
                    title: titleToSync,
                    deleted: !!note.deleted || !!note.pending_delete,
                    base_version: note.version ?? 0,
                    client_updated_at: note.updated_at || new Date().toISOString(),
                    is_active: note.is_active,
                    last_variant_id: null, // Deprecated: using is_active now
                });
            }

            for (const improvement of dirtyImprovements) {
                improvementMap.set(improvement.id, improvement);
                // Fetch parent note to check for is_active
                const parentNote = allNotes.find(n => n.id === improvement.note_id);
                const activeChild = parentNote?.improvements?.find(imp => imp.is_active);
                const isActive = activeChild?.id === improvement.id;

                improvementChanges.push({
                    id: improvement.id,
                    note_id: improvement.note_id,
                    content_ciphertext: improvement.encrypted_content,
                    content_nonce: improvement.content_nonce ?? null,
                    encrypted_title: improvement.encrypted_title ?? null,
                    label: improvement.label ?? null,
                    option_id: improvement.option_id ?? null,
                    deleted: !!improvement.deleted,
                    base_version: improvement.version ?? 0,
                    client_updated_at: improvement.updated_at || new Date().toISOString(),
                    is_active: isActive,
                });
            }

            // 3. Send to server
            // We always ask for server changes if it's not just a quick save (or maybe always?)
            // User said: "Отправляем на сервер одним батчем... Сервер возвращает обновлённые заметки"
            // We should send `since` timestamp.

            // If we have never synced or local cache is empty (e.g. after manual wipe), pull everything.
            // Otherwise, use last sync timestamp.
            const since = !hasLocalNotes || this.lastSyncAt === 0
                ? '1970-01-01T00:00:00+00:00'
                : new Date(this.lastSyncAt).toISOString();

            const response = await notesApi.sync({
                changes,
                improvement_changes: improvementChanges,
                since_updated_at: since,
            });

            // 4. Process response
            const incoming = [
                ...response.updated,
                ...response.server_changes,
                ...response.conflicts
            ];

            // Deduplicate
            const uniqueIncoming = new Map<string, ServerNote>();
            incoming.forEach(n => uniqueIncoming.set(n.id, n));

            if (uniqueIncoming.size > 0) {
                await this.applyServerChanges(Array.from(uniqueIncoming.values()));
            }

            const incomingImprovements = [
                ...(response.improvement_updates || []),
                ...(response.improvement_changes || []),
            ];
            if (incomingImprovements.length > 0) {
                await this.applyServerImprovements(incomingImprovements);
            }

            // 5. Mark local dirty notes as synced (if they were in the request and not in conflict/update response?)
            // Actually, if we sent them and got no error, we assume they are synced.
            // But if there was a conflict, they are in the response.
            // If they were successfully updated, they might be in `updated`?
            // Usually sync response `updated` contains the notes that were successfully written? 
            // Or `updated` means "here is the new state of the note you sent".

            // Let's assume we clear dirty for everything we sent, UNLESS it came back in the response (which we just handled).
            // Actually, `applyServerChanges` will overwrite them.
            // So we can just clear dirty for all `changes` we sent.
            // But we must be careful not to clear dirty if the user edited it *while* syncing.
            // But we are single threaded in JS.
            // If `applyServerChanges` updates the note, it saves it with `dirty=false` (synced=1).

            // What about notes we sent but didn't get back? (Successful write, no change from server side logic?)
            // Typically sync protocols return the new version.
            // If the server returns nothing for a sent change, it implies success?
            // Let's look at `useNotes` implementation of `syncWithServer`.
            // It calls `dedupeServerNotes([...response.updated, ...response.server_changes, ...response.conflicts])`.
            // Then `applyServerNotes`.
            // It doesn't explicitly clear dirty for sent notes that didn't come back.
            // This implies the server returns EVERYTHING that changed, including what we just sent (with new version).

            // If so, `applyServerChanges` handles it.

            // But what if we sent a note and server didn't return it? (e.g. no change in version?)
            // We should probably clear dirty flag for the notes we sent.

            for (const change of changes) {
                // If we have a local note that is still dirty/deleted, and we haven't overwritten it with server response yet...
                // We need to be careful.
                // Simplest: `applyServerChanges` handles the ones returned.
                // For the ones NOT returned, we assume success and clear dirty?
                // Or does the server always return the updated note?
                // Assuming server always returns updated note is safer.

                // If we assume server returns updated notes, then `applyServerChanges` will save them as clean.
                // If the server DOES NOT return them, they stay dirty? That would cause loops.
                // Let's assume we need to mark them clean.

                if (!uniqueIncoming.has(change.id)) {
                    const local = noteMap.get(change.id);
                    if (local) {
                        // If it was a delete, and server didn't return it, it's gone.
                        if (change.deleted) {
                            await deleteNoteLocal(local.id); // Hard delete?
                        } else {
                            // Mark clean
                            await saveNoteLocal({ ...local, dirty: false, synced: 1 });
                        }
                    }
                }
            }

            if (improvementChanges.length > 0) {
                const processedImprovementIds = new Set(
                    [
                        ...(response.improvement_updates || []),
                        ...(response.improvement_changes || []),
                    ].map(imp => imp.id)
                );
                for (const change of improvementChanges) {
                    if (processedImprovementIds.has(change.id)) {
                        continue;
                    }
                    const localImprovement = improvementMap.get(change.id);
                    if (!localImprovement) continue;
                    await saveImprovementLocal({
                        ...localImprovement,
                        dirty: false,
                        synced: 1,
                    });
                }
            }

            this.lastSyncAt = Date.now();
            await AsyncStorage.setItem(SYNC_SINCE_KEY, this.lastSyncAt.toString());

            this.notifyListeners();

        } catch (e) {
            console.error('[SyncService] Sync failed', e);
            // Don't clear dirty flags, so we retry next time.
        } finally {
            this.isSyncing = false;
        }
    }

    private async migrateLocalNotesToUser() {
        try {
            const notes = await getNotesLocal();
            if (!notes.length) {
                this.lastSyncAt = 0;
                await AsyncStorage.setItem(SYNC_SINCE_KEY, '0');
                return;
            }

            console.log('[SyncService] Migrating local notes to current user, marking as dirty...');
            for (const note of notes) {
                const isDeleted = !!note.deleted || !!note.pending_delete;
                const migrated: Note = {
                    ...note,
                    synced: 0,
                    dirty: true,
                    deleted: isDeleted,
                    pending_delete: note.pending_delete ?? isDeleted,
                    version: 0,
                    server_updated_at: undefined,
                    conflict_of: null,
                    // Keep original timestamps; user did not edit now.
                    updated_at: note.updated_at,
                };
                await saveNoteLocal(migrated);
            }

            this.lastSyncAt = 0;
            await AsyncStorage.setItem(SYNC_SINCE_KEY, '0');
            console.log('[SyncService] Migration complete. All notes will be uploaded on next sync.');
        } catch (e) {
            console.error('[SyncService] Failed to migrate notes to new user', e);
        }
    }

    private async applyServerImprovements(improvements: ServerImprovement[]) {
        for (const improvement of improvements) {
            await saveImprovementLocal({
                id: improvement.id,
                note_id: improvement.note_id,
                encrypted_content: improvement.content_ciphertext,
                encrypted_title: improvement.encrypted_title ?? null,
                content_nonce: improvement.content_nonce ?? null,
                label: improvement.label ?? null,
                option_id: improvement.option_id ?? null,
                deleted: improvement.deleted,
                version: improvement.version,
                created_at: improvement.updated_at,
                updated_at: improvement.updated_at,
                synced: 1,
                dirty: false,
                is_active: improvement.is_active ?? false,
            } as any);
        }
    }

    private async applyServerChanges(serverNotes: ServerNote[]) {
        const localNotes = await getNotesLocal();
        const localMap = new Map(localNotes.map(n => [n.id, n]));

        for (const serverNote of serverNotes) {
            const existing = localMap.get(serverNote.id);
            const serverNonce = serverNote.content_nonce ?? null;

            // Skip if nothing changed (prevents updated_at churn on no-op syncs)
            const unchanged =
                existing &&
                existing.version === serverNote.version &&
                existing.encrypted_content === serverNote.content_ciphertext &&
                (existing.content_nonce ?? null) === serverNonce &&
                existing.deleted === serverNote.deleted;
            if (unchanged) {
                continue;
            }

            if (serverNote.deleted) {
                await deleteNoteLocal(serverNote.id); // Hard delete locally
                localMap.delete(serverNote.id);
                continue;
            }

            // Decrypt server payload for local cache
            // Decrypt server payload for local cache
            let title = 'Untitled';
            let content = '';
            let encryptedTitle = serverNote.title || undefined;

            try {
                if (serverNote.content_ciphertext) {
                    content = await decrypt(serverNote.content_ciphertext);
                } else {
                    console.warn(`[SyncService] Note ${serverNote.id} has no content ciphertext`);
                }

                // Handle title decryption
                if (serverNote.title) {
                    try {
                        title = await decrypt(serverNote.title);
                    } catch (e) {
                        // Title might be plaintext (legacy)
                        // console.log('[SyncService] Title decryption failed, assuming plaintext');
                        title = serverNote.title;
                        // Re-encrypt for local consistency
                        encryptedTitle = await encrypt(title);
                    }
                }

                if (!title) {
                    title = '';
                    encryptedTitle = await encrypt(title);
                }
            } catch (e) {
                console.error(`[SyncService] Failed to decrypt note ${serverNote.id}`, e);
                continue;
            }

            const merged: Note = {
                ...(existing ?? {}),
                id: serverNote.id,
                title,
                content,
                encrypted_title: encryptedTitle,
                encrypted_content: serverNote.content_ciphertext ?? (await encrypt(content)),
                updated_at: serverNote.updated_at,
                created_at: existing?.created_at ?? serverNote.updated_at,
                transcription: existing?.transcription,
                encrypted_transcription: existing?.encrypted_transcription,
                audio_file_path: existing?.audio_file_path,
                audio_duration: existing?.audio_duration,
                has_audio: existing?.has_audio,
                synced: 1,
                dirty: false,
                deleted: false,
                pending_delete: false,
                version: serverNote.version,
                server_updated_at: serverNote.updated_at,
                content_nonce: serverNote.content_nonce ?? null,
                conflict_of: serverNote.conflict_of ?? null,
                is_active: serverNote.is_active ?? existing?.is_active ?? false,
            };

            await saveNoteLocal(merged);
            localMap.set(serverNote.id, merged);
        }
    }
}

export const syncService = new SyncService();
