import { useTranslation } from 'react-i18next';
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Image, Alert } from 'react-native';
import { useSubscription, MergedPackage } from '../context/SubscriptionContext';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '../hooks/useAuth';
import { createStyles } from '../theme/createStyles';
import { CUSTOM_AI_ENABLED } from '../utils/featureFlags';
import { haptics } from '../utils/haptics';

export const PaywallScreen = () => {
    const { t } = useTranslation();
    const { packages, purchasePackage, restorePurchases, reloadOfferings, isLoading, isPro } = useSubscription();
    const navigation = useNavigation();
    const { isAuthenticated, isGuest } = useAuth();
    const canPurchase = isAuthenticated && !isGuest;
    const transcriptionMinutes = packages.reduce((maxMinutes, pack) => {
        const planMinutes = pack.backendPlan?.transcription_minutes ?? 0;
        return planMinutes > maxMinutes ? planMinutes : maxMinutes;
    }, 500);

    const monthlyPack = packages.find(p => p.identifier.toLowerCase().includes('monthly'));
    const yearlyPack = packages.find(p => p.identifier.toLowerCase().includes('annual') || p.identifier.toLowerCase().includes('yearly'));
    let savingsPercentage = 0;
    if (monthlyPack && yearlyPack && monthlyPack.product.price > 0 && yearlyPack.product.price > 0) {
        const monthlyCostForYear = monthlyPack.product.price * 12;
        if (yearlyPack.product.price < monthlyCostForYear) {
            savingsPercentage = Math.round((1 - (yearlyPack.product.price / monthlyCostForYear)) * 100);
        }
    }

    const isYearly = (pack: MergedPackage) => {
        const id = pack.identifier.toLowerCase();
        return id.includes('annual') || id.includes('yearly');
    };
    // The yearly plan is preselected, as in most subscription apps; the big
    // button below buys whatever is selected.
    const [selectedId, setSelectedId] = useState<string | null>(null);
    useEffect(() => {
        if (!selectedId && packages.length > 0) {
            setSelectedId((yearlyPack ?? packages[0]).identifier);
        }
    }, [packages, selectedId, yearlyPack]);
    const selectedPack = packages.find((pack) => pack.identifier === selectedId) ?? null;

    const handlePurchase = async (pack: MergedPackage) => {
        if (!canPurchase) {
            Alert.alert(t("voice.signInRequired"), t("aux.purchaseProRequired"));
            (navigation as any).navigate('SignIn');
            return;
        }
        const purchased = await purchasePackage(pack);
        if (purchased || isPro) {
            navigation.goBack();
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.mainContent}>
                <TouchableOpacity
                    onPress={() => navigation.goBack()}
                    style={styles.closeButton}
                    accessibilityRole="button"
                    accessibilityLabel={t("a11y.close", "Close")}
                >
                    <MaterialIcons name="close" size={24} color={colors.textSecondary} />
                </TouchableOpacity>

                <View style={styles.centerContent}>
                    <View style={styles.heroSection}>
                        <View style={styles.logoContainer}>
                            <Image
                                source={require('../../assets/icon.png')}
                                style={styles.logoImage}
                                resizeMode="contain"
                            />
                        </View>
                        <Text style={styles.heroTitle}>{t("aux.proAccess")}</Text>
                        <Text style={styles.heroSubtitle}>
                            {t("aux.unlockFullPotential")}
                        </Text>
                    </View>

                    <View style={styles.featuresList}>
                        <FeatureItem text={t("aux.unlimitedCloudSync")} />
                        <FeatureItem text={t("aux.minsMonthTranscription", { minutes: transcriptionMinutes })} />
                        {CUSTOM_AI_ENABLED && <FeatureItem text={t("aux.customApiKeyServer")} />}
                    </View>

                    {isLoading ? (
                        <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
                    ) : packages.length === 0 ? (
                        // Store unreachable or no offerings configured: say so instead of
                        // leaving an empty gap with nothing to tap.
                        <View style={styles.unavailableCard}>
                            <MaterialIcons name="cloud-off" size={28} color={colors.textSecondary} />
                            <Text style={styles.unavailableTitle}>
                                {t("aux.paywallUnavailableTitle", "Plans are unavailable right now")}
                            </Text>
                            <Text style={styles.unavailableText}>
                                {t("aux.paywallUnavailableDesc", "We couldn't load subscription options. Check your connection and try again.")}
                            </Text>
                            <TouchableOpacity
                                style={styles.retryButton}
                                onPress={() => { void reloadOfferings(); }}
                                accessibilityRole="button"
                            >
                                <MaterialIcons name="refresh" size={18} color={colors.onPrimary} />
                                <Text style={styles.retryButtonText}>{t("aux.paywallRetry", "Try again")}</Text>
                            </TouchableOpacity>
                        </View>
                    ) : (
                        <View style={styles.packagesContainer}>
                            {packages.map((pack) => {
                                const { backendPlan, product } = pack;
                                const title = backendPlan?.display_name || (
                                    pack.identifier.toLowerCase().includes('annual') || pack.identifier.toLowerCase().includes('yearly')
                                        ? t("aux.yearlyPlan")
                                        : pack.identifier.toLowerCase().includes('monthly')
                                            ? t("aux.monthlyPlan")
                                            : pack.identifier
                                );
                                
                                const price = product.priceString;
                                const isBestValue = isYearly(pack);
                                const selected = pack.identifier === selectedId;
                                const perMonth = isBestValue ? product.pricePerMonthString : null;
                                const minutesToDisplay = backendPlan?.transcription_minutes || transcriptionMinutes;
                                const minutesLabel = minutesToDisplay ? `${minutesToDisplay} Vaulto AI minutes / month` : null;

                                return (
                                    <TouchableOpacity
                                        key={pack.identifier}
                                        style={[styles.planCard, selected && styles.planCardBest]}
                                        onPress={() => {
                                            if (!selected) haptics.selection();
                                            setSelectedId(pack.identifier);
                                        }}
                                        activeOpacity={0.9}
                                        disabled={isLoading}
                                        accessibilityRole="radio"
                                        accessibilityState={{ selected }}
                                    >
                                        <View style={styles.planHeader}>
                                            <View style={styles.planTitleRow}>
                                                <MaterialIcons
                                                    name={selected ? 'radio-button-checked' : 'radio-button-unchecked'}
                                                    size={22}
                                                    color={selected ? colors.primary : colors.textTertiary}
                                                />
                                                <Text style={[styles.planTitle, selected && styles.planTitleBest]}>{title}</Text>
                                            </View>
                                            <View style={styles.badgesContainer}>
                                                {isBestValue && savingsPercentage > 0 && (
                                                    <View style={[styles.badge, styles.savingsBadge]}>
                                                        <Text style={styles.badgeText}>{t("aux.savePercentage", { percentage: savingsPercentage })}</Text>
                                                    </View>
                                                )}
                                            </View>
                                        </View>
                                        <View style={styles.planPriceRow}>
                                            <Text style={[styles.planPrice, selected && styles.planPriceBest]}>{price}</Text>
                                            {perMonth ? (
                                                <Text style={styles.planPerMonth}>
                                                    {t("aux.perMonth", { price: perMonth, defaultValue: '{{price}} / month' })}
                                                </Text>
                                            ) : null}
                                        </View>
                                        {minutesLabel ? (
                                            <Text style={[styles.planMinutes, selected && styles.planMinutesBest]}>
                                                {t("aux.vaultoAiMinsMonth", { minutes: minutesToDisplay })}
                                            </Text>
                                        ) : null}
                                    </TouchableOpacity>
                                );
                            })}
                        </View>
                    )}
                </View>

                <View style={styles.footer}>
                    {selectedPack && (
                        <TouchableOpacity
                            style={[styles.ctaButton, isLoading && { opacity: 0.6 }]}
                            onPress={() => { haptics.light(); void handlePurchase(selectedPack); }}
                            disabled={isLoading}
                            accessibilityRole="button"
                        >
                            <Text style={styles.ctaText}>{t("auth.continue", "Continue")}</Text>
                        </TouchableOpacity>
                    )}
                    <TouchableOpacity
                        onPress={() => {
                            if (!canPurchase) {
                                Alert.alert(t("voice.signInRequired"), t("aux.signInRestorePurchases"));
                                (navigation as any).navigate('SignIn');
                                return;
                            }
                            restorePurchases();
                        }}
                        style={styles.restoreButton}
                        disabled={!canPurchase}
                    >
                        <Text style={styles.restoreButtonText}>{t("aux.restorePurchases")}</Text>
                    </TouchableOpacity>

                    <Text style={styles.termsText}>
                        {t("aux.autoRenewable")}
                    </Text>
                </View>
            </View>
        </SafeAreaView>
    );
};

