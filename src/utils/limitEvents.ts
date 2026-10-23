/**
 * Why the server refused, from its 403 body (`meta.reason`), e.g.
 * `guest_budget_exhausted` when the shared guest pool is used up rather than
 * the person's own minutes.
 */
type LimitEventListener = (reason?: string) => void;

/** The `meta.reason` of a 403 response, if the body has one. */
export const limitReasonOf = async (response: Response): Promise<string | undefined> => {
    try {
        const body = await response.clone().json();
        const reason = body?.code ?? body?.meta?.reason ?? body?.detail?.meta?.reason ?? body?.detail?.reason;
        return typeof reason === 'string' ? reason : undefined;
    } catch {
        return undefined;
    }
};

/** A repeat of the same refusal within this window is one event, not a second sheet. */
const REPEAT_WINDOW_MS = 1500;

class LimitEventEmitter {
    private listeners: LimitEventListener[] = [];
    private last: { reason?: string; at: number } | null = null;

    public subscribe(listener: LimitEventListener): () => void {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    public emit(reason?: string) {
        const now = Date.now();
        // Parallel requests refused together (a batch, a retry) announce it once.
        if (this.last && this.last.reason === reason && now - this.last.at < REPEAT_WINDOW_MS) return;
        this.last = { reason, at: now };
        this.listeners.forEach(listener => {
            try {
                listener(reason);
            } catch (e) {
                console.error('[LimitEventEmitter] Listener error:', e);
            }
        });
    }
}

// Singleton for 403 limit reached events
export const onLimitReached = new LimitEventEmitter();

let limitSheetOpen = false;

/** Whether a limit sheet is on screen; other prompts wait until it closes. */
export const isLimitSheetOpen = (): boolean => limitSheetOpen;

export const setLimitSheetOpen = (open: boolean): void => {
    limitSheetOpen = open;
};
