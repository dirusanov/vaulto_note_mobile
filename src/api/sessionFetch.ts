import { refreshSession } from './tokenRefresh';
import { storage } from '../utils/storage';
import { onUnauthorized } from '../utils/authEvents';
import { createSessionFetch } from '../utils/sessionRetry';

type SessionListener = () => void;
const sessionExpiredListeners = new Set<SessionListener>();
let lastAnnouncedAt = 0;

/** Fires when a request found the session gone for good (the user must sign in again). */
export const onSessionExpired = (listener: SessionListener): (() => void) => {
    sessionExpiredListeners.add(listener);
    return () => { sessionExpiredListeners.delete(listener); };
};

const announceSessionExpired = async () => {
    const now = Date.now();
    // Parallel requests refused together are one event, not a stack of dialogs.
    if (now - lastAnnouncedAt < 3000) return;
    lastAnnouncedAt = now;
    await storage.removeToken();
    await storage.removeRefreshToken();
    onUnauthorized.emit();
    sessionExpiredListeners.forEach((listener) => {
        try { listener(); } catch (error) { console.warn('[sessionFetch] listener failed', error); }
    });
};

/**
 * fetch() to our own API (the AI endpoints) with the session handling of the
 * axios clients: an expired access token is renewed silently and the request
 * sent once more; a session that cannot be renewed throws SessionExpiredError.
 */
export const fetchWithSession = createSessionFetch<Response>({
    getToken: () => storage.getToken(),
    refresh: async () => {
        const result = await refreshSession();
        return result.kind === 'success'
            ? { kind: 'success', accessToken: result.accessToken }
            : result;
    },
    send: (url, init) => fetch(url, init),
    onExpired: announceSessionExpired,
});
