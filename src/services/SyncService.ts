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
    markAllDirty,
    migrateGuestData,
} from './DatabaseService';
import { decrypt, encrypt, encryptForSync, decryptFromSync } from '../crypto/encryption';
import { hasMasterKey } from '../crypto/e2ee';
import { isUUID } from '../utils/uuid';

const SYNC_SINCE_KEY = 'vaulto_last_sync_time';
const SYNC_DEBOUNCE_MS = 5000;
const RESUME_SYNC_THRESHOLD_MS = 30000; // 30 seconds

type SyncReason = 'app_start' | 'resume' | 'auto' | 'manual' | 'variant_switch';
type SyncListener = () => void;

const shouldSyncNote = (note: Note): boolean => {
    const storageScope = note.storage_scope ?? 'sync';
    return storageScope === 'sync';
};

const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error) return error.message;
    return String(error ?? '');
};

const isExpectedDecryptFailure = (error: unknown): boolean => {
    const message = getErrorMessage(error).toLowerCase();
    return (
        message.includes('invalid tag') ||
        message.includes('e2ee locked') ||
        message.includes('master key missing') ||
        message.includes('unsupported ciphertext format') ||
        message.includes('invalid ciphertext')
    );
};

class SyncService {
    private isSyncing = false;
    private lastSyncCompletedAtMs: number = 0;
    // Server cursor used for since_updated_at. Stored as an ISO string.
    private lastSyncCursor: string | null = null;
    private syncTimeout: NodeJS.Timeout | null = null;
    private listeners: SyncListener[] = [];
    private isAuthenticated = false;
    private currentUserId: string | null = null;
    private syncEnabled = false;

    constructor() {
        // Load last sync cursor from storage.
        AsyncStorage.getItem(SYNC_SINCE_KEY).then(val => {
            if (val) {
                // Legacy values were stored as epoch millis. That cursor can miss server updates
                // (it is derived from local time), so we discard and force a full sync once.
                if (/^\d+$/.test(val)) {
                    void AsyncStorage.removeItem(SYNC_SINCE_KEY);
                    this.lastSyncCursor = null;
                    return;
                }
                const parsed = Date.parse(val);
                if (Number.isNaN(parsed)) {
                    void AsyncStorage.removeItem(SYNC_SINCE_KEY);
                    this.lastSyncCursor = null;
                    return;
                }
                this.lastSyncCursor = val;
            }
        });

        // App State Listener
        AppState.addEventListener('change', this.handleAppStateChange);
    }

    public setAuthenticated(auth: boolean) {
        this.isAuthenticated = auth;
    }

    public setSyncEnabled(enabled: boolean) {
        this.syncEnabled = enabled;
    }

