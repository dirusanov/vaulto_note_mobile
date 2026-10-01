import axios from 'axios';
import { AUTH_API_URL } from '../utils/env';
import { storage } from '../utils/storage';

/**
 * The one place that rotates the refresh token. Refresh tokens are single-use, so
 * the gateway client, the auth client and the transcription upload must share a
 * single in-flight refresh: two parallel refreshes with the same token make the
 * second one fail and sign the user out.
 */
export type RefreshResult =
    | { kind: 'success'; accessToken: string; refreshToken: string }
    | { kind: 'invalid_refresh' }
    | { kind: 'transient_failure' };

let inFlight: Promise<RefreshResult> | null = null;

const isInvalidRefreshStatus = (status?: number): boolean =>
    status === 400 || status === 401 || status === 403;

const attempt = async (): Promise<RefreshResult> => {
    const sentToken = await storage.getRefreshToken();
    if (!sentToken) {
        return { kind: 'invalid_refresh' };
    }
    try {
        const response = await axios.post(`${AUTH_API_URL}/auth/refresh`, { refresh_token: sentToken });
        const { access_token, refresh_token } = response.data ?? {};
        if (!access_token || !refresh_token) {
            return { kind: 'transient_failure' };
        }
        await storage.setToken(access_token);
        await storage.setRefreshToken(refresh_token);
        return { kind: 'success', accessToken: access_token, refreshToken: refresh_token };
    } catch (error) {
        if (axios.isAxiosError(error) && isInvalidRefreshStatus(error.response?.status)) {
            // Rejected — unless the stored token changed meanwhile (a sign-in or a
            // rotation finished elsewhere): then the session is fine, keep it.
            const storedToken = await storage.getRefreshToken();
            const storedAccess = await storage.getToken();
            if (storedToken && storedToken !== sentToken && storedAccess) {
                return { kind: 'success', accessToken: storedAccess, refreshToken: storedToken };
            }
            return { kind: 'invalid_refresh' };
        }
        // Offline, timeout, 5xx: never a reason to sign out.
        return { kind: 'transient_failure' };
    }
};

export const refreshSession = (): Promise<RefreshResult> => {
    if (!inFlight) {
        inFlight = attempt().finally(() => {
            inFlight = null;
        });
    }
    return inFlight;
};
