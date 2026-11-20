import { ServerUnreachableError, SessionExpiredError } from './sessionErrors';

/**
 * A fetch to our own API that survives an access token expiring between two
 * requests: on 401 the shared refresh runs and the request is sent once more.
 * Only a session that cannot be renewed ends in SessionExpiredError. Pure (the
 * app wires storage, refresh and fetch in api/sessionFetch.ts), so tests can load it.
 */
export type RefreshOutcome =
    | { kind: 'success'; accessToken: string }
    | { kind: 'invalid_refresh' }
    | { kind: 'transient_failure' };

export type SessionFetchDeps = {
    getToken: () => Promise<string | null>;
    refresh: () => Promise<RefreshOutcome>;
    send: (url: string, init: RequestInit) => Promise<{ status: number }>;
    /** The session is gone for good: sign out and ask the user to sign in again. */
    onExpired: () => Promise<void> | void;
};

export const createSessionFetch = <R extends { status: number }>(deps: Omit<SessionFetchDeps, 'send'> & {
    send: (url: string, init: RequestInit) => Promise<R>;
}) => async (url: string, buildInit: (accessToken: string) => RequestInit): Promise<R> => {
    const token = await deps.getToken();
    if (!token) throw new Error('Sign in required to use Vaulto AI.');

    const first = await deps.send(url, buildInit(token));
    if (first.status !== 401) return first;

    const refresh = await deps.refresh();
    if (refresh.kind === 'transient_failure') {
        // Offline or the sign-in service is down: never a reason to sign out.
        throw new ServerUnreachableError();
    }
    if (refresh.kind === 'success') {
        const second = await deps.send(url, buildInit(refresh.accessToken));
        if (second.status !== 401) return second;
        // A brand-new token refused as well: the account itself needs a sign-in.
    }
    await deps.onExpired();
    throw new SessionExpiredError();
};
