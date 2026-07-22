export type AccountEncryptionMode = 'off' | 'e2ee';
export type LocalCryptoMode = 'local' | 'e2ee';

/**
 * A server mode change must pause the current sync before any payload is
 * applied. `local` is the device-at-rest mode used when account E2EE is off.
 */
export const shouldPauseForEncryptionState = (
    localCryptoMode: LocalCryptoMode,
    serverMode: AccountEncryptionMode | null | undefined,
    localKeyEpoch = 0,
    serverKeyEpoch: number | null | undefined = null,
    localVaultGeneration = 0,
    serverVaultGeneration: number | null | undefined = null,
): boolean => {
    if (serverMode == null) return false;
    if (
        serverVaultGeneration != null
        && (serverVaultGeneration > 0 || localVaultGeneration > 0)
        && serverVaultGeneration !== localVaultGeneration
    ) {
        return true;
    }
    const localAccountMode: AccountEncryptionMode = localCryptoMode === 'e2ee' ? 'e2ee' : 'off';
    if (serverMode !== localAccountMode) return true;

    // Epoch zero means "unknown/legacy". A known generation mismatch on an
    // E2EE account can mean the account was reset and enabled again with a new
    // master key while this device was offline.
    return serverMode === 'e2ee'
        && localKeyEpoch > 0
        && serverKeyEpoch != null
        && serverKeyEpoch > 0
        && serverKeyEpoch !== localKeyEpoch;
};

export const isRetryableSyncConflict = (error: string): boolean => {
    return error === 'version_conflict' || error === 'stale_timestamp';
};

/** Timestamp for retrying a preserved local edit after observing the server. */
export const rebasedClientTimestamp = (
    nowMs: number,
    serverTimestamp: string | null | undefined,
): string => {
    const parsedServerMs = Date.parse(serverTimestamp ?? '');
    return new Date(Math.max(
        nowMs,
        Number.isFinite(parsedServerMs) ? parsedServerMs + 1 : 0,
    )).toISOString();
};

export const isSameKeyGeneration = (
    localKeyId: string | undefined,
    serverKeyId: string | undefined,
    bundlesExactlyEqual: boolean,
): boolean => {
    return bundlesExactlyEqual || !!(
        localKeyId
        && serverKeyId
        && localKeyId === serverKeyId
    );
};
