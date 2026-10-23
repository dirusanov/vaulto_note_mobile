import { useTranslation } from 'react-i18next';
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Image, StyleSheet, ScrollView, Linking, Platform } from 'react-native';
import { useSubscription, MergedPackage } from '../context/SubscriptionContext';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, isDarkScheme } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '../hooks/useAuth';
import { createStyles } from '../theme/createStyles';
import { CUSTOM_AI_ENABLED, DRAWING_ENABLED } from '../utils/featureFlags';
import { haptics } from '../utils/haptics';
import { appAlert } from '../components/AppAlert';

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

    // The store's own trial or intro price, if the product carries one (Google Play:
    // the default subscription option; App Store: introPrice). Null when there is none.
    const describeOffer = (pack: MergedPackage, regularPrice: string): { text: string; free: boolean } | null => {
        const trialText = (unit: string, units: number) => {
            if (unit === 'DAY') return t('paywall.trialDays', { count: units, price: regularPrice });
            if (unit === 'WEEK') return t('paywall.trialDays', { count: units * 7, price: regularPrice });
            if (unit === 'MONTH') return t('paywall.trialMonths', { count: units, price: regularPrice });
            if (unit === 'YEAR') return t('paywall.trialMonths', { count: units * 12, price: regularPrice });
            return null;
        };
        const option = pack.product.defaultOption;
        if (option?.freePhase) {
            const period = option.freePhase.billingPeriod;
            const text = trialText(String(period.unit), period.value * (option.freePhase.billingCycleCount ?? 1));
            if (text) return { text, free: true };
        }
        if (option?.introPhase) {
            return { text: t('paywall.introOffer', { intro: option.introPhase.price.formatted, price: regularPrice }), free: false };
        }
        const intro = pack.product.introPrice;
        if (intro) {
            if (intro.price === 0) {
                const text = trialText(intro.periodUnit, intro.periodNumberOfUnits * Math.max(intro.cycles, 1));
                if (text) return { text, free: true };
            }
            return { text: t('paywall.introOffer', { intro: intro.priceString, price: regularPrice }), free: false };
        }
        return null;
    };

    const handlePurchase = async (pack: MergedPackage) => {
        if (!canPurchase) {
            appAlert(t("voice.signInRequired"), t("aux.purchaseProRequired"));
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
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={t("a11y.close", "Close")}
                >
                    <MaterialIcons name="close" size={20} color={colors.textSecondary} />
                </TouchableOpacity>

                {/* Offer and button sit together, centred in the free height; they scroll
                    on short screens and with large text. */}
                <ScrollView
                    style={styles.scroll}
                    contentContainerStyle={styles.body}
                    showsVerticalScrollIndicator={false}
                >
                <View>
                    <View style={styles.heroSection}>
                        {/* The mark is a transparent glyph, tinted to the text colour. */}
                        <Image
                            source={require('../../assets/icon.png')}
                            style={styles.logoImage}
                            resizeMode="contain"
                            accessibilityIgnoresInvertColors
                        />
                        <Text style={styles.heroTitle}>{t("paywall.headline", "Record without watching the clock")}</Text>
                        <Text style={styles.heroSubtitle}>
                            {t("paywall.subtitle", "Vaulto Pro: fresh minutes every month and AI without limits.")}
                        </Text>
                    </View>

                    {/* What Pro adds, then what any account already has: sync and
                        handwriting are not Pro-only, so they are not sold as such. */}
                    <View style={styles.featuresList}>
                        <FeatureItem text={t("aux.minsMonthTranscription", { minutes: transcriptionMinutes })} />
                        <FeatureItem text={t("paywall.benefitAI", "AI without monthly limits: tidy up text, find tasks, ask your notes")} />
                        {CUSTOM_AI_ENABLED && <FeatureItem text={t("aux.customApiKeyServer")} />}
                        <Text style={styles.includedLabel}>{t("paywall.includedLabel", "Plus everything in your free account")}</Text>
                        <FeatureItem quiet text={t("paywall.benefitSync", "Sync and end-to-end encryption on all your devices")} />
                        {DRAWING_ENABLED && <FeatureItem quiet text={t("paywall.benefitHandwriting", "Handwriting and drawings in notes")} />}
                    </View>

                    {isLoading ? (
                        <ActivityIndicator size="small" color={colors.textSecondary} style={styles.loader} />
                    ) : packages.length === 0 ? (
                        // Store unreachable or no offerings configured: say so instead of
                        // leaving an empty gap with nothing to tap.
                        <View style={styles.unavailableCard}>
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
                                <Text style={styles.retryButtonText}>{t("aux.paywallRetry", "Try again")}</Text>
                            </TouchableOpacity>
                        </View>
                    ) : (
                        <View style={styles.packagesContainer} accessibilityRole="radiogroup">
                            {packages.map((pack) => {
                                const { backendPlan, product } = pack;
                                const title = backendPlan?.display_name || (
                                    pack.identifier.toLowerCase().includes('annual') || pack.identifier.toLowerCase().includes('yearly')
                                        ? t("aux.yearlyPlan")
                                        : pack.identifier.toLowerCase().includes('monthly')
                                            ? t("aux.monthlyPlan")
                                            : pack.identifier
                                );

                                const isBestValue = isYearly(pack);
                                const isMonthly = pack.identifier.toLowerCase().includes('monthly');
                                // Every price says what period it pays for.
                                const price = isBestValue
                                    ? t("aux.perYear", { price: product.priceString, defaultValue: '{{price}} / year' })
                                    : isMonthly
                                        ? t("aux.perMonth", { price: product.priceString, defaultValue: '{{price}} / month' })
                                        : product.priceString;
                                const selected = pack.identifier === selectedId;
                                const perMonth = isBestValue ? product.pricePerMonthString : null;
                                // The feature list already names the minutes; a plan repeats them only if it differs.
                                const planMinutes = backendPlan?.transcription_minutes;
                                const minutesToDisplay = planMinutes && planMinutes !== transcriptionMinutes ? planMinutes : 0;
                                const offer = describeOffer(pack, price);

                                return (
                                    <TouchableOpacity
                                        key={pack.identifier}
                                        style={[styles.planCard, selected && styles.planCardSelected]}
                                        onPress={() => {
                                            if (!selected) haptics.selection();
                                            setSelectedId(pack.identifier);
                                        }}
                                        activeOpacity={0.8}
                                        disabled={isLoading}
                                        accessibilityRole="radio"
                                        accessibilityState={{ selected }}
                                    >
                                        <View style={[styles.radio, selected && styles.radioOn]}>
                                            {selected && <View style={styles.radioDot} />}
                                        </View>
                                        <View style={styles.planText}>
                                            <Text style={styles.planTitle}>{title}</Text>
                                            {/* Its own line, so long translations never wrap inside the title row. */}
                                            {isBestValue && savingsPercentage > 0 && (
                                                <Text style={styles.savingsBadge}>
                                                    {t("aux.savePercentage", { percentage: savingsPercentage })}
                                                </Text>
                                            )}
                                            {!!minutesToDisplay && (
                                                <Text style={styles.planMeta}>
                                                    {t("aux.vaultoAiMinsMonth", { minutes: minutesToDisplay })}
                                                </Text>
                                            )}
                                            {offer && <Text style={styles.planOffer}>{offer.text}</Text>}
                                        </View>
                                        <View style={styles.planPriceColumn}>
                                            <Text style={styles.planPrice}>{price}</Text>
                                            {perMonth ? (
                                                <Text style={styles.planPerMonth}>
                                                    {t("aux.perMonth", { price: perMonth, defaultValue: '{{price}} / month' })}
                                                </Text>
                                            ) : null}
                                        </View>
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
                            activeOpacity={0.85}
                            accessibilityRole="button"
                        >
                            <Text style={styles.ctaText}>
                                {describeOffer(selectedPack, selectedPack.product.priceString)?.free
                                    ? t("paywall.startTrial", "Start free trial")
                                    : t("auth.continue", "Continue")}
                            </Text>
                        </TouchableOpacity>
                    )}
                    <Text style={styles.termsText}>
                        {Platform.OS === 'ios'
                            ? t("paywall.cancelAppStore", "Renews automatically. Cancel anytime in your App Store settings.")
                            : t("paywall.cancelGooglePlay", "Renews automatically. Cancel anytime in Google Play.")}
                    </Text>
                    {/* Same documents as Settings and sign-up. */}
                    <View style={styles.legalRow}>
                        <TouchableOpacity onPress={() => { void Linking.openURL('https://vaultonote.com/terms'); }} hitSlop={8} accessibilityRole="link">
                            <Text style={styles.legalLink}>{t("paywall.terms", "Terms of Use")}</Text>
                        </TouchableOpacity>
                        <Text style={styles.legalDot}>·</Text>
                        <TouchableOpacity onPress={() => { void Linking.openURL('https://vaultonote.com/privacy'); }} hitSlop={8} accessibilityRole="link">
                            <Text style={styles.legalLink}>{t("paywall.privacy", "Privacy Policy")}</Text>
                        </TouchableOpacity>
                    </View>
                    <TouchableOpacity
                        onPress={() => {
                            if (!canPurchase) {
                                appAlert(t("voice.signInRequired"), t("aux.signInRestorePurchases"));
                                (navigation as any).navigate('SignIn');
                                return;
                            }
                            restorePurchases();
                        }}
                        style={styles.restoreButton}
                        disabled={!canPurchase}
                        hitSlop={8}
                    >
                        <Text style={styles.restoreButtonText}>{t("aux.restorePurchases")}</Text>
                    </TouchableOpacity>
                </View>
                </ScrollView>
            </View>
        </SafeAreaView>
    );
};

const FeatureItem = ({ text, quiet = false }: { text: string; quiet?: boolean }) => (
    <View style={styles.featureRow}>
        <MaterialIcons name="check" size={18} color={quiet ? colors.textTertiary : colors.primary} />
        <Text style={[styles.featureText, quiet && styles.featureTextQuiet]}>{text}</Text>
    </View>
);

const styles = createStyles(() => ({
    container: {
        flex: 1,
        backgroundColor: colors.background,
    },
    mainContent: {
        width: '100%',
        maxWidth: 520,
        alignSelf: 'center',
        flex: 1,
        paddingHorizontal: spacing.l,
        paddingBottom: spacing.m,
        paddingTop: spacing.s,
    },
    closeButton: {
        width: 32,
        height: 32,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 16,
        backgroundColor: colors.backgroundSecondary,
        alignSelf: 'flex-start',
    },
    scroll: {
        flex: 1,
    },
    body: {
        flexGrow: 1,
        justifyContent: 'center',
        paddingTop: spacing.s,
        paddingBottom: spacing.l,
    },
    heroSection: {
        marginBottom: spacing.l,
    },
    logoImage: {
        width: 44,
        height: 44,
        tintColor: colors.text,
        marginBottom: spacing.m,
    },
    heroTitle: {
        fontSize: 32,
        lineHeight: 38,
        fontWeight: '700',
        letterSpacing: -0.8,
        color: colors.text,
        marginBottom: spacing.s,
    },
    heroSubtitle: {
        fontSize: 16,
        lineHeight: 22,
        color: colors.textSecondary,
    },
    featuresList: {
        marginBottom: spacing.l,
        gap: 12,
    },
    featureRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
    },
    featureText: {
        flex: 1,
        fontSize: 15,
        lineHeight: 20,
        color: colors.text,
    },
    featureTextQuiet: {
        color: colors.textSecondary,
    },
    includedLabel: {
        fontSize: 13,
        lineHeight: 18,
        color: colors.textTertiary,
        marginTop: spacing.xs,
    },
    planOffer: {
        fontSize: 13,
        lineHeight: 18,
        fontWeight: '600',
        color: colors.primary,
    },
    legalRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
    },
    legalLink: {
        fontSize: 12,
        lineHeight: 16,
        color: colors.textSecondary,
        textDecorationLine: 'underline',
    },
    legalDot: {
        fontSize: 12,
        color: colors.textTertiary,
    },
    packagesContainer: {
        gap: 10,
    },
    planCard: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        minHeight: 72,
        paddingHorizontal: spacing.m,
        paddingVertical: 14,
        borderRadius: 16,
        backgroundColor: colors.surface,
        // Hairline at rest; the chosen plan gets a 2px outline (padding absorbs it).
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: isDarkScheme() ? colors.surface : colors.border,
    },
    planCardSelected: {
        borderWidth: 2,
        borderColor: colors.primary,
        paddingHorizontal: spacing.m - 2,
        paddingVertical: 12,
    },
    radio: {
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 1.5,
        borderColor: colors.borderHover,
        alignItems: 'center',
        justifyContent: 'center',
    },
    radioOn: {
        borderColor: colors.primary,
    },
    radioDot: {
        width: 12,
        height: 12,
        borderRadius: 6,
        backgroundColor: colors.primary,
    },
    planText: {
        flex: 1,
        gap: 2,
    },
    planTitle: {
        fontSize: 16,
        lineHeight: 22,
        fontWeight: '600',
        color: colors.text,
    },
    savingsBadge: {
        alignSelf: 'flex-start',
        fontSize: 12,
        fontWeight: '600',
        color: colors.success,
        backgroundColor: colors.successLight,
        overflow: 'hidden',
        borderRadius: 8,
        paddingHorizontal: 6,
        paddingVertical: 1,
    },
    planMeta: {
        fontSize: 13,
        lineHeight: 18,
        color: colors.textSecondary,
    },
    planPriceColumn: {
        alignItems: 'flex-end',
        gap: 2,
    },
    planPrice: {
        fontSize: 17,
        lineHeight: 22,
        fontWeight: '600',
        color: colors.text,
        fontVariant: ['tabular-nums'],
    },
    planPerMonth: {
        fontSize: 13,
        lineHeight: 18,
        color: colors.textSecondary,
    },
    unavailableCard: {
        gap: 6,
        padding: spacing.m,
        borderRadius: 16,
        backgroundColor: colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: isDarkScheme() ? colors.surface : colors.border,
    },
    unavailableTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.text,
    },
    unavailableText: {
        fontSize: 14,
        lineHeight: 20,
        color: colors.textSecondary,
    },
    retryButton: {
        alignSelf: 'flex-start',
        justifyContent: 'center',
        minHeight: 40,
        marginTop: spacing.s,
        paddingHorizontal: 18,
        borderRadius: 20,
        backgroundColor: colors.primary,
    },
    retryButtonText: {
        color: colors.onPrimary,
        fontSize: 14,
        fontWeight: '600',
    },
    loader: {
        marginVertical: spacing.xl,
    },
    footer: {
        alignItems: 'center',
        gap: spacing.s,
        paddingTop: spacing.l,
    },
    ctaButton: {
        alignSelf: 'stretch',
        minHeight: 54,
        borderRadius: 27,
        backgroundColor: colors.primary,
        alignItems: 'center',
        justifyContent: 'center',
    },
    ctaText: {
        color: colors.onPrimary,
        fontSize: 17,
        fontWeight: '600',
    },
    termsText: {
        fontSize: 12,
        lineHeight: 16,
        color: colors.textTertiary,
        textAlign: 'center',
    },
    restoreButton: {
        minHeight: 40,
        justifyContent: 'center',
        paddingHorizontal: spacing.m,
    },
    restoreButtonText: {
        color: colors.textSecondary,
        fontSize: 14,
        fontWeight: '500',
    },
}));
