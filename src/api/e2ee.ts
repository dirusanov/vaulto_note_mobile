import client from './client';
import { KeyBundle } from '../crypto/e2ee';

export const e2eeApi = {
    fetchKeyBundle: async (): Promise<KeyBundle | null> => {
        const response = await client.get('/e2ee/master-key');
        return response.data;
    },
    storeKeyBundle: async (bundle: KeyBundle): Promise<void> => {
        await client.put('/e2ee/master-key', bundle);
    },
};
