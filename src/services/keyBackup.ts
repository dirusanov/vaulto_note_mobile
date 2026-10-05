import { NativeModules, Platform } from 'react-native';

/**
 * The end-to-end key, kept by the platform so nobody has to type it again:
 * Google Block Store on Android (survives reinstalls, restores on a new phone, cloud
 * copy end-to-end encrypted with the screen lock), iCloud Keychain on iOS.
 * Vaulto's server never sees it. The stored value is the account's 24-word key.
 */

type NativeKeyBackup = {
    getStatus(): Promise<{ available: boolean; cloudEncrypted: boolean }>;
    store(account: string, secret: string): Promise<{ cloud: boolean }>;
    retrieve(account: string): Promise<string | null>;
    remove(account: string): Promise<boolean>;
};

const native: NativeKeyBackup | undefined =
    Platform.OS === 'web' ? undefined : (NativeModules.KeyBackup as NativeKeyBackup | undefined);

export type KeyBackupStatus = {
    /** The platform store exists in this build and on this phone. */
    available: boolean;
    /** A copy also goes to the user's Google/iCloud backup (end-to-end encrypted there). */
    cloud: boolean;
};

export const getKeyBackupStatus = async (): Promise<KeyBackupStatus> => {
    if (!native) return { available: false, cloud: false };
    try {
        const status = await native.getStatus();
        return { available: !!status?.available, cloud: !!status?.cloudEncrypted };
    } catch {
        return { available: false, cloud: false };
    }
};

/** Saves the key; resolves whether it reached the cloud backup, or null when it could not be saved. */
export const backupKey = async (userId: string, recoveryKey: string): Promise<{ cloud: boolean } | null> => {
    if (!native || !userId || !recoveryKey) return null;
    try {
        const result = await native.store(userId, recoveryKey);
        console.log(`[KeyBackup] Key saved (cloud copy: ${!!result?.cloud}).`);
        return { cloud: !!result?.cloud };
    } catch (error) {
        console.warn('[KeyBackup] Could not save the key', error instanceof Error ? error.message : 'unknown');
        return null;
    }
};

export const restoreKey = async (userId: string): Promise<string | null> => {
    if (!native || !userId) return null;
    try {
        const value = await native.retrieve(userId);
        const found = typeof value === 'string' && !!value.trim();
        console.log(`[KeyBackup] Kept key ${found ? 'found' : 'not found'}.`);
        return found ? (value as string).trim() : null;
    } catch {
        return null;
    }
};

export const removeKeyBackup = async (userId: string): Promise<void> => {
    if (!native || !userId) return;
    try {
        await native.remove(userId);
    } catch {
        // best effort
    }
};
