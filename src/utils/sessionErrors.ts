/**
 * Errors of a request whose session could not be used. Kept free of app imports
 * so getErrorMessage and the tests can load them.
 */

export const SESSION_EXPIRED = 'session_expired';
export const SERVER_UNREACHABLE = 'server_unreachable';

/** The session cannot be renewed: the user has to sign in again. */
export class SessionExpiredError extends Error {
    constructor() {
        super(SESSION_EXPIRED);
        this.name = 'SessionExpiredError';
    }
}

/** The session could not be renewed right now (offline, server down). */
export class ServerUnreachableError extends Error {
    constructor() {
        super(SERVER_UNREACHABLE);
        this.name = 'ServerUnreachableError';
    }
}

const messageOf = (error: unknown): string => {
    if (typeof error === 'string') return error;
    const message = (error as { message?: unknown } | null)?.message;
    return typeof message === 'string' ? message : '';
};

export const isSessionExpiredError = (error: unknown): boolean =>
    (error as { name?: string } | null)?.name === 'SessionExpiredError' || messageOf(error) === SESSION_EXPIRED;

export const isServerUnreachableError = (error: unknown): boolean =>
    (error as { name?: string } | null)?.name === 'ServerUnreachableError' || messageOf(error) === SERVER_UNREACHABLE;
