import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView, Platform, Modal, Text, TouchableWithoutFeedback } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';

export type MarkdownFormatType = 'bold' | 'italic' | 'strikethrough' | 'underline' | 'list' | 'todo' | 'h1' | 'h2' | 'h3' | 'highlight' | string;

interface MarkdownToolbarProps {
    onFormat: (type: MarkdownFormatType) => void;
    activeFormats?: MarkdownFormatType[];
    onColorPickerToggle?: (visible: boolean) => void;
}

export const MarkdownToolbar: React.FC<MarkdownToolbarProps> = ({ onFormat, activeFormats = [], onColorPickerToggle }) => {
    const [showColorPicker, setShowColorPicker] = useState(false);

    React.useEffect(() => {
        onColorPickerToggle?.(showColorPicker);
    }, [showColorPicker, onColorPickerToggle]);

    const isActive = (type: MarkdownFormatType) => activeFormats.includes(type);

    // Check if any highlight is active
    const activeHighlight = activeFormats.find(f => f.startsWith('highlight:'));
    const activeColor = activeHighlight ? activeHighlight.split(':')[1] : 'white';
    const isHighlightActive = activeFormats.includes('highlight') || !!activeHighlight;

    const getButtonStyle = (type: MarkdownFormatType) => [
        styles.button,
        isActive(type) && styles.activeButton
    ];

    const getIconColor = (type: MarkdownFormatType) =>
        isActive(type) ? colors.primary : colors.text;

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
            <View style={styles.toolbarRow}>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.scrollContent}
                    keyboardShouldPersistTaps="always"
                >
                    {/* Group 1: Structure (Todo, List) */}
                    <TouchableOpacity
                        style={getButtonStyle('todo')}
                        onPress={() => onFormat('todo')}
                        hitSlop={{ top: 10, bottom: 10, left: 5, right: 5 }}
                    >
                        <MaterialIcons name="check-box" size={24} color={getIconColor('todo')} />
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={getButtonStyle('list')}
                        onPress={() => onFormat('list')}
                        hitSlop={{ top: 10, bottom: 10, left: 5, right: 5 }}
                    >
                        <MaterialIcons name="format-list-bulleted" size={24} color={getIconColor('list')} />
                    </TouchableOpacity>

                    <View style={styles.divider} />

                    {/* Group 2: Headers */}
                    <TouchableOpacity
                        style={getButtonStyle('h2')}
                        onPress={() => onFormat('h2')}
                        hitSlop={{ top: 10, bottom: 10, left: 5, right: 5 }}
                    >
                        <Text style={[styles.headingIcon, { fontSize: 18, fontWeight: 'bold', color: getIconColor('h2') }]}>H</Text>
                    </TouchableOpacity>

                    <View style={styles.divider} />

                    {/* Highlight Button */}
                    <TouchableOpacity
                        style={[
                            styles.button,
                            isHighlightActive && { backgroundColor: (colors.highlight as any)[activeColor] }
                        ]}
                        onPress={handleHighlightPress}
                        hitSlop={{ top: 10, bottom: 10, left: 5, right: 5 }}
                    >
                        <MaterialIcons
                            name="border-color"
                            size={20}
                            color={isHighlightActive ? colors.text : colors.text}
                        />
                        <View style={[styles.colorIndicator, { backgroundColor: (colors.highlight as any)[activeColor] }]} />
                    </TouchableOpacity>


                    <View style={styles.divider} />

                    {/* Group 3: Text Formatting */}
                    <TouchableOpacity
                        style={getButtonStyle('bold')}
                        onPress={() => onFormat('bold')}
                        hitSlop={{ top: 10, bottom: 10, left: 5, right: 5 }}
                    >
                        <MaterialIcons name="format-bold" size={24} color={getIconColor('bold')} />
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={getButtonStyle('italic')}
                        onPress={() => onFormat('italic')}
                        hitSlop={{ top: 10, bottom: 10, left: 5, right: 5 }}
                    >
                        <MaterialIcons name="format-italic" size={24} color={getIconColor('italic')} />
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={getButtonStyle('underline')}
                        onPress={() => onFormat('underline')}
                        hitSlop={{ top: 10, bottom: 10, left: 5, right: 5 }}
                    >
                        <MaterialIcons name="format-underlined" size={24} color={getIconColor('underline')} />
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={getButtonStyle('strikethrough')}
                        onPress={() => onFormat('strikethrough')}
                        hitSlop={{ top: 10, bottom: 10, left: 5, right: 5 }}
                    >
                        <MaterialIcons name="format-strikethrough" size={24} color={getIconColor('strikethrough')} />
                    </TouchableOpacity>



                </ScrollView>
            </View>

            <Modal
                transparent
                visible={showColorPicker}
                animationType="fade"
                onRequestClose={() => setShowColorPicker(false)}
            >
                <TouchableWithoutFeedback onPress={() => setShowColorPicker(false)}>
                    <View style={styles.modalOverlay}>
                        <View style={styles.colorPickerContainer}>
                            <Text style={styles.colorPickerTitle}>Select Highlight Color</Text>
                            <View style={styles.colorsGrid}>
                                {highlightColors.map((color) => (
                                    <TouchableOpacity
                                        key={color.name}
                                        style={[
                                            styles.colorOption,
                                            { backgroundColor: color.value },
                                            activeColor === color.name && styles.activeColorOption
                                        ]}
                                        onPress={() => applyHighlight(color.name)}
                                    >
                                        {activeColor === color.name && (
                                            <MaterialIcons name="check" size={20} color={colors.text} />
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
        borderTopColor: colors.border,
        paddingVertical: 0, // Removed vertical padding
        marginHorizontal: -spacing.m, // Extend to screen edges
        ...Platform.select({
            ios: {
                shadowColor: '#000',
                shadowOffset: { width: 0, height: -2 },
                shadowOpacity: 0.05,
                shadowRadius: 3,
            },
            android: {
                elevation: 8,
            },
        }),
    },
    toolbarRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    scrollContent: {
        paddingHorizontal: spacing.s, // Add small padding for content
        alignItems: 'center',
        gap: spacing.s,
        height: 44, // Tighter height
    },
    button: {
        width: 40,
        height: 40,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 12, // Softer corners
        backgroundColor: colors.background, // Slight background for buttons
    },
    activeButton: {
        backgroundColor: colors.backgroundSecondary,
        borderWidth: 1,
        borderColor: colors.border,
    },
    divider: {
        width: 1,
        height: 20,
        backgroundColor: colors.border,
        marginHorizontal: spacing.xs,
    },
    headingIcon: {
        includeFontPadding: false,
        textAlignVertical: 'center',
    },
    colorIndicator: {
        position: 'absolute',
        bottom: 5,
        right: 5,
        width: 8,
        height: 8,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: 'rgba(0,0,0,0.1)'
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.2)',
        justifyContent: 'flex-end',
        paddingBottom: 80, // Position above toolbar
    },
    colorPickerContainer: {
        marginHorizontal: spacing.m,
        backgroundColor: colors.surface,
        borderRadius: 16,
        padding: spacing.m,
        ...Platform.select({
            ios: {
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.15,
                shadowRadius: 12,
            },
            android: {
                elevation: 10,
            },
        }),
    },
    colorPickerTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.textSecondary,
        marginBottom: spacing.m,
        textAlign: 'center',
    },
    colorsGrid: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: spacing.s,
    },
    colorOption: {
        width: 44,
        height: 44,
        borderRadius: 22,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: 'rgba(0,0,0,0.05)',
    },
    activeColorOption: {
        borderWidth: 2,
        borderColor: colors.text,
    },
});
