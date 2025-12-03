import authClient from './authClient';

export interface AuthTokens {
    access_token: string;
    token_type: string;
    expires_in: number;
}

export interface UserProfile {
    id: string;
    email: string;
    full_name?: string | null;
    is_verified: boolean;
    status: string;
    provider: string;
}

export interface GoogleAuthInit {
    authorization_url: string;
    state: string;
}

export const authApi = {
    register: async (params: { email: string; password: string; fullName?: string | null }): Promise<UserProfile> => {
        const response = await authClient.post('/auth/register', {
            email: params.email,
            password: params.password,
            full_name: params.fullName,
        });
        return response.data;
    },

    login: async (email: string, password: string): Promise<AuthTokens> => {
        const response = await authClient.post('/auth/login', { email, password });
        return response.data;
    },

    confirmEmail: async (token: string): Promise<UserProfile> => {
        const response = await authClient.post('/auth/confirm', { token });
        return response.data;
    },

    getProfile: async (): Promise<UserProfile> => {
        const response = await authClient.get('/auth/me');
        return response.data;
    },

    initGoogleLogin: async (): Promise<GoogleAuthInit> => {
        const response = await authClient.get('/auth/google/login');
        return response.data;
    },

    completeGoogleLogin: async (params: { code: string; state: string }): Promise<AuthTokens> => {
        const response = await authClient.get('/auth/google/callback', {
            params: {
                code: params.code,
                state: params.state,
            },
        });
        return response.data;
    },
};
