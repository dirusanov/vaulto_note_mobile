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
    trial_total_credits: number;
    trial_used_credits: number;
    trial_expires_at?: string;
}

export interface GuestProfile {
    access_token: string;
    expires_in: number;
    user_id: string;
    is_verified: boolean;
    trial_total_credits: number;
    trial_used_credits: number;
    trial_expires_at?: string;
}

export interface GoogleAuthInit {
    authorization_url: string;
    state: string;
    code_verifier: string;
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

    checkVerificationStatus: async (email: string): Promise<UserProfile> => {
        const response = await authClient.get('/auth/status', { params: { email } });
        return response.data;
    },

    initGoogleLogin: async (): Promise<GoogleAuthInit> => {
        const response = await authClient.get('/auth/google/login');
        return response.data;
    },

    completeGoogleLogin: async (params: { code: string; state: string; code_verifier: string }): Promise<AuthTokens> => {
        const response = await authClient.get('/auth/google/callback', {
            params: {
                code: params.code,
                state: params.state,
                code_verifier: params.code_verifier,
            },
        });
        return response.data;
    },

    anonymousAuth: async (deviceKey: string, platform: string): Promise<GuestProfile> => {
        const response = await authClient.post('/auth/anonymous', {
            device_key: deviceKey,
            platform: platform,
        });
        return response.data;
    },
};
