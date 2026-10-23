/**
 * What the app knows about the account's AI (LLM token) allowance during this
 * session. Once the server refuses with `llm_tokens_exhausted`, automatic AI work
 * (cleaning up a dictation) is skipped quietly instead of asking again after every
 * recording and popping the limit sheet each time. The state is in memory only:
 * it ends on a successful AI call, a plan change, the next usage period, or an
 * app restart. Kept free of app imports so tests can load it.
 */

/** The 403 code of a used-up AI allowance. */
export const LLM_LIMIT_REASON = 'llm_tokens_exhausted';

/** Without a known reset time, look again after this long. */
const UNKNOWN_RESET_RECHECK_MS = 6 * 60 * 60 * 1000;

let limitedUntil: number | null = null;
let noticeShown = false;
let knownPlan: string | null = null;

/**
 * Whether a refusal means the AI allowance. Other 403 codes (transcription
 * minutes, the shared guest budget) are about something else. Old servers send
 * no code: from an AI-only endpoint a 403 still means the AI allowance.
 */
export const isLlmLimitReason = (reason: string | null | undefined, fromAiEndpoint = false): boolean => {
    if (reason) return reason === LLM_LIMIT_REASON;
    return fromAiEndpoint;
};

export const markAiLimitReached = (resetAt?: string | number | null, now: number = Date.now()): void => {
    const reset = typeof resetAt === 'string' ? Date.parse(resetAt) : typeof resetAt === 'number' ? resetAt : NaN;
    limitedUntil = Number.isFinite(reset) && reset > now ? reset : now + UNKNOWN_RESET_RECHECK_MS;
};

export const clearAiLimit = (): void => {
    limitedUntil = null;
};

export const isAiLimitKnown = (now: number = Date.now()): boolean => {
    if (limitedUntil === null) return false;
    if (now >= limitedUntil) {
        limitedUntil = null;
        return false;
    }
    return true;
};

/** True once per session: the quiet notice that recordings go in as plain text. */
export const takeAiLimitNotice = (): boolean => {
    if (noticeShown) return false;
    noticeShown = true;
    return true;
};

/** A different plan (an upgrade, a renewal) may bring a new allowance. */
export const noteAccountPlan = (plan: string | null | undefined): void => {
    const next = (plan || '').trim().toLowerCase() || null;
    if (knownPlan !== null && next !== null && next !== knownPlan) clearAiLimit();
    if (next !== null) knownPlan = next;
};

/** Usage figures from the server settle the question either way. */
export const noteAiTokensRemaining = (
    remaining: number | null | undefined,
    resetAt?: string | null,
    now: number = Date.now(),
): void => {
    if (typeof remaining !== 'number') return;
    if (remaining > 0) clearAiLimit();
    else markAiLimitReached(resetAt, now);
};

/**
 * Thrown by AI requests the server refused for a usage limit. The message stays
 * "Usage limit reached": screens recognise it to skip their own error dialogs.
 */
export class UsageLimitError extends Error {
    readonly reason?: string;

    constructor(reason?: string) {
        super('Usage limit reached');
        this.name = 'UsageLimitError';
        this.reason = reason;
    }
}

/** The server's reason of a usage-limit error, when the error carries one. */
export const usageLimitReasonOf = (error: unknown): string | undefined => {
    if (error && typeof error === 'object' && typeof (error as { reason?: unknown }).reason === 'string') {
        return (error as { reason: string }).reason;
    }
    return undefined;
};

/** For tests. */
export const resetAiLimitStateForTests = (): void => {
    limitedUntil = null;
    noticeShown = false;
    knownPlan = null;
};
