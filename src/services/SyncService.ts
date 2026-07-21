import { AppState, AppStateStatus, Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';

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
    hardDeleteNoteLocal,
    getAllImprovementsLocal,
    saveImprovementLocal,
    markAllDirty,
    migrateGuestData,
    registerResyncCallback,
    setNoteAudioSyncState,
} from './DatabaseService';
import { AudioService } from './AudioService';
import { audioApi } from '../api/audio';

import {
    decrypt,
    encrypt,
    encryptForSync,
    decryptFromSync,
    getCryptoMode,
    isMasterCiphertext,
    isDeviceCiphertext,
    encryptAudioBase64ForSync,
    decryptAudioBase64FromSync,
} from '../crypto/encryption';
import { hasMasterKey } from '../crypto/e2ee';
import { storage, hasPendingDecryptSync, clearPendingDecryptSync } from '../utils/storage';
import {
    isRetryableSyncConflict,
    rebasedClientTimestamp,
    shouldPauseForEncryptionState,
} from './encryptionState';


// Numeric monotonic cursor (server_seq). New key so stale ISO timestamps from
// the previous timestamp-based cursor are never parsed as a number.
const SYNC_SEQ_KEY = 'vaulto_last_sync_seq';
const SYNC_DEBOUNCE_MS = 5000;
const RESUME_SYNC_THRESHOLD_MS = 30000; // 30 seconds

type SyncReason = 'app_start' | 'resume' | 'auto' | 'manual' | 'variant_switch' | 'e2ee_migration';
type SyncListener = () => void;
type EncryptionConflictInfo = {
    enc_mode: 'off' | 'e2ee' | null;
    key_epoch: number | null;
    previous_key_epoch: number;
};
type EncryptionConflictHandler = (info: EncryptionConflictInfo) => void | Promise<void>;
type SyncEncryptionConflict = {
    error: string;
    server_enc_mode?: 'off' | 'e2ee';
    server_key_epoch?: number;
};

const shouldSyncNote = (note: Note): boolean => {
    const storageScope = note.storage_scope ?? 'sync';
    return storageScope === 'sync';
};

const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error) return error.message;
    return String(error ?? '');
};

class SyncService {
    private isSyncing = false;
    private lastSyncCompletedAtMs: number = 0;
    // Monotonic per-user server cursor (server_seq). null => full pull (seq 0).
    private lastSyncSeq: number | null = null;
    // Server-authoritative encryption epoch stamped onto outgoing writes.
    private currentKeyEpoch = 0;
    private syncTimeout: NodeJS.Timeout | null = null;
    private listeners: SyncListener[] = [];
    private isAuthenticated = false;
    private currentUserId: string | null = null;
    private syncEnabled = false;
    private encryptionConflictHandler: EncryptionConflictHandler | null = null;

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
            this.lastSyncSeq = null;
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

    /** Lets EncryptionContext reconcile when the server reports a mode mismatch. */
    public registerEncryptionConflictHandler(handler: EncryptionConflictHandler | null) {
        this.encryptionConflictHandler = handler;
    }

    public setKeyEpoch(epoch: number) {
        this.currentKeyEpoch = Number.isFinite(epoch) ? epoch : 0;
    }

