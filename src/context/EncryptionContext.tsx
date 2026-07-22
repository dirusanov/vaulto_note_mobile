import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { AppState, InteractionManager } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { useAuth } from '../hooks/useAuth';
import { storage, CryptoMode, setPendingDecryptSync, clearPendingDecryptSync } from '../utils/storage';
import {
    KeyBundle,
    SecretMode,
    clearMasterKey,
    createKeyBundle,
    getMasterKey,
    getSecretValidationError,
    hasMasterKey,
    isKeyBundle,
    keyIdFromMasterKey,
    normalizeSecretInput,
    recoveryCodeFromMasterKey,
    masterKeyFromRecoveryCode,
    setMasterKey,
    unwrapMasterKeyAsync,
    wrapMasterKey,
} from '../crypto/e2ee';
import { setCryptoMode, isMasterCiphertext } from '../crypto/encryption';
import { e2eeApi, E2EEEnableConflictError } from '../api/e2ee';
import { notesApi } from '../api/notes';
import { 
    initDatabase,
    setDeletionGuard,
    decryptAndRescueAllNotes,
    forceReencryptionLocal,
    archiveSyncedNotesAfterReset,
    finalizeResetArchiveAsLocal,
    promoteResetArchiveToSync,
    purgeSyncedNotesForUser,
    purgeUnreadableLocalOnlyNotesForUser,
} from '../services/DatabaseService';
import { syncService } from '../services/SyncService';
import { isSameKeyGeneration } from '../services/encryptionState';
import { generateUUID } from '../utils/uuid';

export type EncryptionStatus = 'loading' | 'uninitialized' | 'locked' | 'ready';
export type ResetEncryptionResult = { purged: boolean; syncSucceeded: boolean };
export type EncryptionProgressCallback = (progress: number) => void;

interface EncryptionContextType {
    status: EncryptionStatus;
    mode: CryptoMode;
    syncEnabled: boolean;
    syncLocked: boolean;
    resetRecoveryPending: boolean;
    hasRemoteKeyBundle: boolean;
    bundle: KeyBundle | null;
    recoveryCode: string | null;
    enableE2EE: (secret: string, mode?: SecretMode, onProgress?: EncryptionProgressCallback) => Promise<void>;
    setupWithRecoveryCode: (code: string) => Promise<void>;
    unlock: (secret: string, onProgress?: EncryptionProgressCallback) => Promise<void>;
    changePin: (secret: string, onProgress?: EncryptionProgressCallback) => Promise<void>;
    setSyncEnabledPreference: (enabled: boolean) => Promise<void>;
    resetSync: () => Promise<ResetEncryptionResult>;
    resetEncryption: () => Promise<ResetEncryptionResult>;
    forceResetEncryption: () => Promise<ResetEncryptionResult>;
    keepResetArchiveLocal: () => Promise<void>;
    resumeStandardSyncAfterReset: () => Promise<void>;
    lock: () => void;
}

const EncryptionContext = createContext<EncryptionContextType | undefined>(undefined);
const clampProgress = (value: number): number => Math.max(0, Math.min(100, value));
const createProgressReporter = (onProgress?: EncryptionProgressCallback): EncryptionProgressCallback => {
    let lastProgress = 0;
    return (value: number) => {
        const nextProgress = Math.max(lastProgress, clampProgress(value));
        lastProgress = nextProgress;
        onProgress?.(nextProgress);
    };
};

