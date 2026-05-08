import { AppState, AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
    notesApi,
    Note,
    ServerNote,
    ServerImprovement,
    SyncChangeRequest,
    SyncImprovementChangeRequest,
    SyncNotesRequest,
    SyncNotesResponse,
} from '../api/notes';
import {
    getNotesLocal,
    saveNoteLocal,
    deleteNoteLocal,
    hardDeleteNoteLocal,
    hardDeleteImprovementLocal,
    getAllImprovementsLocal,
    saveImprovementLocal,
    markAllDirty,
    migrateGuestData,
    registerResyncCallback,
} from './DatabaseService';

import { decrypt, encrypt, encryptForSync, decryptFromSync, getCryptoMode, isMasterCiphertext, isDeviceCiphertext } from '../crypto/encryption';
import { hasMasterKey } from '../crypto/e2ee';
import { storage, hasPendingDecryptSync, clearPendingDecryptSync } from '../utils/storage';


const SYNC_SINCE_KEY = 'vaulto_last_sync_time';
const SYNC_DEBOUNCE_MS = 5000;
const RESUME_SYNC_THRESHOLD_MS = 30000; // 30 seconds

type SyncReason = 'app_start' | 'resume' | 'auto' | 'manual' | 'variant_switch' | 'e2ee_migration';
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
        message.includes('ghash tag') ||
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
        // App State Listener
        AppState.addEventListener('change', this.handleAppStateChange);
        // Register callback so DatabaseService can trigger immediate re-sync
        // when stuck E2EE notes are detected in local mode after disable.
        registerResyncCallback(() => this.scheduleAutoSync());
        // Network restore listener — completes pending decrypt sync when internet comes back
        try {
            NetInfo.addEventListener((state) => this.handleNetworkChange(state.isConnected ?? false));
        } catch (error) {
            console.warn('[SyncService] NetInfo native module not found. Automatic re-sync on network restore will be disabled until the app is rebuilt.', error);
        }
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

        if (userId !== lastKnown) {
            this.lastSyncCursor = null;
            if (userId) {
                this.currentUserId = userId;
                void this.bootstrapSync();
            } else {
                this.currentUserId = null;
            }
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
        const effectiveUserId = userId ?? this.currentUserId;
        if (effectiveUserId) {
            await AsyncStorage.removeItem(`${SYNC_SINCE_KEY}_${effectiveUserId}`);
            await markAllDirty(effectiveUserId);
        }
        this.notifyListeners();
    }

    /** Waits for any in-progress sync to complete, then runs a fresh sync. */
    public async syncNowAndWait(reason: SyncReason = 'manual'): Promise<void> {
        // Wait for any in-flight sync to finish first
        const startWait = Date.now();
        while (this.isSyncing && Date.now() - startWait < 15000) {
            await new Promise<void>((resolve) => setTimeout(resolve, 100));
        }
        await this.syncNow(reason);
        // Wait for the sync we just started to complete
        const startSync = Date.now();
        while (this.isSyncing && Date.now() - startSync < 15000) {
            await new Promise<void>((resolve) => setTimeout(resolve, 100));
        }
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

    private lastNetworkState: boolean | null = null;

    private handleNetworkChange = async (isConnected: boolean) => {
        const wasOffline = this.lastNetworkState === false;
        this.lastNetworkState = isConnected;

        if (!isConnected || !wasOffline) return;
        if (!this.currentUserId || !this.syncEnabled || !this.isAuthenticated) return;

        // Check if there's a pending decrypt sync (DISABLE E2EE failed due to no network)
        const pending = await hasPendingDecryptSync(this.currentUserId);
        if (pending) {
            console.log('[SyncService] Network restored — completing pending decrypt sync');
            await clearPendingDecryptSync(this.currentUserId);
            await this.syncNowAndWait('manual');
        }
    };

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

    private async bootstrapSync() {
        const userId = this.currentUserId;
        if (!userId) return;
        
        // If there's a pending decrypt sync (DISABLE E2EE failed during sync),
        // we force a full sync state reset to ensure everything is pushed up.
        const pending = await hasPendingDecryptSync(userId);
        if (pending) {
            console.log('[SyncService] bootstrapSync found pending decrypt sync — forcing full push');
            await clearPendingDecryptSync(userId);
            await this.resetSyncState(userId);
        }

        const stored = await AsyncStorage.getItem(`${SYNC_SINCE_KEY}_${userId}`);
        this.lastSyncCursor = stored;
        await this.syncNow('app_start');
    }

    private async notifySuccess(newCursor: string | null) {
        this.lastSyncCompletedAtMs = Date.now();
        if (newCursor && this.currentUserId) {
            this.lastSyncCursor = newCursor;
            await AsyncStorage.setItem(`${SYNC_SINCE_KEY}_${this.currentUserId}`, newCursor);
        }
        this.notifyListeners();
    }

    public async refreshLocalVersionsFromServer(): Promise<void> {
        if (!this.isAuthenticated || !this.currentUserId) {
            return;
        }

        const response = await notesApi.sync({
            changes: [],
            improvement_changes: [],
            since_updated_at: '1970-01-01T00:00:00+00:00',
        });

        const incomingNotes = new Map<string, ServerNote>();
        [...(response.updated || []), ...(response.server_changes || [])].forEach((note) => {
            if (!note.deleted) {
                incomingNotes.set(note.id, note);
            }
        });

        if (incomingNotes.size > 0) {
            const localNotes = await getNotesLocal(this.currentUserId);
            for (const local of localNotes) {
                const server = incomingNotes.get(local.id);
                if (!server || local.dirty) continue;
                if ((local.version ?? 0) >= (server.version ?? 0)) continue;

                await saveNoteLocal(this.currentUserId, {
                    ...local,
                    version: server.version,
                    server_updated_at: server.updated_at,
                });
            }
        }

        const incomingImprovements = new Map<string, ServerImprovement>();
        [...(response.improvement_updates || []), ...(response.improvement_changes || [])].forEach((improvement) => {
            if (!improvement.deleted) {
                incomingImprovements.set(improvement.id, improvement);
            }
        });

        if (incomingImprovements.size > 0) {
            const localImprovements = await getAllImprovementsLocal(this.currentUserId);
            for (const local of localImprovements) {
                const server = incomingImprovements.get(local.id);
                if (!server || local.dirty) continue;
                if ((local.version ?? 0) >= (server.version ?? 0)) continue;

                await saveImprovementLocal(this.currentUserId, {
                    ...local,
                    version: server.version,
                    server_updated_at: server.updated_at,
                });
            }
        }
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
        if (getCryptoMode() === 'e2ee' && !hasMasterKey()) {
            console.log('[SyncService] Encryption locked. Skipping sync.');
            return;
        }
        const pendingEncryptionMigration = await storage.getEncryptionMigrationState(this.currentUserId);
        const migrationNeedsOwner =
            pendingEncryptionMigration === 'local' ||
            (pendingEncryptionMigration === 'sync' && (getCryptoMode() !== 'e2ee' || !hasMasterKey()));
        if (migrationNeedsOwner && reason !== 'e2ee_migration') {
            console.log('[SyncService] E2EE migration is pending. Skipping regular sync until encryption is ready.');
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
                if (!note.id || typeof note.id !== 'string' || note.id.trim().length === 0) {
                    console.warn('[SyncService] Skipping note with empty id');
                    continue;
                }

                noteMap.set(note.id, note);

                const shouldDelete = !!note.deleted || !!note.pending_delete || !!note.pending_server_delete;

                // Skip notes that failed decryption — never send '[Encrypted]' to server
                if (!shouldDelete && (note.content === '[Encrypted]' || note.title === '[Encrypted]')) {
                    console.warn(`[SyncService] Skipping note ${note.id} with placeholder content — decryption may have failed`);
                    continue;
                }

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
                    // Skip improvements that failed decryption
                    content_ciphertext: (improvement.content && improvement.content !== '[Encrypted]')
                        ? await encryptForSync(improvement.content)
                        : '',
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
            
            // Check if still unlocked before applying (safety)
            if (getCryptoMode() === 'e2ee' && !hasMasterKey()) {
                console.log('[SyncService] Encryption locked before applying server improvements. Skipping.');
                return;
            }

            if (incomingImprovements.length > 0) {
                await this.applyServerImprovements(incomingImprovements);
            }

            // 5. Cleanup dirty flags
            for (const change of changes) {
                const local = noteMap.get(change.id);
                if (!local || !this.currentUserId) continue;

                // Never clear dirty on conflicted notes — they'll be re-sent next cycle.
                if (conflictedNoteIds.has(change.id)) {
                    continue;
                }

                const serverNote = uniqueIncoming.get(change.id);
                const serverConfirmedDelete = !!serverNote?.deleted;

                if (local.pending_server_delete) {
                    if (serverNote && !serverConfirmedDelete) continue;
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
                    await hardDeleteNoteLocal(this.currentUserId, local.id);
                } else {
                    // Clear dirty regardless of whether server echoed the note back.
                    // If the server didn't return a conflict, the change was accepted.
                    await saveNoteLocal(this.currentUserId, {
                        ...local,
                        dirty: false,
                        synced: 1,
                        version: serverNote?.version ?? Math.max(local.version ?? 0, change.base_version ?? 0) + 1,
                        server_updated_at: serverNote?.updated_at ?? local.server_updated_at,
                    });
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
                        version: incomingImprovements.find((imp) => imp.id === change.id)?.version ?? Math.max(localImprovement.version ?? 0, change.base_version ?? 0) + 1,
                        server_updated_at: incomingImprovements.find((imp) => imp.id === change.id)?.updated_at ?? localImprovement.server_updated_at,
                    });
                }
            }

            // 6. Update cursor based on server response
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
            
            const finalCursor = nextMs > 0 ? new Date(nextMs).toISOString() : this.lastSyncCursor;
            await this.notifySuccess(finalCursor);
            const pendingEncryptionMigration = await storage.getEncryptionMigrationState(this.currentUserId);
            if (pendingEncryptionMigration === 'sync') {
                const { unsyncedCount } = await this.getSyncStatus(this.currentUserId);
                if (unsyncedCount === 0) {
                    await storage.clearEncryptionMigrationState(this.currentUserId);
                }
            }

        } catch (e) {
            console.error('[SyncService] Sync failed', e);
        } finally {
            this.isSyncing = false;
        }
    }

    private async applyServerImprovements(improvements: ServerImprovement[]) {
        if (!this.currentUserId) return;
        if (getCryptoMode() === 'e2ee' && !hasMasterKey()) {
            console.log('[SyncService] Skipping applyServerImprovements: E2EE enabled but locked.');
            return;
        }
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
            } catch (e: any) {
                const message = (e?.message || '').toLowerCase();
                const isLocked = message.includes('e2ee locked') || message.includes('master key missing');
                const isTagError = message.includes('invalid tag') || message.includes('ghash tag') || message.includes('invalid ciphertext');

                if (isLocked) {
                    skippedExpectedDecryptFailures += 1;
                    continue;
                }

                if (isTagError) {
                    console.warn(`[SyncService] Key mismatch or corruption for improvement ${improvement.id}. Saving as [Encrypted].`);
                    await saveImprovementLocal(this.currentUserId, {
                        id: improvement.id,
                        note_id: improvement.note_id,
                        encrypted_content: improvement.content_ciphertext || '',
                        encrypted_title: improvement.encrypted_title || null,
                        content: '[Encrypted]',
                        title: '[Encrypted]',
                        version: improvement.version,
                        updated_at: improvement.updated_at,
                        synced: 1,
                        dirty: false,
                    } as any);
                    processed += 1;
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
        if (!this.currentUserId) return;
        if (getCryptoMode() === 'e2ee' && !hasMasterKey()) {
            console.log('[SyncService] Skipping applyServerChanges: E2EE enabled but locked.');
            return;
        }
        const localNotes = await getNotesLocal(this.currentUserId);
        const localMap = new Map(localNotes.map(n => [n.id, n]));
        let processed = 0;
        let skippedExpectedDecryptFailures = 0;
        const YIELD_EVERY = 20;

        for (const serverNote of serverNotes) {
            const existing = localMap.get(serverNote.id);

            // Skip dirty local notes ONLY if our version is >= server version.
            // This protects locally-migrated notes (e.g. after re-encryption) from
            // being overwritten by a stale server echo in the same sync cycle.
            // If the server has a NEWER version, we must apply it — it could be
            // a change from another device that we haven't seen yet.
            if (existing?.dirty && (existing.version ?? 0) >= (serverNote.version ?? 0)) {
                continue;
            }

            const unchanged =
                existing &&
                !existing.dirty &&
                existing.version === serverNote.version &&
                existing.deleted === serverNote.deleted;
            if (unchanged) {
                continue;
            }
            if (existing && (!shouldSyncNote(existing) || existing.pending_server_delete)) {
                continue;
            }

            if (serverNote.deleted) {
                await hardDeleteNoteLocal(this.currentUserId, serverNote.id);
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
                        // Only fall back to raw value if it looks like plaintext
                        // (not an undecodable E2EE blob like v3m.xxx)
                        const raw = serverNote.title as string;
                        if (!isMasterCiphertext(raw) && !isDeviceCiphertext(raw)) {
                            title = raw;
                        } else {
                            title = ''; // can't decrypt without key, leave empty
                        }
                    }
                }

                if (!title) {
                    title = '';
                }

                encryptedTitle = await encrypt(title);
            } catch (e: any) {
                const message = (e?.message || '').toLowerCase();
                const isLocked = message.includes('e2ee locked') || message.includes('master key missing');
                const isTagError = message.includes('invalid tag') || message.includes('ghash tag') || message.includes('invalid ciphertext');

                if (isLocked) {
                    skippedExpectedDecryptFailures += 1;
                    continue;
                }

                if (isTagError) {
                    console.warn(`[SyncService] Key mismatch or corruption for note ${serverNote.id}. Saving as [Encrypted] placeholder.`);
                    // Save as placeholder to avoid infinite re-fetch loop.
                    // SyncService.syncNow skips notes with '[Encrypted]' content, so this won't overwrite server data.
                    const placeholder: Note = {
                        ...(existing ?? {}),
                        id: serverNote.id,
                        title: '[Encrypted]',
                        content: '[Encrypted]',
                        encrypted_title: serverNote.title || '',
                        encrypted_content: serverNote.content_ciphertext || '',
                        updated_at: serverNote.updated_at,
                        version: serverNote.version,
                        synced: 1,
                        dirty: false,
                    } as any;
                    await saveNoteLocal(this.currentUserId, placeholder);
                    processed += 1;
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