    /**
     * Reconcile the account-level encryption state before applying a sync
     * response. A mode change can happen without producing a write conflict
     * (for example, a clean second device only pulls), so conflicts alone are
     * not a reliable state-change signal.
     *
     * Returns true when the caller must stop the current sync pass. In that
     * case the response must not be applied and the cursor must not advance;
     * EncryptionContext will switch modes or lock the device, and the next
     * sync will replay the same server changes safely.
     */
    private async reconcileEncryptionState(
        serverMode: 'off' | 'e2ee' | null | undefined,
        serverEpoch: number | null | undefined,
    ): Promise<boolean> {
        if (!this.currentUserId) return false;

        const normalizedEpoch = serverEpoch != null && Number.isFinite(serverEpoch)
            ? serverEpoch
            : null;
        const previousEpoch = this.currentKeyEpoch;
        const localCryptoMode = getCryptoMode();
        const localAccountMode: 'off' | 'e2ee' = localCryptoMode === 'e2ee' ? 'e2ee' : 'off';
        const encryptionStateChanged = shouldPauseForEncryptionState(
            localCryptoMode,
            serverMode,
            previousEpoch,
            normalizedEpoch,
        );

        if (encryptionStateChanged) {
            console.log('[SyncService] Server encryption state changed; pausing sync before apply.', {
                local_mode: localAccountMode,
                server_mode: serverMode,
                local_key_epoch: previousEpoch,
                server_key_epoch: normalizedEpoch,
            });

            if (!this.encryptionConflictHandler) {
                // EncryptionContext may still be mounting. Keep both the cursor
                // and local epoch untouched so the next sync observes the same
                // transition instead of pairing a new epoch with an old key.
                console.log('[SyncService] Encryption reconciliation handler is not ready; deferring state change.');
                return true;
            }

            await this.encryptionConflictHandler({
                enc_mode: serverMode ?? null,
                key_epoch: normalizedEpoch,
                previous_key_epoch: previousEpoch,
            });

            // Persist the authoritative generation after the handler has had a
            // chance to inspect the previously stored epoch.
            if (normalizedEpoch != null) {
                this.currentKeyEpoch = normalizedEpoch;
                await storage.setKeyEpoch(this.currentUserId, normalizedEpoch);
            }
            return true;
        }

        if (normalizedEpoch != null && normalizedEpoch !== previousEpoch) {
            this.currentKeyEpoch = normalizedEpoch;
            await storage.setKeyEpoch(this.currentUserId, normalizedEpoch);
        }
        return false;
    }

    public async resetSyncState(userId?: string | null) {
        this.lastSyncSeq = null;
        const effectiveUserId = userId ?? this.currentUserId;
        if (effectiveUserId) {
            await AsyncStorage.removeItem(`${SYNC_SEQ_KEY}_${effectiveUserId}`);
            await markAllDirty(effectiveUserId);
        }
        this.notifyListeners();
    }

    /**
     * Force a full re-pull from the server (cursor reset to 0) and wait for it.
     * Unlike resetSyncState() this does NOT mark everything dirty, so it only
     * pulls server state into the local DB. Used by the encryption reset flow to
     * capture notes that exist on the server but not yet on this device before
     * decrypting and re-uploading them as plaintext.
     */
    public async pullAllFromServer(
        userId?: string | null,
        reason: SyncReason = 'manual',
    ): Promise<void> {
        const effectiveUserId = userId ?? this.currentUserId;
        if (!effectiveUserId) return;
        this.lastSyncSeq = null;
        await AsyncStorage.removeItem(`${SYNC_SEQ_KEY}_${effectiveUserId}`);
        await this.syncNowAndWait(reason, true);
    }

