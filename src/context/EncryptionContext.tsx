import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { InteractionManager, Alert } from 'react-native';
import { BiometricService } from '../services/BiometricService';
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
    unwrapMasterKey,
    wrapMasterKey,
} from '../crypto/e2ee';
import { decrypt, encrypt, setCryptoMode, isMasterCiphertext } from '../crypto/encryption';
import { e2eeApi } from '../api/e2ee';
import { notesApi } from '../api/notes';
import { 
    initDatabase, 
    wipeLocalDatabase, 
    setDeletionGuard, 
    rescueAllNotes, 
    decryptAndRescueAllNotes,
    forceReencryptionLocal,
    getNotesLocal
} from '../services/DatabaseService';
import { syncService } from '../services/SyncService';

export type EncryptionStatus = 'loading' | 'uninitialized' | 'locked' | 'ready';
export type ResetEncryptionResult = { purged: boolean; syncSucceeded: boolean };

interface EncryptionContextType {
    status: EncryptionStatus;
    mode: CryptoMode;
    syncEnabled: boolean;
    syncLocked: boolean;
    hasRemoteKeyBundle: boolean;
    bundle: KeyBundle | null;
    recoveryCode: string | null;
    enableE2EE: (secret: string, mode?: SecretMode) => Promise<void>;
    setupWithRecoveryCode: (code: string) => Promise<void>;
    unlock: (secret: string) => Promise<void>;
    changePin: (secret: string) => Promise<void>;
    setSyncEnabledPreference: (enabled: boolean) => Promise<void>;
    resetSync: () => Promise<ResetEncryptionResult>;
    resetEncryption: () => Promise<ResetEncryptionResult>;
    lock: () => void;
}

const EncryptionContext = createContext<EncryptionContextType | undefined>(undefined);

