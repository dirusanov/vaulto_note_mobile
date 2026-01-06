import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView, Platform, Modal, Text, TouchableWithoutFeedback, Animated } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';

export type MarkdownFormatType = 'bold' | 'italic' | 'strikethrough' | 'underline' | 'list' | 'todo' | 'h1' | 'h2' | 'h3' | 'highlight' | string;

interface MarkdownToolbarProps {
    onFormat: (type: MarkdownFormatType) => void;
    activeFormats?: MarkdownFormatType[];
    onColorPickerToggle?: (visible: boolean) => void;
}

interface ToolbarButtonProps {
    isActive: boolean;
    onPress: () => void;
    iconName?: keyof typeof MaterialIcons.glyphMap;
    label?: string;
    children?: React.ReactNode;
}

const ToolbarButton: React.FC<ToolbarButtonProps> = ({ isActive, onPress, iconName, label, children }) => {
    return (
        <TouchableOpacity
            onPress={onPress}
            style={[styles.button, isActive && styles.activeButton]}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            activeOpacity={0.6}
        >
            {iconName && (
                <MaterialIcons
                    name={iconName}
                    size={24}
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

export const MarkdownToolbar: React.FC<MarkdownToolbarProps> = ({ onFormat, activeFormats = [], onColorPickerToggle }) => {
    const [showColorPicker, setShowColorPicker] = useState(false);

    React.useEffect(() => {
        onColorPickerToggle?.(showColorPicker);
    }, [showColorPicker, onColorPickerToggle]);

    const isActive = (type: MarkdownFormatType) => activeFormats.includes(type);

    // Check if any highlight is active
    const activeHighlight = activeFormats.find(f => f.startsWith('highlight:'));
    const activeHighlightColor = activeHighlight ? activeHighlight.split(':')[1] : 'white';
    const isHighlightActive = activeFormats.includes('highlight') || !!activeHighlight;

    const highlightColors = [
        { name: 'yellow', value: colors.highlight.yellow },
        { name: 'green', value: colors.highlight.green },
        { name: 'blue', value: colors.highlight.blue },
        { name: 'purple', value: colors.highlight.purple },
        { name: 'red', value: colors.highlight.red },
        { name: 'orange', value: colors.highlight.orange },
        { name: 'white', value: colors.highlight.white },
    ];

    const handleHighlightPress = () => {
        setShowColorPicker(true);
    };

    const applyHighlight = (colorName: string) => {
        onFormat(`highlight:${colorName}` as MarkdownFormatType);
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
                />

                <ToolbarButton
                    isActive={isActive('list')}
                    onPress={() => onFormat('list')}
                    iconName="format-list-bulleted"
                />

                <View style={styles.spacer} />

                {/* Headers */}
                <ToolbarButton
                    isActive={isActive('h2')}
                    onPress={() => onFormat('h2')}
                    label="H2"
                />

                <View style={styles.spacer} />

                {/* Text Styles */}
                <ToolbarButton
                    isActive={isActive('bold')}
                    onPress={() => onFormat('bold')}
                    iconName="format-bold"
                />

                <ToolbarButton
                    isActive={isActive('italic')}
                    onPress={() => onFormat('italic')}
                    iconName="format-italic"
                />

                <ToolbarButton
                    isActive={isActive('underline')}
                    onPress={() => onFormat('underline')}
                    iconName="format-underlined"
                />

                <ToolbarButton
                    isActive={isActive('strikethrough')}
                    onPress={() => onFormat('strikethrough')}
                    iconName="format-strikethrough"
                />

                <View style={styles.spacer} />

                {/* Highlight */}
                <TouchableOpacity
                    style={[styles.button, isHighlightActive && styles.activeButton]}
                    onPress={handleHighlightPress}
                    hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                >
                    <MaterialIcons
                        name="border-color"
                        size={22} // Slightly smaller optical size for this icon
                        color={isHighlightActive ? colors.primary : colors.textSecondary}
                    />
                    <View style={[
                        styles.colorDot,
                        { backgroundColor: (colors.highlight as any)[activeHighlightColor] },
                        // specific tweak for correct visual
                        activeHighlightColor === 'white' && { borderWidth: 1, borderColor: '#eee' }
                    ]} />
                </TouchableOpacity>

            </ScrollView>

            <Modal
                transparent
                visible={showColorPicker}
                animationType="fade"
                onRequestClose={() => setShowColorPicker(false)}
            >
                <TouchableWithoutFeedback onPress={() => setShowColorPicker(false)}>
                    <View style={styles.modalOverlay}>
                        <View style={styles.colorPickerContainer}>
                            <Text style={styles.colorPickerTitle}>Highlight Color</Text>
                            <View style={styles.colorsGrid}>
                                {highlightColors.map((color) => (
                                    <TouchableOpacity
                                        key={color.name}
                                        style={[
                                            styles.colorOption,
                                            { backgroundColor: color.value },
                                            activeHighlightColor === color.name && styles.activeColorOption
                                        ]}
                                        onPress={() => applyHighlight(color.name)}
                                        activeOpacity={0.8}
                                    >
                                        {activeHighlightColor === color.name && (
                                            <MaterialIcons
                                                name="check"
                                                size={20}
                                                color={color.name === 'white' ? colors.text : colors.text}
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

const styles = StyleSheet.create({
    container: {
        backgroundColor: colors.surface,
        borderTopWidth: 1,
        borderTopColor: 'rgba(0,0,0,0.05)',
        paddingVertical: spacing.s,
        marginHorizontal: -spacing.m,
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
        paddingHorizontal: spacing.m,
        alignItems: 'center',
        height: 48,
        gap: 4, // Material Design dense toolbar gap
    },
    button: {
        width: 44,
        height: 44,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 12, // Modern rounded square
        backgroundColor: 'transparent',
    },
    activeButton: {
        backgroundColor: colors.backgroundSecondary,
    },
    spacer: {
        width: 8,
    },
    textIcon: {
        fontSize: 17,
        fontWeight: '700',
        includeFontPadding: false,
    },
    colorDot: {
        position: 'absolute',
        bottom: 6,
        right: 6,
        width: 10,
        height: 10,
        borderRadius: 5,
        borderWidth: 1,
        borderColor: 'rgba(0,0,0,0.05)',
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.3)',
        justifyContent: 'flex-end',
    },
    colorPickerContainer: {
        backgroundColor: colors.surface,
        borderTopLeftRadius: 24,
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
        borderColor: 'rgba(0,0,0,0.08)',
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
});
