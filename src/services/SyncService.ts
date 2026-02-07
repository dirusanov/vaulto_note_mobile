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
    migrateLegacyNotesToUser,
    markAllDirty,
} from './DatabaseService';
import { decrypt, encrypt, encryptForSync, decryptFromSync } from '../crypto/encryption';
import { hasMasterKey } from '../crypto/e2ee';
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
    private syncEnabled = false;

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

    public setSyncEnabled(enabled: boolean) {
        this.syncEnabled = enabled;
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
            // Check if we need to migrate guest notes to this user
            // This is "claim device notes" logic.
            // We only do this if we are coming from a state where we might have guest notes.
            await migrateLegacyNotesToUser(userId);
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
        this.lastSyncAt = 0;
        await AsyncStorage.setItem(SYNC_SINCE_KEY, '0');
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

        const dirtyNotes = notes.filter(n => n.dirty || n.deleted || n.pending_delete).length;
        const dirtyImprovements = improvements.filter(n => n.dirty || n.deleted).length;

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
            const dirtyNotes = allNotes.filter(n => n.dirty || n.deleted || n.pending_delete);
            const dirtyImprovements = allImprovements.filter(imp => imp.dirty || imp.deleted);
            const hasLocalNotes = allNotes.length > 0;

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
                }

                noteMap.set(note.id, note);

                const titleToSync = await encryptForSync(note.title || '');
                const contentToSync = await encryptForSync(note.content || '');

                changes.push({
                    id: note.id,
                    content_ciphertext: contentToSync,
                    content_nonce: note.content_nonce ?? null,
                    title: titleToSync,
                    deleted: !!note.deleted || !!note.pending_delete,
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
                const parentNote = allNotes.find(n => n.id === improvement.note_id);
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

            // 5. Cleanup dirty flags
            for (const change of changes) {
                if (!uniqueIncoming.has(change.id)) {
                    const local = noteMap.get(change.id);
                    if (local && this.currentUserId) {
                        if (change.deleted) {
                            await deleteNoteLocal(this.currentUserId, local.id);
                        } else {
                            await saveNoteLocal(this.currentUserId, { ...local, dirty: false, synced: 1 });
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
                    if (!localImprovement || !this.currentUserId) continue;
                    await saveImprovementLocal(this.currentUserId, {
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
        } finally {
            this.isSyncing = false;
        }
    }

    private async applyServerImprovements(improvements: ServerImprovement[]) {
        if (!this.currentUserId) return;
        let processed = 0;
        const YIELD_EVERY = 20;
        for (const improvement of improvements) {
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
    }

    private async applyServerChanges(serverNotes: ServerNote[]) {
        if (!this.currentUserId) return;
        const localNotes = await getNotesLocal(this.currentUserId);
        const localMap = new Map(localNotes.map(n => [n.id, n]));
        let processed = 0;
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
            };

            await saveNoteLocal(this.currentUserId, merged);
            localMap.set(serverNote.id, merged);
            processed += 1;
            if (processed % YIELD_EVERY === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
    }
}

export const syncService = new SyncService();
