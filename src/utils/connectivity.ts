import NetInfo from '@react-native-community/netinfo';
import { API_URL } from './env';

const PROBE_TIMEOUT_MS = 3000;
const PROBE_TTL_MS = 10000;

let lastProbe: { at: number; reachable: boolean } | null = null;
let probeInFlight: Promise<boolean> | null = null;

const probeServer = async (): Promise<boolean> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
        const response = await fetch(`${API_URL}/health`, { method: 'GET', signal: controller.signal });
        return response.ok;
    } catch {
        return false;
    } finally {
        clearTimeout(timer);
    }
};

/** Our own server answers; remembered briefly, since every voice and AI step asks. */
const canReachServer = async (): Promise<boolean> => {
    if (lastProbe && Date.now() - lastProbe.at < PROBE_TTL_MS) return lastProbe.reachable;
    if (!probeInFlight) {
        probeInFlight = probeServer()
            .then((reachable) => {
                lastProbe = { at: Date.now(), reachable };
                return reachable;
            })
            .finally(() => {
                probeInFlight = null;
            });
    }
    return probeInFlight;
};

/**
 * True only when the device definitely has no internet. "Unknown" (null)
 * counts as online, so a slow probe never forces the offline path.
 * Android's own "no internet" verdict comes from a check against Google, which
 * some networks block while our server works: it is confirmed against our server.
 */
export const isDeviceOffline = async (): Promise<boolean> => {
    try {
        const state = await NetInfo.fetch();
        if (state.isConnected === false) return true;
        if (state.isInternetReachable !== false) return false;
        return !(await canReachServer());
    } catch {
        return false;
    }
};