    /** Waits for any in-progress sync to complete, then runs a fresh sync. */
    public async syncNowAndWait(
        reason: SyncReason = 'manual',
        throwOnError = false,
    ): Promise<void> {
        // Wait for any in-flight sync to finish first
        const startWait = Date.now();
        while (this.isSyncing && Date.now() - startWait < 15000) {
            await new Promise<void>((resolve) => setTimeout(resolve, 100));
        }
        if (this.isSyncing) {
            const error = new Error('Timed out waiting for the previous sync operation.');
            if (throwOnError) throw error;
            console.warn('[SyncService]', error.message);
            return;
        }

        await this.syncNow(reason, throwOnError);
        // Wait for the sync we just started to complete
        const startSync = Date.now();
        while (this.isSyncing && Date.now() - startSync < 15000) {
            await new Promise<void>((resolve) => setTimeout(resolve, 100));
        }
        if (this.isSyncing && throwOnError) {
            throw new Error('Timed out waiting for sync to complete.');
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

        const dirtyAudio = notes.filter((note) => (
            shouldSyncNote(note)
            && !note.deleted
            && !note.pending_delete
            && !note.pending_server_delete
            && !!note.has_audio
            && !!note.audio_file_path
            && !note.audio_synced
        )).length;

        return { unsyncedCount: dirtyNotes + dirtyImprovements + dirtyAudio };
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

        const stored = await AsyncStorage.getItem(`${SYNC_SEQ_KEY}_${userId}`);
        const parsed = stored != null ? Number(stored) : NaN;
        this.lastSyncSeq = Number.isFinite(parsed) ? parsed : null;
        this.currentKeyEpoch = await storage.getKeyEpoch(userId);
        await this.syncNow('app_start');
    }

    private async notifySuccess(newSeq: number | null) {
        this.lastSyncCompletedAtMs = Date.now();
        if (newSeq != null && this.currentUserId) {
            this.lastSyncSeq = newSeq;
            await AsyncStorage.setItem(`${SYNC_SEQ_KEY}_${this.currentUserId}`, String(newSeq));
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
            since_seq: 0,
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

    public async syncNow(reason: SyncReason, throwOnError = false) {
        if (this.isSyncing) {
            console.log(`[SyncService] Sync already in progress. Reason: ${reason} ignored.`);
            if (throwOnError) {
                throw new Error('Sync is already in progress.');
            }
            return;
        }

        if (!this.isAuthenticated || !this.currentUserId) {
            console.log('[SyncService] Not authenticated or no user selected. Skipping sync.');
            if (throwOnError) throw new Error('Cannot sync without an authenticated user.');
            return;
        }
        if (!this.syncEnabled) {
            console.log('[SyncService] Sync disabled. Skipping sync.');
            if (throwOnError) throw new Error('Sync is disabled.');
            return;
        }
        if (getCryptoMode() === 'e2ee' && !hasMasterKey()) {
            console.log('[SyncService] Encryption locked. Skipping sync.');
            if (throwOnError) throw new Error('Encryption is locked.');
            return;
        }
        const pendingEncryptionMigration = await storage.getEncryptionMigrationState(this.currentUserId);
        const migrationNeedsOwner =
            pendingEncryptionMigration === 'local' ||
            (pendingEncryptionMigration === 'sync' && (getCryptoMode() !== 'e2ee' || !hasMasterKey()));
        if (migrationNeedsOwner && reason !== 'e2ee_migration') {
            console.log('[SyncService] E2EE migration is pending. Skipping regular sync until encryption is ready.');
            if (throwOnError) throw new Error('Encryption migration is still pending.');
            return;
        }

        console.log(`[SyncService] Starting sync for user ${this.currentUserId}. Reason: ${reason}`);
        this.isSyncing = true;
        // Stamp the generation the ciphertext was produced under. Plaintext
        // (local mode) is epoch 0; encrypted writes carry the current key epoch.
        const outgoingEncEpoch = getCryptoMode() === 'e2ee' ? this.currentKeyEpoch : 0;

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
                if (!shouldDelete && (note.content === '[Encrypted]' || note.title === '[Encrypted]' || note.transcription === '[Encrypted]')) {
                    console.warn(`[SyncService] Skipping note ${note.id} with placeholder content — decryption may have failed`);
                    continue;
                }

                const titleToSync = shouldDelete ? '' : await encryptForSync(note.title || '');
                const contentToSync = shouldDelete ? '' : await encryptForSync(note.content || '');
                const transcriptionToSync = !shouldDelete && note.transcription
                    ? await encryptForSync(note.transcription)
                    : null;

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
                    enc_epoch: outgoingEncEpoch,
                    transcription_ciphertext: transcriptionToSync,
                    audio_duration: note.audio_duration ?? null,
                    has_audio: !shouldDelete && !!note.has_audio,
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
                    enc_epoch: outgoingEncEpoch,
                });
                processedImprovements += 1;
                if (processedImprovements % YIELD_EVERY === 0) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }

            // 3. Send to server (monotonic seq cursor; 0 = full pull)
            const sinceSeq = !hasLocalNotes || this.lastSyncSeq == null ? 0 : this.lastSyncSeq;

            const response = await notesApi.sync({
                changes,
                improvement_changes: improvementChanges,
                since_seq: sinceSeq,
            });

            // Encryption state is part of every modern sync response. Check it
            // before applying notes or clearing dirty flags: a clean stale
            // device receives no write conflict, but still has to lock when
            // another device enables E2EE.
            const encryptionStateChanged = await this.reconcileEncryptionState(
                response.enc_mode,
                response.key_epoch,
            );
            if (encryptionStateChanged) {
                if (throwOnError) {
                    throw new Error('Account encryption state changed during sync.');
                }
                return;
            }

            // Track server seqs we could NOT apply (e.g. locked while in another
            // crypto mode), so we never advance the cursor past them.
            const deferredSeqs: number[] = [];

            // 4. Process response
            const allConflicts = response.conflicts || [];
            const allImprovementConflicts = response.improvement_conflicts || [];
            const conflictedNoteIds = new Set(allConflicts.map((c) => c.id));
            const retryableNoteConflictIds = new Set(
                allConflicts
                    .filter((c) => isRetryableSyncConflict(c.error))
                    .map((c) => c.id),
            );
            if (conflictedNoteIds.size > 0) {
                console.warn(`[SyncService] Server reported ${conflictedNoteIds.size} note conflicts; keeping local notes dirty.`);
            }

            // Surface encryption-mode mismatches so the app can transition this
            // device (e.g. another device disabled E2EE for the account).
            const encConflict = (
                allConflicts.find(
                    (c) => c.error === 'encryption_disabled'
                        || c.error === 'encryption_required'
                        || c.error === 'key_epoch_mismatch',
                )
                ?? allImprovementConflicts.find(
                    (c) => c.error === 'encryption_disabled'
                        || c.error === 'encryption_required'
                        || c.error === 'key_epoch_mismatch',
                )
            ) as SyncEncryptionConflict | undefined;
            if (encConflict) {
                if (this.encryptionConflictHandler) {
                    await this.encryptionConflictHandler({
                        enc_mode: encConflict.server_enc_mode ?? response.enc_mode ?? null,
                        key_epoch: encConflict.server_key_epoch ?? response.key_epoch ?? null,
                        previous_key_epoch: this.currentKeyEpoch,
                    });
                }
                // The rejected changes must remain dirty, and the response must
                // be replayed after reconciliation. Do not apply it or advance
                // the cursor in the stale crypto mode.
                if (throwOnError) {
                    throw new Error(`Server rejected stale encryption state: ${encConflict.error}`);
                }
                return;
            }

            const serverNotes = [
                ...(response.updated || []),
                ...(response.server_changes || []),
            ];
            const uniqueIncoming = new Map<string, ServerNote>();
            serverNotes.forEach(n => uniqueIncoming.set(n.id, n));

            if (uniqueIncoming.size > 0) {
                // A dirty local edit that lost optimistic concurrency must not
                // be overwritten by the server echo. Keep its semantic content,
                // rebase it onto the observed server version below, and retry.
                const safeIncoming = Array.from(uniqueIncoming.values()).filter(
                    (note) => !retryableNoteConflictIds.has(note.id),
                );
                const res = await this.applyServerChanges(safeIncoming);
                deferredSeqs.push(...res.deferredSeqs);
            }

            const incomingImprovements = [
                ...(response.improvement_updates || []),
                ...(response.improvement_changes || []),
            ];
            const conflictedImprovementIds = new Set(allImprovementConflicts.map((c) => c.id));
            const retryableImprovementConflictIds = new Set(
                allImprovementConflicts
                    .filter((c) => isRetryableSyncConflict(c.error))
                    .map((c) => c.id),
            );
            if (conflictedImprovementIds.size > 0) {
                console.warn(`[SyncService] Server reported ${conflictedImprovementIds.size} improvement conflicts; keeping local improvements dirty.`);
            }
            
            // Check if still unlocked before applying (safety)
            if (getCryptoMode() === 'e2ee' && !hasMasterKey()) {
                console.log('[SyncService] Encryption locked before applying server improvements. Skipping.');
                return;
            }

            if (incomingImprovements.length > 0) {
                const safeIncomingImprovements = incomingImprovements.filter(
                    (improvement) => !retryableImprovementConflictIds.has(improvement.id),
                );
                const res = await this.applyServerImprovements(safeIncomingImprovements);
                deferredSeqs.push(...res.deferredSeqs);
            }

            // Rebase retryable conflicts after the pull. This is especially
            // important when another device only re-encrypted a note: an
            // offline semantic edit must survive that mechanical version bump.
            // Move the client timestamp past the observed server timestamp so
            // the replay guard accepts the retry even when device clocks differ.
            for (const conflict of allConflicts) {
                if (!retryableNoteConflictIds.has(conflict.id) || !this.currentUserId) continue;
                const local = noteMap.get(conflict.id);
                if (!local) continue;
                const serverNote = uniqueIncoming.get(conflict.id);
                const serverVersion = conflict.server_version ?? serverNote?.version;
                if (serverVersion == null) continue;
                const retryTimestamp = rebasedClientTimestamp(
                    Date.now(),
                    conflict.server_updated_at ?? serverNote?.updated_at,
                );
                await saveNoteLocal(this.currentUserId, {
                    ...local,
                    version: serverVersion,
                    server_updated_at: conflict.server_updated_at ?? serverNote?.updated_at ?? local.server_updated_at,
                    updated_at: retryTimestamp,
                    dirty: true,
                    synced: 0,
                });
            }

            for (const conflict of allImprovementConflicts) {
                if (!retryableImprovementConflictIds.has(conflict.id) || !this.currentUserId) continue;
                const local = improvementMap.get(conflict.id);
                if (!local) continue;
                const serverImprovement = incomingImprovements.find((item) => item.id === conflict.id);
                const serverVersion = conflict.server_version ?? serverImprovement?.version;
                if (serverVersion == null) continue;
                const retryTimestamp = rebasedClientTimestamp(
                    Date.now(),
                    conflict.server_updated_at ?? serverImprovement?.updated_at,
                );
                await saveImprovementLocal(this.currentUserId, {
                    ...local,
                    version: serverVersion,
                    server_updated_at: conflict.server_updated_at ?? serverImprovement?.updated_at ?? local.server_updated_at,
                    updated_at: retryTimestamp,
                    dirty: true,
                    synced: 0,
                });
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

            // 6. Advance the cursor — but NEVER past an item we failed to apply
            //    (e.g. a ciphertext we could not decrypt yet). Those stay behind
            //    the watermark so they're retried once a key becomes available.
            const serverNext = response.next_cursor;
            let finalSeq: number | null = this.lastSyncSeq;
            if (serverNext != null) {
                finalSeq = serverNext;
                if (deferredSeqs.length > 0) {
                    const minDeferred = Math.min(...deferredSeqs);
                    // Hold the cursor strictly below the earliest deferred item.
                    finalSeq = Math.min(serverNext, minDeferred - 1);
                    // Never move backwards past where we already were.
                    if (this.lastSyncSeq != null) {
                        finalSeq = Math.max(finalSeq, this.lastSyncSeq);
                    }
                }
            }
            await this.notifySuccess(finalSeq);
            const pendingEncryptionMigration = await storage.getEncryptionMigrationState(this.currentUserId);
            if (pendingEncryptionMigration === 'sync') {
                const { unsyncedCount } = await this.getSyncStatus(this.currentUserId);
                if (unsyncedCount === 0) {
                    await storage.clearEncryptionMigrationState(this.currentUserId);
                }
            }

        } catch (e) {
            console.error('[SyncService] Sync failed', e);
            if (throwOnError) throw e;
        } finally {
            this.isSyncing = false;
        }

        // Audio blobs ride behind the text sync, outside the isSyncing critical
        // section so slow transfers never block the next text sync. Retries are
        // driven by the per-note state flags, so a failed pass self-heals on the
        // following sync.
        void this.syncAudioBlobs().catch((audioError) => {
            console.warn('[SyncService] Audio blob sync failed', audioError);
        });
    }

