import client from './client';
import { KeyBundle } from '../crypto/e2ee';

export type DeleteKeyBundleResult = 'deleted' | 'unsupported';
export type ResetSyncResult = E2EEStateResponse & {
    status: 'ok';
    deleted_notes: number;
    key_deleted: boolean;
};

export interface E2EEConfigResponse {
    custody_mode: 'standard';
}

export type AccountEncMode = 'off' | 'e2ee';

export interface E2EEStateResponse {
    enc_mode: AccountEncMode;
    key_epoch: number;
    vault_generation: number;
    transition_state?: 'enabling_e2ee' | 'disabling_e2ee' | null;
    transition_owned?: boolean;
}

export class E2EEEnableConflictError extends Error {
    constructor() {
        super('Encryption was enabled concurrently on another device.');
        this.name = 'E2EEEnableConflictError';
    }
}

export type E2EETransitionReason =
    | 'server_changed'
    | 'key_epoch_mismatch'
    | 'different_key'
    | 'strict_custody'
    | 'encryption_transition_conflict'
    | 'data_mode_incomplete'
    | 'atomic_disable_required'
    | string;

export class E2EETransitionError extends Error {
    readonly reason: E2EETransitionReason;
    readonly serverEncMode: AccountEncMode | null;
    readonly serverKeyEpoch: number | null;

    constructor(
        reason: E2EETransitionReason,
        message: string,
        serverEncMode: AccountEncMode | null = null,
        serverKeyEpoch: number | null = null,
    ) {
        super(message);
        this.name = 'E2EETransitionError';
        this.reason = reason;
        this.serverEncMode = serverEncMode;
        this.serverKeyEpoch = serverKeyEpoch;
    }
}

const transitionErrorFromResponse = (data: any): E2EETransitionError => {
    const detail = data?.detail ?? data ?? {};
    const reason = String(detail?.error || 'encryption_transition_conflict');
    return new E2EETransitionError(
        reason,
        String(detail?.message || 'Encryption state changed while data was being migrated.'),
        detail?.server_enc_mode === 'e2ee' || detail?.server_enc_mode === 'off'
            ? detail.server_enc_mode
            : null,
        Number.isFinite(Number(detail?.server_key_epoch))
            ? Number(detail.server_key_epoch)
            : null,
    );
};

