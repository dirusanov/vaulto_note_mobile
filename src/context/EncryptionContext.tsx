import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { InteractionManager } from 'react-native';
import { useAuth } from '../hooks/useAuth';
import { storage, CryptoMode } from '../utils/storage';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import {
    KeyBundle,
    clearMasterKey,
    createKeyBundle,
    getMasterKey,
    hasMasterKey,
    isKeyBundle,
    isValidPin,
    setMasterKey,
    unwrapMasterKey,
    wrapMasterKey,
} from '../crypto/e2ee';
import { decrypt, encrypt, setCryptoMode } from '../crypto/encryption';
import { e2eeApi } from '../api/e2ee';
import { initDatabase, migrateLegacyEncryption } from '../services/DatabaseService';
import { syncService } from '../services/SyncService';

export type EncryptionStatus = 'loading' | 'uninitialized' | 'locked' | 'ready';

interface EncryptionContextType {
    status: EncryptionStatus;
    mode: CryptoMode;
    syncEnabled: boolean;
    syncLocked: boolean;
    bundle: KeyBundle | null;
    enableE2EE: (pin: string) => Promise<void>;
    unlock: (pin: string) => Promise<void>;
    changePin: (pin: string) => Promise<void>;
    resetSync: () => Promise<void>;
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

    const loadState = useCallback(async () => {
        setStatus('loading');
        clearMasterKey();
        setSyncUnlocked(false);
        setBundle(null);
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
        const localBundle = await storage.getKeyBundle(userId);
        if (localBundle && isKeyBundle(localBundle)) {
            activeBundle = localBundle;
        }

        try {
            const serverBundle = await e2eeApi.fetchKeyBundle();
            if (serverBundle && isKeyBundle(serverBundle)) {
                const chosen = chooseNewestBundle(activeBundle, serverBundle);
                activeBundle = chosen;
                if (chosen === serverBundle) {
                    await storage.setKeyBundle(userId, serverBundle);
                }
            }
        } catch (error) {
            console.warn('[Encryption] Failed to fetch key bundle from server:', error);
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

    const enableE2EE = useCallback(async (pin: string) => {
        if (!isAuthenticated || isGuest) {
            throw new Error('Sign in required to enable sync');
        }
        if (!userId) {
            throw new Error('User not available');
        }
        if (!isValidPin(pin)) {
            throw new Error('PIN must be exactly 8 digits');
        }

        const { bundle: newBundle, masterKey } = await createKeyBundle(pin);
        setMasterKey(masterKey);
        setSyncUnlocked(true);
        await persistMasterKey(userId, masterKey);
        await storage.setKeyBundle(userId, newBundle);
        await storage.setCryptoMode('local');
        await storage.setSyncEnabled(true);
        setCryptoMode('local');
        syncService.setSyncEnabled(true);
        setBundle(newBundle);
        setStatus('ready');
        setMode('local');
        setSyncEnabled(true);

        try {
            await e2eeApi.storeKeyBundle(newBundle);
        } catch (error) {
            console.warn('[Encryption] Failed to store key bundle on server:', error);
        }

        scheduleMigration(userId);
    }, [isAuthenticated, isGuest, userId, scheduleMigration, persistMasterKey]);

    const unlock = useCallback(async (pin: string) => {
        const normalizedPin = pin.trim();
        if (!bundle) {
            throw new Error('Key bundle missing');
        }
        if (!isValidPin(normalizedPin)) {
            throw new Error('PIN must be exactly 8 digits');
        }

        const unwrapped = unwrapMasterKey(bundle, normalizedPin);
        setMasterKey(unwrapped);
        setSyncUnlocked(true);
        if (userId) {
            await persistMasterKey(userId, unwrapped);
        }
        setStatus('ready');

        if (!hasMasterKey()) {
            throw new Error('Failed to unlock');
        }

        if (userId) {
            scheduleMigration(userId);
        }
    }, [bundle, userId, scheduleMigration, persistMasterKey]);

    const changePin = useCallback(async (pin: string) => {
        if (!isAuthenticated || isGuest) {
            throw new Error('Sign in required to change PIN');
        }
        if (!userId) {
            throw new Error('User not available');
        }
        if (!hasMasterKey()) {
            throw new Error('Vault is locked');
        }
        if (!isValidPin(pin)) {
            throw new Error('PIN must be exactly 8 digits');
        }

        const masterKey = getMasterKey();
        if (!masterKey) {
            throw new Error('Master key missing');
        }

        const newBundle = await wrapMasterKey(masterKey, pin);
        await storage.setKeyBundle(userId, newBundle);
        setBundle(newBundle);

        try {
            await e2eeApi.storeKeyBundle(newBundle);
        } catch (error) {
            console.warn('[Encryption] Failed to update key bundle on server:', error);
        }
    }, [isAuthenticated, isGuest, userId]);

    const resetSync = useCallback(async () => {
        if (!isAuthenticated || isGuest) {
            throw new Error('Sign in required to reset sync');
        }
        if (!userId) {
            throw new Error('User not available');
        }

        try {
            await e2eeApi.deleteKeyBundle();
        } catch (error) {
            console.warn('[Encryption] Failed to delete key bundle on server:', error);
        }

        await storage.removeKeyBundle(userId);
        await storage.removeStoredMasterKey(userId);
        await storage.setSyncEnabled(false);
        clearMasterKey();
        setBundle(null);
        setSyncUnlocked(false);
        setSyncEnabled(false);
        setStatus('uninitialized');
        setMode('local');
        setCryptoMode('local');
        syncService.setSyncEnabled(false);
        await syncService.resetSyncState(userId);
    }, [isAuthenticated, isGuest, userId]);

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
        bundle,
        enableE2EE,
        unlock,
        changePin,
        resetSync,
        lock,
    }), [status, mode, syncEnabled, syncUnlocked, bundle, enableE2EE, unlock, changePin, resetSync, lock]);

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
