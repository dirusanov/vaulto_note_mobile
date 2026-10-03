import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { UserProfile } from '../api/auth';
import { KeyBundle } from '../crypto/e2ee';
import { CUSTOM_AI_ENABLED, isLocalAIProvider, LOCAL_MODELS_ENABLED } from './featureFlags';
import { DEFAULT_OPENAI_CHAT_MODEL } from './openaiCompat';

// NOTE: Legacy provider "selfhosted" was removed. It is migrated to "openai".
export type AIProvider = 'vaulto_ai' | 'openai' | 'local_whisper' | 'local_llm' | 'local';
export type CryptoMode = 'local' | 'e2ee';
export type EncryptionMigrationState = 'local' | 'sync';
export type TranscriptionLanguage = string;
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
const SYNC_LOCK_BANNER_DISMISS_PREFIX = 'vaulto_sync_lock_banner_dismissed_v1';
const ENCRYPTION_MIGRATION_PREFIX = 'vaulto_encryption_migration_v1';
// Last known server-authoritative encryption key epoch (per user).
const KEY_EPOCH_PREFIX = 'vaulto_key_epoch_v1';
// Destructive encrypted-vault generation. This changes only after a global
// reset and is sent with every write so stale devices cannot resurrect data.
const VAULT_GENERATION_PREFIX = 'vaulto_vault_generation_v1';
// The device retained readable notes from a remotely reset vault. Those notes
// are isolated as local-only until the user chooses how to recover them.
const RESET_RECOVERY_PENDING_PREFIX = 'vaulto_reset_recovery_pending_v1';
// The account was safely converted to standard sync elsewhere, but this
// device still needs the old passphrase to rewrap its local-only ciphertext.
const REMOTE_DISABLE_RESCUE_PENDING_PREFIX = 'vaulto_remote_disable_rescue_pending_v1';
// Durable client-side journal for a destructive reset. The marker is written
// before the network request and cleared only after local purge/key cleanup,
// closing app-kill windows where old dirty notes could otherwise be uploaded
// under the newly returned vault generation.
const DESTRUCTIVE_RESET_MARKER_PREFIX = 'vaulto_destructive_reset_marker_v1';
const ENCRYPTION_TRANSITION_TOKEN_PREFIX = 'vaulto_encryption_transition_token_v1';
const ENCRYPTION_TRANSITION_KIND_PREFIX = 'vaulto_encryption_transition_kind_v1';
export type EncryptionTransitionKind = 'enable' | 'disable';

export type DestructiveResetMarker = {
    expectedVaultGeneration: number;
    previousSyncEnabled: boolean;
};

