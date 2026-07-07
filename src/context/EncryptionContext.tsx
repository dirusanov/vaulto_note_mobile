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
    normalizeSecretInput,
    recoveryCodeFromMasterKey,
    masterKeyFromRecoveryCode,
    setMasterKey,
    unwrapMasterKeyAsync,
    wrapMasterKey,
} from '../crypto/e2ee';
import { setCryptoMode, isMasterCiphertext } from '../crypto/encryption';
import { e2eeApi } from '../api/e2ee';
import { notesApi } from '../api/notes';
import { 
    initDatabase, 
    setDeletionGuard, 
    decryptAndRescueAllNotes,
    forceReencryptionLocal,
} from '../services/DatabaseService';
import { syncService } from '../services/SyncService';

export type EncryptionStatus = 'loading' | 'uninitialized' | 'locked' | 'ready';
export type ResetEncryptionResult = { purged: boolean; syncSucceeded: boolean };
export type EncryptionProgressCallback = (progress: number) => void;

interface EncryptionContextType {
    status: EncryptionStatus;
    mode: CryptoMode;
    syncEnabled: boolean;
    syncLocked: boolean;
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
    const encryptionMigrationInFlightRef = useRef(false);
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

            if (state === 'local') {
                console.log('[Encryption] Resuming local E2EE migration...');
                reportProgress(86);
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
                    await e2eeApi.setConfig('standard');
                    await e2eeApi.storeKeyBundle(storedBundle);
                    // Flip the account to e2ee (bumps key epoch) BEFORE pushing
                    // ciphertext, otherwise the server's write validation rejects
                    // encrypted writes on a still-'off' account. Idempotent so
                    // migration resumes don't churn the epoch. (null = older server
                    // without the state endpoint → just call setState.)
                    const current1 = await e2eeApi.fetchState();
                    const e2eeState = current1 && current1.enc_mode === 'e2ee'
                        ? current1
                        : await e2eeApi.setState('e2ee');
                    syncService.setKeyEpoch(e2eeState.key_epoch);
                    await storage.setKeyEpoch(currentUserId, e2eeState.key_epoch);
                    setHasRemoteKeyBundle(true);
                    await storage.setEncryptionMigrationState(currentUserId, 'sync');
                    state = 'sync';
                    bundlePublished = true;
                } catch (error) {
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
                        await e2eeApi.setConfig('standard');
                        await e2eeApi.storeKeyBundle(storedBundle);
                        const current2 = await e2eeApi.fetchState();
                        const e2eeState = current2 && current2.enc_mode === 'e2ee'
                            ? current2
                            : await e2eeApi.setState('e2ee');
                        syncService.setKeyEpoch(e2eeState.key_epoch);
                        await storage.setKeyEpoch(currentUserId, e2eeState.key_epoch);
                        setHasRemoteKeyBundle(true);
                    } catch (error) {
                        console.warn('[Encryption] Failed to publish E2EE key bundle. Migration sync remains pending:', error);
                        await storage.setEncryptionMigrationState(currentUserId, 'sync');
                        return false;
                    }
                }

                try {
                    const hasPendingChanges = await syncService.hasUnsyncedChanges(currentUserId);
                    if (hasPendingChanges) {
                        await syncService.resetSyncState(currentUserId);
                    }

                    reportProgress(97);
                    await syncService.syncNowAndWait('e2ee_migration');

                    const stillPending = await syncService.hasUnsyncedChanges(currentUserId);
                    if (stillPending) {
                        console.warn('[Encryption] E2EE migration sync is still pending.');
                        await storage.setEncryptionMigrationState(currentUserId, 'sync');
                        return false;
                    }

                    await storage.clearEncryptionMigrationState(currentUserId);
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
    }, []);

    const loadState = useCallback(async () => {
        setStatus('loading');
        clearMasterKey();
        setSyncUnlocked(false);
        setBundle(null);
        setHasRemoteKeyBundle(false);

        const storedSyncEnabled = await storage.getSyncEnabled(userId);
        const storedCryptoMode = await storage.getCryptoMode(userId);
        const isAuthReady = !!userId && isAuthenticated && !isGuest;
        const pendingMigrationState = isAuthReady
            ? await storage.getEncryptionMigrationState(userId)
            : null;
        const shouldEnableSync = isAuthReady && (pendingMigrationState ? true : storedSyncEnabled !== false);

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

        // Server-authoritative encryption state is the source of truth. If another
        // device disabled E2EE for this account, the server reports enc_mode='off'
        // with a higher key_epoch — this device must drop its key and switch to
        // plaintext rather than staying locked or re-encrypting on the next edit.
        // We also remember the mode so the lock decision below trusts the server,
        // not the device-local default cryptoMode (which is 'local' on a fresh
        // device and would otherwise leak plaintext into an e2ee account).
        let serverEncMode: 'off' | 'e2ee' | null = null;
        if (!pendingMigrationState) {
            try {
                const serverState = await e2eeApi.fetchState();
                // null => server doesn't support the state endpoint (older build);
                // leave serverEncMode unknown and fall back to legacy detection.
                if (serverState) {
                    serverEncMode = serverState.enc_mode;
                    const localEpoch = await storage.getKeyEpoch(userId);
                    syncService.setKeyEpoch(serverState.key_epoch);
                    await storage.setKeyEpoch(userId, serverState.key_epoch);

                    if (serverState.enc_mode === 'off' && serverState.key_epoch >= localEpoch) {
                    const hadE2EE = storedCryptoMode === 'e2ee' || !!(await storage.getKeyBundle(userId));
                    if (hadE2EE) {
                        console.log('[Encryption] Account encryption disabled remotely — switching this device to plaintext.');
                        // Switch to local mode FIRST so encrypt() targets the device key.
                        setCryptoMode('local');
                        setMode('local');
                        await storage.setCryptoMode('local', userId);
                        // Rescue any local-only ciphertext to the device key WHILE the
                        // master key can still be restored, so notes that never reached
                        // the server are not stranded as undecryptable after we drop it.
                        try {
                            const keyRestored = await restoreMasterKey(userId);
                            if (keyRestored && hasMasterKey()) {
                                await decryptAndRescueAllNotes(userId);
                            }
                        } catch (e) {
                            console.warn('[Encryption] Local rescue during remote-disable failed', e);
                        }
                        clearMasterKey();
                        await storage.removeKeyBundle(userId);
                        await storage.removeStoredMasterKey(userId);
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
                    let hasEncryptedRemoteNotes = false;
                    try {
                        const notesResponse = await notesApi.sync({ 
                            changes: [], 
                            improvement_changes: [],
                            since_updated_at: '1970-01-01T00:00:00+00:00' 
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
                        const chosen = chooseNewestBundle(activeBundle, serverBundle);
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
        }

        if (activeBundle) {
            setBundle(activeBundle);
            const keyExists = await restoreMasterKey(userId);
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
            if (pendingMigrationState && userId) {
                await storage.clearEncryptionMigrationState(userId);
            }
            setStatus('ready');
            setSyncUnlocked(true);
        }

        setSyncEnabled(shouldEnableSync);
        syncService.setSyncEnabled(shouldEnableSync);
    }, [userId, isAuthenticated, isGuest, restoreMasterKey, scheduleDatabaseInit, completeEncryptionMigration]);

    useEffect(() => {
        void loadState();
    }, [loadState]);

    // When the server rejects a write because the account encryption mode changed
    // underneath us (e.g. another device disabled E2EE), reconcile by reloading
    // the authoritative state.
    useEffect(() => {
        syncService.registerEncryptionConflictHandler((info) => {
            console.log('[Encryption] Server reported encryption-mode mismatch; reconciling.', info);
            void loadState();
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

            await completeEncryptionMigration(userId, reportProgress);

            scheduleDatabaseInit(userId);
        } finally {
            // ALWAYS disable the guard after setup.
            setDeletionGuard(false);
        }
    }, [isAuthenticated, isGuest, userId, scheduleDatabaseInit, persistMasterKey, completeEncryptionMigration]);

    const setupWithRecoveryCode = useCallback(async (code: string) => {
        if (!isAuthenticated || isGuest || !userId) {
            throw new Error('Authentication required');
        }

        const normalized = normalizeSecretInput(code, 'recovery_code');
        const mk = masterKeyFromRecoveryCode(normalized);

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
    }, [isAuthenticated, isGuest, userId, persistMasterKey, scheduleDatabaseInit, completeEncryptionMigration]);

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
                    await syncService.resetSyncState(userId);
                    await syncService.syncNowAndWait('manual');
                } catch (error) {
                    console.warn('[Encryption] Failed to refresh sync after unlock:', error);
                }
            }
        }
        reportProgress(100);
    }, [bundle, userId, scheduleDatabaseInit, persistMasterKey, completeEncryptionMigration]);

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
        await storage.setKeyBundle(userId, newBundle);
        setBundle(newBundle);
        setHasRemoteKeyBundle(true);
        reportProgress(94);

        try {
            await e2eeApi.setConfig('standard');
        } catch (error) {
            console.warn('[Encryption] Failed to set standard mode on server:', error);
        }
        try {
            await e2eeApi.storeKeyBundle(newBundle);
        } catch (error) {
            console.warn('[Encryption] Failed to update key bundle on server:', error);
        }
        reportProgress(100);
    }, [isAuthenticated, isGuest, userId]);

    const setSyncEnabledPreference = useCallback(async (enabled: boolean) => {
        if (!isAuthenticated || isGuest) {
            throw new Error('Sign in required to change sync');
        }
        if (!userId) {
            throw new Error('User not available');
        }
        await storage.setSyncEnabled(enabled, userId);
        setSyncEnabled(enabled);
        syncService.setSyncEnabled(enabled);
    }, [isAuthenticated, isGuest, userId]);

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

        await storage.clearEncryptionMigrationState(userId);
        setDeletionGuard(true);

        let syncSucceeded = false;
        let keyDeleted = false;
        try {
            // --- STEP 1: capture server-only notes while still E2EE + unlocked.
            syncService.setSyncEnabled(true);
            try {
                await syncService.pullAllFromServer(userId);
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
                const state = await e2eeApi.setState('off');
                syncService.setKeyEpoch(state.key_epoch);
                await storage.setKeyEpoch(userId, state.key_epoch);
            } catch (err) {
                console.warn('[Encryption] Failed to set account encryption off on server', err);
                throw err;
            }

            // --- STEP 3: decrypt locally + push plaintext for the whole set.
            setCryptoMode('local');
            setMode('local');
            await storage.setCryptoMode('local', userId);
            await decryptAndRescueAllNotes(userId);
            console.log('[Encryption] decryptAndRescueAllNotes completed');

            await setPendingDecryptSync(userId);
            await syncService.resetSyncState(userId);
            await syncService.syncNowAndWait('manual');

            const stillPending = await syncService.hasUnsyncedChanges(userId);
            if (!stillPending) {
                await clearPendingDecryptSync(userId);
                syncSucceeded = true;
                console.log('[Encryption] Plaintext push completed — server fully decrypted');
            } else {
                console.warn('[Encryption] Some plaintext notes still pending; key retained for retry');
            }

            // --- STEP 4: only delete the key bundle once everything is plaintext.
            if (syncSucceeded) {
                try {
                    const deleteResult = await e2eeApi.deleteKeyBundle();
                    if (deleteResult === 'deleted') keyDeleted = true;
                } catch (err) {
                    console.warn('[Encryption] Failed to delete key bundle during reset:', err);
                }
                try {
                    await e2eeApi.setConfig('standard');
                } catch (error) {
                    console.warn('[Encryption] Failed to reset server sync mode:', error);
                }

                await storage.removeKeyBundle(userId);
                await storage.removeStoredMasterKey(userId);
                clearMasterKey();
                setBundle(null);
                setHasRemoteKeyBundle(false);
                setStatus('uninitialized');
            } else {
                // Encryption is logically off but the local key is kept so a later
                // retry (network restore / app resume) can finish pushing plaintext
                // before the irreversible key deletion.
                setStatus('ready');
            }
        } finally {
            setSyncUnlocked(true);
            await storage.setCryptoMode('local', userId);
            await storage.setSyncEnabled(true, userId);
            setSyncEnabled(true);
            syncService.setSyncEnabled(true);
            setDeletionGuard(false);
        }

        return { purged: keyDeleted, syncSucceeded };
    }, [isAuthenticated, isGuest, userId]);

    const resetEncryption = useCallback(async (): Promise<{ purged: boolean; syncSucceeded: boolean }> => {
        if (!isAuthenticated || isGuest) {
            throw new Error('Sign in required to reset encryption');
        }

        const result = await resetSync();
        // resetSync already ran resetSyncState + syncNowAndWait — no extra call needed.
        return result;
    }, [isAuthenticated, isGuest, resetSync]);

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
        syncLocked: syncEnabled && !syncUnlocked,
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
        lock,
    }), [status, mode, syncEnabled, syncUnlocked, hasRemoteKeyBundle, bundle, recoveryCode, enableE2EE, setupWithRecoveryCode, unlock, changePin, setSyncEnabledPreference, resetSync, resetEncryption, lock]);

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
