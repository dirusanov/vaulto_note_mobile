import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useEncryption } from '../context/EncryptionContext';
import { ScreenContainer } from './ScreenContainer';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

export const EncryptionGate = ({ children }: { children: React.ReactNode }) => {
    const { status } = useEncryption();
    const hasShownContentRef = useRef(false);

    useEffect(() => {
        if (status !== 'loading') {
            hasShownContentRef.current = true;
        }
    }, [status]);

    if (status === 'loading' && !hasShownContentRef.current) {
        return (
            <ScreenContainer>
                <View style={styles.center}>
                    <ActivityIndicator size="large" color={colors.primary} />
                    <Text style={styles.text}>Preparing encrypted storage...</Text>
                </View>
            </ScreenContainer>
        );
    }

    if (status === 'loading') {
        return (
            <View style={styles.overlayContainer}>
                {children}
                <View style={styles.loadingOverlay} pointerEvents="none">
                    <ActivityIndicator size="large" color={colors.primary} />
                    <Text style={styles.text}>Preparing encrypted storage...</Text>
                </View>
            </View>
        );
    }

    return <>{children}</>;
};

const styles = StyleSheet.create({
    center: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.l,
    },
    text: {
        ...typography.body,
        color: colors.textSecondary,
        marginTop: spacing.m,
    },
    overlayContainer: {
        flex: 1,
    },
    loadingOverlay: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.72)',
    },
});
