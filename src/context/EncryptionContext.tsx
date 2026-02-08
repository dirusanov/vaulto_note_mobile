import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { InteractionManager } from 'react-native';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { useAuth } from '../hooks/useAuth';
import { storage, CryptoMode } from '../utils/storage';
import {
    KeyBundle,
    clearMasterKey,
    createKeyBundle,
    deriveMasterKeyFromSeedAsync,
    getMasterKey,
    getSecretValidationError,
    hasMasterKey,
    isKeyBundle,
    normalizeSecretInput,
    SecretMode,
    setMasterKey,
    unwrapMasterKey,
    wrapMasterKey,
} from '../crypto/e2ee';
import { decrypt, encrypt, setCryptoMode } from '../crypto/encryption';
import { CustodyMode, e2eeApi } from '../api/e2ee';
import { notesApi } from '../api/notes';
import { initDatabase, migrateLegacyEncryption } from '../services/DatabaseService';
import { syncService } from '../services/SyncService';

export type EncryptionStatus = 'loading' | 'uninitialized' | 'locked' | 'ready';

interface EncryptionContextType {
    status: EncryptionStatus;
    mode: CryptoMode;
    custodyMode: CustodyMode;
    syncEnabled: boolean;
    syncLocked: boolean;
    hasRemoteKeyBundle: boolean;
    bundle: KeyBundle | null;
    enableE2EE: (secret: string, mode?: SecretMode) => Promise<void>;
    unlock: (secret: string) => Promise<void>;
    changePin: (secret: string, mode?: SecretMode) => Promise<void>;
    resetSync: () => Promise<'purged' | 'partial'>;
    lock: () => void;
}

const EncryptionContext = createContext<EncryptionContextType | undefined>(undefined);

