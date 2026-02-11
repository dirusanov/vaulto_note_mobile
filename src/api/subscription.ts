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

export const subscriptionApi = {
    getPlans: async (): Promise<SubscriptionPlan[]> => {
        const response = await client.get<SubscriptionPlan[]>('/billing/plans');
        return response.data;
    },
};
