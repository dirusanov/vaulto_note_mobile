import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { Platform } from 'react-native';
import Purchases, { PurchasesPackage, CustomerInfo, LOG_LEVEL } from 'react-native-purchases';
import { subscriptionApi, SubscriptionPlan } from '../api/subscription';
import { ErrorModal } from '../components/ErrorModal';
import { SuccessModal } from '../components/SuccessModal';
import { useAuth } from '../hooks/useAuth';

// TODO: Replace with your actual RevenueCat API keys in .env
const API_KEYS = {
    apple: process.env.EXPO_PUBLIC_REVENUECAT_APPLE_KEY || 'appl_placeholder',
    google: process.env.EXPO_PUBLIC_REVENUECAT_GOOGLE_KEY || 'goog_placeholder',
};

export interface MergedPackage {
    identifier: string;
    product: PurchasesPackage['product'];
    rcPackage: PurchasesPackage;
    backendPlan?: SubscriptionPlan;
}

export interface SubscriptionStatus {
    isActive: boolean;
    entitlementId: string | null;
    productIdentifier: string | null;
    planCode: string | null;
    billingPeriod: string | null;
    expiresAt: string | null;
    willRenew: boolean;
    store: string | null;
    managementURL: string | null;
}

interface SubscriptionContextType {
    isPro: boolean;
    subscriptionStatus: SubscriptionStatus | null;
    packages: MergedPackage[];
    purchasePackage: (pack: MergedPackage) => Promise<boolean>;
    restorePurchases: () => Promise<void>;
    isLoading: boolean;
}

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);

const normalizeProductId = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

const productMatches = (source: string, target: string) => {
    const sourceNormalized = source.trim().toLowerCase();
    const targetNormalized = target.trim().toLowerCase();
    if (!sourceNormalized || !targetNormalized) return false;
    if (sourceNormalized === targetNormalized) return true;
    return normalizeProductId(sourceNormalized) === normalizeProductId(targetNormalized);
};

const findPlanByProductId = (productIdentifier: string | null, plans: SubscriptionPlan[]) => {
    if (!productIdentifier) return undefined;
    return plans.find((plan) => {
        if (!plan.product_id) return false;
        return productMatches(productIdentifier, plan.product_id);
    });
};

