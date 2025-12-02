import AsyncStorage from '@react-native-async-storage/async-storage';

const TOKEN_KEY = 'vaulto_auth_token';
const OPENAI_API_KEY = 'vaulto_openai_api_key';
const PRIVACY_WARNING_DISMISSED_KEY = 'vaulto_privacy_warning_dismissed';
const MAX_RECORDING_DURATION_KEY = 'vaulto_max_recording_duration';
const AI_PROVIDER_KEY = 'vaulto_ai_provider';
const SELF_HOSTED_ENABLED_KEY = 'vaulto_self_hosted_enabled';
const SELF_HOSTED_URL_KEY = 'vaulto_self_hosted_url';
const SELF_HOSTED_API_KEY = 'vaulto_self_hosted_api_key';

export type AIProvider = 'local' | 'openai' | 'selfhosted';

export const storage = {
    getToken: async (): Promise<string | null> => {
        try {
            return await AsyncStorage.getItem(TOKEN_KEY);
        } catch (e) {
            console.error('Failed to get token', e);
            return null;
        }
    },
    setToken: async (token: string): Promise<void> => {
        try {
            await AsyncStorage.setItem(TOKEN_KEY, token);
        } catch (e) {
            console.error('Failed to set token', e);
        }
    },
    removeToken: async (): Promise<void> => {
        try {
            await AsyncStorage.removeItem(TOKEN_KEY);
        } catch (e) {
            console.error('Failed to remove token', e);
        }
    },
};

// OpenAI API Key
export const getOpenAIApiKey = async (): Promise<string | null> => {
    try {
        return await AsyncStorage.getItem(OPENAI_API_KEY);
    } catch (e) {
        console.error('Failed to get OpenAI API key', e);
        return null;
    }
};

export const setOpenAIApiKey = async (apiKey: string): Promise<void> => {
    try {
        await AsyncStorage.setItem(OPENAI_API_KEY, apiKey);
    } catch (e) {
        console.error('Failed to set OpenAI API key', e);
    }
};

// AI Provider
export const getAIProvider = async (): Promise<AIProvider> => {
    try {
        const value = await AsyncStorage.getItem(AI_PROVIDER_KEY);
        if (value === 'openai' || value === 'local' || value === 'selfhosted') {
            return value;
        }
        return 'local';
    } catch (e) {
        console.error('Failed to get AI provider', e);
        return 'local';
    }
};

export const setAIProvider = async (provider: AIProvider): Promise<void> => {
    try {
        await AsyncStorage.setItem(AI_PROVIDER_KEY, provider);
    } catch (e) {
        console.error('Failed to set AI provider', e);
    }
};

// Privacy Warning
export const getPrivacyWarningDismissed = async (): Promise<boolean> => {
    try {
        const value = await AsyncStorage.getItem(PRIVACY_WARNING_DISMISSED_KEY);
        return value === 'true';
    } catch (e) {
        console.error('Failed to get privacy warning state', e);
        return false;
    }
};

export const setPrivacyWarningDismissed = async (dismissed: boolean): Promise<void> => {
    try {
        await AsyncStorage.setItem(PRIVACY_WARNING_DISMISSED_KEY, dismissed.toString());
    } catch (e) {
        console.error('Failed to set privacy warning state', e);
    }
};

export const resetPrivacyWarning = async (): Promise<void> => {
    try {
        await AsyncStorage.removeItem(PRIVACY_WARNING_DISMISSED_KEY);
    } catch (e) {
        console.error('Failed to reset privacy warning', e);
    }
};

// Max Recording Duration
export const getMaxRecordingDuration = async (): Promise<number> => {
    try {
        const value = await AsyncStorage.getItem(MAX_RECORDING_DURATION_KEY);
        return value ? parseInt(value, 10) : 300; // Default 5 minutes
    } catch (e) {
        console.error('Failed to get max recording duration', e);
        return 300;
    }
};

export const setMaxRecordingDuration = async (seconds: number): Promise<void> => {
    try {
        await AsyncStorage.setItem(MAX_RECORDING_DURATION_KEY, seconds.toString());
    } catch (e) {
        console.error('Failed to set max recording duration', e);
    }
};

// Self-Hosted Backend Settings
export const getSelfHostedUrl = async (): Promise<string | null> => {
    try {
        return await AsyncStorage.getItem(SELF_HOSTED_URL_KEY);
    } catch (e) {
        console.error('Failed to get self-hosted URL', e);
        return null;
    }
};

export const setSelfHostedUrl = async (url: string): Promise<void> => {
    try {
        await AsyncStorage.setItem(SELF_HOSTED_URL_KEY, url);
    } catch (e) {
        console.error('Failed to set self-hosted URL', e);
    }
};

export const getSelfHostedApiKey = async (): Promise<string | null> => {
    try {
        return await AsyncStorage.getItem(SELF_HOSTED_API_KEY);
    } catch (e) {
        console.error('Failed to get self-hosted API key', e);
        return null;
    }
};

export const setSelfHostedApiKey = async (apiKey: string): Promise<void> => {
    try {
        await AsyncStorage.setItem(SELF_HOSTED_API_KEY, apiKey);
    } catch (e) {
        console.error('Failed to set self-hosted API key', e);
    }
};
