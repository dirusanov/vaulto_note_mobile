import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

interface AIProcessingIndicatorProps {
    visible: boolean;
    queueSize?: number;
}

export const AIProcessingIndicator: React.FC<AIProcessingIndicatorProps> = ({
    visible,
    queueSize = 0
}) => {
    const fadeAnim = React.useRef(new Animated.Value(0)).current;
    const rotateAnim = React.useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (visible) {
            Animated.timing(fadeAnim, {
                toValue: 1,
                duration: 300,
                useNativeDriver: true,
            }).start();

            // Continuous rotation loop
            const spin = Animated.loop(
                Animated.timing(rotateAnim, {
                    toValue: 1,
                    duration: 2000,
                    easing: Easing.linear,
                    useNativeDriver: true,
                })
            );
            spin.start();

            return () => spin.stop();
        } else {
            Animated.timing(fadeAnim, {
                toValue: 0,
                duration: 300,
                useNativeDriver: true,
            }).start();
            rotateAnim.setValue(0);
        }
    }, [visible]);

    if (!visible) return null;

    // Interpolate rotation
    const spin = rotateAnim.interpolate({
        inputRange: [0, 1],
        outputRange: ['0deg', '360deg'],
    });

    return (
        <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
            <View style={styles.iconContainer}>
                <Animated.View style={{ transform: [{ rotate: spin }] }}>
                    <MaterialIcons name="settings" size={20} color={colors.primary} style={{ position: 'absolute', opacity: 0.3 }} />
                </Animated.View>
                <MaterialIcons name="smart-toy" size={24} color={colors.primary} />
            </View>
            <View style={styles.textContainer}>
                <Text style={styles.title}>AI Agent working...</Text>
                {queueSize > 0 && (
                    <Text style={styles.subtitle}>{queueSize} task{queueSize > 1 ? 's' : ''} pending</Text>
                )}
            </View>
        </Animated.View>
    );
};

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        bottom: 100, // Above typical FAB or keyboard area
        alignSelf: 'center',
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
        zIndex: 9999,
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
    },
    title: {
        ...typography.body2,
        fontWeight: '600',
        color: colors.text,
    },
    subtitle: {
        ...typography.caption,
        color: colors.textSecondary,
    }
});