export const SubscriptionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [isPro, setIsPro] = useState(false);
    const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus | null>(null);
    const [packages, setPackages] = useState<MergedPackage[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<{ title?: string; message: string } | null>(null);

    const { userId, user } = useAuth();
    const isConfigured = useRef(false);
    const plansRef = useRef<SubscriptionPlan[]>([]);
    const customerInfoRef = useRef<CustomerInfo | null>(null);
    const backendProRef = useRef(false);

    const hasBackendProInfo = (currentUser: typeof user) =>
        !!currentUser &&
        (
            typeof (currentUser as any).is_pro === 'boolean' ||
            typeof (currentUser as any).plan === 'string'
        );

    const isBackendPro = (currentUser: typeof user) =>
        !!currentUser && (() => {
            const normalizedPlan = typeof (currentUser as any).plan === 'string'
                ? (currentUser as any).plan.trim().toLowerCase()
                : '';

            return (
                (currentUser as any).is_pro === true ||
                normalizedPlan === 'pro'
            );
        })();

    const buildSubscriptionStatus = (
        customerInfo: CustomerInfo,
        currentPlans: SubscriptionPlan[]
    ): SubscriptionStatus => {
        const entitlements = (customerInfo as any)?.entitlements;
        const activeEntitlement = entitlements?.active?.pro ?? null;
        const knownEntitlement = activeEntitlement ?? entitlements?.all?.pro ?? null;
        const productIdentifier: string | null = knownEntitlement?.productIdentifier ?? null;
        const matchedPlan = findPlanByProductId(productIdentifier, currentPlans);

        return {
            isActive: !!activeEntitlement,
            entitlementId: knownEntitlement?.identifier ?? null,
            productIdentifier,
            planCode: matchedPlan?.plan_code ?? null,
            billingPeriod: matchedPlan?.billing_period ?? null,
            expiresAt: knownEntitlement?.expirationDate ?? null,
            willRenew: !!knownEntitlement?.willRenew,
            store: knownEntitlement?.store ?? null,
            managementURL: (customerInfo as any)?.managementURL ?? null,
        };
    };

    const checkSubscriptionStatus = (
        customerInfo: CustomerInfo,
        currentPlans: SubscriptionPlan[] = plansRef.current
    ) => {
        customerInfoRef.current = customerInfo;
        const status = buildSubscriptionStatus(customerInfo, currentPlans);
        // Source of truth for feature unlock is backend user plan/is_pro.
        // RevenueCat here is used for purchase metadata and product mapping.
        const effectiveIsActive = backendProRef.current;
        const effectiveStatus = {
            ...status,
            isActive: effectiveIsActive,
            planCode: effectiveIsActive ? (status.planCode || 'pro') : status.planCode,
        };
        setSubscriptionStatus(effectiveStatus);
        setIsPro(effectiveIsActive);
        return effectiveStatus;
    };

    useEffect(() => {
        const backendKnown = hasBackendProInfo(user);
        const backendPro = isBackendPro(user);
        backendProRef.current = backendPro;

        if (customerInfoRef.current) {
            checkSubscriptionStatus(customerInfoRef.current, plansRef.current);
            return;
        }

        if (backendKnown && backendPro) {
            setIsPro(true);
            setSubscriptionStatus((prev) => ({
                isActive: true,
                entitlementId: prev?.entitlementId ?? null,
                productIdentifier: prev?.productIdentifier ?? null,
                planCode: prev?.planCode ?? 'pro',
                billingPeriod: prev?.billingPeriod ?? null,
                expiresAt: prev?.expiresAt ?? null,
                willRenew: prev?.willRenew ?? false,
                store: prev?.store ?? null,
                managementURL: prev?.managementURL ?? null,
            }));
        } else {
            setIsPro(false);
            setSubscriptionStatus((prev) => (prev ? { ...prev, isActive: false } : null));
        }
    }, [user?.id, (user as any)?.is_pro, (user as any)?.plan]);

    useEffect(() => {
        const init = async () => {
            if (isConfigured.current) return;

            try {
                if (Platform.OS === 'android') {
                    await Purchases.configure({ apiKey: API_KEYS.google, appUserID: userId || undefined });
                } else if (Platform.OS === 'ios') {
                    await Purchases.configure({ apiKey: API_KEYS.apple, appUserID: userId || undefined });
                }

                if (__DEV__) {
                    await Purchases.setLogLevel(LOG_LEVEL.DEBUG);
                }

                isConfigured.current = true;

                const customerInfo = await Purchases.getCustomerInfo();
                checkSubscriptionStatus(customerInfo);

                await loadOfferings();
            } catch (e) {
                console.error('RevenueCat init error:', e);
            } finally {
                setIsLoading(false);
            }
        };

        init();
    }, []);

    // Identify user when they log in or update profile
    useEffect(() => {
        if (!isConfigured.current) return;

        const identifyUser = async () => {
            if (userId) {
                try {
                    const { customerInfo } = await Purchases.logIn(userId);
                    checkSubscriptionStatus(customerInfo);

                    if (user?.email) {
                        await Purchases.setEmail(user.email);
                    }
                    if (user?.full_name) {
                        await Purchases.setDisplayName(user.full_name);
                    }
                } catch (e) {
                    console.error('RevenueCat login error:', e);
                }
            } else {
                // User logged out
                try {
                    const customerInfo = await Purchases.logOut();
                    checkSubscriptionStatus(customerInfo);
                } catch (e) {
                    console.error('RevenueCat logout error:', e);
                }
            }
        };

        identifyUser();
    }, [userId, user?.email, user?.full_name]);

    const loadOfferings = async () => {
        try {
            const [offerings, backendPlans] = await Promise.all([
                Purchases.getOfferings(),
                subscriptionApi.getPlans().catch(e => {
                    console.error('Failed to fetch backend plans:', e);
                    return [] as SubscriptionPlan[];
                })
            ]);
            plansRef.current = backendPlans;
            if (customerInfoRef.current) {
                checkSubscriptionStatus(customerInfoRef.current, backendPlans);
            }

            if (offerings.current && offerings.current.availablePackages.length > 0) {
                const merged = offerings.current.availablePackages.map(rcPackage => {
                    // Match by productIdentifier (store ID) or mapped product_id
                    const plan = findPlanByProductId(rcPackage.product.identifier, backendPlans);
                    return {
                        identifier: rcPackage.identifier,
                        product: rcPackage.product,
                        rcPackage,
                        backendPlan: plan
                    };
                });
                setPackages(merged);
            }
        } catch (e) {
            console.error('Error loading offerings:', e);
        }
    };

    const purchasePackage = async (pack: MergedPackage) => {
        try {
            setIsLoading(true);
            const { customerInfo } = await Purchases.purchasePackage(pack.rcPackage);
            const status = checkSubscriptionStatus(customerInfo);
            if (status.isActive) {
                const planLabel = status.billingPeriod === 'yearly'
                    ? 'Yearly Pro'
                    : status.billingPeriod === 'monthly'
                        ? 'Monthly Pro'
                        : 'Pro';
                setSuccess({
                    title: 'Subscription Activated',
                    message: `Подписка успешно оформлена! ${planLabel} активирован.`,
                });
            }
            return status.isActive;
        } catch (e: any) {
            if (!e.userCancelled) {
                setError(e.message);
            }
            return false;
        } finally {
            setIsLoading(false);
        }
    };

    const restorePurchases = async () => {
        try {
            setIsLoading(true);
            const customerInfo = await Purchases.restorePurchases();
            const status = checkSubscriptionStatus(customerInfo);
            setSuccess({
                title: status.isActive ? 'Purchases Restored' : 'Restore Complete',
                message: status.isActive
                    ? 'Подписка успешно восстановлена.'
                    : 'Покупки восстановлены, активной подписки сейчас нет.',
            });
        } catch (e: any) {
            setError(e.message);
        } finally {
            setIsLoading(false);
        }
    };

    // We don't need to expose error/success setters to consumers,
    // but we need to render the modals here.

    return (
        <SubscriptionContext.Provider
            value={{
                isPro,
                subscriptionStatus,
                packages,
                purchasePackage,
                restorePurchases,
                isLoading,
            }}
        >
            {children}
            <ErrorModal
                visible={!!error}
                message={error || ''}
                onClose={() => setError(null)}
            />
            <SuccessModal
                visible={!!success}
                title={success?.title}
                message={success?.message || ''}
                onClose={() => setSuccess(null)}
            />
        </SubscriptionContext.Provider>
    );
};

export const useSubscription = () => {
    const context = useContext(SubscriptionContext);
    if (!context) {
        throw new Error('useSubscription must be used within a SubscriptionProvider');
    }
    return context;
};
