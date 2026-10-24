/**
 * Pure helpers for the Play Integrity check of a new guest session (no native
 * imports, so they run under node tests). The native part lives in
 * src/services/guestAttestation.ts.
 *
 * Protocol (gateway app/application/services/guest_integrity.py): the gateway
 * answers POST /auth/anonymous for an unknown device with 428
 * `integrity_required` and a challenge; the app asks Google Play for a token
 * whose requestHash is `guestRequestHash(...)` and repeats the request.
 */
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

export interface IntegrityChallenge {
    challenge: string;
    cloudProjectNumber: string | null;
}

/** Extra fields for the repeated /auth/anonymous request. */
export interface GuestAttestationFields {
    integrity_capable: true;
    integrity_challenge: string;
    integrity_token?: string;
    integrity_error?: string;
    install_id?: string;
}

export const sha256Hex = (value: string): string => bytesToHex(sha256(utf8ToBytes(value)));

/** Must match `request_hash` on the gateway exactly. */
export const guestRequestHash = (challenge: string, deviceKey: string, installId?: string | null): string =>
    sha256Hex(`vaulto-guest-v1|${challenge}|${deviceKey}|${installId ?? ''}`);

/** A per-device, per-app value derived from the Android ID; the raw ID never leaves the phone. */
export const installIdFromAndroidId = (androidId: string | null | undefined): string | undefined => {
    const value = (androidId ?? '').trim();
    return value ? sha256Hex(`vaulto-ssaid|${value}`) : undefined;
};

/** The challenge of a 428 `integrity_required` axios error, or null for any other error. */
export const integrityChallengeOf = (error: unknown): IntegrityChallenge | null => {
    const response = (error as { response?: { status?: number; data?: unknown } } | null)?.response;
    if (!response || response.status !== 428) return null;
    const data = response.data as { code?: unknown; meta?: Record<string, unknown> } | undefined;
    if (data?.code !== 'integrity_required') return null;
    const challenge = data.meta?.challenge;
    if (typeof challenge !== 'string' || !challenge) return null;
    const project = data.meta?.cloud_project_number;
    return {
        challenge,
        cloudProjectNumber: typeof project === 'string' && /^\d+$/.test(project) ? project : null,
    };
};

/** A short, stable reason for the server's logs, e.g. "PLAY_SERVICES_NOT_FOUND". */
export const integrityErrorCode = (error: unknown): string => {
    const code = (error as { code?: unknown } | null)?.code;
    const raw = typeof code === 'string' && code ? code : error instanceof Error && error.name === 'TimeoutError' ? 'TIMEOUT' : 'UNKNOWN';
    return raw.replace(/^ERR_APP_INTEGRITY_/, '').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40);
};

export class TimeoutError extends Error {
    constructor(label: string) {
        super(`${label} timed out`);
        this.name = 'TimeoutError';
    }
}

export const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
    new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new TimeoutError(label)), ms);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
