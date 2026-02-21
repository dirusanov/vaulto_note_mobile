import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing, TouchableOpacity, ScrollView } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

export interface AIActiveTask {
    id: string;
    text: string;
    isTranscribing?: boolean;
}

interface AIProcessingIndicatorProps {
    visible: boolean;
    tasks: AIActiveTask[];
    onCancelTask?: (taskId: string) => void;
}

const AIAnimatedIcon = () => {
    const rotateAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.loop(
            Animated.timing(rotateAnim, {
                toValue: 1,
                duration: 2000,
                easing: Easing.linear,
                useNativeDriver: true,
            })
        ).start();
    }, [rotateAnim]);

    const spin = rotateAnim.interpolate({
        inputRange: [0, 1],
        outputRange: ['0deg', '360deg'],
    });

    return (
        <View style={styles.iconContainer}>
            <Animated.View style={{ transform: [{ rotate: spin }] }}>
                <MaterialIcons name="settings" size={16} color={colors.primary} style={{ position: 'absolute', opacity: 0.3 }} />
            </Animated.View>
            <MaterialIcons name="smart-toy" size={20} color={colors.primary} />
        </View>
    );
};

export const AIProcessingIndicator: React.FC<AIProcessingIndicatorProps> = ({
    visible,
    tasks = [],
    onCancelTask,
}) => {
    const fadeAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (visible && tasks.length > 0) {
            Animated.spring(fadeAnim, {
                toValue: 1,
                useNativeDriver: true,
                speed: 12,
                bounciness: 6,
            }).start();
        } else {
            Animated.timing(fadeAnim, {
                toValue: 0,
                duration: 200,
                useNativeDriver: true,
            }).start();
        }
    }, [visible, tasks.length, fadeAnim]);

    if (!visible || tasks.length === 0) return null;

    const filteredTasks = tasks.filter(t => !t.isTranscribing);

    return (
        <Animated.View style={[styles.wrapper, { opacity: fadeAnim, transform: [{ translateY: fadeAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }]}>
            <ScrollView
                style={styles.listContainer}
                contentContainerStyle={styles.listContentContainer}
                showsVerticalScrollIndicator={false}
            >
                {filteredTasks.map((task, index) => (
                    <View key={task.id} style={[styles.container, index > 0 && { marginTop: spacing.s }]}>
                        <AIAnimatedIcon />
                        <View style={styles.textContainer}>
                            <Text style={styles.title} numberOfLines={1}>
                                AI Agent working...
                            </Text>
                            {!!task.text && (
                                <Text style={styles.subtitle} numberOfLines={2}>
                                    "{task.text}"
                                </Text>
                            )}
                        </View>
                        {!!onCancelTask && (
                            <TouchableOpacity
                                accessibilityRole="button"
                                accessibilityLabel="Cancel task"
                                onPress={() => onCancelTask(task.id)}
                                activeOpacity={0.7}
                                style={styles.taskCancelButton}
                            >
                                <MaterialIcons name="close" size={18} color={colors.textSecondary} />
                            </TouchableOpacity>
                        )}
                    </View>
                ))}
            </ScrollView>
        </Animated.View>
    );
};

const styles = StyleSheet.create({
    wrapper: {
        position: 'absolute',
        bottom: 140,
        alignSelf: 'center',
        alignItems: 'center',
        zIndex: 9999,
        maxWidth: '90%',
        maxHeight: 250, // Added to limit height when multiple notifications are present
    },
    listContainer: {
        width: '100%',
    },
    listContentContainer: {
        alignItems: 'center',
        paddingVertical: spacing.s,
    },
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        paddingVertical: spacing.s,
        paddingHorizontal: spacing.m,
        borderRadius: 20,
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
        alignSelf: 'center',
    },
    iconContainer: {
        marginRight: spacing.m,
        justifyContent: 'center',
        alignItems: 'center',
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: colors.primary + '15',
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
        fontStyle: 'italic',
        marginTop: 2,
    },
    taskCancelButton: {
        marginLeft: spacing.s,
        padding: spacing.xs,
        borderRadius: 12,
        backgroundColor: colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(0,0,0,0.1)',
    },
});
