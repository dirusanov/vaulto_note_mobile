import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Platform } from 'react-native';
import { useSubscription, MergedPackage } from '../context/SubscriptionContext';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { MaterialIcons } from '@expo/vector-icons';

export const PaywallScreen = () => {
    const { packages, purchasePackage, restorePurchases, isLoading, isPro } = useSubscription();
    const navigation = useNavigation();

    const handlePurchase = async (pack: MergedPackage) => {
        const purchased = await purchasePackage(pack);
        if (purchased || isPro) {
            navigation.goBack();
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.closeButton}>
                    <MaterialIcons name="close" size={24} color={colors.textSecondary} />
                </TouchableOpacity>
                <Text style={styles.title}>Unlock Premium</Text>
            </View>

            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                <View style={styles.heroSection}>
                    <MaterialIcons name="diamond" size={64} color={colors.primary} />
                    <Text style={styles.heroTitle}>Go Pro</Text>
                    <Text style={styles.heroSubtitle}>
                        Unlimited access to advanced AI features and secure synchronization.
                    </Text>
                </View>

                <View style={styles.features}>
                    <FeatureItem text="Unlimited Cloud Sync" icon="cloud-queue" />
                    <FeatureItem text="Advanced Encryption" icon="security" />
                    <FeatureItem text="Priority Support" icon="support-agent" />
                    <FeatureItem text="No Ads" icon="block" />
                    <FeatureItem text="Extended Transcription Limits" icon="graphic-eq" />
                </View>

                {isLoading ? (
                    <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
                ) : (
                    <View style={styles.packagesContainer}>
                        {packages.map((pack) => {
                            const { rcPackage, backendPlan, product } = pack;
                            // Prefer backend display name if available, otherwise store title
                            const title = backendPlan?.display_name || product.title;
                            const description = product.description;
                            const price = product.priceString;
                            const isBestValue = pack.identifier.toLowerCase().includes('annual');

                            return (
                                <TouchableOpacity
                                    key={pack.identifier}
                                    style={[styles.packageButton, isBestValue && styles.packageButtonBest]}
                                    onPress={() => handlePurchase(pack)}
                                    activeOpacity={0.9}
                                >
                                    {isBestValue && (
                                        <View style={styles.bestValueBadge}>
                                            <Text style={styles.bestValueText}>BEST VALUE</Text>
                                        </View>
                                    )}
                                    <View style={styles.packageContent}>
                                        <View>
                                            <Text style={[styles.packageTitle, isBestValue && styles.packageTitleBest]}>{title}</Text>
                                            <Text style={[styles.packageDescription, isBestValue && styles.packageDescriptionBest]}>{description}</Text>
                                        </View>
                                        <Text style={[styles.packagePrice, isBestValue && styles.packagePriceBest]}>{price}</Text>
                                    </View>
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                )}

                <TouchableOpacity onPress={restorePurchases} style={styles.restoreButton}>
                    <Text style={styles.restoreButtonText}>Restore Purchases</Text>
                </TouchableOpacity>

                <Text style={styles.termsText}>
                    Subscription automatically renews unless auto-renew is turned off at least 24-hours before the end of the current period.
                </Text>
            </ScrollView>
        </SafeAreaView>
    );
};

const FeatureItem = ({ text, icon }: { text: string; icon: keyof typeof MaterialIcons.glyphMap }) => (
    <View style={styles.featureRow}>
        <View style={styles.featureIconContainer}>
            <MaterialIcons name={icon} size={20} color={colors.primary} />
        </View>
        <Text style={styles.featureText}>{text}</Text>
    </View>
);

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.background,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
    },
    closeButton: {
        position: 'absolute',
        top: 16,
        left: 16,
        zIndex: 1,
        padding: 4,
    },
    title: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.text,
    },
    content: {
        padding: 24,
        paddingBottom: 40,
    },
    heroSection: {
        alignItems: 'center',
        marginBottom: 40,
        marginTop: 20,
    },
    heroTitle: {
        fontSize: 32,
        fontWeight: 'bold',
        color: colors.text,
        marginTop: 16,
        marginBottom: 8,
    },
    heroSubtitle: {
        fontSize: 16,
        color: colors.textSecondary,
        textAlign: 'center',
        paddingHorizontal: 20,
        lineHeight: 22,
    },
    description: {
        fontSize: 16,
        color: colors.textSecondary,
        textAlign: 'center',
        marginBottom: 32,
        lineHeight: 24,
    },
    features: {
        marginBottom: 40,
        backgroundColor: colors.surface,
        borderRadius: 16,
        padding: 20,
        // Shadow for iOS
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        // Elevation for Android
        elevation: 2,
    },
    featureRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
    featureIconContainer: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: colors.primary + '15', // 15% opacity
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 16,
    },
    featureText: {
        fontSize: 16,
        color: colors.text,
        fontWeight: '500',
    },
    loader: {
        marginTop: 20,
    },
    packagesContainer: {
        gap: 16,
    },
    packageButton: {
        backgroundColor: colors.surface,
        padding: 20,
        borderRadius: 16,
        marginBottom: 0,
        borderWidth: 1,
        borderColor: colors.border,
        // Shadow
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
        elevation: 2,
    },
    packageButtonBest: {
        backgroundColor: colors.primary,
        borderColor: colors.primary,
    },
    bestValueBadge: {
        position: 'absolute',
        top: -10,
        right: 16,
        backgroundColor: colors.accentYellow,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
        zIndex: 2,
    },
    bestValueText: {
        fontSize: 10,
        fontWeight: 'bold',
        color: colors.text,
    },
    packageContent: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    packageTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: colors.text,
        marginBottom: 4,
    },
    packageTitleBest: {
        color: '#fff',
    },
    packagePrice: {
        fontSize: 20,
        fontWeight: 'bold',
        color: colors.primary,
    },
    packagePriceBest: {
        color: '#fff',
    },
    packageDescription: {
        fontSize: 14,
        color: colors.textSecondary,
        maxWidth: 200,
    },
    packageDescriptionBest: {
        color: 'rgba(255,255,255,0.9)',
    },
    restoreButton: {
        marginTop: 32,
        alignItems: 'center',
        padding: 12,
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
