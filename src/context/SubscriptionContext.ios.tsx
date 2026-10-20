import React, { createContext, useContext, useMemo } from 'react';
import { useAuth } from '../hooks/useAuth';
import type { SubscriptionContextType } from './SubscriptionContext';

export type { MergedPackage, SubscriptionStatus } from './SubscriptionContext';

// The first iOS release has no store products. Do not initialize a purchase
// SDK or request offerings while account access still comes from the backend.
const Context = createContext<SubscriptionContextType | undefined>(undefined);

export const SubscriptionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user } = useAuth();
    const isPro = user?.is_pro === true || user?.plan?.trim().toLowerCase() === 'pro';
    const value = useMemo<SubscriptionContextType>(() => ({
        isPro,
        subscriptionStatus: null,
        packages: [],
        isLoading: false,
        purchasePackage: async () => false,
        restorePurchases: async () => undefined,
        reloadOfferings: async () => undefined,
    }), [isPro]);
    return <Context.Provider value={value}>{children}</Context.Provider>;
};

export const useSubscription = () => {
    const context = useContext(Context);
    if (!context) throw new Error('useSubscription must be used within a SubscriptionProvider');
    return context;
};
