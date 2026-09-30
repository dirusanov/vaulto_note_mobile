import { useTranslation } from 'react-i18next';
import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    Modal,
    TouchableOpacity,
    TouchableWithoutFeedback,
    Switch,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

interface TextAppearanceModalProps {
    visible: boolean;
    onClose: () => void;
    fontSize: number;
    onFontSizeChange: (size: number) => void;
    autoScalingEnabled: boolean;
    onAutoScalingChange: (enabled: boolean) => void;
}

export const TextAppearanceModal: React.FC<TextAppearanceModalProps> = ({
    visible,
    onClose,
    fontSize,
    onFontSizeChange,
    autoScalingEnabled,
    onAutoScalingChange,
}) => {
    const { t } = useTranslation();

    // Font size range
    const MIN_FONT_SIZE = 12;
    const MAX_FONT_SIZE = 32;
    const STEP = 2;

    const increaseFontSize = () => {
        if (fontSize < MAX_FONT_SIZE) {
            onFontSizeChange(fontSize + STEP);
        }
    };

    const decreaseFontSize = () => {
        if (fontSize > MIN_FONT_SIZE) {
            onFontSizeChange(fontSize - STEP);
        }
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
        >
            <TouchableWithoutFeedback onPress={onClose}>
                <View style={styles.overlay}>
                    <TouchableWithoutFeedback>
                        <View style={styles.contentContainer}>
                            <View style={styles.header}>
                                <Text style={styles.title}>{t("aux.textAppearance", "Text Appearance")}</Text>
                                <TouchableOpacity
                                    onPress={onClose}
                                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                    accessibilityRole="button"
                                    accessibilityLabel={t('a11y.close', 'Close')}
                                >
                                    <MaterialIcons name="close" size={24} color={colors.textSecondary} />
                                </TouchableOpacity>
                            </View>

                            {/* Font Size Control */}
                            <View style={styles.section}>
                                <View style={styles.sectionHeader}>
                                    <MaterialIcons name="format-size" size={24} color={colors.text} />
                                    <Text style={styles.sectionTitle}>{t("aux.fontSize", "Font Size")}</Text>
                                </View>

                                <View style={styles.fontSizeControl}>
                                    <TouchableOpacity
                                        style={[styles.sizeButton, fontSize <= MIN_FONT_SIZE && styles.disabledButton]}
                                        onPress={decreaseFontSize}
                                        disabled={fontSize <= MIN_FONT_SIZE}
                                        accessibilityRole="button"
                                        accessibilityLabel={t('a11y.decreaseFontSize', 'Decrease font size')}
                                        accessibilityState={{ disabled: fontSize <= MIN_FONT_SIZE }}
                                    >
                                        <MaterialIcons name="remove" size={24} color={fontSize <= MIN_FONT_SIZE ? colors.textMuted : colors.text} />
                                    </TouchableOpacity>

                                    <Text style={styles.fontSizeValue}>{fontSize}</Text>

                                    <TouchableOpacity
                                        style={[styles.sizeButton, fontSize >= MAX_FONT_SIZE && styles.disabledButton]}
                                        onPress={increaseFontSize}
                                        disabled={fontSize >= MAX_FONT_SIZE}
                                        accessibilityRole="button"
                                        accessibilityLabel={t('a11y.increaseFontSize', 'Increase font size')}
                                        accessibilityState={{ disabled: fontSize >= MAX_FONT_SIZE }}
                                    >
                                        <MaterialIcons name="add" size={24} color={fontSize >= MAX_FONT_SIZE ? colors.textMuted : colors.text} />
                                    </TouchableOpacity>
                                </View>
                            </View>

                            <View style={styles.divider} />

                            {/* Auto Scaling Toggle */}
                            <View style={styles.sectionRow}>
                                <View style={styles.sectionInfo}>
                                    <View style={styles.sectionHeader}>
                                        <MaterialIcons name="aspect-ratio" size={24} color={colors.text} />
                                        <Text style={styles.sectionTitle}>{t("aux.autoScaleChecklists", "Auto-scale Checklists")}</Text>
                                    </View>
                                    <Text style={styles.sectionDescription}>
                                        {t('aux.autoScaleDesc', 'Automatically increase size of short checklists for better readability.')}
                                    </Text>
                                </View>
                                <Switch
                                    accessibilityLabel={t('aux.autoScaleChecklists', 'Auto-scale Checklists')}
                                    value={autoScalingEnabled}
                                    onValueChange={onAutoScalingChange}
                                    trackColor={{ false: colors.textMuted, true: colors.primary }}
                                    thumbColor={colors.surface}
                                />
                            </View>

                        </View>
                    </TouchableWithoutFeedback>
                </View>
            </TouchableWithoutFeedback>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: colors.overlay,
        justifyContent: 'flex-end',
    },
    contentContainer: {
        backgroundColor: colors.surface,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        padding: spacing.l,
        paddingBottom: spacing.xl + 20, // Extra padding for bottom safe area
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: spacing.l,
    },
    title: {
        ...typography.h3,
    },
    section: {

    },
    sectionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    sectionInfo: {
        flex: 1,
        paddingRight: spacing.m,
    },
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: spacing.xs,
    },
    sectionTitle: {
        ...typography.bodyLarge,
        fontWeight: '600',
        marginLeft: spacing.s,
    },
    sectionDescription: {
        ...typography.bodySmall,
        marginTop: 2,
    },
    fontSizeControl: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: spacing.s,
        backgroundColor: colors.background,
        borderRadius: 12,
        padding: spacing.xs,
    },
    sizeButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.surface,
        borderRadius: 8,
        shadowColor: "#000",
        shadowOffset: {
            width: 0,
            height: 1,
        },
        shadowOpacity: 0.1,
        shadowRadius: 1,
        elevation: 2,
    },
    disabledButton: {
        opacity: 0.5,
        elevation: 0,
    },
    fontSizeValue: {
        ...typography.h2,
        minWidth: 40,
        textAlign: 'center',
    },
    divider: {
        height: 1,
        backgroundColor: colors.border,
        marginVertical: spacing.l,
    },
});