// OpenAI-compatible settings (legacy self-hosted keys are read for migration).
const OPENAI_BASE_URL_KEY = 'vaulto_openai_base_url_v1';
const LEGACY_SELF_HOSTED_URL_KEY = 'vaulto_self_hosted_url';
const OPENAI_MODEL_KEY = 'vaulto_openai_model_v1';
const LEGACY_SELF_HOSTED_API_KEY = 'vaulto_self_hosted_api_key';
const LOCAL_ONLY_WARNING_DISMISSED_KEY = 'vaulto_local_only_warning_dismissed_v1';
const PRIVATE_AI_ALLOWED_KEY = 'vaulto_private_ai_allowed_v1';
const LOCAL_WHISPER_MODEL_KEY = 'vaulto_local_whisper_model_v1';
const TRANSCRIPTION_LANGUAGE_KEY = 'vaulto_transcription_language_v1';
const LOCAL_LLM_MODEL_KEY = 'vaulto_local_llm_model_v1';
const VERSION_SWIPE_HINT_SEEN_KEY = 'vaulto_version_swipe_hint_seen_v1';
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
    getCryptoMode: async (userId?: string | null): Promise<CryptoMode> => {
        try {
            if (!userId) {
                const value = await AsyncStorage.getItem(CRYPTO_MODE_KEY);
                return value === 'e2ee' ? 'e2ee' : 'local';
            }
            const key = `${CRYPTO_MODE_KEY}_${userId}`;
            const value = await AsyncStorage.getItem(key);
            return value === 'e2ee' ? 'e2ee' : 'local';
        } catch (e) {
            console.error('Failed to get crypto mode', e);
            return 'local';
        }
    },
    setCryptoMode: async (mode: CryptoMode, userId?: string | null): Promise<void> => {
        try {
            const key = userId ? `${CRYPTO_MODE_KEY}_${userId}` : CRYPTO_MODE_KEY;
            await AsyncStorage.setItem(key, mode);
        } catch (e) {
            console.error('Failed to set crypto mode', e);
        }
    },
    getSyncEnabled: async (userId?: string | null): Promise<boolean | null> => {
        try {
            if (!userId) {
                const value = await AsyncStorage.getItem(SYNC_ENABLED_KEY);
                return value !== null ? value === 'true' : null;
            }
            const key = `${SYNC_ENABLED_KEY}_${userId}`;
            const value = await AsyncStorage.getItem(key);
            return value !== null ? value === 'true' : null;
        } catch (e) {
            console.error('Failed to get sync enabled flag', e);
            return null;
        }
    },
    setSyncEnabled: async (enabled: boolean, userId?: string | null): Promise<void> => {
        try {
            const key = userId ? `${SYNC_ENABLED_KEY}_${userId}` : SYNC_ENABLED_KEY;
            await AsyncStorage.setItem(key, enabled ? 'true' : 'false');
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
    getEncryptionMigrationState: async (userId: string): Promise<EncryptionMigrationState | null> => {
        if (!userId) return null;
        try {
            const value = await AsyncStorage.getItem(`${ENCRYPTION_MIGRATION_PREFIX}_${userId}`);
            return value === 'local' || value === 'sync' ? value : null;
        } catch (e) {
            console.error('Failed to get encryption migration state', e);
            return null;
        }
    },
    setEncryptionMigrationState: async (userId: string, state: EncryptionMigrationState): Promise<void> => {
        if (!userId) return;
        try {
            await AsyncStorage.setItem(`${ENCRYPTION_MIGRATION_PREFIX}_${userId}`, state);
        } catch (e) {
            console.error('Failed to set encryption migration state', e);
        }
    },
    clearEncryptionMigrationState: async (userId: string): Promise<void> => {
        if (!userId) return;
        try {
            await AsyncStorage.removeItem(`${ENCRYPTION_MIGRATION_PREFIX}_${userId}`);
        } catch (e) {
            console.error('Failed to clear encryption migration state', e);
        }
    },
    getKeyEpoch: async (userId?: string | null): Promise<number> => {
        if (!userId) return 0;
        try {
            const value = await AsyncStorage.getItem(`${KEY_EPOCH_PREFIX}_${userId}`);
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : 0;
        } catch (e) {
            return 0;
        }
    },
    setKeyEpoch: async (userId: string | null | undefined, epoch: number): Promise<void> => {
        if (!userId) return;
        try {
            await AsyncStorage.setItem(`${KEY_EPOCH_PREFIX}_${userId}`, String(epoch));
        } catch (e) {
            console.error('Failed to set key epoch', e);
        }
    },
    getVaultGeneration: async (userId?: string | null): Promise<number> => {
        if (!userId) return 0;
        try {
            const value = await AsyncStorage.getItem(`${VAULT_GENERATION_PREFIX}_${userId}`);
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : 0;
        } catch (e) {
            return 0;
        }
    },
    setVaultGeneration: async (userId: string | null | undefined, generation: number): Promise<void> => {
        if (!userId) return;
        try {
            await AsyncStorage.setItem(
                `${VAULT_GENERATION_PREFIX}_${userId}`,
                String(Math.max(0, generation)),
            );
        } catch (e) {
            console.error('Failed to set vault generation', e);
        }
    },
    getResetRecoveryPending: async (userId: string): Promise<boolean> => {
        if (!userId) return false;
        try {
            return await AsyncStorage.getItem(
                `${RESET_RECOVERY_PENDING_PREFIX}_${userId}`,
            ) === '1';
        } catch (e) {
            return false;
        }
    },
    setResetRecoveryPending: async (userId: string, pending: boolean): Promise<void> => {
        if (!userId) return;
        const key = `${RESET_RECOVERY_PENDING_PREFIX}_${userId}`;
        try {
            if (pending) {
                await AsyncStorage.setItem(key, '1');
            } else {
                await AsyncStorage.removeItem(key);
            }
        } catch (e) {
            console.error('Failed to set reset recovery state', e);
        }
    },
    // The user turned end-to-end encryption off (or reset it): do not set it up
    // again automatically.
    getAutoEncryptionOptOut: async (userId: string): Promise<boolean> => {
        if (!userId) return true;
        return await AsyncStorage.getItem(`vaulto_auto_e2ee_opt_out_${userId}`) === '1';
    },
    setAutoEncryptionOptOut: async (userId: string, optOut: boolean): Promise<void> => {
        if (!userId) return;
        const key = `vaulto_auto_e2ee_opt_out_${userId}`;
        if (optOut) await AsyncStorage.setItem(key, '1');
        else await AsyncStorage.removeItem(key);
    },
    // The user confirmed they saved the recovery key shown after automatic setup.
    getRecoveryKeySaved: async (userId: string): Promise<boolean> => {
        if (!userId) return true;
        return await AsyncStorage.getItem(`vaulto_recovery_key_saved_${userId}`) === '1';
    },
    setRecoveryKeySaved: async (userId: string, saved: boolean): Promise<void> => {
        if (!userId) return;
        const key = `vaulto_recovery_key_saved_${userId}`;
        if (saved) await AsyncStorage.setItem(key, '1');
        else await AsyncStorage.removeItem(key);
    },
    getRemoteDisableRescuePending: async (userId: string): Promise<boolean> => {
        if (!userId) return false;
        return await AsyncStorage.getItem(
            `${REMOTE_DISABLE_RESCUE_PENDING_PREFIX}_${userId}`,
        ) === '1';
    },
    setRemoteDisableRescuePending: async (
        userId: string,
        pending: boolean,
    ): Promise<void> => {
        if (!userId) return;
        const key = `${REMOTE_DISABLE_RESCUE_PENDING_PREFIX}_${userId}`;
        if (pending) await AsyncStorage.setItem(key, '1');
        else await AsyncStorage.removeItem(key);
    },
    getDestructiveResetMarker: async (userId: string): Promise<DestructiveResetMarker | null> => {
        if (!userId) return null;
        try {
            const raw = await AsyncStorage.getItem(
                `${DESTRUCTIVE_RESET_MARKER_PREFIX}_${userId}`,
            );
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            const expectedVaultGeneration = Number(parsed?.expectedVaultGeneration);
            if (!Number.isFinite(expectedVaultGeneration) || expectedVaultGeneration < 0) {
                return null;
            }
            return {
                expectedVaultGeneration,
                previousSyncEnabled: parsed?.previousSyncEnabled !== false,
            };
        } catch (e) {
            console.error('Failed to read destructive reset marker', e);
            return null;
        }
    },
    setDestructiveResetMarker: async (
        userId: string,
        marker: DestructiveResetMarker,
    ): Promise<void> => {
        if (!userId) return;
        await AsyncStorage.setItem(
            `${DESTRUCTIVE_RESET_MARKER_PREFIX}_${userId}`,
            JSON.stringify({
                expectedVaultGeneration: Math.max(0, marker.expectedVaultGeneration),
                previousSyncEnabled: marker.previousSyncEnabled,
            }),
        );
    },
    clearDestructiveResetMarker: async (userId: string): Promise<void> => {
        if (!userId) return;
        await AsyncStorage.removeItem(`${DESTRUCTIVE_RESET_MARKER_PREFIX}_${userId}`);
    },
    getEncryptionTransitionToken: async (userId: string): Promise<string | null> => {
        if (!userId) return null;
        return await AsyncStorage.getItem(`${ENCRYPTION_TRANSITION_TOKEN_PREFIX}_${userId}`);
    },
    setEncryptionTransitionToken: async (userId: string, token: string): Promise<void> => {
        if (!userId) return;
        await AsyncStorage.setItem(`${ENCRYPTION_TRANSITION_TOKEN_PREFIX}_${userId}`, token);
    },
    getEncryptionTransitionKind: async (userId: string): Promise<EncryptionTransitionKind | null> => {
        if (!userId) return null;
        const value = await AsyncStorage.getItem(`${ENCRYPTION_TRANSITION_KIND_PREFIX}_${userId}`);
        return value === 'enable' || value === 'disable' ? value : null;
    },
    setEncryptionTransitionKind: async (
        userId: string,
        kind: EncryptionTransitionKind,
    ): Promise<void> => {
        if (!userId) return;
        await AsyncStorage.setItem(`${ENCRYPTION_TRANSITION_KIND_PREFIX}_${userId}`, kind);
    },
    clearEncryptionTransitionToken: async (userId: string): Promise<void> => {
        if (!userId) return;
        await AsyncStorage.removeItem(`${ENCRYPTION_TRANSITION_TOKEN_PREFIX}_${userId}`);
        await AsyncStorage.removeItem(`${ENCRYPTION_TRANSITION_KIND_PREFIX}_${userId}`);
    },
    getBiometricsEnabled: async (userId: string): Promise<boolean> => {
        if (!userId) return false;
        try {
            const value = await secureGet(`vaulto_biometrics_enabled_${userId}`);
            return value === 'true';
        } catch (e) {
            return false;
        }
    },
    setBiometricsEnabled: async (userId: string, enabled: boolean): Promise<void> => {
        if (!userId) return;
        try {
            await secureSet(`vaulto_biometrics_enabled_${userId}`, enabled ? 'true' : 'false');
        } catch (e) {
            console.error('Failed to set biometrics flag', e);
        }
    },
    getEncryptionWarningAccepted: async (): Promise<boolean> => {
        try {
            const value = await AsyncStorage.getItem('encryption_warning_accepted');
            return value === 'true';
        } catch (e) {
            return false;
        }
    },
    setEncryptionWarningAccepted: async (accepted: boolean): Promise<void> => {
        try {
            await AsyncStorage.setItem('encryption_warning_accepted', accepted ? 'true' : 'false');
        } catch (e) {
            console.error('Failed to set encryption warning accepted flag', e);
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

export const getOpenAIModel = async (): Promise<string> => {
    try {
        const value = await AsyncStorage.getItem(OPENAI_MODEL_KEY);
        return (value || '').trim() || DEFAULT_OPENAI_CHAT_MODEL;
    } catch (e) {
        console.error('Failed to get OpenAI model', e);
        return DEFAULT_OPENAI_CHAT_MODEL;
    }
};

export const setOpenAIModel = async (model: string): Promise<void> => {
    try {
        await AsyncStorage.setItem(OPENAI_MODEL_KEY, model.trim());
    } catch (e) {
        console.error('Failed to set OpenAI model', e);
    }
};

// AI Provider
export const getAIProvider = async (): Promise<AIProvider> => {
    try {
        const value = await AsyncStorage.getItem(AI_PROVIDER_KEY);
        if (value === 'openai' && !CUSTOM_AI_ENABLED) {
            // Custom AI is hidden: a stored choice falls back to Vaulto AI.
            await AsyncStorage.setItem(AI_PROVIDER_KEY, 'vaulto_ai');
            return 'vaulto_ai';
        }
        if (value === 'openai' || value === 'vaulto_ai') {
            return value;
        }

        if (value === 'local_whisper' || value === 'local_llm') {
            const migratedProvider: AIProvider = LOCAL_MODELS_ENABLED ? 'local' : 'vaulto_ai';
            await AsyncStorage.setItem(AI_PROVIDER_KEY, migratedProvider);
            return migratedProvider;
        }

        if (value === 'local') {
            if (!LOCAL_MODELS_ENABLED) {
                await AsyncStorage.setItem(AI_PROVIDER_KEY, 'vaulto_ai');
                return 'vaulto_ai';
            }
            return 'local';
        }

        if (value === 'secure_llm') {
            await AsyncStorage.setItem(AI_PROVIDER_KEY, 'vaulto_ai');
            return 'vaulto_ai';
        }
        if (value === 'selfhosted') {
            // Migrate legacy self-hosted to OpenAI-compatible (Vaulto AI while Custom AI is hidden).
            const migrated: AIProvider = CUSTOM_AI_ENABLED ? 'openai' : 'vaulto_ai';
            await AsyncStorage.setItem(AI_PROVIDER_KEY, migrated);
            return migrated;
        }
        // Fallback or migration: mapping 'local' to 'vaulto_ai' logic could go here, but for now default to 'vaulto_ai'
        return 'vaulto_ai';
    } catch (e) {
        console.error('Failed to get AI provider', e);
        return 'vaulto_ai';
    }
};

export const setAIProvider = async (provider: AIProvider): Promise<void> => {
    try {
        const providerToStore: AIProvider =
            (!LOCAL_MODELS_ENABLED && isLocalAIProvider(provider)) || (!CUSTOM_AI_ENABLED && provider === 'openai')
                ? 'vaulto_ai'
                : provider;
        await AsyncStorage.setItem(AI_PROVIDER_KEY, providerToStore);
    } catch (e) {
        console.error('Failed to set AI provider', e);
    }
};

export const getLocalWhisperModelKey = async (): Promise<string> => {
    try {
        return (await AsyncStorage.getItem(LOCAL_WHISPER_MODEL_KEY)) || 'tiny';
    } catch (e) {
        console.error('Failed to get local Whisper model key', e);
        return 'tiny';
    }
};

export const setLocalWhisperModelKey = async (modelKey: string): Promise<void> => {
    try {
        await AsyncStorage.setItem(LOCAL_WHISPER_MODEL_KEY, modelKey);
    } catch (e) {
        console.error('Failed to set local Whisper model key', e);
    }
};

export const getLocalLLMModelKey = async (): Promise<string> => {
    try {
        // Empty: the LLM service picks a model that suits the device's memory.
        return (await AsyncStorage.getItem(LOCAL_LLM_MODEL_KEY)) || '';
    } catch (e) {
        console.error('Failed to get local LLM model key', e);
        return '';
    }
};

export const setLocalLLMModelKey = async (modelKey: string): Promise<void> => {
    try {
        await AsyncStorage.setItem(LOCAL_LLM_MODEL_KEY, modelKey);
    } catch (e) {
        console.error('Failed to set local LLM model key', e);
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

// Before 1.0.78 choosing Custom AI or on-device AI silently stored "agent off"
// (it was meant as "unavailable"), so the agent stayed off after switching back.
// That stored value is reset once to the default; real choices are kept after.
const AGENT_MODE_RESET_KEY = 'vaulto_agent_mode_reset_v2';

export const getAgentModeEnabled = async (): Promise<boolean> => {
    try {
        if ((await AsyncStorage.getItem(AGENT_MODE_RESET_KEY)) !== 'done') {
            await AsyncStorage.multiSet([[AGENT_MODE_RESET_KEY, 'done'], [AGENT_MODE_KEY, 'true']]);
            return true;
        }
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
const NOTE_CHECKLIST_SCALE_LOCKS_KEY = 'vaulto_note_checklist_scale_locks_v1';

const sanitizeChecklistScaleLocks = (raw: unknown): Record<string, number> => {
    if (!raw || typeof raw !== 'object') {
        return {};
    }

    return Object.entries(raw as Record<string, unknown>).reduce<Record<string, number>>((acc, [key, value]) => {
        if (!key) {
            return acc;
        }

        const parsed = typeof value === 'number' ? value : Number(value);
        if (Number.isFinite(parsed) && parsed > 0) {
            acc[key] = parsed;
        }
        return acc;
    }, {});
};

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

export const getChecklistScaleLocks = async (): Promise<Record<string, number>> => {
    try {
        const value = await AsyncStorage.getItem(NOTE_CHECKLIST_SCALE_LOCKS_KEY);
        if (!value) {
            return {};
        }

        return sanitizeChecklistScaleLocks(JSON.parse(value));
    } catch (e) {
        console.error('Failed to get checklist scale locks', e);
        return {};
    }
};

export const setChecklistScaleLock = async (variantId: string, scaleFactor: number): Promise<void> => {
    if (!variantId || !Number.isFinite(scaleFactor) || scaleFactor <= 0) {
        return;
    }

    try {
        const current = await getChecklistScaleLocks();
        if (current[variantId] === scaleFactor) {
            return;
        }

        await AsyncStorage.setItem(
            NOTE_CHECKLIST_SCALE_LOCKS_KEY,
            JSON.stringify({
                ...current,
                [variantId]: scaleFactor,
            })
        );
    } catch (e) {
        console.error('Failed to set checklist scale lock', e);
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

const ON_DEVICE_TRANSCRIPTION_KEY = 'vaulto_on_device_transcription';

/** Transcribe recordings with the downloaded Whisper model instead of the cloud. */
export const getOnDeviceTranscription = async (): Promise<boolean> => {
    try {
        return (await AsyncStorage.getItem(ON_DEVICE_TRANSCRIPTION_KEY)) === 'true';
    } catch {
        return false;
    }
};

export const setOnDeviceTranscription = async (enabled: boolean): Promise<void> => {
    try {
        await AsyncStorage.setItem(ON_DEVICE_TRANSCRIPTION_KEY, enabled ? 'true' : 'false');
    } catch (e) {
        console.error('Failed to save on-device transcription setting', e);
    }
};

const ON_DEVICE_OFFER_SHOWN_KEY = 'vaulto_on_device_offer_shown_v1';
const RECORDINGS_COUNT_KEY = 'vaulto_recordings_count_v1';

const OFFLINE_OFFER_SHOWN_KEY = 'vaulto_offline_offer_shown_v1';

type OnDeviceOfferKind = 'suggest' | 'offline';
const offerShownKey = (kind: OnDeviceOfferKind) => (kind === 'offline' ? OFFLINE_OFFER_SHOWN_KEY : ON_DEVICE_OFFER_SHOWN_KEY);

/**
 * One-time on-device suggestions: "transcribe free on the phone" after a few
 * cloud recordings, and "work offline" after a recording made without internet.
 */
export const getOnDeviceOfferShown = async (kind: OnDeviceOfferKind = 'suggest'): Promise<boolean> => {
    try {
        return (await AsyncStorage.getItem(offerShownKey(kind))) === 'true';
    } catch {
        return true;
    }
};

export const setOnDeviceOfferShown = async (kind: OnDeviceOfferKind = 'suggest'): Promise<void> => {
    try {
        await AsyncStorage.setItem(offerShownKey(kind), 'true');
    } catch {
        // best effort
    }
};

/** Counts finished recordings; returns the new total. */
export const incrementRecordingsCount = async (): Promise<number> => {
    try {
        const next = (Number(await AsyncStorage.getItem(RECORDINGS_COUNT_KEY)) || 0) + 1;
        await AsyncStorage.setItem(RECORDINGS_COUNT_KEY, String(next));
        return next;
    } catch {
        return 0;
    }
};

export const getTranscriptionLanguage = async (): Promise<TranscriptionLanguage> => {
    try {
        const value = await AsyncStorage.getItem(TRANSCRIPTION_LANGUAGE_KEY);
        if (value) {
            return value;
        }
        return 'auto';
    } catch (e) {
        console.error('Failed to get transcription language setting', e);
        return 'auto';
    }
};

export const setTranscriptionLanguage = async (language: TranscriptionLanguage): Promise<void> => {
    try {
        await AsyncStorage.setItem(TRANSCRIPTION_LANGUAGE_KEY, language);
    } catch (e) {
        console.error('Failed to set transcription language setting', e);
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

export const getSyncLockBannerDismissed = async (userId: string): Promise<boolean> => {
    if (!userId) return false;
    try {
        const value = await AsyncStorage.getItem(`${SYNC_LOCK_BANNER_DISMISS_PREFIX}_${userId}`);
        return value === '1';
    } catch (e) {
        console.error('Failed to get sync lock banner dismissed state', e);
        return false;
    }
};

export const setSyncLockBannerDismissed = async (userId: string): Promise<void> => {
    if (!userId) return;
    try {
        await AsyncStorage.setItem(`${SYNC_LOCK_BANNER_DISMISS_PREFIX}_${userId}`, '1');
    } catch (e) {
        console.error('Failed to set sync lock banner dismissed state', e);
    }
};

export const clearSyncLockBannerDismissed = async (userId: string): Promise<void> => {
    if (!userId) return;
    try {
        await AsyncStorage.removeItem(`${SYNC_LOCK_BANNER_DISMISS_PREFIX}_${userId}`);
    } catch (e) {
        console.error('Failed to clear sync lock banner dismissed state', e);
    }
};

// ---------------------------------------------------------------------------
// Pending Decrypt Sync — tracks whether a DISABLE E2EE migration sync is
// still pending (e.g. failed due to no network). On next network restore the
// SyncService will automatically complete the push.
// ---------------------------------------------------------------------------
const PENDING_DECRYPT_SYNC_PREFIX = 'vaulto_pending_decrypt_sync_v1';

export const setPendingDecryptSync = async (userId: string): Promise<void> => {
    if (!userId) return;
    try {
        await AsyncStorage.setItem(`${PENDING_DECRYPT_SYNC_PREFIX}_${userId}`, '1');
    } catch (e) {
        console.error('Failed to set pending decrypt sync flag', e);
    }
};

export const clearPendingDecryptSync = async (userId: string): Promise<void> => {
    if (!userId) return;
    try {
        await AsyncStorage.removeItem(`${PENDING_DECRYPT_SYNC_PREFIX}_${userId}`);
    } catch (e) {
        console.error('Failed to clear pending decrypt sync flag', e);
    }
};

export const hasPendingDecryptSync = async (userId: string): Promise<boolean> => {
    if (!userId) return false;
    try {
        const val = await AsyncStorage.getItem(`${PENDING_DECRYPT_SYNC_PREFIX}_${userId}`);
        return val === '1';
    } catch (e) {
        return false;
    }
};


/** One-time "swipe the text to switch versions" hint. */
export const getVersionSwipeHintSeen = async (): Promise<boolean> => {
    try {
        return (await AsyncStorage.getItem(VERSION_SWIPE_HINT_SEEN_KEY)) === '1';
    } catch {
        return true;
    }
};

export const setVersionSwipeHintSeen = async (): Promise<void> => {
    try {
        await AsyncStorage.setItem(VERSION_SWIPE_HINT_SEEN_KEY, '1');
    } catch {
        // Not worth surfacing: the hint may simply show once more.
    }
};
