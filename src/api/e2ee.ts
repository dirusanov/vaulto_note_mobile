import client from './client';
import { KeyBundle } from '../crypto/e2ee';

export type DeleteKeyBundleResult = 'deleted' | 'unsupported';
export type ResetSyncResult = 'deleted';

export interface E2EEConfigResponse {
    custody_mode: 'standard';
}

export const e2eeApi = {
    fetchConfig: async (): Promise<E2EEConfigResponse> => {
        const response = await client.get('/e2ee/config', {
            validateStatus: (status) =>
                (status >= 200 && status < 300) || status === 404 || status === 405,
        });

        if (response.status === 404 || response.status === 405) {
            return { custody_mode: 'standard' };
        }

        if (response.data?.custody_mode === 'standard') {
            return response.data;
        }
        return { custody_mode: 'standard' };
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
        const response = await client.get('/e2ee/master-key');
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
        await client.delete('/e2ee/reset');
        return 'deleted';
    },
};
