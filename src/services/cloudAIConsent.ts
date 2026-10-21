import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, AppState, Linking, Platform } from 'react-native';
import i18n from '../i18n';
import { API_URL } from '../utils/env';

const PREFIX = 'vaulto_cloud_ai_consent_v1:';
const pending = new Map<string, Promise<void>>();
let revision = 0;
let revocation: Promise<void> | null = null;

export class CloudAIConsentRequiredError extends Error {
    readonly code = 'CLOUD_AI_CONSENT_REQUIRED';
    constructor() {
        super(i18n.t('cloudAIConsent.required', { defaultValue: 'Cloud AI needs your permission. Your note is still saved.' }));
        this.name = 'CloudAIConsentRequiredError';
    }
}
export const isCloudAIConsentError = (error: unknown): boolean => {
    // Speech results carry a localized message across the retry queue boundary.
    if (typeof error === 'string') return error === new CloudAIConsentRequiredError().message;
    return !!error && typeof error === 'object' && 'code' in error && error.code === 'CLOUD_AI_CONSENT_REQUIRED';
};

export async function hasCloudAIConsent(): Promise<boolean> {
    if (revocation) await revocation;
    const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(PREFIX));
    if (!keys.length) return false;
    return (await AsyncStorage.multiGet(keys)).some(([, value]) => value === 'allowed');
}

export async function revokeCloudAIConsent(): Promise<void> {
    revision += 1;
    const task = (async () => {
        const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(PREFIX));
        if (keys.length) await AsyncStorage.multiRemove(keys);
    })();
    revocation = task;
    try { await task; } finally { if (revocation === task) revocation = null; }
}

/** Called at the upload boundary, including background retries and custom APIs. */
export async function requireCloudAIConsent(url: string = API_URL): Promise<void> {
    // The initial App Store release adds this permission to iOS. Other platforms
    // keep their existing flows; local processing never calls this boundary.
    if (Platform.OS !== 'ios') return;
    if (revocation) await revocation;
    const destination = new URL(url).origin;
    const key = PREFIX + encodeURIComponent(destination);
    if (await AsyncStorage.getItem(key) === 'allowed') return;
    const existing = pending.get(destination);
    if (existing) return existing;
    if (AppState.currentState !== 'active') throw new CloudAIConsentRequiredError();
    const startedAt = revision;
    const request = (async () => {
        const gateway = destination === new URL(API_URL).origin;
        const approved = await new Promise<boolean>((resolve) => {
            const body = gateway
                ? i18n.t('cloudAIConsent.gateway', { defaultValue: 'Your selected audio, note text and questions are sent to Vaulto and OpenAI to process your request. They receive readable content; encrypted sync is separate. Downloaded models process data on this device.' })
                : i18n.t('cloudAIConsent.custom', { host: destination, defaultValue: 'Your selected audio, note text and questions are sent to {{host}}, your chosen AI service. It receives readable content; encrypted sync is separate. Downloaded models process data on this device.' });
            Alert.alert(
                i18n.t('cloudAIConsent.title', { defaultValue: 'Use cloud AI?' }),
                body,
                [
                    { text: i18n.t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel', onPress: () => resolve(false) },
                    { text: i18n.t('auth.privacyPolicy', { defaultValue: 'Privacy Policy' }), onPress: () => {
                        void Linking.openURL('https://vaultonote.com/privacy').catch(() => {});
                        resolve(false);
                    } },
                    { text: i18n.t('cloudAIConsent.allow', { defaultValue: 'Allow cloud AI' }), onPress: () => resolve(true) },
                ],
                { cancelable: true, onDismiss: () => resolve(false) },
            );
        });
        if (!approved || startedAt !== revision) throw new CloudAIConsentRequiredError();
        await AsyncStorage.setItem(key, 'allowed');
        if (startedAt !== revision) {
            await AsyncStorage.removeItem(key);
            throw new CloudAIConsentRequiredError();
        }
    })();
    pending.set(destination, request);
    try { await request; }
    finally { if (pending.get(destination) === request) pending.delete(destination); }
}

export async function cloudAIFetch(url: string, init?: RequestInit): Promise<Response> {
    await requireCloudAIConsent(url);
    return fetch(url, init);
}
