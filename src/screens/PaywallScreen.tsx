import { useTranslation } from 'react-i18next';
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Image, Alert } from 'react-native';
import { useSubscription, MergedPackage } from '../context/SubscriptionContext';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '../hooks/useAuth';

export const PaywallScreen = () => {
    const { t } = useTranslation();
    const { packages, purchasePackage, restorePurchases, isLoading, isPro } = useSubscription();
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

    const handlePurchase = async (pack: MergedPackage) => {
        if (!canPurchase) {
            Alert.alert('Sign in required', 'Create an account to purchase Pro.');
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
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.closeButton}>
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
                        <Text style={styles.heroTitle}>{t("aux.proAccess", "PRO ACCESS")}</Text>
                        <Text style={styles.heroSubtitle}>
                            Unlock the full potential.
                        </Text>
                    </View>

                    <View style={styles.featuresList}>
                        <FeatureItem text="Unlimited Cloud Sync" />
                        <FeatureItem text={`${transcriptionMinutes} mins/month transcription with Vaulto AI`} />
                        <FeatureItem text="Custom API Key & Server" />
                    </View>

                    {isLoading ? (
                        <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
                    ) : (
                        <View style={styles.packagesContainer}>
                            {packages.map((pack) => {
                                const { backendPlan, product } = pack;
                                const title = backendPlan?.display_name || (
                                    pack.identifier.toLowerCase().includes('annual') || pack.identifier.toLowerCase().includes('yearly')
                                        ? 'Yearly Plan'
                                        : pack.identifier.toLowerCase().includes('monthly')
                                            ? 'Monthly Plan'
                                            : pack.identifier
                                );
                                
                                const price = product.priceString;
                                const isBestValue = pack.identifier.toLowerCase().includes('annual') || pack.identifier.toLowerCase().includes('yearly');
                                const minutesToDisplay = backendPlan?.transcription_minutes || transcriptionMinutes;
                                const minutesLabel = minutesToDisplay ? `${minutesToDisplay} Vaulto AI minutes / month` : null;

                                return (
                                    <TouchableOpacity
                                        key={pack.identifier}
                                        style={[styles.planCard, isBestValue && styles.planCardBest]}
                                        onPress={() => handlePurchase(pack)}
                                        activeOpacity={0.9}
                                        disabled={!canPurchase || isLoading}
                                    >
                                        <View style={styles.planHeader}>
                                            <Text style={[styles.planTitle, isBestValue && styles.planTitleBest]}>{title}</Text>
                                            <View style={styles.badgesContainer}>
                                                {isBestValue && savingsPercentage > 0 && (
                                                    <View style={[styles.badge, styles.savingsBadge]}>
                                                        <Text style={styles.badgeText}>SAVE {savingsPercentage}%</Text>
                                                    </View>
                                                )}
                                                {isBestValue && (
                                                    <View style={styles.badge}>
                                                        <Text style={styles.badgeText}>{t("aux.bestValue", "BEST VALUE")}</Text>
                                                    </View>
                                                )}
                                            </View>
                                        </View>
                                        <Text style={[styles.planPrice, isBestValue && styles.planPriceBest]}>{price}</Text>
                                        {minutesLabel ? (
                                            <Text style={[styles.planMinutes, isBestValue && styles.planMinutesBest]}>
                                                {minutesLabel}
                                            </Text>
                                        ) : null}
                                        <Text style={[styles.planSubtext, isBestValue && styles.planSubtextBest]}>
                                            {product.description}
                                        </Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>
                    )}
                </View>

                <View style={styles.footer}>
                    <TouchableOpacity
                        onPress={() => {
                            if (!canPurchase) {
                                Alert.alert('Sign in required', 'Sign in to restore purchases.');
                                (navigation as any).navigate('SignIn');
                                return;
                            }
                            restorePurchases();
                        }}
                        style={styles.restoreButton}
                        disabled={!canPurchase}
                    >
                        <Text style={styles.restoreButtonText}>{t("aux.restorePurchases", "Restore Purchases")}</Text>
                    </TouchableOpacity>

                    <Text style={styles.termsText}>
                        Auto-renewable. Cancel anytime.
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

const styles = StyleSheet.create({
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
        backgroundColor: colors.surface,
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
});