    // -----------------------------------------------------------------------
    // Audio blob sync. Runs after the text sync: uploads local recordings that
    // are not yet in server storage and downloads blobs recorded on other
    // devices. In E2EE mode blobs are encrypted client-side with the master
    // key (binary VAE1 framing); in standard mode the raw m4a is uploaded and
    // at-rest encryption is the bucket's responsibility.
    // -----------------------------------------------------------------------

    private audioSyncInProgress = false;

    public async syncAudioNowAndWait(): Promise<void> {
        const startedAt = Date.now();
        while (this.audioSyncInProgress && Date.now() - startedAt < 60000) {
            await new Promise<void>((resolve) => setTimeout(resolve, 100));
        }
        if (this.audioSyncInProgress) {
            throw new Error('Timed out waiting for audio synchronization.');
        }
        await this.syncAudioBlobs();
    }

    /** Ensure no server audio would be stranded by a key/mode transition. */
    public async ensureAllRemoteAudioAvailable(userId: string): Promise<void> {
        await this.syncAudioNowAndWait();
        const notes = await getNotesLocal(userId);
        const missing = notes.find((note) => (
            shouldSyncNote(note)
            && !note.deleted
            && !!note.has_audio
            && !!note.audio_remote
            && !note.audio_file_path
        ));
        if (missing) {
            throw new Error(`Audio for note ${missing.id} is not available locally.`);
        }
    }

