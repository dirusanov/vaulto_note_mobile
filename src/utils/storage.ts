import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { UserProfile } from '../api/auth';
import { KeyBundle } from '../crypto/e2ee';

// NOTE: Legacy provider "selfhosted" was removed. It is migrated to "openai".
export type AIProvider = 'secure_llm' | 'openai';
export type CryptoMode = 'local' | 'e2ee';
export type CustodyMode = 'standard' | 'strict_seed';
const TOKEN_KEY = 'vaulto_auth_token';
const REFRESH_TOKEN_KEY = 'vaulto_refresh_token';
const USER_ID_KEY = 'vaulto_user_id';
const USER_PROFILE_KEY = 'vaulto_user_profile';
const KEEP_LOCAL_NOTES_KEY = 'vaulto_keep_local_notes';
const OPENAI_API_KEY = 'vaulto_openai_api_key';
const PRIVACY_WARNING_DISMISSED_KEY = 'vaulto_privacy_warning_dismissed';
const MAX_RECORDING_DURATION_KEY = 'vaulto_max_recording_duration';
const AI_PROVIDER_KEY = 'vaulto_ai_provider';
const CRYPTO_MODE_KEY = 'vaulto_crypto_mode';
const SYNC_ENABLED_KEY = 'vaulto_sync_enabled';
const DEVICE_KEY_KEY = 'vaulto_device_key_v1';
const KEY_BUNDLE_PREFIX = 'vaulto_key_bundle_v1';
const MASTER_KEY_PREFIX = 'vaulto_master_key_v1';
const SYNC_RESET_BLOCK_PREFIX = 'vaulto_sync_reset_block_v1';
const CUSTODY_MODE_PREFIX = 'vaulto_custody_mode_v1';

