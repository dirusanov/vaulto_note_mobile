import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { InteractionManager } from 'react-native';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { useAuth } from '../hooks/useAuth';
import { storage, CryptoMode } from '../utils/storage';
import {
    KeyBundle,
    clearMasterKey,
    createKeyBundle,
    getMasterKey,
    getSecretValidationError,
    hasMasterKey,
    isKeyBundle,
    normalizeSecretInput,
    setMasterKey,
    unwrapMasterKey,
    wrapMasterKey,
} from '../crypto/e2ee';
import { decrypt, encrypt, setCryptoMode } from '../crypto/encryption';
import { e2eeApi } from '../api/e2ee';
import { initDatabase, wipeLocalDatabase } from '../services/DatabaseService';
import { syncService } from '../services/SyncService';

export type EncryptionStatus = 'loading' | 'uninitialized' | 'locked' | 'ready';

interface EncryptionContextType {
    status: EncryptionStatus;
    mode: CryptoMode;
    syncEnabled: boolean;
    syncLocked: boolean;
    hasRemoteKeyBundle: boolean;
    bundle: KeyBundle | null;
    enableE2EE: (secret: string) => Promise<void>;
    unlock: (secret: string) => Promise<void>;
    changePin: (secret: string) => Promise<void>;
    setSyncEnabledPreference: (enabled: boolean) => Promise<void>;
    resetSync: () => Promise<'purged' | 'partial'>;
    resetEncryption: () => Promise<'purged' | 'partial'>;
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

    const persistMasterKey = useCallback(async (currentUserId: string, key: Uint8Array) => {
        const hex = bytesToHex(key);
        const wrapped = await encrypt(hex);
        await storage.setStoredMasterKey(currentUserId, wrapped);
    }, []);

    const restoreMasterKey = useCallback(async (currentUserId: string): Promise<boolean> => {
        try {
            const wrapped = await storage.getStoredMasterKey(currentUserId);
            if (!wrapped) return false;
            const hex = await decrypt(wrapped);
            setMasterKey(hexToBytes(hex));
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

        const storedSyncEnabled = await storage.getSyncEnabled();
        const isAuthReady = !!userId && isAuthenticated && !isGuest;
        const shouldEnableSync = isAuthReady && storedSyncEnabled;

        setMode('local');
        setCryptoMode('local');
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
                    setHasRemoteKeyBundle(true);
                    const chosen = chooseNewestBundle(activeBundle, serverBundle);
                    activeBundle = chosen;
                    if (chosen === serverBundle) {
                        await storage.setKeyBundle(userId, serverBundle);
                    }
                }
            } catch (error) {
                console.warn('[Encryption] Failed to fetch key bundle from server:', error);
            }
        }

        if (activeBundle) {
            setBundle(activeBundle);
            const restored = await restoreMasterKey(userId);
            setStatus(restored ? 'ready' : 'locked');
            // Keep existing key bundle but respect user preference for toggling sync.
            setSyncEnabled(shouldEnableSync);
            syncService.setSyncEnabled(shouldEnableSync);
            return;
        }

        setSyncEnabled(false);
        syncService.setSyncEnabled(false);
        setStatus('uninitialized');
    }, [userId, isAuthenticated, isGuest, restoreMasterKey, scheduleDatabaseInit]);

    useEffect(() => {
        void loadState();
    }, [loadState]);

    const enableE2EE = useCallback(async (secret: string) => {
        if (!isAuthenticated || isGuest) {
            throw new Error('Sign in required to enable sync');
        }
        if (!userId) {
            throw new Error('User not available');
        }

        const validationError = getSecretValidationError(secret, 'passphrase');
        if (validationError) {
            throw new Error(validationError);
        }

        const normalizedSecret = normalizeSecretInput(secret, 'passphrase');
        await storage.clearSyncResetBlocked(userId);
        await storage.setSyncEnabled(true);
        await storage.setCryptoMode('local');
        setCryptoMode('local');
        setMode('local');
        setSyncEnabled(true);
        syncService.setSyncEnabled(true);

        const { bundle: newBundle, masterKey } = await createKeyBundle(normalizedSecret, 'passphrase');
        setMasterKey(masterKey);
        setSyncUnlocked(true);
        await persistMasterKey(userId, masterKey);
        await storage.setKeyBundle(userId, newBundle);
        setBundle(newBundle);
        setHasRemoteKeyBundle(true);
        setStatus('ready');

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

        scheduleDatabaseInit(userId);
    }, [isAuthenticated, isGuest, userId, scheduleDatabaseInit, persistMasterKey]);

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
        await storage.setSyncEnabled(enabled);
        setSyncEnabled(enabled);
        syncService.setSyncEnabled(enabled);
    }, [isAuthenticated, isGuest, userId]);

    const resetSync = useCallback(async (): Promise<'purged' | 'partial'> => {
        if (!isAuthenticated || isGuest) {
            throw new Error('Sign in required to reset sync');
        }
        if (!userId) {
            throw new Error('User not available');
        }

        let remoteNotesPurged = false;
        let keyDeleted = false;

        await storage.setSyncResetBlocked(userId);
        try {
            await e2eeApi.resetSyncData();
            remoteNotesPurged = true;
            keyDeleted = true;
        } catch (error) {
            console.warn('[Encryption] Failed to reset remote sync data:', error);
        }

        try {
            await e2eeApi.setConfig('standard');
        } catch (error) {
            console.warn('[Encryption] Failed to reset server sync mode:', error);
        }

        await storage.removeKeyBundle(userId);
        await storage.removeStoredMasterKey(userId);
        await storage.setSyncEnabled(false);
        clearMasterKey();
        setBundle(null);
        setSyncUnlocked(false);
        setHasRemoteKeyBundle(false);
        setSyncEnabled(false);
        setStatus('uninitialized');
        setMode('local');
        setCryptoMode('local');
        syncService.setSyncEnabled(false);
        await syncService.resetSyncState(userId);
        return remoteNotesPurged && keyDeleted ? 'purged' : 'partial';
    }, [isAuthenticated, isGuest, userId]);

    const resetEncryption = useCallback(async (): Promise<'purged' | 'partial'> => {
        if (!isAuthenticated || isGuest) {
            throw new Error('Sign in required to reset encryption');
        }

        const result = await resetSync();

        // Wipe local notes so the user doesn't end up with unreadable ciphertext after key reset.
        try {
            await initDatabase();
        } catch (_) {
            // best-effort
        }
        try {
            await wipeLocalDatabase();
        } catch (error) {
            console.error('[Encryption] Failed to wipe local notes after encryption reset:', error);
            throw new Error('Encryption reset completed, but failed to delete local notes.');
        }

        // Ensure UI refreshes even if the wipe happened after resetSync notifications.
        await syncService.resetSyncState(userId ?? null);

        return result;
    }, [isAuthenticated, isGuest, resetSync, userId]);

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
        enableE2EE,
        unlock,
        changePin,
        setSyncEnabledPreference,
        resetSync,
        resetEncryption,
        lock,
    }), [status, mode, syncEnabled, syncUnlocked, hasRemoteKeyBundle, bundle, enableE2EE, unlock, changePin, setSyncEnabledPreference, resetSync, resetEncryption, lock]);

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
