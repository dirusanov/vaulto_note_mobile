import client from './client';

export interface SubscriptionPlan {
    id: string;
    plan_code: string;
    billing_period: string;
    product_id: string | null;
    display_name: string;
    transcription_minutes: number;
    price_amount: number;
    currency_code: string;
    is_active: boolean;
}

export interface CurrentPeriodUsage {
    plan: string;
    subscription_next_refill_at: string | null;
    period_start_at: string;
    period_end_at: string;
    usage: {
        transcription_seconds: number;
        transcription_minutes: number;
        llm_total_tokens: number;
        llm_input_tokens: number;
        llm_output_tokens: number;
    };
    limits: {
        transcription_trial_total_seconds: number;
        transcription_trial_used_seconds: number;
        transcription_trial_remaining_seconds: number;
        transcription_subscription_max_seconds: number;
        transcription_subscription_used_seconds: number;
        transcription_subscription_remaining_seconds: number;
        llm_max_tokens: number;
        llm_used_tokens: number;
        llm_remaining_tokens: number;
    };
}

export const subscriptionApi = {
    getPlans: async (): Promise<SubscriptionPlan[]> => {
        const response = await client.get<SubscriptionPlan[]>('/billing/plans');
        return response.data;
    },
    getCurrentPeriodUsage: async (): Promise<CurrentPeriodUsage | null> => {
        const response = await client.get<CurrentPeriodUsage>('/billing/usage/current-period', {
            validateStatus: (status) => (status >= 200 && status < 300) || status === 401,
        });
        if (response.status === 401) {
            return null;
        }
        return response.data;
    },
};
