import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Modal, StyleSheet, Text, View } from 'react-native';
import { ActivityIndicator } from 'react-native';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

interface UnlockingOverlayProps {
    visible: boolean;
    title?: string;
    subtitle?: string;
}

export const UnlockingOverlay = ({ visible, title, subtitle }: UnlockingOverlayProps) => {
    const barWidth = 220;
    const shimmerWidth = 80;
    const translate = useRef(new Animated.Value(-shimmerWidth)).current;

    const shimmerStyle = useMemo(() => ({
        transform: [{ translateX: translate }],
    }), [translate]);

    useEffect(() => {
        if (!visible) return;
        translate.setValue(-shimmerWidth);
        const animation = Animated.loop(
            Animated.timing(translate, {
                toValue: barWidth,
                duration: 1200,
                useNativeDriver: true,
            })
        );
        animation.start();
        return () => animation.stop();
    }, [visible, translate, barWidth, shimmerWidth]);

    return (
        <Modal visible={visible} transparent animationType="fade">
            <View style={styles.backdrop}>
                <View style={styles.card}>
                    <Text style={styles.title}>{title || 'Unlocking sync'}</Text>
                    <Text style={styles.subtitle}>
                        {subtitle || 'Decrypting your sync key. This may take a few seconds.'}
                    </Text>
                    <View style={styles.row}>
                        <ActivityIndicator size="small" color={colors.primary} />
                        <Text style={styles.progressText}>Working…</Text>
                    </View>
                    <View style={[styles.progressTrack, { width: barWidth }]}>
                        <Animated.View style={[styles.progressShimmer, shimmerStyle]} />
                    </View>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.35)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: spacing.l,
    },
    card: {
        width: '100%',
        maxWidth: 360,
        backgroundColor: colors.surface,
        borderRadius: 20,
        padding: spacing.l,
        borderWidth: 1,
        borderColor: colors.border,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 3,
    },
    title: {
        ...typography.h2,
        marginBottom: spacing.s,
    },
    subtitle: {
        ...typography.body,
        color: colors.textSecondary,
        marginBottom: spacing.m,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
        marginBottom: spacing.m,
    },
    progressText: {
        ...typography.caption,
        color: colors.textSecondary,
    },
    progressTrack: {
        height: 6,
        borderRadius: 6,
        backgroundColor: colors.backgroundSecondary,
        overflow: 'hidden',
    },
    progressShimmer: {
        width: 80,
        height: 6,
        borderRadius: 6,
        backgroundColor: colors.primary,
        opacity: 0.35,
    },
});
