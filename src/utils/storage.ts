import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { UserProfile } from '../api/auth';

export type AIProvider = 'secure_llm' | 'openai' | 'selfhosted';
const TOKEN_KEY = 'vaulto_auth_token';
const REFRESH_TOKEN_KEY = 'vaulto_refresh_token';
const USER_ID_KEY = 'vaulto_user_id';
const USER_PROFILE_KEY = 'vaulto_user_profile';
const OPENAI_API_KEY = 'vaulto_openai_api_key';
const PRIVACY_WARNING_DISMISSED_KEY = 'vaulto_privacy_warning_dismissed';
const MAX_RECORDING_DURATION_KEY = 'vaulto_max_recording_duration';
const AI_PROVIDER_KEY = 'vaulto_ai_provider';

const SELF_HOSTED_URL_KEY = 'vaulto_self_hosted_url';
const SELF_HOSTED_API_KEY = 'vaulto_self_hosted_api_key';

// Helper for SecureStore with web fallback (since SecureStore doesn't support web)
const secureGet = async (key: string): Promise<string | null> => {
    if (Platform.OS === 'web') {
        return AsyncStorage.getItem(key);
    }
    return SecureStore.getItemAsync(key);
};

const secureSet = async (key: string, value: string): Promise<void> => {
    if (Platform.OS === 'web') {
        return AsyncStorage.setItem(key, value);
    }
    return SecureStore.setItemAsync(key, value, {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    });
};

const secureDelete = async (key: string): Promise<void> => {
    if (Platform.OS === 'web') {
        return AsyncStorage.removeItem(key);
    }
    return SecureStore.deleteItemAsync(key);
};

export const storage = {
    getToken: async (): Promise<string | null> => {
        try {
            return await secureGet(TOKEN_KEY);
        } catch (e) {
            console.error('Failed to get token', e);
            return null;
        }
    },
    setToken: async (token: string): Promise<void> => {
        try {
            await secureSet(TOKEN_KEY, token);
        } catch (e) {
            console.error('Failed to set token', e);
        }
    },
    removeToken: async (): Promise<void> => {
        try {
            await secureDelete(TOKEN_KEY);
        } catch (e) {
            console.error('Failed to remove token', e);
        }
    },
    getRefreshToken: async (): Promise<string | null> => {
        try {
            return await secureGet(REFRESH_TOKEN_KEY);
        } catch (e) {
            console.error('Failed to get refresh token', e);
            return null;
        }
    },
    setRefreshToken: async (token: string): Promise<void> => {
        try {
            await secureSet(REFRESH_TOKEN_KEY, token);
        } catch (e) {
            console.error('Failed to set refresh token', e);
        }
    },
    removeRefreshToken: async (): Promise<void> => {
        try {
            await secureDelete(REFRESH_TOKEN_KEY);
        } catch (e) {
            console.error('Failed to remove refresh token', e);
        }
    },
    getUserId: async (): Promise<string | null> => {
        try {
            return await AsyncStorage.getItem(USER_ID_KEY);
        } catch (e) {
            console.error('Failed to get user id', e);
            return null;
        }
    },
    setUserId: async (userId: string): Promise<void> => {
        try {
            await AsyncStorage.setItem(USER_ID_KEY, userId);
        } catch (e) {
            console.error('Failed to set user id', e);
        }
    },
    removeUserId: async (): Promise<void> => {
        try {
            await AsyncStorage.removeItem(USER_ID_KEY);
        } catch (e) {
            console.error('Failed to remove user id', e);
        }
    },
    getUserProfile: async (): Promise<UserProfile | null> => {
        try {
            const json = await AsyncStorage.getItem(USER_PROFILE_KEY);
            return json ? JSON.parse(json) : null;
        } catch (e) {
            console.error('Failed to get user profile', e);
            return null;
        }
    },
    setUserProfile: async (profile: UserProfile): Promise<void> => {
        try {
            await AsyncStorage.setItem(USER_PROFILE_KEY, JSON.stringify(profile));
        } catch (e) {
            console.error('Failed to set user profile', e);
        }
    },
    removeUserProfile: async (): Promise<void> => {
        try {
            await AsyncStorage.removeItem(USER_PROFILE_KEY);
        } catch (e) {
            console.error('Failed to remove user profile', e);
        }
    },
};

