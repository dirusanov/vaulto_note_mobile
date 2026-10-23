import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { View, Text, Animated, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { createStyles } from '../theme/createStyles';

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


export const AIProcessingIndicator: React.FC<AIProcessingIndicatorProps> = ({
    visible,
    tasks = [],
    onCancelTask,
}) => {
    const { t } = useTranslation();
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

    const filteredTasks = tasks.filter(task => !task.isTranscribing);

    return (
        <Animated.View style={[styles.wrapper, { opacity: fadeAnim, transform: [{ translateY: fadeAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }]}>
            <ScrollView
                style={styles.listContainer}
                contentContainerStyle={styles.listContentContainer}
                showsVerticalScrollIndicator={false}
            >
                {filteredTasks.map((task, index) => (
                    <View key={task.id} style={[styles.container, index > 0 && { marginTop: spacing.s }]}>
                        <ActivityIndicator size="small" color={colors.primary} style={styles.spinner} />
                        <View style={styles.textContainer}>
                            <Text style={styles.title} numberOfLines={1}>
                                {t('aux.aiWorking', 'AI Agent working...')}
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
                                accessibilityLabel={t('a11y.cancelTask', 'Cancel task')}
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

const styles = createStyles(() => ({
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
    // Room around the pill so the ScrollView does not clip its shadow into a box.
    listContentContainer: {
        alignItems: 'center',
        paddingVertical: spacing.m,
        paddingHorizontal: spacing.m,
    },
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        // Opaque: Android draws the elevation shadow through a translucent fill as a grey box.
        backgroundColor: colors.surface,
        paddingVertical: spacing.s,
        paddingStart: spacing.m,
        paddingEnd: spacing.s,
        minHeight: 56,
        borderRadius: 28,
        shadowColor: "#000",
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 3,
        alignSelf: 'center',
    },
    spinner: {
        marginEnd: spacing.m,
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
        marginTop: 2,
    },
    taskCancelButton: {
        marginStart: spacing.m,
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: colors.backgroundSecondary,
        alignItems: 'center',
        justifyContent: 'center',
    },
}));