const FeatureItem = ({ text }: { text: string }) => (
    <View style={styles.featureRow}>
        <MaterialIcons name="check" size={16} color={colors.primary} style={styles.checkIcon} />
        <Text style={styles.featureText}>{text}</Text>
    </View>
);

const styles = createStyles(() => ({
    unavailableCard: {
        alignItems: 'center',
        gap: 8,
        paddingVertical: 24,
        paddingHorizontal: 16,
        marginTop: 24,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
    },
    unavailableTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.text,
        textAlign: 'center',
    },
    unavailableText: {
        fontSize: 14,
        lineHeight: 20,
        color: colors.textSecondary,
        textAlign: 'center',
    },
    retryButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginTop: 8,
        paddingVertical: 10,
        paddingHorizontal: 20,
        borderRadius: 12,
        backgroundColor: colors.primary,
    },
    retryButtonText: {
        color: colors.onPrimary,
        fontSize: 15,
        fontWeight: '600',
    },
    container: {
        flex: 1,
        backgroundColor: colors.background,
    },
    mainContent: {
        flex: 1,
        paddingHorizontal: 24,
        paddingBottom: 24,
        paddingTop: 16,
        justifyContent: 'space-between',
    },
    closeButton: {
        width: 32,
        height: 32,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 16,
        backgroundColor: colors.surface,
        alignSelf: 'flex-start',
    },
    centerContent: {
        flex: 1,
        justifyContent: 'center',
    },
    heroSection: {
        alignItems: 'center',
        marginBottom: 32,
    },
    logoContainer: {
        width: 80,
        height: 80,
        borderRadius: 20,
        backgroundColor: '#FFFFFF',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 20,
        // Soft shadow for app icon look
        shadowColor: colors.primary,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.15,
        shadowRadius: 16,
        elevation: 8,
    },
    logoImage: {
        width: 60,
        height: 60,
        borderRadius: 12,
    },
    heroTitle: {
        fontSize: 24,
        fontWeight: '800',
        color: colors.text,
        marginBottom: 8,
        letterSpacing: 1,
        textTransform: 'uppercase',
    },
    heroSubtitle: {
        fontSize: 15,
        color: colors.textSecondary,
        textAlign: 'center',
        letterSpacing: 0.5,
    },
    featuresList: {
        marginBottom: 32,
        gap: 14,
        paddingHorizontal: 16,
    },
    featureRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    checkIcon: {
        opacity: 1,
    },
    featureText: {
        fontSize: 14,
        color: colors.text,
        fontWeight: '500',
    },
    packagesContainer: {
        gap: 12,
    },
    planCard: {
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 16,
        padding: 20,
    },
    planCardBest: {
        borderColor: colors.primary,
        backgroundColor: colors.surface,
        borderWidth: 2,
    },
    planHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 4,
    },
    planTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        flexShrink: 1,
    },
    planPriceRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        flexWrap: 'wrap',
        gap: 8,
        marginLeft: 30,
    },
    planPerMonth: {
        fontSize: 14,
        color: colors.textSecondary,
    },
    ctaButton: {
        alignSelf: 'stretch',
        minHeight: 56,
        borderRadius: 16,
        backgroundColor: colors.primary,
        alignItems: 'center',
        justifyContent: 'center',
    },
    ctaText: {
        color: colors.onPrimary,
        fontSize: 17,
        fontWeight: '700',
    },
    planTitle: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.textSecondary,
    },
    planTitleBest: {
        color: colors.primary,
        fontWeight: '700',
    },
    badgesContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    badge: {
        backgroundColor: colors.primary,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 6,
    },
    savingsBadge: {
        backgroundColor: '#10B981',
    },
    badgeText: {
        color: '#fff',
        fontSize: 10,
        fontWeight: '700',
    },
    planPrice: {
        fontSize: 20,
        fontWeight: 'bold',
        color: colors.text,
        marginBottom: 2,
    },
    planPriceBest: {
        color: colors.primary,
    },
    planMinutes: {
        fontSize: 13,
        fontWeight: '700',
        color: colors.text,
        marginBottom: 4,
        marginLeft: 30,
    },
    planMinutesBest: {
        color: colors.primary,
    },
    planSubtext: {
        fontSize: 12,
        color: colors.textSecondary,
    },
    planSubtextBest: {
        color: colors.textSecondary,
    },
    loader: {
        marginVertical: 40,
    },
    footer: {
        alignItems: 'center',
        gap: 16,
        paddingTop: 16,
    },
    restoreButton: {
        padding: 8,
    },
    restoreButtonText: {
        color: colors.textSecondary,
        fontSize: 14,
        fontWeight: '500',
    },
    termsText: {
        marginTop: 24,
        fontSize: 12,
        color: colors.textTertiary,
        textAlign: 'center',
        lineHeight: 18,
    },
}));