// OpenAI API Key
export const getOpenAIApiKey = async (): Promise<string | null> => {
    try {
        return await secureGet(OPENAI_API_KEY);
    } catch (e) {
        console.error('Failed to get OpenAI API key', e);
        return null;
    }
};

export const setOpenAIApiKey = async (apiKey: string): Promise<void> => {
    try {
        await secureSet(OPENAI_API_KEY, apiKey);
    } catch (e) {
        console.error('Failed to set OpenAI API key', e);
    }
};

// AI Provider
export const getAIProvider = async (): Promise<AIProvider> => {
    try {
        const value = await AsyncStorage.getItem(AI_PROVIDER_KEY);
        if (value === 'openai' || value === 'secure_llm' || value === 'selfhosted') {
            return value as AIProvider;
        }
        // Fallback or migration: mapping 'local' to 'secure_llm' logic could go here, but for now default to 'secure_llm'
        return 'secure_llm';
    } catch (e) {
        console.error('Failed to get AI provider', e);
        return 'secure_llm';
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
        return await secureGet(SELF_HOSTED_API_KEY);
    } catch (e) {
        console.error('Failed to get self-hosted API key', e);
        return null;
    }
};

export const setSelfHostedApiKey = async (apiKey: string): Promise<void> => {
    try {
        await secureSet(SELF_HOSTED_API_KEY, apiKey);
    } catch (e) {
        console.error('Failed to set self-hosted API key', e);
    }
};

// Agent Mode
const AGENT_MODE_KEY = 'vaulto_agent_mode_enabled';

export const getAgentModeEnabled = async (): Promise<boolean> => {
    try {
        const value = await AsyncStorage.getItem(AGENT_MODE_KEY);
        // Default to true if not set
        return value === null ? true : value === 'true';
    } catch (e) {
        console.error('Failed to get agent mode setting', e);
        return true;
    }
};

export const setAgentModeEnabled = async (enabled: boolean): Promise<void> => {
    try {
        await AsyncStorage.setItem(AGENT_MODE_KEY, enabled.toString());
    } catch (e) {
        console.error('Failed to set agent mode setting', e);
    }
};

// Text Appearance Settings
const FONT_SIZE_KEY = 'vaulto_font_size';
const AUTO_SCALING_KEY = 'vaulto_auto_scaling_enabled';

export const getFontSize = async (): Promise<number> => {
    try {
        const value = await AsyncStorage.getItem(FONT_SIZE_KEY);
        return value ? parseInt(value, 10) : 16; // Default 16
    } catch (e) {
        console.error('Failed to get font size', e);
        return 16;
    }
};

export const setFontSize = async (size: number): Promise<void> => {
    try {
        await AsyncStorage.setItem(FONT_SIZE_KEY, size.toString());
    } catch (e) {
        console.error('Failed to set font size', e);
    }
};

export const getAutoScalingEnabled = async (): Promise<boolean> => {
    try {
        const value = await AsyncStorage.getItem(AUTO_SCALING_KEY);
        return value === null ? true : value === 'true'; // Default true
    } catch (e) {
        console.error('Failed to get auto scaling setting', e);
        return true;
    }
};

export const setAutoScalingEnabled = async (enabled: boolean): Promise<void> => {
    try {
        await AsyncStorage.setItem(AUTO_SCALING_KEY, enabled.toString());
    } catch (e) {
        console.error('Failed to set auto scaling setting', e);
    }
};

// Transcription Setting
const TRANSCRIPTION_ENABLED_KEY = 'vaulto_transcription_enabled';

export const getTranscriptionEnabled = async (): Promise<boolean> => {
    try {
        const value = await AsyncStorage.getItem(TRANSCRIPTION_ENABLED_KEY);
        // Default to true if not set
        return value === null ? true : value === 'true';
    } catch (e) {
        console.error('Failed to get transcription setting', e);
        return true;
    }
};

export const setTranscriptionEnabled = async (enabled: boolean): Promise<void> => {
    try {
        await AsyncStorage.setItem(TRANSCRIPTION_ENABLED_KEY, enabled.toString());
    } catch (e) {
        console.error('Failed to set transcription setting', e);
    }
};
