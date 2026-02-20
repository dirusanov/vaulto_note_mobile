import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Animated, Easing, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

interface AIProcessingIndicatorProps {
    visible: boolean;
    queueSize?: number;
    isTranscribing?: boolean;
    canCancel?: boolean;
    onCancel?: () => void;
}

export const AIProcessingIndicator: React.FC<AIProcessingIndicatorProps> = ({
    visible,
    queueSize = 0,
    isTranscribing = false,
    canCancel = false,
    onCancel,
}) => {
    const fadeAnim = React.useRef(new Animated.Value(0)).current;

    // Animations for AI (Spin)
    const rotateAnim = React.useRef(new Animated.Value(0)).current;

    // Animations for Transcribing (Pulse)
    const pulseAnim = React.useRef(new Animated.Value(1)).current;

    useEffect(() => {
        if (visible) {
            Animated.timing(fadeAnim, {
                toValue: 1,
                duration: 300,
                useNativeDriver: true,
            }).start();

            if (isTranscribing) {
                // Pulse Animation for Transcription
                Animated.loop(
                    Animated.sequence([
                        Animated.timing(pulseAnim, {
                            toValue: 1.2,
                            duration: 800,
                            easing: Easing.inOut(Easing.ease),
                            useNativeDriver: true,
                        }),
                        Animated.timing(pulseAnim, {
                            toValue: 1,
                            duration: 800,
                            easing: Easing.inOut(Easing.ease),
                            useNativeDriver: true,
                        }),
                    ])
                ).start();
                rotateAnim.setValue(0); // Reset rotation
            } else {
                // Spin Animation for AI
                Animated.loop(
                    Animated.timing(rotateAnim, {
                        toValue: 1,
                        duration: 2000,
                        easing: Easing.linear,
                        useNativeDriver: true,
                    })
                ).start();
                pulseAnim.setValue(1); // Reset pulse
            }

        } else {
            Animated.timing(fadeAnim, {
                toValue: 0,
                duration: 300,
                useNativeDriver: true,
            }).start();
            rotateAnim.setValue(0);
            pulseAnim.setValue(1);
        }
    }, [visible, isTranscribing]);

    if (!visible) return null;

    const spin = rotateAnim.interpolate({
        inputRange: [0, 1],
        outputRange: ['0deg', '360deg'],
    });

    return (
        <Animated.View style={[styles.wrapper, { opacity: fadeAnim }]}>
            <View style={styles.container}>
                <View style={styles.iconContainer}>
                    {isTranscribing ? (
                        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                            <MaterialIcons name="graphic-eq" size={24} color={colors.primary} />
                        </Animated.View>
                    ) : (
                        <>
                            <Animated.View style={{ transform: [{ rotate: spin }] }}>
                                <MaterialIcons name="settings" size={20} color={colors.primary} style={{ position: 'absolute', opacity: 0.3 }} />
                            </Animated.View>
                            <MaterialIcons name="smart-toy" size={24} color={colors.primary} />
                        </>
                    )}
                </View>
                <View style={styles.textContainer}>
                    <Text style={styles.title}>
                        {isTranscribing ? 'Transcribing...' : 'AI Agent working...'}
                    </Text>
                    {(!isTranscribing && queueSize > 0) && (
                        <Text style={styles.subtitle}>Tasks in work: {queueSize}</Text>
                    )}
                </View>
            </View>
            {canCancel && onCancel && (
                <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Cancel AI processing"
                    onPress={onCancel}
                    activeOpacity={0.8}
                    style={styles.cancelButton}
                >
                    <MaterialIcons name="close" size={24} color={colors.textSecondary} />
                </TouchableOpacity>
            )}
        </Animated.View>
    );
};

const styles = StyleSheet.create({
    wrapper: {
        position: 'absolute',
        bottom: 70,
        alignSelf: 'center',
        alignItems: 'center',
        zIndex: 9999,
    },
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surface,
        paddingVertical: spacing.s,
        paddingHorizontal: spacing.m,
        borderRadius: 24,
        shadowColor: "#000",
        shadowOffset: {
            width: 0,
            height: 4,
        },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 8,
        borderWidth: 1,
        borderColor: 'rgba(0,0,0,0.05)',
        minWidth: 180,
    },
    iconContainer: {
        marginRight: spacing.m,
        justifyContent: 'center',
        alignItems: 'center',
        width: 24,
        height: 24,
    },
    textContainer: {
        flexDirection: 'column',
        flexShrink: 1,
    },
    title: {
        ...typography.body2,
        fontWeight: '600',
        color: colors.text,
    },
    subtitle: {
        ...typography.caption,
        color: colors.textSecondary,
    },
    cancelButton: {
        marginTop: spacing.s,
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: "#000",
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 4,
        borderWidth: 1,
        borderColor: 'rgba(0,0,0,0.05)',
    },
});