    public async setCurrentUser(userId: string | null, previousUserId?: string | null) {
        // Wait for any in-flight sync to avoid racing migrations
        while (this.isSyncing) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        const lastKnown = this.currentUserId;
        const migrationSourceUserId = previousUserId ?? null;

        // Run migration only when caller explicitly provides the previous user.
        // This avoids accidental guest->guest merges on transient session switches.
        if (userId && migrationSourceUserId && userId !== migrationSourceUserId) {
            await migrateGuestData(migrationSourceUserId, userId);
        }

        if (userId === lastKnown) {
            this.currentUserId = userId;
            return;
        }

        if (userId) {
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

    public async resetSyncState(userId?: string | null) {
        this.lastSyncCursor = null;
        await AsyncStorage.removeItem(SYNC_SINCE_KEY);
        const effectiveUserId = userId ?? this.currentUserId;
        if (effectiveUserId) {
            await markAllDirty(effectiveUserId);
        }
        this.notifyListeners();
    }

    private notifyListeners() {
        this.listeners.forEach(l => l());
    }

    public async getSyncStatus(userId?: string | null): Promise<{ unsyncedCount: number }> {
        if (!this.syncEnabled) return { unsyncedCount: 0 };
        const effectiveUserId = userId ?? this.currentUserId;
        if (!effectiveUserId) return { unsyncedCount: 0 };
        const notes = await getNotesLocal(effectiveUserId);
        const improvements = await getAllImprovementsLocal(effectiveUserId);
        const notesById = new Map(notes.map((n) => [n.id, n]));

        const dirtyNotes = notes.filter(
            (n) => (shouldSyncNote(n) || n.pending_server_delete) && (n.dirty || n.deleted || n.pending_delete || n.pending_server_delete)
        ).length;
        const dirtyImprovements = improvements.filter((imp) => {
            const parent = notesById.get(imp.note_id);
            return !!parent && shouldSyncNote(parent) && !parent.pending_server_delete && (imp.dirty || imp.deleted);
        }).length;

        return { unsyncedCount: dirtyNotes + dirtyImprovements };
    }

    public async hasUnsyncedChanges(userId?: string | null): Promise<boolean> {
        if (!this.syncEnabled) return false;
        const status = await this.getSyncStatus(userId);
        return status.unsyncedCount > 0;
    }

    private handleAppStateChange = (nextAppState: AppStateStatus) => {
        if (nextAppState === 'active') {
            const now = Date.now();
            if (now - this.lastSyncCompletedAtMs > RESUME_SYNC_THRESHOLD_MS) {
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
        // Local changes were made; update listeners (e.g. Settings sync status)
        this.notifyListeners();
    }

    public async syncNow(reason: SyncReason) {
        if (this.isSyncing) {
            console.log(`[SyncService] Sync already in progress. Reason: ${reason} ignored.`);
            return;
        }

        if (!this.isAuthenticated || !this.currentUserId) {
            console.log('[SyncService] Not authenticated or no user selected. Skipping sync.');
            return;
        }
        if (!this.syncEnabled) {
            console.log('[SyncService] Sync disabled. Skipping sync.');
            return;
        }
        if (!hasMasterKey()) {
            console.log('[SyncService] Encryption locked. Skipping sync.');
            return;
        }

        console.log(`[SyncService] Starting sync for user ${this.currentUserId}. Reason: ${reason}`);
        this.isSyncing = true;

        try {
            // 1. Gather local changes
            const allNotes = await getNotesLocal(this.currentUserId);
            const allImprovements = await getAllImprovementsLocal(this.currentUserId);
            const notesById = new Map(allNotes.map((n) => [n.id, n]));
            const dirtyNotes = allNotes.filter(
                (n) => (shouldSyncNote(n) || n.pending_server_delete) && (n.dirty || n.deleted || n.pending_delete || n.pending_server_delete)
            );
            const dirtyImprovements = allImprovements.filter((imp) => {
                const parent = notesById.get(imp.note_id);
                return !!parent && shouldSyncNote(parent) && !parent.pending_server_delete && (imp.dirty || imp.deleted);
            });
            const hasLocalNotes = allNotes.some((n) => shouldSyncNote(n));

            // 2. Prepare changes for server
            const changes: SyncChangeRequest[] = [];
            const improvementChanges: SyncImprovementChangeRequest[] = [];
            const noteMap = new Map<string, Note>();
            const improvementMap = new Map<string, typeof dirtyImprovements[number]>();

            let processedNotes = 0;
            const YIELD_EVERY = 20;
            for (const note of dirtyNotes) {
                if (!isUUID(note.id)) {
                    // Skip invalid IDs
                    continue;
                }

                noteMap.set(note.id, note);

                const shouldDelete = !!note.deleted || !!note.pending_delete || !!note.pending_server_delete;
                const titleToSync = shouldDelete ? '' : await encryptForSync(note.title || '');
                const contentToSync = shouldDelete ? '' : await encryptForSync(note.content || '');

                changes.push({
                    id: note.id,
                    content_ciphertext: contentToSync,
                    content_nonce: note.content_nonce ?? null,
                    title: titleToSync,
                    deleted: shouldDelete,
                    base_version: note.version ?? 0,
                    client_updated_at: note.updated_at || new Date().toISOString(),
                    is_active: note.is_active,
                    is_pinned: note.is_pinned ?? false,
                    last_variant_id: null,
                });
                processedNotes += 1;
                if (processedNotes % YIELD_EVERY === 0) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }

            let processedImprovements = 0;
            for (const improvement of dirtyImprovements) {
                improvementMap.set(improvement.id, improvement);
                const parentNote = notesById.get(improvement.note_id);
                const activeChild = parentNote?.improvements?.find(imp => imp.is_active);
                const isActive = activeChild?.id === improvement.id;

                let improvementTitle: string | null = null;
                if (improvement.encrypted_title) {
                    try {
                        const titlePlain = await decrypt(improvement.encrypted_title);
                        improvementTitle = await encryptForSync(titlePlain);
                    } catch (e) {
                        console.warn('[SyncService] Failed to re-encrypt improvement title', e);
                        improvementTitle = null;
                    }
                }

                improvementChanges.push({
                    id: improvement.id,
                    note_id: improvement.note_id,
                    content_ciphertext: await encryptForSync(improvement.content || ''),
                    content_nonce: improvement.content_nonce ?? null,
                    encrypted_title: improvementTitle,
                    label: improvement.label ?? null,
                    option_id: improvement.option_id ?? null,
                    deleted: !!improvement.deleted,
                    base_version: improvement.version ?? 0,
                    client_updated_at: improvement.updated_at || new Date().toISOString(),
                    is_active: isActive,
                });
                processedImprovements += 1;
                if (processedImprovements % YIELD_EVERY === 0) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }

            // 3. Send to server
            const since = !hasLocalNotes || !this.lastSyncCursor
                ? '1970-01-01T00:00:00+00:00'
                : this.lastSyncCursor;

            const response = await notesApi.sync({
                changes,
                improvement_changes: improvementChanges,
                since_updated_at: since,
            });

            // 4. Process response
            const conflictedNoteIds = new Set((response.conflicts || []).map((c) => c.id));
            if (conflictedNoteIds.size > 0) {
                console.warn(`[SyncService] Server reported ${conflictedNoteIds.size} note conflicts; keeping local notes dirty.`);
            }

            const serverNotes = [
                ...(response.updated || []),
                ...(response.server_changes || []),
            ];
            const uniqueIncoming = new Map<string, ServerNote>();
            serverNotes.forEach(n => uniqueIncoming.set(n.id, n));

            if (uniqueIncoming.size > 0) {
                await this.applyServerChanges(Array.from(uniqueIncoming.values()));
            }

            const incomingImprovements = [
                ...(response.improvement_updates || []),
                ...(response.improvement_changes || []),
            ];
            const conflictedImprovementIds = new Set((response.improvement_conflicts || []).map((c) => c.id));
            if (conflictedImprovementIds.size > 0) {
                console.warn(`[SyncService] Server reported ${conflictedImprovementIds.size} improvement conflicts; keeping local improvements dirty.`);
            }
            if (!hasMasterKey()) {
                console.log('[SyncService] Encryption locked before applying server changes. Skipping response apply.');
                return;
            }
            if (incomingImprovements.length > 0) {
                await this.applyServerImprovements(incomingImprovements);
            }

            // 5. Cleanup dirty flags
            for (const change of changes) {
                const local = noteMap.get(change.id);
                if (!local || !this.currentUserId) continue;

                if (conflictedNoteIds.has(change.id)) {
                    continue;
                }
                const serverNote = uniqueIncoming.get(change.id);
                if (!serverNote) {
                    // If server didn't echo back, keep local dirty.
                    continue;
                }

                const serverConfirmedDelete = !!serverNote.deleted;
                if (local.pending_server_delete) {
                    if (!serverConfirmedDelete) continue;
                    await saveNoteLocal(this.currentUserId, {
                        ...local,
                        pending_server_delete: false,
                        dirty: false,
                        synced: 0,
                        deleted: false,
                        pending_delete: false,
                    });
                    continue;
                }

                if (change.deleted || serverConfirmedDelete) {
                    await deleteNoteLocal(this.currentUserId, local.id);
                } else {
                    await saveNoteLocal(this.currentUserId, { ...local, dirty: false, synced: 1 });
                }
            }

            if (improvementChanges.length > 0) {
                const processedImprovementIds = new Set(incomingImprovements.map(imp => imp.id));
                for (const change of improvementChanges) {
                    if (conflictedImprovementIds.has(change.id)) continue;
                    if (!processedImprovementIds.has(change.id)) continue;
                    const localImprovement = improvementMap.get(change.id);
                    if (!localImprovement || !this.currentUserId) continue;
                    await saveImprovementLocal(this.currentUserId, {
                        ...localImprovement,
                        dirty: false,
                        synced: 1,
                    });
                }
            }

            // Update cursor based on server timestamps, not local wall-clock time.
            const cursorCandidates = [
                ...Array.from(uniqueIncoming.values()).map((n) => n.updated_at),
                ...incomingImprovements.map((i) => i.updated_at),
            ];
            const maxIncomingMs = cursorCandidates
                .map((t) => Date.parse(t))
                .filter((t) => Number.isFinite(t))
                .reduce((acc, t) => Math.max(acc, t), 0);
            const prevMs = this.lastSyncCursor ? Date.parse(this.lastSyncCursor) : 0;
            const nextMs = Math.max(Number.isFinite(prevMs) ? prevMs : 0, maxIncomingMs);
            if (nextMs > 0) {
                this.lastSyncCursor = new Date(nextMs).toISOString();
                await AsyncStorage.setItem(SYNC_SINCE_KEY, this.lastSyncCursor);
            }
            this.lastSyncCompletedAtMs = Date.now();

            this.notifyListeners();

        } catch (e) {
            console.error('[SyncService] Sync failed', e);
        } finally {
            this.isSyncing = false;
        }
    }

    private async applyServerImprovements(improvements: ServerImprovement[]) {
        if (!this.currentUserId || !hasMasterKey()) return;
        const localNotes = await getNotesLocal(this.currentUserId);
        const notesById = new Map(localNotes.map((n) => [n.id, n]));
        let processed = 0;
        let skippedExpectedDecryptFailures = 0;
        const YIELD_EVERY = 20;
        for (const improvement of improvements) {
            const parent = notesById.get(improvement.note_id);
            if (parent && (!shouldSyncNote(parent) || parent.pending_server_delete)) {
                continue;
            }
            let content = '';
            let encryptedTitle: string | null = null;
            try {
                if (improvement.content_ciphertext) {
                    content = await decryptFromSync(improvement.content_ciphertext);
                }
                if (improvement.encrypted_title) {
                    const titlePlain = await decryptFromSync(improvement.encrypted_title);
                    encryptedTitle = await encrypt(titlePlain);
                }
            } catch (e) {
                if (isExpectedDecryptFailure(e)) {
                    skippedExpectedDecryptFailures += 1;
                    continue;
                }
                console.error(`[SyncService] Failed to decrypt improvement ${improvement.id}`, e);
                continue;
            }

            await saveImprovementLocal(this.currentUserId, {
                id: improvement.id,
                note_id: improvement.note_id,
                encrypted_content: await encrypt(content),
                encrypted_title: encryptedTitle,
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
            processed += 1;
            if (processed % YIELD_EVERY === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
        if (skippedExpectedDecryptFailures > 0) {
            console.warn(
                `[SyncService] Skipped ${skippedExpectedDecryptFailures} improvements due to locked encryption or key mismatch.`
            );
        }
    }

    private async applyServerChanges(serverNotes: ServerNote[]) {
        if (!this.currentUserId || !hasMasterKey()) return;
        const localNotes = await getNotesLocal(this.currentUserId);
        const localMap = new Map(localNotes.map(n => [n.id, n]));
        let processed = 0;
        let skippedExpectedDecryptFailures = 0;
        const YIELD_EVERY = 20;

        for (const serverNote of serverNotes) {
            const existing = localMap.get(serverNote.id);
            const unchanged =
                existing &&
                existing.version === serverNote.version &&
                existing.deleted === serverNote.deleted;
            if (unchanged) {
                continue;
            }
            if (existing && (!shouldSyncNote(existing) || existing.pending_server_delete)) {
                continue;
            }

            if (serverNote.deleted) {
                await deleteNoteLocal(this.currentUserId, serverNote.id);
                localMap.delete(serverNote.id);
                continue;
            }

            let title = '';
            let content = '';
            let encryptedTitle: string | undefined = undefined;

            try {
                if (serverNote.content_ciphertext) {
                    content = await decryptFromSync(serverNote.content_ciphertext);
                }

                if (serverNote.title) {
                    try {
                        title = await decryptFromSync(serverNote.title);
                    } catch (e) {
                        title = serverNote.title;
                    }
                }

                if (!title) {
                    title = '';
                }

                encryptedTitle = await encrypt(title);
            } catch (e) {
                if (isExpectedDecryptFailure(e)) {
                    skippedExpectedDecryptFailures += 1;
                    continue;
                }
                console.error(`[SyncService] Failed to decrypt note ${serverNote.id}`, e);
                continue;
            }

            const merged: Note = {
                ...(existing ?? {}),
                id: serverNote.id,
                title,
                content,
                encrypted_title: encryptedTitle,
                encrypted_content: await encrypt(content),
                updated_at: serverNote.updated_at,
                created_at: existing?.created_at ?? serverNote.updated_at,
                transcription: existing?.transcription,
                encrypted_transcription: existing?.encrypted_transcription,
                audio_file_path: existing?.audio_file_path,
                audio_duration: existing?.audio_duration,
                has_audio: existing?.has_audio,
                is_pinned: serverNote.is_pinned ?? existing?.is_pinned ?? false,
                synced: 1,
                dirty: false,
                deleted: false,
                pending_delete: false,
                version: serverNote.version,
                server_updated_at: serverNote.updated_at,
                content_nonce: serverNote.content_nonce ?? null,
                conflict_of: serverNote.conflict_of ?? null,
                is_active: serverNote.is_active ?? existing?.is_active ?? false,
                storage_scope: existing?.storage_scope ?? 'sync',
                privacy: existing?.privacy ?? 'normal',
                pending_server_delete: false,
            };

            await saveNoteLocal(this.currentUserId, merged);
            localMap.set(serverNote.id, merged);
            processed += 1;
            if (processed % YIELD_EVERY === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
        if (skippedExpectedDecryptFailures > 0) {
            console.warn(
                `[SyncService] Skipped ${skippedExpectedDecryptFailures} notes due to locked encryption or key mismatch.`
            );
        }
    }
}

export const syncService = new SyncService();