    /** Force local audio to be committed again under the new account mode. */
    public async markAllLocalAudioForResync(userId: string): Promise<void> {
        const notes = await getNotesLocal(userId);
        for (const note of notes) {
            if (
                shouldSyncNote(note)
                && !note.deleted
                && !!note.has_audio
                && !!note.audio_file_path
            ) {
                await setNoteAudioSyncState(userId, note.id, { audio_synced: 0 });
            }
        }
        this.notifyListeners();
    }

    private async syncAudioBlobs(): Promise<void> {
        if (Platform.OS === 'web') return;
        if (!this.currentUserId || !this.syncEnabled || !this.isAuthenticated) return;
        if (this.audioSyncInProgress) return;
        const mode = getCryptoMode();
        if (mode === 'e2ee' && !hasMasterKey()) return; // locked: retry next sync

        this.audioSyncInProgress = true;
        const userId = this.currentUserId;
        let appliedDownload = false;
        try {
            const notes = await getNotesLocal(userId);
            for (const note of notes) {
                if (!shouldSyncNote(note) || note.deleted || note.pending_delete || note.pending_server_delete) continue;
                if (userId !== this.currentUserId) return; // user switched mid-pass
                try {
                    if (note.has_audio && note.audio_file_path && !note.audio_synced) {
                        await this.uploadNoteAudio(userId, note);
                    } else if (note.has_audio && !note.audio_file_path && note.audio_remote) {
                        await this.downloadNoteAudio(userId, note);
                        appliedDownload = true;
                    }
                } catch (error) {
                    console.warn(`[SyncService] Audio sync failed for note ${note.id}:`, getErrorMessage(error));
                }
            }
        } finally {
            this.audioSyncInProgress = false;
            if (appliedDownload) {
                this.notifyListeners();
            }
        }
    }