export const EncryptionProvider = ({ children }: { children: React.ReactNode }) => {
    const { userId, isGuest, isAuthenticated } = useAuth();
    const [status, setStatus] = useState<EncryptionStatus>('loading');
    const [mode, setMode] = useState<CryptoMode>('local');
    const [syncEnabled, setSyncEnabled] = useState(false);
    const [bundle, setBundle] = useState<KeyBundle | null>(null);
    const [syncUnlocked, setSyncUnlocked] = useState(false);
    const [hasRemoteKeyBundle, setHasRemoteKeyBundle] = useState(false);
    const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
    const [resetRecoveryPending, setResetRecoveryPending] = useState(false);
    const encryptionMigrationInFlightRef = useRef(false);
    const disableTransitionInFlightRef = useRef(false);
    const encryptionReconciliationInFlightRef = useRef<Promise<void> | null>(null);
    const persistMasterKey = useCallback(async (currentUserId: string, key: Uint8Array) => {
        const hex = bytesToHex(key);
        await storage.setStoredMasterKey(currentUserId, hex);
    }, []);

    const restoreMasterKey = useCallback(async (currentUserId: string): Promise<boolean> => {
        try {
            const wrapped = await storage.getStoredMasterKey(currentUserId);
            if (!wrapped) return false;
            
            const keyBytes = hexToBytes(wrapped);
            setMasterKey(keyBytes);
            setRecoveryCode(recoveryCodeFromMasterKey(keyBytes));
            setSyncUnlocked(true);
            return true;
        } catch (error) {
            console.warn('[Encryption] Failed to restore master key:', error);
            return false;
        }
    }, []);

    const ensureEncryptionTransitionToken = useCallback(async (
        currentUserId: string,
        kind: 'enable' | 'disable',
    ): Promise<string> => {
        const [existingToken, existingKind] = await Promise.all([
            storage.getEncryptionTransitionToken(currentUserId),
            storage.getEncryptionTransitionKind(currentUserId),
        ]);
        if (existingToken && existingKind === kind) {
            syncService.setEncryptionTransitionToken(existingToken);
            return existingToken;
        }
        if (existingToken && existingKind && existingKind !== kind) {
            throw new Error('Another encryption transition is still pending on this device.');
        }
        const token = existingToken ?? await generateUUID();
        await storage.setEncryptionTransitionToken(currentUserId, token);
        await storage.setEncryptionTransitionKind(currentUserId, kind);
        syncService.setEncryptionTransitionToken(token);
        return token;
    }, []);

    const clearEncryptionTransitionToken = useCallback(async (currentUserId: string) => {
        await storage.clearEncryptionTransitionToken(currentUserId);
        syncService.setEncryptionTransitionToken(null);
    }, []);

    const prepareForRemoteKeyGeneration = useCallback(async (
        currentUserId: string,
        localEpoch: number,
        serverEpoch: number,
    ): Promise<void> => {
        if (localEpoch <= 0 || serverEpoch <= 0 || localEpoch === serverEpoch) return;

        console.log('[Encryption] E2EE key generation changed remotely; preserving local notes before locking.', {
            local_key_epoch: localEpoch,
            server_key_epoch: serverEpoch,
        });

        setDeletionGuard(true);
        try {
            const oldKeyAvailable = hasMasterKey() || await restoreMasterKey(currentUserId);
            if (!oldKeyAvailable || !hasMasterKey()) {
                throw new Error('Previous master key is unavailable for local note migration.');
            }

            // Keep any local-only/dirty notes readable: decrypt with the old
            // master key and immediately protect them with the device key. Once
            // the new account key is unlocked, normal sync encrypts only the
            // dirty set with that new key.
            setCryptoMode('local');
            await decryptAndRescueAllNotes(currentUserId, false, true);

            clearMasterKey();
            await storage.removeStoredMasterKey(currentUserId);
            await storage.removeKeyBundle(currentUserId);
        } catch (error) {
            // Keep the old generation active if even one local row could not be
            // preserved. The server epoch guard will reject uploads with this
            // key, avoiding corruption while the user can retry/recover.
            setCryptoMode('e2ee');
            throw error;
        } finally {
            setDeletionGuard(false);
        }
    }, [restoreMasterKey]);

    const publishE2EEBundle = useCallback(async (
        currentUserId: string,
        keyBundle: KeyBundle,
    ) => {
        const transitionToken = await ensureEncryptionTransitionToken(currentUserId, 'enable');
        const current = await e2eeApi.fetchState(transitionToken);
        if (!current?.transition_state) {
            await e2eeApi.setConfig('standard');
        }
        const expectedEpoch = current?.key_epoch ?? await storage.getKeyEpoch(currentUserId);
        const atomicState = await e2eeApi.enableWithBundle(
            keyBundle,
            expectedEpoch,
            syncService.getServerSeqSnapshot(),
            transitionToken,
        );
        if (!atomicState) {
            // A split bundle/state write cannot be made crash-safe. Refuse the
            // legacy fallback and keep the local migration journal intact until
            // the account server supports the atomic transition protocol.
            throw new Error('The sync server must be updated before E2EE can be enabled safely.');
        }
        return atomicState;
    }, [ensureEncryptionTransitionToken]);

    const adoptConcurrentE2EE = useCallback(async (
        currentUserId: string,
    ): Promise<void> => {
        // Our locally-created key lost the server-side enable race. Re-wrap all
        // local rows with the device key before forgetting it, then adopt the
        // winning bundle and require its passphrase.
        setCryptoMode('local');
        await decryptAndRescueAllNotes(currentUserId, false, true);
        clearMasterKey();
        await storage.removeStoredMasterKey(currentUserId);
        await storage.removeKeyBundle(currentUserId);
        await storage.clearEncryptionMigrationState(currentUserId);
        await storage.setRemoteDisableRescuePending(currentUserId, false);
        await clearEncryptionTransitionToken(currentUserId);

        const [serverState, serverBundle] = await Promise.all([
            e2eeApi.fetchState(),
            e2eeApi.fetchKeyBundle(),
        ]);
        if (!serverState || serverState.enc_mode !== 'e2ee' || !serverBundle || !isKeyBundle(serverBundle)) {
            throw new Error('Concurrent encryption setup was detected, but the active server key is unavailable.');
        }

        await storage.setKeyBundle(currentUserId, serverBundle);
        await storage.setKeyEpoch(currentUserId, serverState.key_epoch);
        await storage.setVaultGeneration(currentUserId, serverState.vault_generation);
        await storage.setCryptoMode('e2ee', currentUserId);
        syncService.setKeyEpoch(serverState.key_epoch);
        syncService.setVaultGeneration(serverState.vault_generation);
        setCryptoMode('e2ee');
        setMode('e2ee');
        setBundle(serverBundle);
        setHasRemoteKeyBundle(true);
        setRecoveryCode(null);
        setSyncUnlocked(false);
        setStatus('locked');
    }, [clearEncryptionTransitionToken]);

    const runDatabaseInit = useCallback(async (_currentUserId: string) => {
        try {
            await initDatabase();
        } catch (error) {
            console.warn('[Encryption] Database init failed:', error);
        }
    }, []);

    const scheduleDatabaseInit = useCallback((currentUserId: string) => {
        InteractionManager.runAfterInteractions(() => {
            void runDatabaseInit(currentUserId);
        });
    }, [runDatabaseInit]);

    const finalizeDestructiveResetLocally = useCallback(async (
        currentUserId: string,
        resetState: { key_epoch: number; vault_generation: number },
    ): Promise<void> => {
        // Sync is disabled before the server request and remains disabled until
        // the user explicitly chooses standard sync or E2EE again.
        await storage.setSyncEnabled(false, currentUserId);
        setSyncEnabled(false);
        syncService.setSyncEnabled(false);

        const oldKeyAvailable = hasMasterKey() || await restoreMasterKey(currentUserId);
        setCryptoMode('local');
        setMode('local');
        await storage.setCryptoMode('local', currentUserId);

        await purgeSyncedNotesForUser(currentUserId);
        if (oldKeyAvailable && hasMasterKey()) {
            // Only local-only rows remain. Move the readable ones from the old
            // account master key to the device key before erasing that key.
            await decryptAndRescueAllNotes(currentUserId, false, true);
        } else {
            // Device-key local-only notes survive. Master-key rows cannot be
            // truthfully described as preserved after a forgotten-key reset.
            await purgeUnreadableLocalOnlyNotesForUser(currentUserId);
        }

        await storage.clearEncryptionMigrationState(currentUserId);
        await storage.setRemoteDisableRescuePending(currentUserId, false);
        await clearEncryptionTransitionToken(currentUserId);
        await clearPendingDecryptSync(currentUserId);
        await storage.removeKeyBundle(currentUserId);
        await storage.removeStoredMasterKey(currentUserId);
        clearMasterKey();
        setBundle(null);
        setHasRemoteKeyBundle(false);
        setRecoveryCode(null);

        syncService.setKeyEpoch(resetState.key_epoch);
        await storage.setKeyEpoch(currentUserId, resetState.key_epoch);
        syncService.setVaultGeneration(resetState.vault_generation);
        await storage.setVaultGeneration(currentUserId, resetState.vault_generation);

        await storage.setResetRecoveryPending(currentUserId, false);
        setResetRecoveryPending(false);
        await syncService.resetSyncState(currentUserId);
        setSyncUnlocked(true);
        setStatus('ready');
        await storage.clearDestructiveResetMarker(currentUserId);
        scheduleDatabaseInit(currentUserId);
    }, [restoreMasterKey, scheduleDatabaseInit, clearEncryptionTransitionToken]);

    const completeEncryptionMigration = useCallback(async (
        currentUserId: string,
        onProgress?: EncryptionProgressCallback,
    ): Promise<boolean> => {
        if (!currentUserId) return false;

        const initialState = await storage.getEncryptionMigrationState(currentUserId);
        if (!initialState) return true;

        if (encryptionMigrationInFlightRef.current) {
            return false;
        }

        if (!hasMasterKey()) {
            console.warn('[Encryption] Pending E2EE migration found, but master key is locked.');
            return false;
        }

        const transitionToken = await ensureEncryptionTransitionToken(
            currentUserId,
            'enable',
        );

        const reportProgress = createProgressReporter(onProgress);

        encryptionMigrationInFlightRef.current = true;
        setDeletionGuard(true);

        try {
            await storage.clearSyncResetBlocked(currentUserId);
            await storage.setSyncEnabled(true, currentUserId);
            await storage.setCryptoMode('e2ee', currentUserId);
            setCryptoMode('e2ee');
            setMode('e2ee');
            setSyncEnabled(true);
            syncService.setSyncEnabled(true);
            setSyncUnlocked(true);
            setStatus('ready');

            let state = initialState;
            let bundlePublished = false;

            // Crash recovery: the atomic enable may have committed on the
            // server just before this device persisted migration_state='sync'.
            // Detect that idempotently before running the plaintext preflight
            // again, otherwise every retry would observe e2ee while in local
            // mode and pause forever.
            if (state === 'local') {
                const serverState = await e2eeApi.fetchState(transitionToken);
                if (serverState?.enc_mode === 'e2ee') {
                    const [storedBundle, serverBundle] = await Promise.all([
                        storage.getKeyBundle(currentUserId),
                        e2eeApi.fetchKeyBundle(),
                    ]);
                    const sameMasterKey = !!(
                        storedBundle
                        && serverBundle
                        && isKeyBundle(storedBundle)
                        && isKeyBundle(serverBundle)
                        && isSameKeyGeneration(
                            storedBundle.key_id,
                            serverBundle.key_id,
                            JSON.stringify(storedBundle) === JSON.stringify(serverBundle),
                        )
                    );
                    if (!sameMasterKey || !serverBundle || !isKeyBundle(serverBundle)) {
                        await adoptConcurrentE2EE(currentUserId);
                        throw new E2EEEnableConflictError();
                    }

                    await storage.setKeyBundle(currentUserId, serverBundle);
                    await storage.setKeyEpoch(currentUserId, serverState.key_epoch);
                    await storage.setVaultGeneration(currentUserId, serverState.vault_generation);
                    await storage.setEncryptionMigrationState(currentUserId, 'sync');
                    syncService.setKeyEpoch(serverState.key_epoch);
                    syncService.setVaultGeneration(serverState.vault_generation);
                    setBundle(serverBundle);
                    setHasRemoteKeyBundle(true);
                    state = 'sync';
                    bundlePublished = true;
                }
            }

            if (state === 'local') {
                console.log('[Encryption] Resuming local E2EE migration...');
                reportProgress(86);
                // Before the server flips to E2EE, capture every server-only
                // audio blob locally. Text can be rewrapped repeatedly, but an
                // old-mode audio object cannot be recovered after its key is
                // discarded. The migration remains pending while offline.
                setCryptoMode('local');
                try {
                    await syncService.pullAllFromServer(currentUserId, 'e2ee_migration');
                    await syncService.ensureAllRemoteAudioAvailable(currentUserId);
                    await syncService.markAllLocalAudioForResync(currentUserId);
                } finally {
                    setCryptoMode('e2ee');
                }

                await forceReencryptionLocal(currentUserId, ({ completed, total }) => {
                    if (total <= 0) {
                        reportProgress(94);
                        return;
                    }
                    reportProgress(86 + (completed / total) * 8);
                });
                reportProgress(95);
                console.log('[Encryption] Local E2EE migration finished.');
            }

            if (state === 'local') {
                reportProgress(96);

                const storedBundle = await storage.getKeyBundle(currentUserId);
                if (!storedBundle || !isKeyBundle(storedBundle)) {
                    console.warn('[Encryption] Cannot complete E2EE migration: key bundle missing.');
                    await storage.setEncryptionMigrationState(currentUserId, 'local');
                    return false;
                }

                try {
                    // Publish the bundle and claim the next epoch atomically so
                    // concurrent devices cannot establish different master keys.
                    const e2eeState = await publishE2EEBundle(currentUserId, storedBundle);
                    syncService.setKeyEpoch(e2eeState.key_epoch);
                    await storage.setKeyEpoch(currentUserId, e2eeState.key_epoch);
                    syncService.setVaultGeneration(e2eeState.vault_generation);
                    await storage.setVaultGeneration(currentUserId, e2eeState.vault_generation);
                    setHasRemoteKeyBundle(true);
                    await storage.setEncryptionMigrationState(currentUserId, 'sync');
                    state = 'sync';
                    bundlePublished = true;
                } catch (error) {
                    if (error instanceof E2EEEnableConflictError) {
                        await adoptConcurrentE2EE(currentUserId);
                        throw error;
                    }
                    console.warn('[Encryption] Failed to publish E2EE key bundle. Migration remains pending:', error);
                    await storage.setEncryptionMigrationState(currentUserId, 'local');
                    return false;
                }
            }

            if (state === 'sync') {
                reportProgress(96);

                if (!bundlePublished) {
                    const storedBundle = await storage.getKeyBundle(currentUserId);
                    if (!storedBundle || !isKeyBundle(storedBundle)) {
                        console.warn('[Encryption] Cannot complete E2EE migration: key bundle missing.');
                        await storage.setEncryptionMigrationState(currentUserId, 'sync');
                        return false;
                    }

                    try {
                        const e2eeState = await publishE2EEBundle(currentUserId, storedBundle);
                        syncService.setKeyEpoch(e2eeState.key_epoch);
                        await storage.setKeyEpoch(currentUserId, e2eeState.key_epoch);
                        syncService.setVaultGeneration(e2eeState.vault_generation);
                        await storage.setVaultGeneration(currentUserId, e2eeState.vault_generation);
                        setHasRemoteKeyBundle(true);
                    } catch (error) {
                        if (error instanceof E2EEEnableConflictError) {
                            await adoptConcurrentE2EE(currentUserId);
                            throw error;
                        }
                        console.warn('[Encryption] Failed to publish E2EE key bundle. Migration sync remains pending:', error);
                        await storage.setEncryptionMigrationState(currentUserId, 'sync');
                        return false;
                    }
                }

                try {
                    // A reset archive stays local-only throughout the standard
                    // mode preflight. Only after the server has atomically
                    // entered E2EE may it become dirty/syncable, ensuring its
                    // first upload is master-key ciphertext.
                    if (await storage.getResetRecoveryPending(currentUserId)) {
                        await promoteResetArchiveToSync(currentUserId);
                    }

                    const hasPendingChanges = await syncService.hasUnsyncedChanges(currentUserId);
                    if (hasPendingChanges) {
                        await syncService.resetSyncState(currentUserId);
                    }

                    reportProgress(97);
                    await syncService.syncNowAndWait('e2ee_migration');
                    await syncService.syncAudioNowAndWait();

                    const stillPending = await syncService.hasUnsyncedChanges(currentUserId);
                    if (stillPending) {
                        console.warn('[Encryption] E2EE migration sync is still pending.');
                        await storage.setEncryptionMigrationState(currentUserId, 'sync');
                        return false;
                    }

                    // Local dirty=0 is not enough to prove that every server row
                    // and audio descriptor was migrated. Keep the crash-resume
                    // marker until the server audits the active dataset.
                    await e2eeApi.validateDataMode('e2ee', transitionToken);

                    await storage.clearEncryptionMigrationState(currentUserId);
                    await clearEncryptionTransitionToken(currentUserId);
                    if (await storage.getResetRecoveryPending(currentUserId)) {
                        await storage.setResetRecoveryPending(currentUserId, false);
                        setResetRecoveryPending(false);
                    }
                    reportProgress(100);
                    console.log('[Encryption] E2EE migration completed.');
                    return true;
                } catch (error) {
                    console.warn('[Encryption] Failed to complete E2EE migration sync:', error);
                    await storage.setEncryptionMigrationState(currentUserId, 'sync');
                    return false;
                }
            }

            return true;
        } finally {
            setDeletionGuard(false);
            encryptionMigrationInFlightRef.current = false;
        }
    }, [
        publishE2EEBundle,
        adoptConcurrentE2EE,
        ensureEncryptionTransitionToken,
        clearEncryptionTransitionToken,
    ]);

    const loadState = useCallback(async () => {
        setStatus('loading');
        clearMasterKey();
        setSyncUnlocked(false);
        setBundle(null);
        setHasRemoteKeyBundle(false);

        const storedSyncEnabled = await storage.getSyncEnabled(userId);
        const storedCryptoMode = await storage.getCryptoMode(userId);
        const isAuthReady = !!userId && isAuthenticated && !isGuest;
        const destructiveResetMarker = isAuthReady
            ? await storage.getDestructiveResetMarker(userId)
            : null;
        const storedVaultGeneration = isAuthReady
            ? await storage.getVaultGeneration(userId)
            : 0;
        const storedResetRecoveryPending = isAuthReady
            ? await storage.getResetRecoveryPending(userId)
            : false;
        const remoteDisableRescuePending = isAuthReady
            ? await storage.getRemoteDisableRescuePending(userId)
            : false;
        setResetRecoveryPending(storedResetRecoveryPending);
        const pendingMigrationState = isAuthReady
            ? await storage.getEncryptionMigrationState(userId)
            : null;
        let storedTransitionToken = isAuthReady
            ? await storage.getEncryptionTransitionToken(userId)
            : null;
        const storedTransitionKind = isAuthReady
            ? await storage.getEncryptionTransitionKind(userId)
            : null;
        syncService.setEncryptionTransitionToken(storedTransitionToken);
        let shouldEnableSync = isAuthReady
            && !destructiveResetMarker
            && !storedResetRecoveryPending
            && !remoteDisableRescuePending
            && (pendingMigrationState ? true : storedSyncEnabled !== false);

        setMode(storedCryptoMode);
        setCryptoMode(storedCryptoMode);
        setSyncEnabled(shouldEnableSync);
        syncService.setSyncEnabled(shouldEnableSync);

        if (!isAuthReady) {
            setStatus('ready');
            if (userId) {
                scheduleDatabaseInit(userId);
            }
            return;
        }

        const blockSyncForServerRollback = async (message: string) => {
            console.error(message);
            await storage.setSyncEnabled(false, userId);
            setSyncEnabled(false);
            syncService.setSyncEnabled(false);
            const retainedBundle = await storage.getKeyBundle(userId);
            if (retainedBundle && isKeyBundle(retainedBundle)) {
                setBundle(retainedBundle);
            }
            const keyAvailable = storedCryptoMode === 'e2ee'
                ? await restoreMasterKey(userId)
                : true;
            setCryptoMode(storedCryptoMode);
            setMode(storedCryptoMode);
            setSyncUnlocked(keyAvailable);
            setStatus(
                storedCryptoMode === 'e2ee' && !keyAvailable
                    ? 'locked'
                    : 'ready',
            );
            scheduleDatabaseInit(userId);
        };

        // Server-authoritative encryption state is the source of truth. If another
        // device disabled E2EE for this account, the server reports enc_mode='off'
        // with a higher key_epoch — this device must drop its key and switch to
        // plaintext rather than staying locked or re-encrypting on the next edit.
        // We also remember the mode so the lock decision below trusts the server,
        // not the device-local default cryptoMode (which is 'local' on a fresh
        // device and would otherwise leak plaintext into an e2ee account).
        let serverEncMode: 'off' | 'e2ee' | null = null;
        if (!pendingMigrationState || destructiveResetMarker) {
            try {
                const serverState = await e2eeApi.fetchState(storedTransitionToken);
                // null => server doesn't support the state endpoint (older build);
                // leave serverEncMode unknown and fall back to legacy detection.
                if (serverState) {
                    serverEncMode = serverState.enc_mode;
                    const localEpoch = await storage.getKeyEpoch(userId);

                    if (serverState.transition_state && !serverState.transition_owned) {
                        // A token left by an older local operation must never
                        // make this device look like the owner of a transition
                        // started elsewhere. The backend remains authoritative.
                        await clearEncryptionTransitionToken(userId);
                        storedTransitionToken = null;
                    } else if (
                        !serverState.transition_state
                        && storedTransitionToken
                        && storedTransitionKind !== 'disable'
                        && !pendingMigrationState
                    ) {
                        await clearEncryptionTransitionToken(userId);
                        storedTransitionToken = null;
                    }

                    // Resume or roll back a client-side destructive reset
                    // journal before any ordinary generation reconciliation.
                    if (destructiveResetMarker) {
                        if (
                            serverState.vault_generation
                            > destructiveResetMarker.expectedVaultGeneration
                        ) {
                            await finalizeDestructiveResetLocally(userId, serverState);
                            return;
                        }

                        // The server never crossed the destructive boundary.
                        // Restore the device's previous sync preference and
                        // clear the abandoned journal.
                        await storage.clearDestructiveResetMarker(userId);
                        await storage.setSyncEnabled(
                            destructiveResetMarker.previousSyncEnabled,
                            userId,
                        );
                        shouldEnableSync = destructiveResetMarker.previousSyncEnabled;
                        setSyncEnabled(shouldEnableSync);
                        syncService.setSyncEnabled(shouldEnableSync);
                    }

                    if (
                        storedVaultGeneration > 0
                        && serverState.vault_generation < storedVaultGeneration
                    ) {
                        await blockSyncForServerRollback(
                            '[Encryption] Server vault generation regressed; blocking sync to prevent stale-vault writes.',
                        );
                        return;
                    }

                    if (
                        serverState.enc_mode === 'e2ee'
                        && localEpoch > 0
                        && serverState.key_epoch > 0
                        && serverState.key_epoch < localEpoch
                    ) {
                        await blockSyncForServerRollback(
                            '[Encryption] Server key epoch regressed; blocking sync to preserve the current local key generation.',
                        );
                        return;
                    }

                    // A higher vault generation means a destructive reset was
                    // committed elsewhere. This is deliberately handled before
                    // the ordinary e2ee->off path: retained data must become a
                    // local-only archive, never an automatic plaintext upload.
                    if (serverState.vault_generation > storedVaultGeneration) {
                        const localBundle = await storage.getKeyBundle(userId);
                        const localMasterKey = await storage.getStoredMasterKey(userId);
                        const hadOldEncryptedVault = storedCryptoMode === 'e2ee'
                            || !!localBundle
                            || !!localMasterKey;

                        if (hadOldEncryptedVault) {
                            console.log('[Encryption] Encrypted vault was reset remotely; isolating retained notes locally.');
                            // Journal and stop sync BEFORE adopting the server
                            // generation. If the app is killed during rescue,
                            // the next launch still observes a higher generation
                            // and safely retries instead of uploading old dirty rows.
                            await storage.setResetRecoveryPending(userId, true);
                            setResetRecoveryPending(true);
                            await storage.setSyncEnabled(false, userId);
                            setSyncEnabled(false);
                            syncService.setSyncEnabled(false);
                            setDeletionGuard(true);
                            let archivedCount: number | null = null;
                            try {
                                const keyRestored = hasMasterKey() || await restoreMasterKey(userId);
                                if (!keyRestored || !hasMasterKey()) {
                                    throw new Error('The previous master key is unavailable on this device.');
                                }

                                setCryptoMode('local');
                                setMode('local');
                                await storage.setCryptoMode('local', userId);
                                // Mechanical re-wrap only. Preserve genuine dirty
                                // and deleted flags until the rows are archived.
                                await decryptAndRescueAllNotes(userId, false, true);
                                archivedCount = await archiveSyncedNotesAfterReset(userId);
                                await storage.setRemoteDisableRescuePending(userId, false);

                                clearMasterKey();
                                await storage.removeKeyBundle(userId);
                                await storage.removeStoredMasterKey(userId);
                                setBundle(null);
                                setHasRemoteKeyBundle(false);
                                setRecoveryCode(null);

                                syncService.setVaultGeneration(serverState.vault_generation);
                                await storage.setVaultGeneration(userId, serverState.vault_generation);
                                syncService.setKeyEpoch(serverState.key_epoch);
                                await storage.setKeyEpoch(userId, serverState.key_epoch);
                                setSyncUnlocked(true);
                                setStatus('ready');
                            } catch (error) {
                                // Keep the old local key material so the user can
                                // still unlock/export it. Sync remains stopped and
                                // the server generation fence rejects every write.
                                console.warn('[Encryption] Could not archive every retained reset note yet.', error);
                                if (localBundle && isKeyBundle(localBundle)) {
                                    setBundle(localBundle);
                                }
                                setCryptoMode('e2ee');
                                setMode('e2ee');
                                await storage.setCryptoMode('e2ee', userId);
                                setSyncUnlocked(hasMasterKey());
                                setStatus(hasMasterKey() ? 'ready' : 'locked');
                            } finally {
                                setDeletionGuard(false);
                            }
                            if (archivedCount === 0) {
                                await storage.setResetRecoveryPending(userId, false);
                                setResetRecoveryPending(false);
                                await storage.setSyncEnabled(shouldEnableSync, userId);
                                setSyncEnabled(shouldEnableSync);
                                syncService.setSyncEnabled(shouldEnableSync);
                                if (shouldEnableSync) {
                                    void syncService.pullAllFromServer(userId)
                                        .catch((error) => console.warn('[Encryption] Post-reset refresh failed:', error));
                                }
                            }
                            scheduleDatabaseInit(userId);
                            return;
                        }

                        // A generation boundary protects standard-sync data as
                        // well. Even without E2EE key material, old dirty rows
                        // must be isolated locally instead of being adopted into
                        // the new vault and resurrected automatically.
                        await storage.setResetRecoveryPending(userId, true);
                        setResetRecoveryPending(true);
                        await storage.setSyncEnabled(false, userId);
                        setSyncEnabled(false);
                        syncService.setSyncEnabled(false);
                        setCryptoMode('local');
                        setMode('local');
                        await storage.setCryptoMode('local', userId);
                        let archivedCount: number | null = null;
                        try {
                            archivedCount = await archiveSyncedNotesAfterReset(userId);
                            syncService.setVaultGeneration(serverState.vault_generation);
                            await storage.setVaultGeneration(userId, serverState.vault_generation);
                            syncService.setKeyEpoch(serverState.key_epoch);
                            await storage.setKeyEpoch(userId, serverState.key_epoch);
                        } catch (error) {
                            console.warn('[Encryption] Standard-sync reset archive is incomplete; sync remains paused.', error);
                        }
                        if (archivedCount === 0) {
                            await storage.setResetRecoveryPending(userId, false);
                            setResetRecoveryPending(false);
                            await storage.setSyncEnabled(shouldEnableSync, userId);
                            setSyncEnabled(shouldEnableSync);
                            syncService.setSyncEnabled(shouldEnableSync);
                            if (shouldEnableSync) {
                                void syncService.pullAllFromServer(userId)
                                    .catch((error) => console.warn('[Encryption] Post-reset refresh failed:', error));
                            }
                        }
                        setSyncUnlocked(true);
                        setStatus('ready');
                        scheduleDatabaseInit(userId);
                        return;
                    }

                    syncService.setVaultGeneration(serverState.vault_generation);
                    await storage.setVaultGeneration(userId, serverState.vault_generation);

                    if (
                        serverState.enc_mode === 'e2ee'
                        && storedCryptoMode === 'e2ee'
                        && localEpoch > 0
                        && serverState.key_epoch !== localEpoch
                    ) {
                        await prepareForRemoteKeyGeneration(userId, localEpoch, serverState.key_epoch);
                    }

                    syncService.setKeyEpoch(serverState.key_epoch);
                    await storage.setKeyEpoch(userId, serverState.key_epoch);

                    if (
                        serverState.enc_mode === 'off'
                        && !serverState.transition_state
                        && serverState.key_epoch >= localEpoch
                    ) {
                    const localBundleBeforeDisable = await storage.getKeyBundle(userId);
                    const hadE2EE = storedCryptoMode === 'e2ee' || !!localBundleBeforeDisable;
                    if (hadE2EE) {
                        console.log('[Encryption] Account encryption disabled remotely — switching this device to plaintext.');
                        // Switch to local mode FIRST so encrypt() targets the device key.
                        setCryptoMode('local');
                        setMode('local');
                        await storage.setCryptoMode('local', userId);
                        // Rescue any local-only ciphertext to the device key WHILE the
                        // master key can still be restored, so notes that never reached
                        // the server are not stranded as undecryptable after we drop it.
                        let rescueCompleted = false;
                        try {
                            const keyRestored = await restoreMasterKey(userId);
                            if (!keyRestored || !hasMasterKey()) {
                                throw new Error('Previous master key is unavailable for local note rescue.');
                            }
                            // Never delete the old key after a partial pass. One
                            // unreadable local-only row is enough to keep it for
                            // the next retry/recovery attempt.
                            // Re-wrap clean rows mechanically without converting
                            // them into semantic edits. Existing dirty rows remain
                            // dirty and will be reconciled normally.
                            await decryptAndRescueAllNotes(userId, false, true);
                            if (storedResetRecoveryPending) {
                                await archiveSyncedNotesAfterReset(userId);
                            }
                            rescueCompleted = true;
                        } catch (e) {
                            console.warn('[Encryption] Local rescue during remote-disable is incomplete; retaining the old key.', e);
                        }
                        if (rescueCompleted) {
                            await storage.setRemoteDisableRescuePending(userId, false);
                            await clearEncryptionTransitionToken(userId);
                            clearMasterKey();
                            await storage.removeKeyBundle(userId);
                            await storage.removeStoredMasterKey(userId);
                        } else if (storedResetRecoveryPending) {
                            // This is an old reset archive, not an ordinary
                            // disable transition. Keep its local bundle and let
                            // the user unlock it; never fall through to plaintext.
                            if (localBundleBeforeDisable && isKeyBundle(localBundleBeforeDisable)) {
                                setBundle(localBundleBeforeDisable);
                            }
                            setCryptoMode('e2ee');
                            setMode('e2ee');
                            await storage.setCryptoMode('e2ee', userId);
                            setSyncUnlocked(false);
                            setStatus('locked');
                            await storage.setSyncEnabled(false, userId);
                            setSyncEnabled(false);
                            syncService.setSyncEnabled(false);
                            scheduleDatabaseInit(userId);
                            return;
                        } else {
                            // The cloud is already plaintext, but local-only rows
                            // may still require the old passphrase. Keep the old
                            // bundle locally and pause sync until unlock() can
                            // rewrap them with the device key.
                            await storage.setRemoteDisableRescuePending(userId, true);
                            if (localBundleBeforeDisable && isKeyBundle(localBundleBeforeDisable)) {
                                setBundle(localBundleBeforeDisable);
                            }
                            setCryptoMode('e2ee');
                            setMode('e2ee');
                            await storage.setCryptoMode('e2ee', userId);
                            setSyncUnlocked(false);
                            setStatus('locked');
                            setSyncEnabled(false);
                            syncService.setSyncEnabled(false);
                            scheduleDatabaseInit(userId);
                            return;
                        }
                    }
                    setCryptoMode('local');
                    setMode('local');
                    setBundle(null);
                    setHasRemoteKeyBundle(false);
                    setSyncUnlocked(true);
                    setStatus('ready');
                    setSyncEnabled(shouldEnableSync);
                    syncService.setSyncEnabled(shouldEnableSync);
                    scheduleDatabaseInit(userId);
                    if (hadE2EE) {
                        // Push the rescued plaintext and pull the now-plaintext server
                        // notes (overwriting any stale local ciphertext).
                        void syncService.pullAllFromServer(userId)
                            .catch((e) => console.warn('[Encryption] Re-pull after remote disable failed', e));
                    }
                    return;
                    }
                }
            } catch (error) {
                // Older server without /e2ee/state, or offline — fall through to
                // the legacy bundle-based detection below.
                console.warn('[Encryption] Could not fetch server encryption state:', error);
            }
        }

        const chooseNewestBundle = (local: KeyBundle | null, remote: KeyBundle | null): KeyBundle | null => {
            if (!local) return remote;
            if (!remote) return local;
            const localTime = Date.parse(local.created_at || '');
            const remoteTime = Date.parse(remote.created_at || '');
            if (!Number.isNaN(localTime) && !Number.isNaN(remoteTime)) {
                return remoteTime > localTime ? remote : local;
            }
            if (!Number.isNaN(localTime) && Number.isNaN(remoteTime)) {
                return local;
            }
            return remote;
        };

        let activeBundle: KeyBundle | null = null;
        let validServerBundleSeen = false;
        const syncResetBlocked = await storage.getSyncResetBlocked(userId);
        if (syncResetBlocked) {
            await storage.removeKeyBundle(userId);
        } else {
            const localBundle = await storage.getKeyBundle(userId);
            if (localBundle && isKeyBundle(localBundle)) {
                activeBundle = localBundle;
            }

            try {
                const serverBundle = await e2eeApi.fetchKeyBundle();
                if (serverBundle && isKeyBundle(serverBundle)) {
                    validServerBundleSeen = true;
                    let hasEncryptedRemoteNotes = false;
                    try {
                        const notesResponse = await notesApi.sync({ 
                            changes: [], 
                            improvement_changes: [],
                            since_updated_at: '1970-01-01T00:00:00+00:00',
                            vault_generation: await storage.getVaultGeneration(userId),
                            transition_token: storedTransitionToken ?? undefined,
                        });
                        
                        const isEnc = (n: any) => n.content_type === 'encrypted' || (typeof n.content_ciphertext === 'string' && isMasterCiphertext(n.content_ciphertext));
                        
                        const hasEncNotes = (notesResponse.server_changes || []).some(n => !n.deleted && isEnc(n)) || 
                                           (notesResponse.updated || []).some(n => !n.deleted && isEnc(n));
                        const hasEncImps = (notesResponse.improvement_changes || []).some(n => !n.deleted && (typeof n.content_ciphertext === 'string' && isMasterCiphertext(n.content_ciphertext))) || 
                                           (notesResponse.improvement_updates || []).some(n => !n.deleted && (typeof n.content_ciphertext === 'string' && isMasterCiphertext(n.content_ciphertext)));
                        
                        hasEncryptedRemoteNotes = hasEncNotes || hasEncImps;
                    } catch (e) {
                        hasEncryptedRemoteNotes = false;
                    }

                    // Adopt the server bundle when the account is authoritatively
                    // e2ee (serverEncMode) OR — for older servers without the state
                    // endpoint — when we can still detect encrypted notes. This also
                    // covers an e2ee account that currently has no encrypted notes
                    // (e.g. just enabled / empty), where the heuristic alone would
                    // miss it and a fresh device would wrongly skip the lock.
                    const accountEncrypted = serverEncMode === 'e2ee'
                        || (serverEncMode === null && hasEncryptedRemoteNotes);
                    if (accountEncrypted) {
                        setHasRemoteKeyBundle(true);
                        // On a modern server the account state and bundle are
                        // authoritative. Client timestamps are not trustworthy
                        // enough to select a cryptographic key generation.
                        const chosen = serverEncMode === 'e2ee'
                            ? serverBundle
                            : chooseNewestBundle(activeBundle, serverBundle);
                        activeBundle = chosen;
                        if (chosen === serverBundle) {
                            await storage.setKeyBundle(userId, serverBundle);
                        }
                    } else {
                        // Encryption is off (or a legacy bundle with no encrypted
                        // data) — no need to force a lock.
                        setHasRemoteKeyBundle(false);
                        activeBundle = activeBundle || null;
                    }
                }
            } catch (error) {
                console.warn('[Encryption] Failed to fetch key bundle from server:', error);
            }

            // Once the modern state endpoint says E2EE is active, a local
            // cached bundle must never substitute for a missing/invalid server
            // bundle. It might belong to a losing concurrent setup or an older
            // generation. Lock and retry the authoritative fetch instead.
            if (serverEncMode === 'e2ee' && !validServerBundleSeen) {
                activeBundle = null;
                setHasRemoteKeyBundle(false);
            }
        }

        if (activeBundle) {
            setBundle(activeBundle);
            let keyExists = await restoreMasterKey(userId);
            const restoredKey = getMasterKey();
            if (
                keyExists
                && restoredKey
                && activeBundle.key_id
                && keyIdFromMasterKey(restoredKey) !== activeBundle.key_id
            ) {
                console.warn('[Encryption] Stored master key does not match the active server bundle; preserving local rows and locking.');
                try {
                    setCryptoMode('local');
                    await decryptAndRescueAllNotes(userId, false, true);
                    await storage.removeStoredMasterKey(userId);
                } catch (error) {
                    console.warn('[Encryption] Could not preserve every row from the mismatched key generation.', error);
                } finally {
                    clearMasterKey();
                    setCryptoMode('e2ee');
                }
                keyExists = false;
            }
            if (keyExists) {
                // Defensive: a key-holding device on an e2ee account must be in
                // e2ee mode, otherwise outgoing sync would emit plaintext (which
                // the server now rejects). Corrects any stale local 'local' mode.
                if (serverEncMode === 'e2ee' && storedCryptoMode !== 'e2ee') {
                    await storage.setCryptoMode('e2ee', userId);
                    setCryptoMode('e2ee');
                    setMode('e2ee');
                }
                setStatus('ready');
                setSyncUnlocked(true);
                if (userId) {
                    scheduleDatabaseInit(userId);
                    if (pendingMigrationState) {
                        void completeEncryptionMigration(userId)
                            .then(() => scheduleDatabaseInit(userId))
                            .catch((error) => {
                                console.warn('[Encryption] Failed to resume E2EE migration:', error);
                            });
                    }
                }
            } else {
                // No master key on this device. The lock decision is driven by the
                // SERVER's encryption mode, not the device-local cryptoMode default.
                //
                // If the account is genuinely e2ee we must lock — even when the
                // local default is 'local' (e.g. a freshly signed-in device).
                // Locking does NOT block the app: the user can keep creating notes
                // (stored locally, device-key encrypted) and sync stays paused until
                // the passphrase is entered, at which point unlock() re-encrypts and
                // uploads them. This is what prevents plaintext from leaking into an
                // encrypted account.
                //
                // We only skip the lock when the server says encryption is 'off'
                // (handled by the early off-branch above) or when we couldn't reach
                // the server AND the user explicitly chose local mode before.
                const accountIsE2EE = serverEncMode === 'e2ee'
                    || (serverEncMode === null && storedCryptoMode === 'e2ee')
                    || (serverEncMode === null && !!pendingMigrationState);

                if (accountIsE2EE) {
                    console.log('[Encryption] Account is e2ee and key is missing. Entering locked state.');
                    // Ensure encryptForSync() refuses to emit plaintext while locked.
                    await storage.setCryptoMode('e2ee', userId);
                    setCryptoMode('e2ee');
                    setMode('e2ee');
                    setStatus('locked');
                    setSyncUnlocked(false);
                } else {
                    console.log('[Encryption] Server has a (legacy) bundle but encryption is not active. Skipping lock.');
                    setStatus('ready');
                    setSyncUnlocked(true);
                }
            }
        } else {
            if (serverEncMode === 'e2ee') {
                // Broken/legacy partial transition: the account requires E2EE
                // but no bundle is available. Never fall back to ready/local,
                // which would repeatedly attempt plaintext uploads. The reset
                // action remains available from the locked banner.
                await storage.setCryptoMode('e2ee', userId);
                setCryptoMode('e2ee');
                setMode('e2ee');
                setStatus('locked');
                setSyncUnlocked(false);
            } else {
                if (pendingMigrationState && userId) {
                    await storage.clearEncryptionMigrationState(userId);
                }
                setStatus('ready');
                setSyncUnlocked(true);
            }
        }

        setSyncEnabled(shouldEnableSync);
        syncService.setSyncEnabled(shouldEnableSync);
    }, [
        userId,
        isAuthenticated,
        isGuest,
        restoreMasterKey,
        prepareForRemoteKeyGeneration,
        scheduleDatabaseInit,
        completeEncryptionMigration,
        finalizeDestructiveResetLocally,
        clearEncryptionTransitionToken,
    ]);

    useEffect(() => {
        void loadState();
    }, [loadState]);

    // When the server rejects a write because the account encryption mode changed
    // underneath us, or reports a new mode in an otherwise successful pull,
    // reconcile by reloading the authoritative state. SyncService awaits this
    // callback and does not apply the stale-mode response or advance its cursor.
    useEffect(() => {
        syncService.registerEncryptionConflictHandler(async (info) => {
            console.log('[Encryption] Server reported encryption-mode mismatch; reconciling.', info);

            let reconciliation = encryptionReconciliationInFlightRef.current;
            if (!reconciliation) {
                reconciliation = loadState();
                encryptionReconciliationInFlightRef.current = reconciliation;
            }

            try {
                await reconciliation;
            } finally {
                if (encryptionReconciliationInFlightRef.current === reconciliation) {
                    encryptionReconciliationInFlightRef.current = null;
                }
            }
        });
        return () => syncService.registerEncryptionConflictHandler(null);
    }, [loadState]);

    const resumePendingEncryptionMigration = useCallback(async () => {
        if (!userId || !isAuthenticated || isGuest || !hasMasterKey()) return;

        const pendingMigrationState = await storage.getEncryptionMigrationState(userId);
        if (!pendingMigrationState) return;

        try {
            const completed = await completeEncryptionMigration(userId);
            if (completed) {
                scheduleDatabaseInit(userId);
            }
        } catch (error) {
            console.warn('[Encryption] Failed to resume pending E2EE migration:', error);
        }
    }, [userId, isAuthenticated, isGuest, completeEncryptionMigration, scheduleDatabaseInit]);

    useEffect(() => {
        if (!userId || !isAuthenticated || isGuest) return;

        void resumePendingEncryptionMigration();

        const appStateSubscription = AppState.addEventListener('change', (nextState) => {
            if (nextState === 'active') {
                void resumePendingEncryptionMigration();
            }
        });

        let unsubscribeNetInfo: (() => void) | undefined;
        try {
            unsubscribeNetInfo = NetInfo.addEventListener((state) => {
                if (state.isConnected) {
                    void resumePendingEncryptionMigration();
                }
            });
        } catch (error) {
            console.warn('[Encryption] NetInfo native module not found. Pending E2EE migration will resume on app foreground.', error);
        }

        return () => {
            appStateSubscription.remove();
            unsubscribeNetInfo?.();
        };
    }, [userId, isAuthenticated, isGuest, resumePendingEncryptionMigration]);

    const enableE2EE = useCallback(async (
        secret: string,
        mode: SecretMode = 'passphrase',
        onProgress?: EncryptionProgressCallback,
    ) => {
        if (!isAuthenticated || isGuest) {
            throw new Error('Sign in required to enable sync');
        }
        if (!userId) {
            throw new Error('User not available');
        }

        const existingMigration = await storage.getEncryptionMigrationState(userId);
        if (existingMigration) {
            const resumed = await completeEncryptionMigration(userId, onProgress);
            if (!resumed) {
                throw new Error('Encryption setup is already pending. Connect to the internet and retry.');
            }
            return;
        }

        const existingServerState = await e2eeApi.fetchState();
        if (existingServerState?.enc_mode === 'e2ee') {
            throw new Error('Encryption is already enabled for this account. Unlock it instead.');
        }

        const validationError = getSecretValidationError(secret, mode);
        if (validationError) {
            throw new Error(validationError);
        }

        const normalizedSecret = normalizeSecretInput(secret, mode);
        const reportProgress = createProgressReporter(onProgress);
        
        // PROTECTION: Enable deletion guard during encryption setup.
        setDeletionGuard(true);
        
        try {
            reportProgress(5);
            // STEP 1: Create the master key FIRST so all subsequent operations use it
            const { bundle: newBundle, masterKey } = await createKeyBundle(
                normalizedSecret,
                mode,
                (kdfProgress) => reportProgress(5 + kdfProgress * 75),
            );
            setMasterKey(masterKey);  // Set in memory immediately
            reportProgress(80);

            // STEP 2: Persist the key material before switching mode. If the app
            // is killed after this point, the pending migration can be resumed.
            await storage.clearSyncResetBlocked(userId);
            setRecoveryCode(recoveryCodeFromMasterKey(masterKey));
            setSyncUnlocked(true);
            await persistMasterKey(userId, masterKey);
            await storage.setKeyBundle(userId, newBundle);
            await storage.setEncryptionMigrationState(userId, 'local');

            // STEP 3: Switch crypto mode to E2EE now that the resume state exists.
            await storage.setSyncEnabled(true, userId);
            await storage.setCryptoMode('e2ee', userId);
            setCryptoMode('e2ee');
            setMode('e2ee');
            setSyncEnabled(true);
            syncService.setSyncEnabled(true);
            setBundle(newBundle);
            setStatus('ready');
            reportProgress(84);

            const completed = await completeEncryptionMigration(userId, reportProgress);
            if (!completed) {
                throw new Error('Encryption migration is pending. Connect to the internet and retry.');
            }

            scheduleDatabaseInit(userId);
        } finally {
            // ALWAYS disable the guard after setup.
            setDeletionGuard(false);
        }
    }, [isAuthenticated, isGuest, userId, resetRecoveryPending, scheduleDatabaseInit, persistMasterKey, completeEncryptionMigration]);

    const setupWithRecoveryCode = useCallback(async (code: string) => {
        if (!isAuthenticated || isGuest || !userId) {
            throw new Error('Authentication required');
        }

        const normalized = normalizeSecretInput(code, 'recovery_code');
        const mk = masterKeyFromRecoveryCode(normalized);
        if (bundle?.key_id && keyIdFromMasterKey(mk) !== bundle.key_id) {
            throw new Error('Recovery code does not match this encrypted account.');
        }

        // To protect the Master Key even when using a Recovery Code for entry,
        // we should ideally ask for a local Passphrase to wrap it for storage.
        // For now, we'll use the roadmap's "Lock with Biometrics" approach (Phase 2).
        // For Phase 1, we'll store it wrapped with the device key.
        
        setMasterKey(mk);
        setRecoveryCode(recoveryCodeFromMasterKey(mk));
        setSyncUnlocked(true);
        await persistMasterKey(userId, mk);

        // Entering a recovery code means the account is e2ee — switch this device
        // to e2ee mode so re-encryption uses the master key and sync never emits
        // plaintext (which the server would now reject).
        await storage.setCryptoMode('e2ee', userId);
        setCryptoMode('e2ee');
        setMode('e2ee');

        // When using recovery code, we don't necessarily have a server bundle yet,
        // or we might want to create one using a dummy passphrase or similar.
        // But the roadmap says: "Вводит Код восстановления -> Новое устройство расшифровывает данные".

        await storage.setSyncEnabled(true, userId);
        setSyncEnabled(true);
        syncService.setSyncEnabled(true);
        setStatus('ready');
        scheduleDatabaseInit(userId);

        const pendingMigrationState = await storage.getEncryptionMigrationState(userId);
        if (pendingMigrationState) {
            await completeEncryptionMigration(userId);
        } else {
            // Ensure local data is re-encrypted with the restored key
            await forceReencryptionLocal(userId);
            try {
                await syncService.resetSyncState(userId);
                await syncService.syncNowAndWait('manual');
            } catch (error) {
                console.warn('[Encryption] Failed to refresh sync after recovery code setup:', error);
            }
        }
    }, [isAuthenticated, isGuest, userId, bundle, persistMasterKey, scheduleDatabaseInit, completeEncryptionMigration]);

    const unlock = useCallback(async (secret: string, onProgress?: EncryptionProgressCallback) => {
        if (!secret.trim()) {
            throw new Error('Access key is required.');
        }
        if (!bundle) {
            throw new Error('Key bundle missing');
        }
        const reportProgress = createProgressReporter(onProgress);

        let resolvedMasterKey: Uint8Array;
        try {
            reportProgress(10);
            resolvedMasterKey = await unwrapMasterKeyAsync(
                bundle,
                secret,
                (kdfProgress) => reportProgress(8 + kdfProgress * 80),
            );
            reportProgress(88);
        } catch (error: any) {
            const message = String(error?.message || '').toLowerCase();
            if (message.includes('invalid access key') || message.includes('invalid tag')) {
                throw new Error('Incorrect passphrase.');
            }
            throw error;
        }

        setMasterKey(resolvedMasterKey);
        setRecoveryCode(recoveryCodeFromMasterKey(resolvedMasterKey));
        setSyncUnlocked(true);
        if (userId) {
            await persistMasterKey(userId, resolvedMasterKey);

            // The server vault may have been destructively reset while this
            // device was locked. The local bundle can still unlock its retained
            // copy, but that copy must be isolated before any sync resumes.
            if (await storage.getResetRecoveryPending(userId)) {
                setCryptoMode('local');
                setMode('local');
                await storage.setCryptoMode('local', userId);
                await decryptAndRescueAllNotes(userId, false, true);
                await archiveSyncedNotesAfterReset(userId);
                await storage.setRemoteDisableRescuePending(userId, false);
                clearMasterKey();
                await storage.removeStoredMasterKey(userId);
                await storage.removeKeyBundle(userId);
                setBundle(null);
                setHasRemoteKeyBundle(false);
                setRecoveryCode(null);
                const resetServerState = await e2eeApi.fetchState();
                if (resetServerState) {
                    syncService.setVaultGeneration(resetServerState.vault_generation);
                    await storage.setVaultGeneration(userId, resetServerState.vault_generation);
                    syncService.setKeyEpoch(resetServerState.key_epoch);
                    await storage.setKeyEpoch(userId, resetServerState.key_epoch);
                }
                setSyncUnlocked(true);
                setStatus('ready');
                await storage.setSyncEnabled(false, userId);
                setSyncEnabled(false);
                syncService.setSyncEnabled(false);
                scheduleDatabaseInit(userId);
                reportProgress(100);
                return;
            }

            if (await storage.getRemoteDisableRescuePending(userId)) {
                // The account was converted to standard sync on another
                // device. This passphrase is needed only to rescue this
                // device's old local ciphertext; never re-enable E2EE or upload
                // it until it has been rewrapped with the device key.
                setCryptoMode('local');
                setMode('local');
                await storage.setCryptoMode('local', userId);
                await decryptAndRescueAllNotes(userId, false, true);
                await storage.setRemoteDisableRescuePending(userId, false);
                await clearEncryptionTransitionToken(userId);
                clearMasterKey();
                await storage.removeStoredMasterKey(userId);
                await storage.removeKeyBundle(userId);
                setBundle(null);
                setHasRemoteKeyBundle(false);
                setRecoveryCode(null);
                setSyncUnlocked(true);
                setStatus('ready');
                const storedSyncPreference = await storage.getSyncEnabled(userId);
                const resumeSync = storedSyncPreference !== false;
                setSyncEnabled(resumeSync);
                syncService.setSyncEnabled(resumeSync);
                scheduleDatabaseInit(userId);
                if (resumeSync) {
                    void syncService.pullAllFromServer(userId)
                        .catch((error) => console.warn('[Encryption] Standard sync refresh after local rescue failed:', error));
                }
                reportProgress(100);
                return;
            }
            // Unlocking always means the account is e2ee — make sure outgoing sync
            // encrypts with the master key (never emits plaintext to the server).
            await storage.setCryptoMode('e2ee', userId);
        }
        setCryptoMode('e2ee');
        setMode('e2ee');
        reportProgress(92);
        setStatus('ready');

        if (!hasMasterKey()) {
            throw new Error('Failed to unlock');
        }

        if (userId) {
            scheduleDatabaseInit(userId);
            const pendingMigrationState = await storage.getEncryptionMigrationState(userId);
            if (pendingMigrationState) {
                await completeEncryptionMigration(userId, (migrationProgress) => {
                    const normalizedMigrationProgress = Math.max(86, migrationProgress);
                    reportProgress(92 + ((normalizedMigrationProgress - 86) / 14) * 8);
                });
            } else {
                try {
                    reportProgress(96);
                    // A device unlocking an account that was migrated elsewhere
                    // must not mark every stale local copy dirty: doing so turns
                    // a read-only key transition into avoidable version conflicts.
                    // Reset only the cursor; genuinely local edits already carry
                    // dirty=1 and will still be uploaded with the active key.
                    await syncService.pullAllFromServer(userId);
                } catch (error) {
                    console.warn('[Encryption] Failed to refresh sync after unlock:', error);
                }
            }
        }
        reportProgress(100);
    }, [
        bundle,
        userId,
        scheduleDatabaseInit,
        persistMasterKey,
        completeEncryptionMigration,
        clearEncryptionTransitionToken,
    ]);

    const changePin = useCallback(async (secret: string, onProgress?: EncryptionProgressCallback) => {
        if (!isAuthenticated || isGuest) {
            throw new Error('Sign in required to change access key');
        }
        if (!userId) {
            throw new Error('User not available');
        }
        if (!hasMasterKey()) {
            throw new Error('Sync key is locked');
        }

        const validationError = getSecretValidationError(secret, 'passphrase');
        if (validationError) {
            throw new Error(validationError);
        }

        const currentMasterKey = getMasterKey();
        if (!currentMasterKey) {
            throw new Error('Master key missing');
        }
        const reportProgress = createProgressReporter(onProgress);

        const normalizedSecret = normalizeSecretInput(secret, 'passphrase');
        await storage.clearSyncResetBlocked(userId);
        reportProgress(20);

        const newBundle = await wrapMasterKey(
            currentMasterKey,
            normalizedSecret,
            'passphrase',
            (kdfProgress) => reportProgress(8 + kdfProgress * 80),
        );
        reportProgress(88);
        await e2eeApi.setConfig('standard');
        await e2eeApi.storeKeyBundle(newBundle);
        reportProgress(94);

        await storage.setKeyBundle(userId, newBundle);
        setBundle(newBundle);
        setHasRemoteKeyBundle(true);
        reportProgress(100);
    }, [isAuthenticated, isGuest, userId]);

    const setSyncEnabledPreference = useCallback(async (enabled: boolean) => {
        if (!isAuthenticated || isGuest) {
            throw new Error('Sign in required to change sync');
        }
        if (!userId) {
            throw new Error('User not available');
        }
        if (enabled && await storage.getResetRecoveryPending(userId)) {
            throw new Error('Choose how to recover the local encrypted-vault archive before enabling sync.');
        }
        if (enabled && await storage.getRemoteDisableRescuePending(userId)) {
            throw new Error('Enter the previous encryption passphrase to rescue local notes before enabling sync.');
        }
        await storage.setSyncEnabled(enabled, userId);
        setSyncEnabled(enabled);
        syncService.setSyncEnabled(enabled);
    }, [isAuthenticated, isGuest, userId]);

    const keepResetArchiveLocal = useCallback(async (): Promise<void> => {
        if (!userId) throw new Error('User not available');
        await finalizeResetArchiveAsLocal(userId);
        await storage.setResetRecoveryPending(userId, false);
        await storage.setRemoteDisableRescuePending(userId, false);
        setResetRecoveryPending(false);
        await storage.setSyncEnabled(false, userId);
        setSyncEnabled(false);
        syncService.setSyncEnabled(false);
        scheduleDatabaseInit(userId);
    }, [userId, scheduleDatabaseInit]);

    const resumeStandardSyncAfterReset = useCallback(async (): Promise<void> => {
        if (!isAuthenticated || isGuest || !userId) {
            throw new Error('Sign in required to recover sync');
        }
        if (mode === 'e2ee' || hasMasterKey()) {
            throw new Error('Finish unlocking the retained vault before choosing standard sync.');
        }

        await promoteResetArchiveToSync(userId);
        await storage.setResetRecoveryPending(userId, false);
        await storage.setRemoteDisableRescuePending(userId, false);
        setResetRecoveryPending(false);
        await storage.setSyncEnabled(true, userId);
        setSyncEnabled(true);
        syncService.setSyncEnabled(true);
        await syncService.resetSyncState(userId);
        await syncService.syncNowAndWait('manual', true);
        scheduleDatabaseInit(userId);
    }, [isAuthenticated, isGuest, userId, mode, scheduleDatabaseInit]);

    const resetSync = useCallback(async (): Promise<{ purged: boolean; syncSucceeded: boolean }> => {
        if (!isAuthenticated || isGuest) {
            throw new Error('Sign in required to reset sync');
        }
        if (!userId) {
            throw new Error('User not available');
        }

        // Disabling encryption must operate over the WHOLE account, not just the
        // notes that happen to live on this device — otherwise notes that exist
        // only on the server stay ciphertext after the key bundle is deleted and
        // become permanently unreadable. Required ordering:
        //   1. (key present) pull every server note locally and decrypt it
        //   2. flip the account to enc_mode='off' so the server accepts plaintext
        //   3. re-encrypt locally with the device key and push plaintext for all
        //   4. only after everything is plaintext on the server, delete the key
        if (!hasMasterKey()) {
            throw new Error('Unlock encryption on this device before disabling it.');
        }

        if (disableTransitionInFlightRef.current) {
            throw new Error('Encryption disable is already in progress.');
        }
        disableTransitionInFlightRef.current = true;
        let transitionToken: string;
        try {
            transitionToken = await ensureEncryptionTransitionToken(userId, 'disable');
        } catch (error) {
            disableTransitionInFlightRef.current = false;
            throw error;
        }
        setDeletionGuard(true);

        let syncSucceeded = false;
        let keyDeleted = false;
        let serverDisabled = false;
        const deleteKeyMaterial = async (): Promise<void> => {
            const deleteResult = await e2eeApi.deleteKeyBundle();
            if (deleteResult !== 'deleted') {
                throw new Error('Server could not confirm deletion of the encryption key. Try again.');
            }
            await clearEncryptionTransitionToken(userId);
            await storage.removeKeyBundle(userId);
            await storage.removeStoredMasterKey(userId);
            clearMasterKey();
            setBundle(null);
            setHasRemoteKeyBundle(false);
            setStatus('uninitialized');
            keyDeleted = true;
        };
        try {
            await storage.clearEncryptionMigrationState(userId);
            const initialState = await e2eeApi.fetchState(transitionToken);
            if (!initialState) {
                throw new Error('Server encryption state is unavailable. Try again when online.');
            }
            if (initialState.transition_state && !initialState.transition_owned) {
                throw new Error('Another device is changing encryption. Wait for it to finish and retry.');
            }
            if (initialState.transition_state === 'enabling_e2ee') {
                throw new Error('Encryption setup is still being completed. Finish it before disabling encryption.');
            }

            // Crash recovery: server validation may have completed immediately
            // before this device removed the retained bundle. Re-audit the
            // plaintext dataset and finish only the irreversible key cleanup.
            if (initialState.enc_mode === 'off' && !initialState.transition_state) {
                serverDisabled = true;
                setCryptoMode('local');
                setMode('local');
                await storage.setCryptoMode('local', userId);
                await decryptAndRescueAllNotes(userId, false, true);
                await e2eeApi.validateDataMode('off', transitionToken);
                await clearPendingDecryptSync(userId);
                syncSucceeded = true;
                await deleteKeyMaterial();
                return { purged: true, syncSucceeded: true };
            }

            // --- STEP 1: capture server-only notes while still E2EE + unlocked.
            syncService.setSyncEnabled(true);
            try {
                await syncService.pullAllFromServer(userId);
                await syncService.ensureAllRemoteAudioAvailable(userId);
                console.log('[Encryption] Full pre-reset pull completed');
            } catch (err) {
                // If we cannot guarantee we have the whole account locally, abort
                // rather than risk orphaning encrypted notes on the server.
                console.warn('[Encryption] Pre-reset pull failed — aborting reset to avoid data loss', err);
                throw new Error('Could not reach the server to disable encryption. Try again when online.');
            }

            // --- STEP 2: flip account encryption OFF (bumps key epoch). After
            // this the server rejects ciphertext writes and accepts plaintext.
            try {
                const currentState = await e2eeApi.fetchState(transitionToken);
                const canResumeDisable = currentState?.enc_mode === 'off'
                    && currentState.transition_state === 'disabling_e2ee'
                    && currentState.transition_owned;
                if (!currentState || (currentState.enc_mode !== 'e2ee' && !canResumeDisable)) {
                    throw new Error('Server encryption state changed. Refresh and try again.');
                }
                const state = await e2eeApi.disableAtSnapshot(
                    currentState.key_epoch,
                    syncService.getServerSeqSnapshot(),
                    transitionToken,
                );
                serverDisabled = state.enc_mode === 'off';
                syncService.setKeyEpoch(state.key_epoch);
                await storage.setKeyEpoch(userId, state.key_epoch);
                syncService.setVaultGeneration(state.vault_generation);
                await storage.setVaultGeneration(userId, state.vault_generation);
            } catch (err) {
                console.warn('[Encryption] Failed to set account encryption off on server', err);
                throw err;
            }

            // --- STEP 3: decrypt locally + push plaintext for the whole set.
            setCryptoMode('local');
            setMode('local');
            await storage.setCryptoMode('local', userId);
            await decryptAndRescueAllNotes(userId);
            await syncService.markAllLocalAudioForResync(userId);
            console.log('[Encryption] decryptAndRescueAllNotes completed');

            await setPendingDecryptSync(userId);
            await syncService.resetSyncState(userId);
            await syncService.syncNowAndWait('manual', true);
            await syncService.syncAudioNowAndWait();

            const stillPending = await syncService.hasUnsyncedChanges(userId);
            if (!stillPending) {
                await e2eeApi.validateDataMode('off', transitionToken);
                await clearPendingDecryptSync(userId);
                syncSucceeded = true;
                console.log('[Encryption] Plaintext push completed — server fully decrypted');
            } else {
                console.warn('[Encryption] Some plaintext notes still pending; key retained for retry');
            }

            // --- STEP 4: only delete the key bundle once everything is plaintext.
            if (syncSucceeded) {
                await deleteKeyMaterial();
                try {
                    await e2eeApi.setConfig('standard');
                } catch (error) {
                    console.warn('[Encryption] Failed to reset server sync mode:', error);
                }
            } else {
                // Encryption is logically off but the local key is kept so a later
                // retry (network restore / app resume) can finish pushing plaintext
                // before the irreversible key deletion.
                setStatus('ready');
            }
        } finally {
            disableTransitionInFlightRef.current = false;
            setDeletionGuard(false);
            // Standard sync does not require a master key. Once disable is
            // complete, the account must not remain visually "locked" merely
            // because the obsolete local key was removed.
            setSyncUnlocked(true);
            if (serverDisabled) {
                setCryptoMode('local');
                setMode('local');
                await storage.setCryptoMode('local', userId);
            } else {
                setCryptoMode('e2ee');
                setMode('e2ee');
                await storage.setCryptoMode('e2ee', userId);
            }
            await storage.setSyncEnabled(true, userId);
            setSyncEnabled(true);
            syncService.setSyncEnabled(true);
        }

        return { purged: keyDeleted, syncSucceeded };
    }, [
        isAuthenticated,
        isGuest,
        userId,
        ensureEncryptionTransitionToken,
        clearEncryptionTransitionToken,
    ]);

    const resumePendingDisable = useCallback(async () => {
        if (
            !userId
            || !isAuthenticated
            || isGuest
            || status === 'loading'
            || !hasMasterKey()
            || disableTransitionInFlightRef.current
        ) {
            return;
        }
        const [kind, token] = await Promise.all([
            storage.getEncryptionTransitionKind(userId),
            storage.getEncryptionTransitionToken(userId),
        ]);
        if (kind !== 'disable' || !token) return;
        try {
            await resetSync();
        } catch (error) {
            console.warn('[Encryption] Pending encryption disable remains paused:', error);
        }
    }, [userId, isAuthenticated, isGuest, status, resetSync]);

    useEffect(() => {
        if (!userId || !isAuthenticated || isGuest) return;

        void resumePendingDisable();
        const appStateSubscription = AppState.addEventListener('change', (nextState) => {
            if (nextState === 'active') void resumePendingDisable();
        });
        let unsubscribeNetInfo: (() => void) | undefined;
        try {
            unsubscribeNetInfo = NetInfo.addEventListener((state) => {
                if (state.isConnected) void resumePendingDisable();
            });
        } catch (error) {
            console.warn('[Encryption] Pending disable will resume on app foreground.', error);
        }
        return () => {
            appStateSubscription.remove();
            unsubscribeNetInfo?.();
        };
    }, [userId, isAuthenticated, isGuest, resumePendingDisable]);

    const resetEncryption = useCallback(async (): Promise<{ purged: boolean; syncSucceeded: boolean }> => {
        if (!isAuthenticated || isGuest) {
            throw new Error('Sign in required to reset encryption');
        }

        const result = await resetSync();
        // resetSync already ran resetSyncState + syncNowAndWait — no extra call needed.
        return result;
    }, [isAuthenticated, isGuest, resetSync]);

    // Destructive "forgot passphrase" reset. Unlike resetSync() this must work
    // while the key is LOCKED: the passphrase is gone, so every note that is
    // ciphertext under the lost key — on the server and on this device — is
    // forfeited (the ResetEncryptionModal warns about exactly this). The server
    // purge runs first; if the server is unreachable nothing is deleted locally
    // and the user can retry.
    const forceResetEncryption = useCallback(async (): Promise<ResetEncryptionResult> => {
        if (!isAuthenticated || isGuest) {
            throw new Error('Sign in required to reset encryption');
        }
        if (!userId) {
            throw new Error('User not available');
        }

        if (await storage.getRemoteDisableRescuePending(userId)) {
            const serverState = await e2eeApi.fetchState();
            if (serverState?.enc_mode === 'off' && !serverState.transition_state) {
                // "Forgot passphrase" after a remote disable is a local cleanup,
                // not permission to erase the already-plaintext cloud vault.
                const storedSyncPreference = await storage.getSyncEnabled(userId);
                await storage.setSyncEnabled(false, userId);
                setSyncEnabled(false);
                syncService.setSyncEnabled(false);
                setDeletionGuard(true);
                try {
                    setCryptoMode('local');
                    setMode('local');
                    await storage.setCryptoMode('local', userId);
                    await purgeSyncedNotesForUser(userId);
                    await purgeUnreadableLocalOnlyNotesForUser(userId);
                    await storage.setRemoteDisableRescuePending(userId, false);
                    await storage.clearEncryptionMigrationState(userId);
                    await clearPendingDecryptSync(userId);
                    await clearEncryptionTransitionToken(userId);
                    await storage.removeKeyBundle(userId);
                    await storage.removeStoredMasterKey(userId);
                    clearMasterKey();
                    setBundle(null);
                    setHasRemoteKeyBundle(false);
                    setRecoveryCode(null);
                    syncService.setKeyEpoch(serverState.key_epoch);
                    await storage.setKeyEpoch(userId, serverState.key_epoch);
                    syncService.setVaultGeneration(serverState.vault_generation);
                    await storage.setVaultGeneration(userId, serverState.vault_generation);
                    await syncService.resetSyncState(userId);
                    setSyncUnlocked(true);
                    setStatus('ready');
                    const resumeSync = storedSyncPreference !== false;
                    setSyncEnabled(resumeSync);
                    syncService.setSyncEnabled(resumeSync);
                    scheduleDatabaseInit(userId);
                    if (resumeSync) {
                        void syncService.pullAllFromServer(userId)
                            .catch((error) => console.warn('[Encryption] Standard sync refresh after discarded local key failed:', error));
                    }
                    return { purged: true, syncSucceeded: true };
                } finally {
                    setDeletionGuard(false);
                }
            }
        }

        const expectedVaultGeneration = await storage.getVaultGeneration(userId);
        const storedSyncPreference = await storage.getSyncEnabled(userId);
        const previousSyncEnabled = storedSyncPreference !== false;
        await storage.setDestructiveResetMarker(userId, {
            expectedVaultGeneration,
            previousSyncEnabled,
        });
        // Stop future sync before asking the server to cross the generation
        // boundary. An already-running old-generation transaction is serialized
        // by the backend account lock and will be tombstoned by the reset.
        await storage.setSyncEnabled(false, userId);
        setSyncEnabled(false);
        syncService.setSyncEnabled(false);

        setDeletionGuard(true);
        try {
            // Server side: soft-delete all synced notes, drop the key bundle,
            // purge audio blobs, custody mode back to standard.
            let resetState: { key_epoch: number; vault_generation: number };
            try {
                resetState = await e2eeApi.resetSyncData();
            } catch (err) {
                console.warn('[Encryption] Force reset: server purge failed', err);
                // The DB transaction may have committed even when object-store
                // cleanup or the response failed. Resolve the authoritative
                // generation before deciding whether to roll back the journal.
                let observedState = null;
                try {
                    observedState = await e2eeApi.fetchState();
                } catch {
                    // Keep the journal + sync pause. A later load/retry will
                    // finish safely once the server becomes reachable.
                }
                if (
                    observedState
                    && observedState.vault_generation > expectedVaultGeneration
                ) {
                    resetState = observedState;
                } else {
                    if (observedState) {
                        await storage.clearDestructiveResetMarker(userId);
                        await storage.setSyncEnabled(previousSyncEnabled, userId);
                        setSyncEnabled(previousSyncEnabled);
                        syncService.setSyncEnabled(previousSyncEnabled);
                    }
                    throw new Error('Could not reach the server to reset encryption. Try again when online.');
                }
            }

            await finalizeDestructiveResetLocally(userId, resetState);
        } finally {
            setDeletionGuard(false);
        }

        return { purged: true, syncSucceeded: true };
    }, [
        isAuthenticated,
        isGuest,
        userId,
        finalizeDestructiveResetLocally,
        clearEncryptionTransitionToken,
        scheduleDatabaseInit,
    ]);

    const lock = useCallback(() => {
        clearMasterKey();
        setSyncUnlocked(false);
        if (bundle) {
            setStatus('locked');
        } else {
            setStatus('uninitialized');
        }
    }, [bundle]);

    const value = useMemo(() => ({
        status,
        mode,
        syncEnabled,
        syncLocked: status === 'locked' || (syncEnabled && !syncUnlocked),
        resetRecoveryPending,
        hasRemoteKeyBundle,
        bundle,
        recoveryCode,
        enableE2EE,
        setupWithRecoveryCode,
        unlock,
        changePin,
        setSyncEnabledPreference,
        resetSync,
        resetEncryption,
        forceResetEncryption,
        keepResetArchiveLocal,
        resumeStandardSyncAfterReset,
        lock,
    }), [status, mode, syncEnabled, syncUnlocked, resetRecoveryPending, hasRemoteKeyBundle, bundle, recoveryCode, enableE2EE, setupWithRecoveryCode, unlock, changePin, setSyncEnabledPreference, resetSync, resetEncryption, forceResetEncryption, keepResetArchiveLocal, resumeStandardSyncAfterReset, lock]);

    return (
        <EncryptionContext.Provider value={value}>
            {children}
        </EncryptionContext.Provider>
    );
};

export const useEncryption = () => {
    const context = useContext(EncryptionContext);
    if (!context) {
        throw new Error('useEncryption must be used within an EncryptionProvider');
    }
    return context;
};
