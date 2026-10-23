import { useTranslation } from 'react-i18next';
import React from 'react';
import {
    View,
    Text,
    Modal,
    TouchableOpacity,
    TouchableWithoutFeedback,
    Switch,
    StyleSheet,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { createStyles } from '../theme/createStyles';

interface TextAppearanceModalProps {
    visible: boolean;
    onClose: () => void;
    fontSize: number;
    onFontSizeChange: (size: number) => void;
    autoScalingEnabled: boolean;
    onAutoScalingChange: (enabled: boolean) => void;
    /** Editing the note's Markdown source instead of formatted text. */
    markdownMode?: boolean;
    onMarkdownModeChange?: (enabled: boolean) => void;
}

export const TextAppearanceModal: React.FC<TextAppearanceModalProps> = ({
    visible,
    onClose,
    fontSize,
    onFontSizeChange,
    autoScalingEnabled,
    onAutoScalingChange,
    markdownMode,
    onMarkdownModeChange,
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
                            <View style={styles.handle} />
                            <View style={styles.header}>
                                <Text style={styles.title}>{t("aux.textAppearance", "Text Appearance")}</Text>
                                <TouchableOpacity
                                    onPress={onClose}
                                    style={styles.closeButton}
                                    hitSlop={8}
                                    accessibilityRole="button"
                                    accessibilityLabel={t('a11y.close', 'Close')}
                                >
                                    <MaterialIcons name="close" size={20} color={colors.textSecondary} />
                                </TouchableOpacity>
                            </View>

                            {/* Font size: a label and a compact stepper on one line */}
                            <View style={styles.row}>
                                <Text style={styles.rowTitle}>{t("aux.fontSize", "Font Size")}</Text>
                                <View style={styles.stepper}>
                                    <TouchableOpacity
                                        style={styles.stepButton}
                                        onPress={decreaseFontSize}
                                        disabled={fontSize <= MIN_FONT_SIZE}
                                        accessibilityRole="button"
                                        accessibilityLabel={t('a11y.decreaseFontSize', 'Decrease font size')}
                                        accessibilityState={{ disabled: fontSize <= MIN_FONT_SIZE }}
                                    >
                                        <MaterialIcons name="remove" size={20} color={fontSize <= MIN_FONT_SIZE ? colors.textMuted : colors.text} />
                                    </TouchableOpacity>
                                    <Text style={styles.fontSizeValue}>{fontSize}</Text>
                                    <TouchableOpacity
                                        style={styles.stepButton}
                                        onPress={increaseFontSize}
                                        disabled={fontSize >= MAX_FONT_SIZE}
                                        accessibilityRole="button"
                                        accessibilityLabel={t('a11y.increaseFontSize', 'Increase font size')}
                                        accessibilityState={{ disabled: fontSize >= MAX_FONT_SIZE }}
                                    >
                                        <MaterialIcons name="add" size={20} color={fontSize >= MAX_FONT_SIZE ? colors.textMuted : colors.text} />
                                    </TouchableOpacity>
                                </View>
                            </View>

                            <View style={styles.divider} />

                            <TouchableOpacity
                                style={styles.row}
                                activeOpacity={0.6}
                                onPress={() => onAutoScalingChange(!autoScalingEnabled)}
                                accessibilityRole="switch"
                                accessibilityState={{ checked: autoScalingEnabled }}
                            >
                                <View style={styles.rowText}>
                                    <Text style={styles.rowTitle}>{t("aux.autoScaleChecklists", "Auto-scale Checklists")}</Text>
                                    <Text style={styles.rowDetail}>
                                        {t('aux.autoScaleDesc', 'Automatically increase size of short checklists for better readability.')}
                                    </Text>
                                </View>
                                <Switch
                                    accessibilityLabel={t('aux.autoScaleChecklists', 'Auto-scale Checklists')}
                                    value={autoScalingEnabled}
                                    onValueChange={onAutoScalingChange}
                                    trackColor={{ false: colors.borderHover, true: colors.primary }}
                                    thumbColor={colors.onPrimary}
                                    ios_backgroundColor={colors.borderHover}
                                />
                            </TouchableOpacity>

                            {onMarkdownModeChange && (
                                <>
                                    <View style={styles.divider} />
                                    <TouchableOpacity
                                        style={styles.row}
                                        activeOpacity={0.6}
                                        onPress={() => onMarkdownModeChange(!markdownMode)}
                                        accessibilityRole="switch"
                                        accessibilityState={{ checked: !!markdownMode }}
                                    >
                                        <View style={styles.rowText}>
                                            <Text style={styles.rowTitle}>{t('aux.markdownSource', 'Edit as Markdown')}</Text>
                                            <Text style={styles.rowDetail}>
                                                {t('aux.markdownSourceDesc', 'Formatting appears as plain characters, like **bold**.')}
                                            </Text>
                                        </View>
                                        <Switch
                                            accessibilityLabel={t('aux.markdownSource', 'Edit as Markdown')}
                                            value={!!markdownMode}
                                            onValueChange={onMarkdownModeChange}
                                            trackColor={{ false: colors.borderHover, true: colors.primary }}
                                            thumbColor={colors.onPrimary}
                                            ios_backgroundColor={colors.borderHover}
                                        />
                                    </TouchableOpacity>
                                </>
                            )}
                        </View>
                    </TouchableWithoutFeedback>
                </View>
            </TouchableWithoutFeedback>
        </Modal>
    );
};

const styles = createStyles(() => ({
    overlay: {
        flex: 1,
        backgroundColor: colors.overlay,
        justifyContent: 'flex-end',
    },
    contentContainer: {
        backgroundColor: colors.surface,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        width: '100%',
        maxWidth: 640,
        alignSelf: 'center',
        paddingHorizontal: spacing.l,
        paddingTop: spacing.s,
        paddingBottom: spacing.xl + 20, // Extra padding for bottom safe area
    },
    handle: {
        alignSelf: 'center',
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: colors.border,
        marginBottom: spacing.m,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: spacing.s,
    },
    title: {
        fontSize: 20,
        lineHeight: 26,
        fontWeight: '700',
        letterSpacing: -0.3,
        color: colors.text,
    },
    closeButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.backgroundSecondary,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.m,
        minHeight: 56,
        paddingVertical: spacing.s,
    },
    rowText: {
        flex: 1,
        gap: 2,
    },
    rowTitle: {
        fontSize: 16,
        lineHeight: 22,
        color: colors.text,
        flexShrink: 1,
    },
    rowDetail: {
        fontSize: 13,
        lineHeight: 18,
        color: colors.textSecondary,
    },
    stepper: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.backgroundSecondary,
        borderRadius: 20,
    },
    stepButton: {
        width: 44,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    fontSizeValue: {
        minWidth: 32,
        fontSize: 16,
        fontWeight: '600',
        color: colors.text,
        textAlign: 'center',
        fontVariant: ['tabular-nums'],
    },
    divider: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: colors.border,
    },
}));