    private async uploadNoteAudio(userId: string, note: Note): Promise<void> {
        const scheme: 'none' | 'e2ee' = getCryptoMode() === 'e2ee' ? 'e2ee' : 'none';
        const mimeType = scheme === 'e2ee' ? 'application/octet-stream' : 'audio/m4a';

        const plainBase64 = await AudioService.readAudioBase64(note.audio_file_path!);
        const sha256 = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, plainBase64);

        // Same bytes already on the server (e.g. re-login re-marked everything):
        // just record the fact instead of re-uploading.
        if (note.audio_remote && note.audio_sha256 && note.audio_sha256 === sha256) {
            await setNoteAudioSyncState(userId, note.id, { audio_synced: 1, audio_sha256: sha256 });
            return;
        }

        const target = await audioApi.getUploadUrl(note.id, mimeType);
        const audioEncryptionStateChanged = await this.reconcileEncryptionState(
            target.required_enc_scheme === 'e2ee' ? 'e2ee' : 'off',
            target.key_epoch,
        );
        if (audioEncryptionStateChanged) {
            return;
        }
        if (target.required_enc_scheme !== scheme) {
            // Account encryption state changed under us; the text sync conflict
            // path reconciles the mode, we just skip this round.
            console.warn(`[SyncService] Audio upload skipped for note ${note.id}: server requires enc_scheme=${target.required_enc_scheme}`);
            return;
        }

        const uploadBase64 = scheme === 'e2ee' ? await encryptAudioBase64ForSync(plainBase64) : plainBase64;