export const EncryptionProvider = ({ children }: { children: React.ReactNode }) => {
    const { userId, isGuest, isAuthenticated } = useAuth();
    const [status, setStatus] = useState<EncryptionStatus>('loading');
    const [mode, setMode] = useState<CryptoMode>('local');
    const [syncEnabled, setSyncEnabled] = useState(false);
    const [bundle, setBundle] = useState<KeyBundle | null>(null);
    const [syncUnlocked, setSyncUnlocked] = useState(false);
    const [hasRemoteKeyBundle, setHasRemoteKeyBundle] = useState(false);
    const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
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

    const loadState = useCallback(async () => {
        setStatus('loading');
        clearMasterKey();
        setSyncUnlocked(false);
        setBundle(null);
        setHasRemoteKeyBundle(false);

        const storedSyncEnabled = await storage.getSyncEnabled(userId);
        const storedCryptoMode = await storage.getCryptoMode(userId);
        const isAuthReady = !!userId && isAuthenticated && !isGuest;
        const shouldEnableSync = isAuthReady && storedSyncEnabled !== false;

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

                    if (hasEncryptedRemoteNotes) {
                        setHasRemoteKeyBundle(true);
                        const chosen = chooseNewestBundle(activeBundle, serverBundle);
                        activeBundle = chosen;
                        if (chosen === serverBundle) {
                            await storage.setKeyBundle(userId, serverBundle);
                        }
                    } else {
                        // If there are no encrypted notes, we don't need to force a lock,
                        // even if a bundle exists (it might be a legacy bundle).
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
                setStatus('ready');
                setSyncUnlocked(true);
                if (userId) {
                    scheduleDatabaseInit(userId);
                }
            } else {
                // If the user has explicitly set their preference to standard (local) sync,
                // we should NOT enter the locked state, as they've chosen to ignore E2EE for now.
                if (storedCryptoMode === 'local') {
                    console.log('[Encryption] Server has active bundle, but user preferred standard mode. Skipping lock.');
                    setStatus('ready');
                    setSyncUnlocked(true);
                } else {
                    console.log('[Encryption] Server has active bundle. Entering locked state.');
                    setStatus('locked');
                    setSyncUnlocked(false);
                }
            }
        } else {
            setStatus('ready');
            setSyncUnlocked(true);
        }

        setSyncEnabled(shouldEnableSync);
        syncService.setSyncEnabled(shouldEnableSync);
    }, [userId, isAuthenticated, isGuest, restoreMasterKey, scheduleDatabaseInit]);

    useEffect(() => {
        void loadState();
    }, [loadState]);

    const enableE2EE = useCallback(async (secret: string, mode: SecretMode = 'passphrase') => {
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
        
        // PROTECTION: Enable deletion guard during encryption setup.
        setDeletionGuard(true);
        
        try {
            // STEP 1: Create the master key FIRST so all subsequent operations use it
            const { bundle: newBundle, masterKey } = await createKeyBundle(normalizedSecret, mode);
            setMasterKey(masterKey);  // Set in memory immediately

            // STEP 2: Switch crypto mode to e2ee NOW that master key is available
            await storage.clearSyncResetBlocked(userId);
            await storage.setSyncEnabled(true, userId);
            await storage.setCryptoMode('e2ee', userId);
            setCryptoMode('e2ee');
            setMode('e2ee');
            setSyncEnabled(true);
            syncService.setSyncEnabled(true);

            // STEP 3: Persist key material
            setRecoveryCode(recoveryCodeFromMasterKey(masterKey));
            setSyncUnlocked(true);
            await persistMasterKey(userId, masterKey);
            await storage.setKeyBundle(userId, newBundle);
            setBundle(newBundle);
            setHasRemoteKeyBundle(true);
            setStatus('ready');

            // STEP 4: Push key bundle to server
            try {
                await e2eeApi.setConfig('standard');
            } catch (error) {
                console.warn('[Encryption] Failed to set standard mode on server:', error);
            }
            try {
                await e2eeApi.storeKeyBundle(newBundle);
            } catch (error) {
                console.warn('[Encryption] Failed to store key bundle on server:', error);
            }

            // STEP 5: Re-encrypt ALL local notes with the master key.
            // forceReencryptionLocal reads raw DB rows, decrypts with device key,
            // and re-encrypts with master key (because cryptoMode is now 'e2ee').
            console.log('[Encryption] Starting local re-encryption with master key...');
            await forceReencryptionLocal(userId);
            console.log('[Encryption] Local re-encryption finished.');

            // STEP 6: Push the re-encrypted snapshot as in-place updates for the same note ids.
            // Enabling E2EE should update existing server notes, not recreate or delete them.
            try {
                await syncService.resetSyncState(userId);
                console.log('[Encryption] Pushing re-encrypted notes to server...');
                await syncService.syncNowAndWait('manual');
                console.log('[Encryption] Server now has E2EE-encrypted notes.');
            } catch (err) {
                console.warn('[Encryption] Failed to push E2EE notes to server:', err);
            }

            scheduleDatabaseInit(userId);
        } finally {
            // ALWAYS disable the guard after setup.
            setDeletionGuard(false);
        }
    }, [isAuthenticated, isGuest, userId, scheduleDatabaseInit, persistMasterKey]);

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
        
        // When using recovery code, we don't necessarily have a server bundle yet,
        // or we might want to create one using a dummy passphrase or similar.
        // But the roadmap says: "Вводит Код восстановления -> Новое устройство расшифровывает данные".
        
        await storage.setSyncEnabled(true);
        setSyncEnabled(true);
        syncService.setSyncEnabled(true);
        setStatus('ready');
        scheduleDatabaseInit(userId);
        
        // Ensure local data is re-encrypted with the restored key
        await forceReencryptionLocal(userId);
        try {
            await syncService.resetSyncState(userId);
            await syncService.syncNowAndWait('manual');
        } catch (error) {
            console.warn('[Encryption] Failed to refresh sync after recovery code setup:', error);
        }
    }, [isAuthenticated, isGuest, userId, persistMasterKey, scheduleDatabaseInit]);

    const unlock = useCallback(async (secret: string) => {
        if (!secret.trim()) {
            throw new Error('Access key is required.');
        }
        if (!bundle) {
            throw new Error('Key bundle missing');
        }

        let resolvedMasterKey: Uint8Array;
        try {
            resolvedMasterKey = unwrapMasterKey(bundle, secret);
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
        }
        setStatus('ready');

        if (!hasMasterKey()) {
            throw new Error('Failed to unlock');
        }

        if (userId) {
            scheduleDatabaseInit(userId);
            try {
                await syncService.resetSyncState(userId);
                await syncService.syncNowAndWait('manual');
            } catch (error) {
                console.warn('[Encryption] Failed to refresh sync after unlock:', error);
            }
        }
    }, [bundle, userId, scheduleDatabaseInit, persistMasterKey]);

    const changePin = useCallback(async (secret: string) => {
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

        const normalizedSecret = normalizeSecretInput(secret, 'passphrase');
        await storage.clearSyncResetBlocked(userId);

        const newBundle = await wrapMasterKey(currentMasterKey, normalizedSecret, 'passphrase');
        await storage.setKeyBundle(userId, newBundle);
        setBundle(newBundle);
        setHasRemoteKeyBundle(true);

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

        // --- STEP 1: Decrypt all local notes while master key is still in memory ---
        // Switch crypto mode to 'local' FIRST so encrypt() uses device key.
        setDeletionGuard(true);
        try {
            setCryptoMode('local');
            setMode('local');
            await decryptAndRescueAllNotes(userId);
            console.log('[Encryption] decryptAndRescueAllNotes completed');
        } catch (err) {
            console.warn('[Encryption] Decrypt and rescue failed during resetSync, proceeding anyway...', err);
        }

        // --- STEP 2: Push the newly decrypted notes to the server ---
        let syncSucceeded = false;
        try {
            syncService.setSyncEnabled(true);
            await syncService.resetSyncState(userId);
            console.log('[Encryption] Starting forced sync to push decrypted notes...');
            
            // Mark as pending before we start
            await setPendingDecryptSync(userId);
            
            await syncService.syncNowAndWait('manual');
            
            // Success! Clear the flag.
            await clearPendingDecryptSync(userId);
            syncSucceeded = true;
            console.log('[Encryption] Forced sync completed — server should now have plaintext notes');
        } catch (err) {
            console.warn('[Encryption] Failed to push decrypted notes to server (will retry later):', err);
            // Flag remains set for SyncService retry on network restore
            syncSucceeded = false;
        }

        // --- STEP 3: Clean up keys and remote E2EE config ---
        let keyDeleted = false;
        try {
            const deleteResult = await e2eeApi.deleteKeyBundle();
            if (deleteResult === 'deleted') {
                keyDeleted = true;
            }
        } catch (err) {
            console.warn('[Encryption] Failed to delete key bundle during reset:', err);
        }

        try {
            await e2eeApi.setConfig('standard');
        } catch (error) {
            console.warn('[Encryption] Failed to reset server sync mode:', error);
        }

        // --- STEP 4: Clear local key material and update state ---
        await storage.removeKeyBundle(userId);
        await storage.removeStoredMasterKey(userId);
        clearMasterKey();           
        setBundle(null);
        setSyncUnlocked(true);
        setHasRemoteKeyBundle(false);
        setStatus('uninitialized');
        await storage.setCryptoMode('local', userId);

        await storage.setSyncEnabled(true, userId);
        setSyncEnabled(true);
        syncService.setSyncEnabled(true);

        setDeletionGuard(false);

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
