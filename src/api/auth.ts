import client from './client';

export const authApi = {
    register: async (email: string, password: string): Promise<any> => {
        const response = await client.post('/auth/register', { email, password });
        return response.data;
    },

    login: async (email: string, password: string): Promise<{ access_token: string; token_type: string }> => {
        // The backend expects form data or json? The prompt says "POST /api/v1/auth/login".
        // Usually FastAPI OAuth2PasswordRequestForm expects form data, but let's assume JSON based on "JWT auth (email + password)" description
        // If it fails, we might need to switch to URLSearchParams for form-urlencoded.
        // Let's assume JSON for now as it's a "modern" API description.
        // Actually, standard FastAPI /token endpoint uses form-data.
        // But the prompt says "POST /api/v1/auth/login", which might be a custom endpoint.
        // I will try JSON first.
        const response = await client.post('/auth/login', { email, password });
        return response.data;
    },
};
