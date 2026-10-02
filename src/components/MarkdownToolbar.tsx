import React, { useState } from 'react';
import { View, TouchableOpacity, ScrollView, Platform, Modal, Text, TouchableWithoutFeedback } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import {
    findHighlightPaletteEntry,
    highlightPalette,
    normalizeHighlightColorForCss,
} from '../utils/highlightColors';
import { createStyles } from '../theme/createStyles';

export type MarkdownFormatType = 'bold' | 'italic' | 'strikethrough' | 'underline' | 'list' | 'todo' | 'h1' | 'h2' | 'h3' | 'highlight' | 'dictate' | string;

interface MarkdownToolbarProps {
    onFormat: (type: MarkdownFormatType) => void;
    activeFormats?: MarkdownFormatType[];
    onColorPickerToggle?: (visible: boolean) => void;
    /**
     * Dictation runs on the on-device Whisper model, so the button is only shown
     * where that handler exists and local models are enabled for the build.
     */
    showDictate?: boolean;
}

interface ToolbarButtonProps {
    isActive: boolean;
    onPress: () => void;
    iconName?: keyof typeof MaterialIcons.glyphMap;
    label?: string;
    accessibilityLabel: string;
    children?: React.ReactNode;
}

const ToolbarButton: React.FC<ToolbarButtonProps> = ({ isActive, onPress, iconName, label, accessibilityLabel, children }) => {
    return (
        <TouchableOpacity
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            accessibilityState={{ selected: isActive }}
            style={[styles.button, isActive && styles.activeButton]}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            activeOpacity={0.6}
        >
            {iconName && (
                <MaterialIcons
                    name={iconName}
                    size={22}
                    color={isActive ? colors.primary : colors.textSecondary}
                />
            )}
            {label && (
                <Text style={[
                    styles.textIcon,
                    { color: isActive ? colors.primary : colors.textSecondary }
                ]}>
                    {label}
                </Text>
            )}
            {children}
        </TouchableOpacity>
    );
};

