import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Modal, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

interface UnlockingOverlayProps {
    visible: boolean;
    title?: string;
    subtitle?: string;
    progress?: number;
    progressLabel?: string;
}

const PROGRESS_WIDTH = 168;
const PROGRESS_FILL_WIDTH = 64;

export const UnlockingOverlay = ({ visible, title, subtitle, progress, progressLabel = 'Progress' }: UnlockingOverlayProps) => {
    const pulse = useRef(new Animated.Value(0)).current;
    const glide = useRef(new Animated.Value(0)).current;
    const isDeterminate = typeof progress === 'number';
    const progressValue = isDeterminate
        ? Math.max(0, Math.min(100, progress))
        : 0;
    const progressText = progressValue < 10 && progressValue % 1 !== 0
        ? progressValue.toFixed(1)
        : String(Math.round(progressValue));

    const pulseStyle = useMemo(() => ({
        opacity: pulse.interpolate({
            inputRange: [0, 1],
            outputRange: [0.22, 0],
        }),
        transform: [{
            scale: pulse.interpolate({
                inputRange: [0, 1],
                outputRange: [0.8, 1.35],
            }),
        }],
    }), [pulse]);

    const glideStyle = useMemo(() => ({
        transform: [{
            translateX: glide.interpolate({
                inputRange: [0, 1],
                outputRange: [-PROGRESS_FILL_WIDTH, PROGRESS_WIDTH],
            }),
        }],
    }), [glide]);

    useEffect(() => {
        if (!visible) return;
        pulse.setValue(0);
        glide.setValue(0);

        const pulseAnimation = Animated.loop(
            Animated.timing(pulse, {
                toValue: 1,
                duration: 1400,
                easing: Easing.out(Easing.quad),
                useNativeDriver: true,
            })
        );

        const glideAnimation = !isDeterminate
            ? Animated.loop(
                Animated.sequence([
                    Animated.timing(glide, {
                        toValue: 1,
                        duration: 700,
                        easing: Easing.inOut(Easing.quad),
                        useNativeDriver: true,
                    }),
                    Animated.timing(glide, {
                        toValue: 0,
                        duration: 700,
                        easing: Easing.inOut(Easing.quad),
                        useNativeDriver: true,
                    }),
                ])
            )
            : null;

        pulseAnimation.start();
        glideAnimation?.start();

        return () => {
            pulseAnimation.stop();
            glideAnimation?.stop();
        };
    }, [visible, pulse, glide, isDeterminate]);

    return (
        <Modal visible={visible} transparent animationType="fade">
            <View style={styles.backdrop}>
                <View style={styles.card}>
                    <View style={styles.iconWrap}>
                        <Animated.View style={[styles.iconPulse, pulseStyle]} />
                        <View style={styles.iconBadge}>
                            <MaterialCommunityIcons name="shield-lock-outline" size={30} color={colors.primary} />
                        </View>
                    </View>
                    <Text style={styles.title}>{title || 'Unlocking notes'}</Text>
                    {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
                    {isDeterminate && (
                        <View style={styles.progressMeta}>
                            <Text style={styles.progressMetaText}>{progressLabel}</Text>
                            <Text style={styles.progressPercent}>{progressText}%</Text>
                        </View>
                    )}
                    <View style={styles.progressTrack}>
                        {isDeterminate ? (
                            <View style={[styles.progressFill, { width: `${progressValue}%` }]} />
                        ) : (
                            <Animated.View style={[styles.progressFill, { width: PROGRESS_FILL_WIDTH }, glideStyle]} />
                        )}
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
        maxWidth: 320,
        backgroundColor: colors.surface,
        borderRadius: 28,
        paddingHorizontal: spacing.l,
        paddingVertical: spacing.xl,
        borderWidth: 1,
        borderColor: colors.border,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.12,
        shadowRadius: 22,
        elevation: 6,
        alignItems: 'center',
    },
    iconWrap: {
        width: 86,
        height: 86,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: spacing.m,
    },
    iconPulse: {
        position: 'absolute',
        width: 86,
        height: 86,
        borderRadius: 43,
        backgroundColor: colors.primary,
    },
    iconBadge: {
        width: 64,
        height: 64,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.primary + '10',
        borderWidth: 1,
        borderColor: colors.primary + '18',
    },
    title: {
        ...typography.h3,
        textAlign: 'center',
        marginBottom: spacing.xs,
    },
    subtitle: {
        ...typography.bodySmall,
        textAlign: 'center',
        color: colors.textSecondary,
        marginBottom: spacing.m,
    },
    progressMeta: {
        width: PROGRESS_WIDTH,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: spacing.xs,
    },
    progressMetaText: {
        ...typography.caption,
        color: colors.textSecondary,
    },
    progressPercent: {
        ...typography.captionBold,
        color: colors.primary,
    },
    progressTrack: {
        width: PROGRESS_WIDTH,
        height: 6,
        borderRadius: 999,
        backgroundColor: colors.backgroundSecondary,
        overflow: 'hidden',
    },
    progressFill: {
        height: 6,
        borderRadius: 999,
        backgroundColor: colors.primary,
        opacity: 0.9,
    },
});
