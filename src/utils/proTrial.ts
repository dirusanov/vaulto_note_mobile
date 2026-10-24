/**
 * The server-granted Pro trial (no card, no store purchase) as the app shows it.
 * Pure functions over the /usage/me profile, so they can be tested without React.
 */

export interface ProTrialProfile {
    plan?: string | null;
    is_pro?: boolean;
    is_pro_trial?: boolean;
    pro_trial_available?: boolean;
    pro_trial_days?: number;
    pro_trial_minutes?: number;
    subscription_expires_at?: string | null;
}

export interface ProTrialState {
    /** The account can start the trial now. */
    available: boolean;
    /** Pro comes from the running trial, not from a store subscription. */
    active: boolean;
    /** Whole days left, rounded up (1 on the last day); 0 when not running. */
    daysLeft: number;
    /** When the running trial ends, or null. */
    endsAt: Date | null;
    /** Length and minutes of the trial as the server grants it. */
    days: number;
    minutes: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_PRO_TRIAL_DAYS = 7;
export const DEFAULT_PRO_TRIAL_MINUTES = 60;

const positiveOr = (value: unknown, fallback: number): number => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
};

export const proTrialDaysLeft = (endsAt: Date | null, now: number = Date.now()): number => {
    if (!endsAt) return 0;
    const left = endsAt.getTime() - now;
    return left > 0 ? Math.ceil(left / DAY_MS) : 0;
};

export const getProTrialState = (
    profile: ProTrialProfile | null | undefined,
    options: { signedIn: boolean; isPro: boolean; now?: number },
): ProTrialState => {
    const days = positiveOr(profile?.pro_trial_days, DEFAULT_PRO_TRIAL_DAYS);
    const minutes = positiveOr(profile?.pro_trial_minutes, DEFAULT_PRO_TRIAL_MINUTES);
    const active = !!profile && options.isPro && profile.is_pro_trial === true;
    const parsed = active && profile?.subscription_expires_at ? new Date(profile.subscription_expires_at) : null;
    const endsAt = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
    // Older servers do not send the field: no offer rather than a button that fails.
    const available = !!profile && options.signedIn && !options.isPro && profile.pro_trial_available === true;
    return {
        available,
        active,
        daysLeft: active ? Math.max(proTrialDaysLeft(endsAt, options.now), endsAt ? 0 : 1) : 0,
        endsAt,
        days,
        minutes,
    };
};