export const MarkdownToolbar: React.FC<MarkdownToolbarProps> = ({ onFormat, activeFormats = [], onColorPickerToggle, showDictate = false }) => {
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    const [showColorPicker, setShowColorPicker] = useState(false);

    React.useEffect(() => {
        onColorPickerToggle?.(showColorPicker);
    }, [showColorPicker, onColorPickerToggle]);

    const isActive = (type: MarkdownFormatType) => activeFormats.includes(type);

    // Check if any highlight is active
    const highlightColors = highlightPalette.filter((color) => (
        color.name === 'yellow'
        || color.name === 'green'
        || color.name === 'blue'
        || color.name === 'red'
        || color.name === 'white'
    ));

    const activeHighlight = activeFormats.find(f => f.startsWith('highlight:'));
    const activeHighlightValue = activeHighlight ? activeHighlight.slice('highlight:'.length) : 'white';
    const activeHighlightEntry = findHighlightPaletteEntry(activeHighlightValue);
    const activeHighlightColor = activeHighlightEntry?.hex
        || normalizeHighlightColorForCss(activeHighlightValue, colors.highlight.white);
    const isHighlightActive = activeFormats.includes('highlight') || !!activeHighlight;

    const getHighlightColorLabel = (colorName: string) => {
        switch (colorName) {
            case 'yellow': return t('a11y.colorYellow', 'Yellow');
            case 'green': return t('a11y.colorGreen', 'Green');
            case 'blue': return t('a11y.colorBlue', 'Blue');
            case 'red': return t('a11y.colorRed', 'Red');
            case 'white': return t('a11y.noHighlight', 'No highlight');
            default: return colorName;
        }
    };

    const handleHighlightPress = () => {
        setShowColorPicker(true);
    };

    const applyHighlight = (colorName: string) => {
        const selectedColor = highlightColors.find((color) => color.name === colorName);
        if (!selectedColor) {
            return;
        }

        onFormat(`highlight:${selectedColor.name === 'white' ? 'white' : selectedColor.hex}` as MarkdownFormatType);
        setShowColorPicker(false);
    };

    return (
        <View style={styles.container}>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="always"
            >
                {/* Structure */}
                <ToolbarButton
                    isActive={isActive('todo')}
                    onPress={() => onFormat('todo')}
                    iconName="check-box"
                    accessibilityLabel={t('a11y.checklist', 'Checklist')}
                />

                <ToolbarButton
                    isActive={isActive('list')}
                    onPress={() => onFormat('list')}
                    iconName="format-list-bulleted"
                    accessibilityLabel={t('a11y.bulletList', 'Bulleted list')}
                />

                {showDictate && (
                    <ToolbarButton
                        isActive={isActive('dictate')}
                        onPress={() => onFormat('dictate')}
                        iconName="mic"
                        accessibilityLabel={t('a11y.dictate', 'Dictate')}
                    />
                )}

                <View style={styles.spacer} />

                {/* Text styles. Ordered before the headings so the actions used
                    on almost every note stay reachable without scrolling the
                    toolbar on a narrow phone. */}
                <ToolbarButton
                    isActive={isActive('bold')}
                    onPress={() => onFormat('bold')}
                    iconName="format-bold"
                    accessibilityLabel={t('a11y.bold', 'Bold')}
                />

                <ToolbarButton
                    isActive={isActive('italic')}
                    onPress={() => onFormat('italic')}
                    iconName="format-italic"
                    accessibilityLabel={t('a11y.italic', 'Italic')}
                />

                <ToolbarButton
                    isActive={isActive('underline')}
                    onPress={() => onFormat('underline')}
                    iconName="format-underlined"
                    accessibilityLabel={t('a11y.underline', 'Underline')}
                />

                <ToolbarButton
                    isActive={isActive('strikethrough')}
                    onPress={() => onFormat('strikethrough')}
                    iconName="format-strikethrough"
                    accessibilityLabel={t('a11y.strikethrough', 'Strikethrough')}
                />

                {/* Highlight */}
                <TouchableOpacity
                    style={[styles.button, isHighlightActive && styles.activeButton]}
                    onPress={handleHighlightPress}
                    accessibilityRole="button"
                    accessibilityLabel={t('a11y.highlight', 'Highlight')}
                    accessibilityState={{ selected: isHighlightActive }}
                    hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                >
                    <MaterialIcons
                        name="border-color"
                        size={20} // Slightly smaller optical size for this icon
                        color={isHighlightActive ? colors.primary : colors.textSecondary}
                    />
                    <View style={[
                        styles.colorDot,
                        { backgroundColor: activeHighlightColor },
                        // specific tweak for correct visual
                        activeHighlightColor.toLowerCase() === colors.highlight.white.toLowerCase()
                        && { borderWidth: 1, borderColor: colors.border }
                    ]} />
                </TouchableOpacity>

                <View style={styles.spacer} />

                {/* Headings */}
                <ToolbarButton
                    isActive={isActive('h1')}
                    onPress={() => onFormat('h1')}
                    label="H1"
                    accessibilityLabel={t('a11y.heading', 'Heading {{level}}', { level: 1 })}
                />

                <ToolbarButton
                    isActive={isActive('h2')}
                    onPress={() => onFormat('h2')}
                    label="H2"
                    accessibilityLabel={t('a11y.heading', 'Heading {{level}}', { level: 2 })}
                />

                <ToolbarButton
                    isActive={isActive('h3')}
                    onPress={() => onFormat('h3')}
                    label="H3"
                    accessibilityLabel={t('a11y.heading', 'Heading {{level}}', { level: 3 })}
                />

            </ScrollView>

            <Modal
                transparent
                visible={showColorPicker}
                animationType="fade"
                onRequestClose={() => setShowColorPicker(false)}
            >
                <TouchableWithoutFeedback onPress={() => setShowColorPicker(false)}>
                    <View style={styles.modalOverlay}>
                        <View style={[styles.colorPickerContainer, { paddingBottom: Math.max(insets.bottom, 20) + spacing.l }]}>
                            <Text style={styles.colorPickerTitle}>{t('aux.highlightColor', 'Highlight Color')}</Text>
                            <View style={styles.colorsGrid}>
                                {highlightColors.map((color) => (
                                    <TouchableOpacity
                                        key={color.name}
                                        style={[
                                            styles.colorOption,
                                            { backgroundColor: color.hex },
                                            activeHighlightColor.toLowerCase() === color.hex.toLowerCase() && styles.activeColorOption
                                        ]}
                                        onPress={() => applyHighlight(color.name)}
                                        activeOpacity={0.8}
                                        accessibilityRole="button"
                                        accessibilityLabel={getHighlightColorLabel(color.name)}
                                        accessibilityState={{ selected: activeHighlightEntry?.name === color.name }}
                                    >
                                        {activeHighlightEntry?.name === color.name && (
                                            <MaterialIcons
                                                name="check"
                                                size={20}
                                                color={colors.text}
                                            />
                                        )}
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </View>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>
        </View>
    );
};

const styles = createStyles(() => ({
    container: {
        backgroundColor: colors.surface,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        paddingVertical: spacing.xs,
        ...Platform.select({
            ios: {
                shadowColor: '#000',
                shadowOffset: { width: 0, height: -3 },
                shadowOpacity: 0.08,
                shadowRadius: 5,
                zIndex: 10,
            },
            android: {
                elevation: 12,
            },
        }),
    },
    scrollContent: {
        flexGrow: 1,
        justifyContent: 'flex-start',
        paddingHorizontal: spacing.m,
        alignItems: 'center',
        height: 44,
        gap: 4, // Material Design dense toolbar gap
    },
    button: {
        width: 40,
        height: 40,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 10, // Modern rounded square
        backgroundColor: 'transparent',
    },
    activeButton: {
        backgroundColor: colors.backgroundSecondary,
    },
    spacer: {
        width: 4,
    },
    textIcon: {
        fontSize: 15,
        fontWeight: '700',
        includeFontPadding: false,
    },
    colorDot: {
        position: 'absolute',
        bottom: 4,
        right: 4,
        width: 8,
        height: 8,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.border,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.3)',
        justifyContent: 'flex-end',
    },
    colorPickerContainer: {
        backgroundColor: colors.surface,
        borderTopLeftRadius: 24,
        width: '100%',
        maxWidth: 640,
        alignSelf: 'center',
        borderTopRightRadius: 24,
        padding: spacing.l,
        paddingBottom: Platform.OS === 'ios' ? 40 : spacing.l,
        ...Platform.select({
            ios: {
                shadowColor: '#000',
                shadowOffset: { width: 0, height: -4 },
                shadowOpacity: 0.1,
                shadowRadius: 10,
            },
            android: {
                elevation: 20,
            },
        }),
    },
    colorPickerTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.text,
        marginBottom: spacing.l,
        textAlign: 'center',
        opacity: 0.8,
    },
    colorsGrid: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: spacing.m,
    },
    colorOption: {
        width: 48,
        height: 48,
        borderRadius: 24,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: colors.border,
        ...Platform.select({
            ios: {
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.1,
                shadowRadius: 3,
            },
            android: {
                elevation: 2,
            },
        }),
    },
    activeColorOption: {
        borderWidth: 2,
        borderColor: colors.primary,
        transform: [{ scale: 1.1 }],
    },
}));