        const cacheDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
        if (!cacheDir) throw new Error('No cache directory for audio upload');
        const tempUri = `${cacheDir}audioup_${note.id}.bin`;
        try {
            await FileSystem.writeAsStringAsync(tempUri, uploadBase64, { encoding: 'base64' });
            const result = await FileSystem.uploadAsync(target.url, tempUri, {
                httpMethod: 'PUT',
                headers: target.headers,
            });
            if (result.status < 200 || result.status >= 300) {
                throw new Error(`Audio upload failed with HTTP ${result.status}`);
            }
        } finally {
            await FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => {});
        }

        await audioApi.commit(note.id, {
            upload_id: target.upload_id,
            enc_scheme: scheme,
            enc_epoch: scheme === 'e2ee' ? this.currentKeyEpoch : 0,
            mime_type: mimeType,
            sha256,
            duration: note.audio_duration ?? null,
        });

        await setNoteAudioSyncState(userId, note.id, {
            audio_synced: 1,
            audio_remote: 1,
            audio_sha256: sha256,
        });
        console.log(`[SyncService] Uploaded audio for note ${note.id} (${scheme})`);
    }

    private async downloadNoteAudio(userId: string, note: Note): Promise<void> {
        let target;
        try {
            target = await audioApi.getDownloadUrl(note.id);
        } catch (error: any) {
            if (error?.response?.status === 404) {
                // Blob vanished server-side; stop trying until sync says otherwise.
                await setNoteAudioSyncState(userId, note.id, { audio_remote: 0 });
                return;
            }
            throw error;
        }

        if (target.enc_scheme === 'e2ee' && !hasMasterKey()) {
            return; // locked: retry once unlocked
        }

        const cacheDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
        if (!cacheDir) throw new Error('No cache directory for audio download');
        const tempUri = `${cacheDir}audiodl_${note.id}.bin`;
        let payloadBase64: string;
        try {
            const result = await FileSystem.downloadAsync(target.url, tempUri);
            if (result.status < 200 || result.status >= 300) {
                throw new Error(`Audio download failed with HTTP ${result.status}`);
            }
            payloadBase64 = await FileSystem.readAsStringAsync(tempUri, { encoding: 'base64' });
        } finally {
            await FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => {});
        }

        const plainBase64 = target.enc_scheme === 'e2ee'
            ? decryptAudioBase64FromSync(payloadBase64)
            : payloadBase64;

        if (target.sha256) {
            const sha256 = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, plainBase64);
            if (sha256 !== target.sha256) {
                throw new Error(`Audio checksum mismatch for note ${note.id}`);
            }
        }

        const filePath = await AudioService.writeAudioBase64(plainBase64);
        await setNoteAudioSyncState(userId, note.id, {
            audio_file_path: filePath,
            audio_synced: 1,
            audio_remote: 1,
            audio_sha256: target.sha256 ?? null,
            has_audio: true,
            audio_duration: target.duration ?? note.audio_duration ?? null,
        });
        console.log(`[SyncService] Downloaded audio for note ${note.id}`);
    }

    private async applyServerImprovements(improvements: ServerImprovement[]): Promise<{ deferredSeqs: number[] }> {
        const deferredSeqs: number[] = [];
        if (!this.currentUserId) return { deferredSeqs };
        if (getCryptoMode() === 'e2ee' && !hasMasterKey()) {
            console.log('[SyncService] Skipping applyServerImprovements: E2EE enabled but locked.');
            // We applied nothing — keep the cursor behind every incoming item.
            improvements.forEach((imp) => { if (imp.server_seq != null) deferredSeqs.push(imp.server_seq); });
            return { deferredSeqs };
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
                    if (improvement.server_seq != null) deferredSeqs.push(improvement.server_seq);
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
        return { deferredSeqs };
    }

    private async applyServerChanges(serverNotes: ServerNote[]): Promise<{ deferredSeqs: number[] }> {
        const deferredSeqs: number[] = [];
        if (!this.currentUserId) return { deferredSeqs };
        if (getCryptoMode() === 'e2ee' && !hasMasterKey()) {
            console.log('[SyncService] Skipping applyServerChanges: E2EE enabled but locked.');
            serverNotes.forEach((n) => { if (n.server_seq != null) deferredSeqs.push(n.server_seq); });
            return { deferredSeqs };
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
            let transcription: string | undefined =
                existing?.transcription && existing.transcription !== '[Encrypted]'
                    ? existing.transcription
                    : undefined;

            try {
                if (serverNote.content_ciphertext) {
                    content = await decryptFromSync(serverNote.content_ciphertext);
                }

                if (serverNote.transcription_ciphertext) {
                    try {
                        transcription = await decryptFromSync(serverNote.transcription_ciphertext);
                    } catch (transcriptionError) {
                        // Keep the local transcription rather than blanking it; the
                        // content decrypt above would already have failed on a real
                        // key problem.
                        console.warn(`[SyncService] Failed to decrypt transcription for note ${serverNote.id}`, transcriptionError);
                    }
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
                            // Can't decrypt the title with the current key. Keep the
                            // existing local title rather than silently blanking it.
                            title = existing?.title && existing.title !== '[Encrypted]'
                                ? existing.title
                                : '';
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
                    if (serverNote.server_seq != null) deferredSeqs.push(serverNote.server_seq);
                    continue;
                }

                if (isTagError) {
                    console.warn(`[SyncService] Key mismatch for note ${serverNote.id}. Storing raw ciphertext for later decryption.`);
                    // Persist the ORIGINAL server ciphertext (title/content left
                    // undefined so saveNoteLocal keeps the raw blobs instead of
                    // re-encrypting the literal "[Encrypted]" string). The read
                    // path (processNotes) shows "[Encrypted]" until the correct
                    // key is available, then transparently decrypts it — no
                    // re-fetch needed, and no infinite loop because syncNow skips
                    // notes whose decrypted content is "[Encrypted]".
                    const placeholder: Note = {
                        ...(existing ?? {}),
                        id: serverNote.id,
                        title: undefined,
                        content: undefined,
                        transcription: undefined,
                        encrypted_title: serverNote.title || '',
                        encrypted_content: serverNote.content_ciphertext || '',
                        encrypted_transcription: serverNote.transcription_ciphertext || existing?.encrypted_transcription,
                        content_nonce: serverNote.content_nonce ?? null,
                        updated_at: serverNote.updated_at,
                        version: serverNote.version,
                        server_updated_at: serverNote.updated_at,
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

            // Audio reconciliation. Server has_audio=false is only authoritative
            // when this device knows the blob was on the server before
            // (audio_remote=1) — otherwise it is a legacy note whose local-only
            // recording predates audio sync and must not be destroyed.
            const serverRemovedAudio =
                serverNote.has_audio === false && !!existing?.audio_remote && !!existing?.audio_file_path;
            if (serverRemovedAudio && existing?.audio_file_path) {
                try {
                    await AudioService.deleteAudioFile(existing.audio_file_path);
                } catch (audioError) {
                    console.warn(`[SyncService] Failed to remove local audio for note ${serverNote.id}`, audioError);
                }
            }
            const keepLocalAudio = !!existing?.audio_file_path && !serverRemovedAudio;

            const merged: Note = {
                ...(existing ?? {}),
                id: serverNote.id,
                title,
                content,
                encrypted_title: encryptedTitle,
                encrypted_content: await encrypt(content),
                updated_at: serverNote.updated_at,
                created_at: existing?.created_at ?? serverNote.updated_at,
                transcription,
                encrypted_transcription: transcription !== undefined ? undefined : existing?.encrypted_transcription,
                audio_file_path: keepLocalAudio ? existing?.audio_file_path : '',
                audio_duration: serverNote.audio_duration ?? (keepLocalAudio ? existing?.audio_duration : undefined),
                has_audio: keepLocalAudio || !!serverNote.has_audio,
                audio_remote: serverNote.audio_available ? 1 : 0,
                audio_synced: serverRemovedAudio ? 0 : existing?.audio_synced ?? 0,
                audio_sha256: serverRemovedAudio ? null : serverNote.audio_sha256 ?? existing?.audio_sha256 ?? null,
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
        return { deferredSeqs };
    }
}

export const syncService = new SyncService();