export const EncryptionProvider = ({ children }: { children: React.ReactNode }) => {
    const { userId, isGuest, isAuthenticated } = useAuth();
    const [status, setStatus] = useState<EncryptionStatus>('loading');
    const [mode, setMode] = useState<CryptoMode>('local');
    const [custodyMode, setCustodyMode] = useState<CustodyMode>('standard');
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

    const runMigration = useCallback(async (currentUserId: string) => {
        try {
            await initDatabase();
            await migrateLegacyEncryption(currentUserId, 'device');
        } catch (error) {
            console.warn('[Encryption] Legacy migration failed:', error);
        }
    }, []);

    const scheduleMigration = useCallback((currentUserId: string) => {
        InteractionManager.runAfterInteractions(() => {
            void runMigration(currentUserId);
        });
    }, [runMigration]);

    const persistCustodyMode = useCallback(async (currentUserId: string, nextMode: CustodyMode) => {
        await storage.setCustodyMode(currentUserId, nextMode);
        setCustodyMode(nextMode);
    }, []);

    const loadState = useCallback(async () => {
        setStatus('loading');
        clearMasterKey();
        setSyncUnlocked(false);
        setBundle(null);
        setHasRemoteKeyBundle(false);
        setCustodyMode('standard');
        const storedSyncEnabled = await storage.getSyncEnabled();
        const isAuthReady = !!userId && isAuthenticated && !isGuest;

        setMode('local');
        setCryptoMode('local');
        setSyncEnabled(isAuthReady && storedSyncEnabled);
        syncService.setSyncEnabled(isAuthReady && storedSyncEnabled);

        if (!isAuthReady) {
            setStatus('ready');
            if (userId) {
                scheduleMigration(userId);
            }
            return;
        }

        let effectiveCustodyMode: CustodyMode = 'standard';
        const localCustodyMode = await storage.getCustodyMode(userId);
        if (localCustodyMode === 'strict_seed') {
            effectiveCustodyMode = 'strict_seed';
        }
        try {
            const remoteConfig = await e2eeApi.fetchConfig();
            effectiveCustodyMode = remoteConfig.custody_mode;
            await storage.setCustodyMode(userId, effectiveCustodyMode);
        } catch (error) {
            console.warn('[Encryption] Failed to fetch e2ee config from server:', error);
        }

        setCustodyMode(effectiveCustodyMode);

        if (effectiveCustodyMode === 'strict_seed') {
            await storage.setSyncEnabled(true);
            setSyncEnabled(true);
            syncService.setSyncEnabled(true);
            setHasRemoteKeyBundle(false);
            setBundle(null);
            const restored = await restoreMasterKey(userId);
            setStatus(restored ? 'ready' : 'locked');
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
            setSyncEnabled(true);
            syncService.setSyncEnabled(true);
            const restored = await restoreMasterKey(userId);
            setStatus(restored ? 'ready' : 'locked');
            return;
        }

        setSyncEnabled(false);
        syncService.setSyncEnabled(false);
        setStatus('uninitialized');
    }, [userId, isAuthenticated, isGuest, restoreMasterKey, scheduleMigration]);

    useEffect(() => {
        void loadState();
    }, [loadState]);

    const enableE2EE = useCallback(async (secret: string, nextMode: SecretMode = 'pin') => {
        if (!isAuthenticated || isGuest) {
            throw new Error('Sign in required to enable sync');
        }
        if (!userId) {
            throw new Error('User not available');
        }
        const validationError = getSecretValidationError(secret, nextMode);
        if (validationError) {
            throw new Error(validationError);
        }

        const normalizedSecret = normalizeSecretInput(secret, nextMode);
        await storage.clearSyncResetBlocked(userId);
        await storage.setSyncEnabled(true);
        await storage.setCryptoMode('local');
        setCryptoMode('local');
        setMode('local');
        setSyncEnabled(true);
        syncService.setSyncEnabled(true);

        if (nextMode === 'seed_phrase') {
            const derivedMasterKey = await deriveMasterKeyFromSeedAsync(normalizedSecret);
            setMasterKey(derivedMasterKey);
            setSyncUnlocked(true);
            setBundle(null);
            setHasRemoteKeyBundle(false);
            setStatus('ready');
            await persistMasterKey(userId, derivedMasterKey);
            await storage.removeKeyBundle(userId);
            await persistCustodyMode(userId, 'strict_seed');

            try {
                await e2eeApi.setConfig('strict_seed');
            } catch (error) {
                console.warn('[Encryption] Failed to set strict seed mode on server:', error);
            }
            try {
                await e2eeApi.deleteKeyBundle();
            } catch (error) {
                console.warn('[Encryption] Failed to delete key bundle on server:', error);
            }

            await syncService.resetSyncState(userId);
            scheduleMigration(userId);
            return;
        }

        const { bundle: newBundle, masterKey } = await createKeyBundle(normalizedSecret, nextMode);
        setMasterKey(masterKey);
        setSyncUnlocked(true);
        await persistMasterKey(userId, masterKey);
        await storage.setKeyBundle(userId, newBundle);
        await persistCustodyMode(userId, 'standard');
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

        scheduleMigration(userId);
    }, [isAuthenticated, isGuest, userId, scheduleMigration, persistMasterKey, persistCustodyMode]);

    const unlock = useCallback(async (secret: string) => {
        if (!secret.trim()) {
            throw new Error('Access key is required.');
        }

        const formatIncorrectSecretMessage = (secretMode: SecretMode): string => {
            if (secretMode === 'pin') return 'Incorrect PIN.';
            if (secretMode === 'passphrase') return 'Incorrect passphrase.';
            return 'Incorrect seed phrase.';
        };

        const expectedSecretMode: SecretMode =
            custodyMode === 'strict_seed'
                ? 'seed_phrase'
                : (bundle?.secret_mode ?? 'pin');

        let resolvedMasterKey: Uint8Array;
        if (custodyMode === 'strict_seed') {
            const validationError = getSecretValidationError(secret, 'seed_phrase');
            if (validationError) {
                throw new Error(validationError);
            }
            try {
                resolvedMasterKey = await deriveMasterKeyFromSeedAsync(secret);
            } catch (error: any) {
                const message = String(error?.message || '');
                if (message.toLowerCase().includes('invalid')) {
                    throw new Error(formatIncorrectSecretMessage(expectedSecretMode));
                }
                throw error;
            }

            // In strict-seed mode, verify against locally cached master key when available.
            // This gives immediate "incorrect seed" feedback on devices that already unlocked before.
            if (userId) {
                const storedWrappedMasterKey = await storage.getStoredMasterKey(userId);
                if (storedWrappedMasterKey) {
                    try {
                        const storedMasterKeyHex = await decrypt(storedWrappedMasterKey);
                        if (storedMasterKeyHex !== bytesToHex(resolvedMasterKey)) {
                            throw new Error(formatIncorrectSecretMessage(expectedSecretMode));
                        }
                    } catch (error: any) {
                        const message = String(error?.message || '').toLowerCase();
                        if (
                            message.includes('incorrect seed phrase') ||
                            message.includes('invalid tag') ||
                            message.includes('invalid ciphertext')
                        ) {
                            throw new Error(formatIncorrectSecretMessage(expectedSecretMode));
                        }
                        console.warn('[Encryption] Failed to verify strict-seed master key from local cache:', error);
                    }
                }
            }
        } else {
            if (!bundle) {
                throw new Error('Key bundle missing');
            }
            try {
                resolvedMasterKey = unwrapMasterKey(bundle, secret);
            } catch (error: any) {
                const message = String(error?.message || '').toLowerCase();
                if (message.includes('invalid access key') || message.includes('invalid tag')) {
                    throw new Error(formatIncorrectSecretMessage(expectedSecretMode));
                }
                throw error;
            }
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
            scheduleMigration(userId);
        }
    }, [bundle, custodyMode, userId, scheduleMigration, persistMasterKey]);

    const changePin = useCallback(async (secret: string, nextMode: SecretMode = 'pin') => {
        if (!isAuthenticated || isGuest) {
            throw new Error('Sign in required to change access key');
        }
        if (!userId) {
            throw new Error('User not available');
        }
        if (!hasMasterKey()) {
            throw new Error('Vault is locked');
        }
        const validationError = getSecretValidationError(secret, nextMode);
        if (validationError) {
            throw new Error(validationError);
        }

        const currentMasterKey = getMasterKey();
        if (!currentMasterKey) {
            throw new Error('Master key missing');
        }

        const normalizedSecret = normalizeSecretInput(secret, nextMode);
        await storage.clearSyncResetBlocked(userId);

        if (nextMode === 'seed_phrase') {
            const previousMasterHex = bytesToHex(currentMasterKey);
            const derivedMasterKey = await deriveMasterKeyFromSeedAsync(normalizedSecret);
            const nextMasterHex = bytesToHex(derivedMasterKey);
            const requiresReSync = custodyMode !== 'strict_seed' || previousMasterHex !== nextMasterHex;

            setMasterKey(derivedMasterKey);
            setSyncUnlocked(true);
            setBundle(null);
            setHasRemoteKeyBundle(false);
            setSyncEnabled(true);
            syncService.setSyncEnabled(true);
            await storage.setSyncEnabled(true);
            await persistMasterKey(userId, derivedMasterKey);
            await storage.removeKeyBundle(userId);
            await persistCustodyMode(userId, 'strict_seed');

            try {
                await e2eeApi.setConfig('strict_seed');
            } catch (error) {
                console.warn('[Encryption] Failed to set strict seed mode on server:', error);
            }
            try {
                await e2eeApi.deleteKeyBundle();
            } catch (error) {
                console.warn('[Encryption] Failed to delete key bundle on server:', error);
            }

            if (requiresReSync) {
                await syncService.resetSyncState(userId);
                setTimeout(() => {
                    void syncService.syncNow('manual');
                }, 0);
            }
            return;
        }

        const newBundle = await wrapMasterKey(currentMasterKey, normalizedSecret, nextMode);
        await storage.setKeyBundle(userId, newBundle);
        await persistCustodyMode(userId, 'standard');
        setBundle(newBundle);
        setHasRemoteKeyBundle(true);
        setSyncEnabled(true);
        syncService.setSyncEnabled(true);
        await storage.setSyncEnabled(true);

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
    }, [isAuthenticated, isGuest, userId, custodyMode, persistMasterKey, persistCustodyMode]);

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
            const result = await e2eeApi.resetVault();
            if (result === 'deleted') {
                remoteNotesPurged = true;
                keyDeleted = true;
            } else {
                console.warn('[Encryption] Server does not support /e2ee/vault reset endpoint.');
            }
        } catch (error) {
            console.warn('[Encryption] Failed to reset remote vault:', error);
        }

        if (!remoteNotesPurged) {
            try {
                const deleteNotesResult = await notesApi.deleteAllSyncNotes();
                if (deleteNotesResult === 'deleted') {
                    remoteNotesPurged = true;
                } else {
                    console.warn('[Encryption] Server does not support /sync/notes deletion endpoint.');
                }
            } catch (error) {
                console.warn('[Encryption] Failed to delete remote sync notes:', error);
            }
        }

        if (!keyDeleted) {
            try {
                const keyDeleteResult = await e2eeApi.deleteKeyBundle();
                if (keyDeleteResult === 'deleted') {
                    keyDeleted = true;
                } else {
                    console.warn('[Encryption] Server does not support key-bundle deletion endpoint.');
                }
            } catch (error) {
                console.warn('[Encryption] Failed to delete key bundle on server:', error);
            }
        }

        try {
            await e2eeApi.setConfig('standard');
        } catch (error) {
            console.warn('[Encryption] Failed to reset custody mode on server:', error);
        }

        await storage.removeKeyBundle(userId);
        await storage.removeStoredMasterKey(userId);
        await storage.removeCustodyMode(userId);
        await storage.setSyncEnabled(false);
        clearMasterKey();
        setBundle(null);
        setCustodyMode('standard');
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

    const lock = useCallback(() => {
        clearMasterKey();
        setSyncUnlocked(false);
        if (bundle || custodyMode === 'strict_seed') {
            setStatus('locked');
        } else {
            setStatus('uninitialized');
        }
    }, [bundle, custodyMode]);

    const value = useMemo(() => ({
        status,
        mode,
        custodyMode,
        syncEnabled,
        syncLocked: syncEnabled && !syncUnlocked,
        hasRemoteKeyBundle,
        bundle,
        enableE2EE,
        unlock,
        changePin,
        resetSync,
        lock,
    }), [status, mode, custodyMode, syncEnabled, syncUnlocked, hasRemoteKeyBundle, bundle, enableE2EE, unlock, changePin, resetSync, lock]);

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
