import authClient from './authClient';

export interface AuthTokens {
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
}

export interface LoginResult {
    needs_legal_acceptance: boolean;
    legal_token?: string | null;
    access_token?: string | null;
    refresh_token?: string | null;
    token_type?: string;
    expires_in?: number | null;
}

export interface UserProfile {
    id: string;
    email: string;
    full_name?: string | null;
    is_verified: boolean;
    status: string;
    provider: string;
    plan?: string;
    is_pro?: boolean;
    subscription_next_refill_at?: string | null;
    transcription_total_seconds: number;
    transcription_total_used_seconds: number;
    transcription_remaining_seconds: number;
    transcription_trial_total_seconds?: number;
    transcription_trial_used_seconds?: number;
    transcription_trial_remaining_seconds?: number;
    transcription_subscription_max_seconds?: number;
    transcription_subscription_used_seconds?: number;
    transcription_subscription_remaining_seconds?: number;
    has_llm_access: boolean;
    llm_max_tokens?: number;
    llm_used_tokens?: number;
    llm_remaining_tokens?: number;
    current_usage_period_start_at?: string | null;
    current_usage_period_end_at?: string | null;
}

export interface GuestProfile {
    access_token: string;
    expires_in: number;
    user_id: string;
    is_verified: boolean;
    transcription_total_seconds: number;
    transcription_total_used_seconds: number;
    transcription_remaining_seconds: number;
    has_llm_access: boolean;
}

export interface GoogleAuthInit {
    authorization_url: string;
    state: string;
    code_verifier: string;
}

export const authApi = {
    register: async (params: { email: string; password: string; fullName?: string | null; termsAccepted?: boolean }): Promise<UserProfile> => {
        const response = await authClient.post('/auth/register', {
            email: params.email,
            password: params.password,
            full_name: params.fullName,
            terms_accepted: params.termsAccepted ?? false,
        });
        return response.data;
    },

    login: async (email: string, password: string): Promise<LoginResult> => {
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

    completeGoogleLogin: async (params: { code: string; state: string; code_verifier?: string }): Promise<LoginResult> => {
        const queryParams: Record<string, string> = {
            code: params.code,
            state: params.state,
        };
        if (params.code_verifier) {
            queryParams.code_verifier = params.code_verifier;
        }

        const response = await authClient.get('/auth/google/callback', {
            params: queryParams,
        });
        return response.data;
    },

    acceptLegal: async (legalToken: string): Promise<AuthTokens> => {
        const response = await authClient.post('/auth/legal/accept', {
            legal_token: legalToken,
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

    requestPasswordReset: async (email: string): Promise<void> => {
        await authClient.post('/auth/password-reset/request', { email });
    },

    confirmPasswordReset: async (token: string, newPassword: string): Promise<void> => {
        await authClient.post('/auth/password-reset/confirm', {
            token,
            new_password: newPassword,
        });
    },

    generateMagicLink: async (): Promise<{ url: string; token: string }> => {
        const response = await authClient.post<{ url: string; token: string }>('/auth/magic-link');
        return response.data;
    },
};
