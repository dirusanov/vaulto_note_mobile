import React, { useEffect, useRef, useState } from 'react';
import { Text, View, Animated, Easing, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { createStyles } from '../theme/createStyles';

interface Props {
    visible: boolean;
    onDevice?: boolean;
    onOpenSettings?: () => void;
}

export const TranscriptionIndicator: React.FC<Props> = ({ visible, onDevice, onOpenSettings }) => {
    const { t } = useTranslation();
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const pulseAnim = useRef(new Animated.Value(1)).current;
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
        setElapsed(0);
        if (!visible) return;
        const started = Date.now();
        const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
        return () => clearInterval(timer);
    }, [visible]);

    useEffect(() => {
        let pulse: ReturnType<typeof Animated.loop> | undefined;
        if (visible) {
            Animated.timing(fadeAnim, {
                toValue: 1,
                duration: 300,
                easing: Easing.out(Easing.ease),
                useNativeDriver: true,
            }).start();

            pulse = Animated.loop(
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
            );
            pulse.start();
        } else {
            Animated.timing(fadeAnim, {
                toValue: 0,
                duration: 300,
                easing: Easing.in(Easing.ease),
                useNativeDriver: true,
            }).start(() => pulseAnim.stopAnimation());
        }
        return () => { pulse?.stop(); pulseAnim.stopAnimation(); fadeAnim.stopAnimation(); };
    }, [visible, fadeAnim, pulseAnim]);

    if (!visible) return null;

    return (
        <Animated.View style={[
            styles.container,
            {
                opacity: fadeAnim,
                transform: [{
                    translateY: fadeAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [10, 0]
                    })
                }]
            }
        ]}>
            <View style={styles.content}>
                <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                    <MaterialIcons name="graphic-eq" size={20} color={colors.primary} />
                </Animated.View>
                <Text style={styles.text}>
                    {onDevice ? t('voice.transcribingLocal', 'Transcribing on this device…') : t('voice.transcribingCloud', 'Transcribing in the cloud…')}
                    {elapsed >= 3 ? ` · ${t('voice.processingSeconds', '{{seconds}} s', { seconds: elapsed })}` : ''}
                </Text>
            </View>
            {onDevice && elapsed >= 30 && (
                <View style={{ marginTop: 8 }}>
                    <Text style={styles.slowHint}>{t('voice.slowOnDevice', 'This recording is still processing on the device. For future recordings, cloud processing may be faster when online.')}</Text>
                    {!!onOpenSettings && (
                        <TouchableOpacity onPress={onOpenSettings} accessibilityRole="button" style={{ paddingVertical: 8 }}>
                            <Text style={[styles.text, { color: colors.primary }]}>{t('common.settings', 'Settings')}</Text>
                        </TouchableOpacity>
                    )}
                </View>
            )}
        </Animated.View>
    );
};

const styles = createStyles(() => ({
    container: {
        position: 'absolute',
        bottom: 80, // Positioned above the microphone button
        alignSelf: 'center',
        backgroundColor: colors.surface,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
        elevation: 4,
        zIndex: 100, // Ensure it's above other elements
        maxWidth: '90%',
    },
    content: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    text: {
        ...typography.caption,
        color: colors.text,
        fontWeight: '500',
        flexShrink: 1,
    },
    slowHint: {
        ...typography.caption,
        color: colors.textSecondary,
    },
}));