export const e2eeApi = {
    fetchConfig: async (): Promise<E2EEConfigResponse> => {
        const response = await client.get('/e2ee/config', {
            validateStatus: (status) =>
                (status >= 200 && status < 300) || status === 401 || status === 404 || status === 405,
        });

        if (response.status === 401 || response.status === 404 || response.status === 405) {
            return { custody_mode: 'standard' };
        }

        if (response.data?.custody_mode === 'standard') {
            return response.data;
        }
        return { custody_mode: 'standard' };
    },
    // Returns null when the server does not support the endpoint (older build)
    // so callers fall back to legacy detection instead of mistaking a missing
    // endpoint for "encryption disabled" (which would drop a valid key bundle).
    fetchState: async (transitionToken?: string | null): Promise<E2EEStateResponse | null> => {
        const response = await client.get('/e2ee/state', {
            headers: transitionToken
                ? { 'X-Encryption-Transition-Token': transitionToken }
                : undefined,
            validateStatus: (status) =>
                (status >= 200 && status < 300) || status === 401 || status === 404 || status === 405,
        });
        if (response.status === 401 || response.status === 404 || response.status === 405) {
            return null;
        }
        if (response.data?.enc_mode !== 'off' && response.data?.enc_mode !== 'e2ee') {
            // Unexpected payload — treat as unknown rather than guessing 'off'.
            return null;
        }
        return {
            enc_mode: response.data.enc_mode,
            key_epoch: Number(response.data?.key_epoch ?? 0),
            vault_generation: Number(response.data?.vault_generation ?? 0),
            transition_state: response.data?.transition_state ?? null,
            transition_owned: response.data?.transition_owned === true,
        };
    },
    setState: async (enc_mode: AccountEncMode, key_epoch?: number): Promise<E2EEStateResponse> => {
        const response = await client.put('/e2ee/state', {
            enc_mode,
            ...(key_epoch !== undefined ? { key_epoch } : {}),
        }, {
            validateStatus: (status) =>
                (status >= 200 && status < 300) || status === 404 || status === 405 || status === 409,
        });
        if (response.status === 404 || response.status === 405) {
            // Older server — no-op, the account is implicitly plaintext.
            return { enc_mode, key_epoch: key_epoch ?? 0, vault_generation: 0 };
        }
        if (response.status === 409) {
            throw new Error('Encryption state epoch conflict');
        }
        const mode = response.data?.enc_mode === 'e2ee' ? 'e2ee' : 'off';
        return {
            enc_mode: mode,
            key_epoch: Number(response.data?.key_epoch ?? 0),
            vault_generation: Number(response.data?.vault_generation ?? 0),
        };
    },
    enableWithBundle: async (
        bundle: KeyBundle,
        expectedKeyEpoch: number,
        expectedServerSeq: number,
        transitionToken: string,
    ): Promise<E2EEStateResponse | null> => {
        const response = await client.put('/e2ee/enable', {
            bundle,
            expected_key_epoch: expectedKeyEpoch,
            expected_server_seq: expectedServerSeq,
            transition_token: transitionToken,
        }, {
            validateStatus: (status) =>
                (status >= 200 && status < 300) || status === 404 || status === 405 || status === 409,
        });
        if (response.status === 404 || response.status === 405) {
            return null;
        }
        if (response.status === 409) {
            const error = transitionErrorFromResponse(response.data);
            if (error.reason === 'different_key') {
                throw new E2EEEnableConflictError();
            }
            throw error;
        }
        return {
            enc_mode: response.data?.enc_mode === 'e2ee' ? 'e2ee' : 'off',
            key_epoch: Number(response.data?.key_epoch ?? 0),
            vault_generation: Number(response.data?.vault_generation ?? 0),
            transition_state: response.data?.transition_state ?? null,
        };
    },
    disableAtSnapshot: async (
        expectedKeyEpoch: number,
        expectedServerSeq: number,
        transitionToken: string,
    ): Promise<E2EEStateResponse> => {
        const response = await client.put('/e2ee/disable', {
            expected_key_epoch: expectedKeyEpoch,
            expected_server_seq: expectedServerSeq,
            transition_token: transitionToken,
        }, {
            validateStatus: (status) => (status >= 200 && status < 300) || status === 409,
        });
        if (response.status === 409) {
            throw transitionErrorFromResponse(response.data);
        }
        return {
            enc_mode: response.data?.enc_mode === 'e2ee' ? 'e2ee' : 'off',
            key_epoch: Number(response.data?.key_epoch ?? 0),
            vault_generation: Number(response.data?.vault_generation ?? 0),
            transition_state: response.data?.transition_state ?? null,
        };
    },
    validateDataMode: async (
        encMode: AccountEncMode,
        transitionToken: string,
    ): Promise<void> => {
        const response = await client.post('/e2ee/validate', {
            enc_mode: encMode,
            transition_token: transitionToken,
        }, {
            validateStatus: (status) => (status >= 200 && status < 300) || status === 409,
        });
        if (response.status === 409) {
            throw transitionErrorFromResponse(response.data);
        }
    },
    setConfig: async (syncMode: 'standard' = 'standard'): Promise<E2EEConfigResponse> => {
        const response = await client.put('/e2ee/config', {
            custody_mode: syncMode,
        });
        if (response.data?.custody_mode === 'standard') {
            return response.data;
        }
        return { custody_mode: 'standard' };
    },
    fetchKeyBundle: async (): Promise<KeyBundle | null> => {
        const response = await client.get('/e2ee/master-key', {
            validateStatus: (status) =>
                (status >= 200 && status < 300) || status === 401 || status === 404 || status === 405,
        });

        if (response.status === 401 || response.status === 404 || response.status === 405) {
            return null;
        }

        return response.data;
    },
    storeKeyBundle: async (bundle: KeyBundle): Promise<void> => {
        const response = await client.put('/e2ee/master-key', bundle, {
            validateStatus: (status) => (status >= 200 && status < 300) || status === 409,
        });
        if (response.status === 409) {
            throw new Error('Server rejected key bundle');
        }
    },
    deleteKeyBundle: async (): Promise<DeleteKeyBundleResult> => {
        const response = await client.delete('/e2ee/master-key', {
            validateStatus: (status) => (status >= 200 && status < 300) || status === 405,
        });

        if (response.status === 405) {
            return 'unsupported';
        }

        return 'deleted';
    },
    resetSyncData: async (): Promise<ResetSyncResult> => {
        const response = await client.delete('/e2ee/reset');
        return {
            status: 'ok',
            deleted_notes: Number(response.data?.deleted_notes ?? 0),
            key_deleted: !!response.data?.key_deleted,
            enc_mode: response.data?.enc_mode === 'e2ee' ? 'e2ee' : 'off',
            key_epoch: Number(response.data?.key_epoch ?? 0),
            vault_generation: Number(response.data?.vault_generation ?? 0),
        };
    },
};