// OpenAI-compatible settings (legacy self-hosted keys are read for migration).
const OPENAI_BASE_URL_KEY = 'vaulto_openai_base_url_v1';
const LEGACY_SELF_HOSTED_URL_KEY = 'vaulto_self_hosted_url';
const LEGACY_SELF_HOSTED_API_KEY = 'vaulto_self_hosted_api_key';
const LOCAL_ONLY_WARNING_DISMISSED_KEY = 'vaulto_local_only_warning_dismissed_v1';
const PRIVATE_AI_ALLOWED_KEY = 'vaulto_private_ai_allowed_v1';
// NOTE: legacy App Lock keys may still exist on user devices, but the feature was removed.

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
    getKeepLocalNotes: async (): Promise<boolean> => {
        try {
            const value = await AsyncStorage.getItem(KEEP_LOCAL_NOTES_KEY);
            return value === 'true';
        } catch (e) {
            console.error('Failed to get keep local notes flag', e);
            return false;
        }
    },
    setKeepLocalNotes: async (keep: boolean): Promise<void> => {
        try {
            await AsyncStorage.setItem(KEEP_LOCAL_NOTES_KEY, keep.toString());
        } catch (e) {
            console.error('Failed to set keep local notes flag', e);
        }
    },
    getCryptoMode: async (): Promise<CryptoMode> => {
        try {
            const value = await AsyncStorage.getItem(CRYPTO_MODE_KEY);
            return value === 'e2ee' ? 'e2ee' : 'local';
        } catch (e) {
            console.error('Failed to get crypto mode', e);
            return 'local';
        }
    },
    setCryptoMode: async (mode: CryptoMode): Promise<void> => {
        try {
            await AsyncStorage.setItem(CRYPTO_MODE_KEY, mode);
        } catch (e) {
            console.error('Failed to set crypto mode', e);
        }
    },
    getSyncEnabled: async (): Promise<boolean> => {
        try {
            const value = await AsyncStorage.getItem(SYNC_ENABLED_KEY);
            return value === 'true';
        } catch (e) {
            console.error('Failed to get sync enabled flag', e);
            return false;
        }
    },
    setSyncEnabled: async (enabled: boolean): Promise<void> => {
        try {
            await AsyncStorage.setItem(SYNC_ENABLED_KEY, enabled.toString());
        } catch (e) {
            console.error('Failed to set sync enabled flag', e);
        }
    },
    getDeviceKey: async (): Promise<string | null> => {
        try {
            return await secureGet(DEVICE_KEY_KEY);
        } catch (e) {
            console.error('Failed to get device key', e);
            return null;
        }
    },
    setDeviceKey: async (hexKey: string): Promise<void> => {
        try {
            await secureSet(DEVICE_KEY_KEY, hexKey);
        } catch (e) {
            console.error('Failed to set device key', e);
        }
    },
    getKeyBundle: async (userId: string): Promise<KeyBundle | null> => {
        if (!userId) return null;
        try {
            const raw = await secureGet(`${KEY_BUNDLE_PREFIX}_${userId}`);
            return raw ? (JSON.parse(raw) as KeyBundle) : null;
        } catch (e) {
            console.error('Failed to get key bundle', e);
            return null;
        }
    },
    getStoredMasterKey: async (userId: string): Promise<string | null> => {
        if (!userId) return null;
        try {
            return await secureGet(`${MASTER_KEY_PREFIX}_${userId}`);
        } catch (e) {
            console.error('Failed to get master key', e);
            return null;
        }
    },
    setStoredMasterKey: async (userId: string, wrappedKey: string): Promise<void> => {
        if (!userId) return;
        try {
            await secureSet(`${MASTER_KEY_PREFIX}_${userId}`, wrappedKey);
        } catch (e) {
            console.error('Failed to set master key', e);
        }
    },
    removeStoredMasterKey: async (userId: string): Promise<void> => {
        if (!userId) return;
        try {
            await secureDelete(`${MASTER_KEY_PREFIX}_${userId}`);
        } catch (e) {
            console.error('Failed to remove master key', e);
        }
    },
    setKeyBundle: async (userId: string, bundle: KeyBundle): Promise<void> => {
        if (!userId) return;
        try {
            await secureSet(`${KEY_BUNDLE_PREFIX}_${userId}`, JSON.stringify(bundle));
        } catch (e) {
            console.error('Failed to set key bundle', e);
        }
    },
    removeKeyBundle: async (userId: string): Promise<void> => {
        if (!userId) return;
        try {
            await secureDelete(`${KEY_BUNDLE_PREFIX}_${userId}`);
        } catch (e) {
            console.error('Failed to remove key bundle', e);
        }
    },
    getSyncResetBlocked: async (userId: string): Promise<boolean> => {
        if (!userId) return false;
        try {
            const value = await secureGet(`${SYNC_RESET_BLOCK_PREFIX}_${userId}`);
            return value === '1';
        } catch (e) {
            console.error('Failed to get sync reset block flag', e);
            return false;
        }
    },
    setSyncResetBlocked: async (userId: string): Promise<void> => {
        if (!userId) return;
        try {
            await secureSet(`${SYNC_RESET_BLOCK_PREFIX}_${userId}`, '1');
        } catch (e) {
            console.error('Failed to set sync reset block flag', e);
        }
    },
    clearSyncResetBlocked: async (userId: string): Promise<void> => {
        if (!userId) return;
        try {
            await secureDelete(`${SYNC_RESET_BLOCK_PREFIX}_${userId}`);
        } catch (e) {
            console.error('Failed to clear sync reset block flag', e);
        }
    },
    getCustodyMode: async (userId: string): Promise<CustodyMode | null> => {
        if (!userId) return null;
        try {
            const value = await secureGet(`${CUSTODY_MODE_PREFIX}_${userId}`);
            if (value === 'strict_seed' || value === 'standard') {
                return value;
            }
            return null;
        } catch (e) {
            console.error('Failed to get custody mode', e);
            return null;
        }
    },
    setCustodyMode: async (userId: string, mode: CustodyMode): Promise<void> => {
        if (!userId) return;
        try {
            await secureSet(`${CUSTODY_MODE_PREFIX}_${userId}`, mode);
        } catch (e) {
            console.error('Failed to set custody mode', e);
        }
    },
    removeCustodyMode: async (userId: string): Promise<void> => {
        if (!userId) return;
        try {
            await secureDelete(`${CUSTODY_MODE_PREFIX}_${userId}`);
        } catch (e) {
            console.error('Failed to remove custody mode', e);
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

export const getOpenAIBaseUrl = async (): Promise<string | null> => {
    try {
        const value = await AsyncStorage.getItem(OPENAI_BASE_URL_KEY);
        if (value) return value;
        // Backward-compat: previously stored as "self-hosted url".
        return await AsyncStorage.getItem(LEGACY_SELF_HOSTED_URL_KEY);
    } catch (e) {
        console.error('Failed to get OpenAI base URL', e);
        return null;
    }
};

export const setOpenAIBaseUrl = async (baseUrl: string): Promise<void> => {
    try {
        await AsyncStorage.setItem(OPENAI_BASE_URL_KEY, baseUrl);
    } catch (e) {
        console.error('Failed to set OpenAI base URL', e);
    }
};

// AI Provider
export const getAIProvider = async (): Promise<AIProvider> => {
    try {
        const value = await AsyncStorage.getItem(AI_PROVIDER_KEY);
        if (value === 'openai' || value === 'secure_llm') return value;
        if (value === 'selfhosted') {
            // Migrate legacy self-hosted to OpenAI-compatible.
            await AsyncStorage.setItem(AI_PROVIDER_KEY, 'openai');
            return 'openai';
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

// Legacy Self-Hosted Backend Settings (kept for reading during migration).
export const getLegacySelfHostedUrl = async (): Promise<string | null> => {
    try {
        return await AsyncStorage.getItem(LEGACY_SELF_HOSTED_URL_KEY);
    } catch (e) {
        console.error('Failed to get legacy self-hosted URL', e);
        return null;
    }
};

export const getLegacySelfHostedApiKey = async (): Promise<string | null> => {
    try {
        return await secureGet(LEGACY_SELF_HOSTED_API_KEY);
    } catch (e) {
        console.error('Failed to get legacy self-hosted API key', e);
        return null;
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

export const getLocalOnlyWarningDismissed = async (): Promise<boolean> => {
    try {
        const value = await AsyncStorage.getItem(LOCAL_ONLY_WARNING_DISMISSED_KEY);
        return value === 'true';
    } catch (e) {
        console.error('Failed to get local-only warning state', e);
        return false;
    }
};

export const setLocalOnlyWarningDismissed = async (dismissed: boolean): Promise<void> => {
    try {
        await AsyncStorage.setItem(LOCAL_ONLY_WARNING_DISMISSED_KEY, dismissed.toString());
    } catch (e) {
        console.error('Failed to set local-only warning state', e);
    }
};

export const getPrivateAIAllowed = async (): Promise<boolean> => {
    try {
        const value = await AsyncStorage.getItem(PRIVATE_AI_ALLOWED_KEY);
        return value === 'true';
    } catch (e) {
        console.error('Failed to get private AI setting', e);
        return false;
    }
};

export const setPrivateAIAllowed = async (enabled: boolean): Promise<void> => {
    try {
        await AsyncStorage.setItem(PRIVATE_AI_ALLOWED_KEY, enabled.toString());
    } catch (e) {
        console.error('Failed to set private AI setting', e);
    }
};
