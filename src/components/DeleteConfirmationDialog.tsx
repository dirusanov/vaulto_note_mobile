import { useTranslation } from 'react-i18next';
import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Modal, Animated, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { createStyles } from '../theme/createStyles';


interface DeleteConfirmationDialogProps {
    visible: boolean;
    noteCount?: number;
    title?: string;
    message?: string;
    onConfirm: () => void;
    onCancel: () => void;
}

export const DeleteConfirmationDialog = ({
    visible,
    noteCount = 1,
    title,
    message,
    onConfirm,
    onCancel,
}: DeleteConfirmationDialogProps) => {
    const { t } = useTranslation();

    const scaleAnim = useRef(new Animated.Value(0.85)).current;
    const opacityAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (visible) {
            Animated.parallel([
                Animated.spring(scaleAnim, {
                    toValue: 1,
                    friction: 7,
                    tension: 50,
                    useNativeDriver: true,
                }),
                Animated.timing(opacityAnim, {
                    toValue: 1,
                    duration: 300,
                    useNativeDriver: true,
                }),
            ]).start();
        } else {
            scaleAnim.setValue(0.85);
            opacityAnim.setValue(0);
        }
    }, [visible]);

    return (
        <Modal
            visible={visible}
            transparent={true}
            animationType="none"
            onRequestClose={onCancel}
            statusBarTranslucent
        >
            <View style={styles.overlay}>
                <Animated.View
                    style={[
                        styles.dialogContainer,
                        {
                            opacity: opacityAnim,
                            transform: [{ scale: scaleAnim }],
                        },
                    ]}
                >
                    <View style={styles.dialog}>
                        {/* Status Bar Indicator */}
                        <View style={styles.topAccent} />

                        {/* Icon Container */}
                        <View style={styles.iconWrapper}>
                            <View style={styles.iconCircle}>
                                <MaterialIcons name="delete-forever" size={42} color={colors.error} />
                            </View>
                        </View>

                        {/* Title */}
                        <Text style={styles.title}>
                            {title || (noteCount === 1 ? t("aux.deleteNoteTitle") : t("aux.deleteNotesTitle", { count: noteCount }))}
                        </Text>

                        {/* Message */}
                        <Text style={styles.message}>
                            {message || t("aux.permanentActionDesc")}
                        </Text>

                        {/* Actions */}
                        <View style={styles.buttonRow}>
                            <TouchableOpacity
                                style={[styles.btn, styles.btnCancel]}
                                onPress={onCancel}
                                activeOpacity={0.7}
                            >
                                <Text style={styles.btnCancelText}>{t("aux.keepIt", "Keep it")}</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[styles.btn, styles.btnDelete]}
                                onPress={onConfirm}
                                activeOpacity={0.9}
                            >
                                <Text style={styles.btnDeleteText}>{t("aux.deleteBtn", "Delete")}</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </Animated.View>
            </View>
        </Modal>
    );
};

const styles = createStyles(() => ({
    overlay: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.6)', // Darker overlay for more focus
    },
    dialogContainer: {
        width: '88%',
        maxWidth: 360,
    },
    dialog: {
        backgroundColor: colors.surface,
        borderRadius: 32,
        padding: spacing.xl,
        alignItems: 'center',
        overflow: 'hidden',
        // Sophisticated shadow for premium feel
        ...Platform.select({
            ios: {
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 20 },
                shadowOpacity: 0.2,
                shadowRadius: 30,
            },
            android: {
                elevation: 24,
            },
        }),
    },
    topAccent: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 6,
        backgroundColor: colors.error,
        opacity: 0.8,
    },
    iconWrapper: {
        marginBottom: spacing.l,
        marginTop: spacing.s,
    },
    iconCircle: {
        width: 84,
        height: 84,
        borderRadius: 42,
        backgroundColor: `${colors.error}10`,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: `${colors.error}20`,
    },
    title: {
        ...typography.h3,
        fontSize: 24,
        fontWeight: '700',
        color: colors.text,
        marginBottom: spacing.s,
        textAlign: 'center',
    },
    message: {
        ...typography.body,
        fontSize: 16,
        color: colors.textSecondary,
        textAlign: 'center',
        lineHeight: 22,
        marginBottom: spacing.xxl,
        paddingHorizontal: spacing.m,
    },
    buttonRow: {
        flexDirection: 'row',
        gap: spacing.m,
        width: '100%',
    },
    btn: {
        flex: 1,
        height: 56,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    btnCancel: {
        backgroundColor: colors.backgroundSecondary,
    },
    btnCancelText: {
        ...typography.button,
        color: colors.text,
        fontWeight: '600',
    },
    btnDelete: {
        backgroundColor: colors.error,
        // Glossy effect logic removed for simplicity, using solid premium red
        shadowColor: colors.error,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.3,
        shadowRadius: 12,
        elevation: 6,
    },
    btnDeleteText: {
        ...typography.button,
        color: '#FFFFFF',
        fontWeight: '700',
    },
}));
