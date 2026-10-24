import React, { useEffect, useState } from 'react';
import { View, TouchableOpacity, ScrollView, Platform, Text, Keyboard, StyleSheet, LayoutChangeEvent, useWindowDimensions } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { haptics } from '../utils/haptics';
import {
    findHighlightPaletteEntry,
    highlightPalette,
} from '../utils/highlightColors';
import { createStyles } from '../theme/createStyles';
import { shouldUseCompactPanel } from '../utils/toolbarLayout';

export type MarkdownFormatType =
    | 'bold' | 'italic' | 'strikethrough' | 'underline'
    | 'list' | 'ordered' | 'todo' | 'indent' | 'outdent' | 'quote'
    | 'h1' | 'h2' | 'h3' | 'paragraph'
    | 'highlight' | 'dictate' | 'dismiss'
    | string;

interface MarkdownToolbarProps {
    onFormat: (type: MarkdownFormatType) => void;
    /** Styles at the caret, plus 'can-indent' / 'can-outdent' availability. */
    activeFormats?: MarkdownFormatType[];
    /**
     * Dictation runs on the on-device Whisper model, so the button is only shown
     * where that handler exists and local models are enabled for the build.
     */
    showDictate?: boolean;
    /** Height grows while the Aa panel is open; the screen reserves room for it. */
    onHeightChange?: (height: number) => void;
    /**
     * The caret is in the note title, which is plain text: formatting would
     * land in the body instead, so the buttons are disabled and the panel shut.
     */
    formattingDisabled?: boolean;
    /** Height of the keyboard below the bar, to tell a short window (tablet landscape). */
    keyboardHeight?: number;
}

type IconName = keyof typeof MaterialIcons.glyphMap;

// 44dp is the smallest comfortable target (Apple HIG); icons stay at 24dp.
const BUTTON_SIZE = 44;
const ICON_SIZE = 24;

const HIGHLIGHT_ORDER = ['white', 'yellow', 'green', 'blue', 'red'] as const;

interface ToolbarButtonProps {
    iconName: IconName;
    accessibilityLabel: string;
    onPress: () => void;
    isActive?: boolean;
    disabled?: boolean;
    /** Fills the cell of a segmented group instead of a fixed square. */
    grow?: boolean;
}

const ToolbarButton: React.FC<ToolbarButtonProps> = ({ iconName, accessibilityLabel, onPress, isActive = false, disabled = false, grow = false }) => (
    <TouchableOpacity
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ selected: isActive, disabled }}
        style={[styles.button, grow && styles.buttonGrow, isActive && styles.buttonActive, disabled && styles.buttonDisabled]}
        activeOpacity={0.6}
    >
        <MaterialIcons
            name={iconName}
            size={ICON_SIZE}
            color={isActive ? colors.primary : colors.text}
        />
    </TouchableOpacity>
);

/**
 * The bar docked above the keyboard. Like Apple Notes it keeps one calm row of
 * the actions used on almost every note; the rest (text styles, underline,
 * strikethrough, highlight, numbered lists, indent, quote) sit in the Aa panel,
 * which opens above the row without closing the keyboard.
 */
export const MarkdownToolbar: React.FC<MarkdownToolbarProps> = ({
    onFormat,
    activeFormats = [],
    showDictate = false,
    onHeightChange,
    formattingDisabled = false,
    keyboardHeight = 0,
}) => {
    const { t } = useTranslation();
    const [panelOpenState, setPanelOpen] = useState(false);
    // The hook lives here, not in NoteEditScreen: re-rendering the screen on
    // rotation drops the WebView editor's focus.
    const { height: windowHeight } = useWindowDimensions();
    const compact = shouldUseCompactPanel(windowHeight, keyboardHeight);
    const panelOpen = panelOpenState && !formattingDisabled;

    // Back in the text after the title, the bar starts calm again.
    useEffect(() => {
        if (formattingDisabled) setPanelOpen(false);
    }, [formattingDisabled]);

    const isActive = (type: MarkdownFormatType) => activeFormats.includes(type);
    const format = (type: MarkdownFormatType) => {
        haptics.selection();
        onFormat(type);
    };

    const togglePanel = () => {
        haptics.selection();
        setPanelOpen((open) => !open);
    };

    const dismissKeyboard = () => {
        onFormat('dismiss');
        Keyboard.dismiss();
    };

    const headingLevel = isActive('h1') ? 1 : isActive('h2') ? 2 : isActive('h3') ? 3 : 0;
    const textStyles: { type: MarkdownFormatType; label: string; level: number; textStyle: object }[] = [
        { type: 'h1', level: 1, label: t('edit.textStyleTitle', 'Title'), textStyle: styles.styleTitle },
        { type: 'h2', level: 2, label: t('edit.textStyleHeading', 'Heading'), textStyle: styles.styleHeading },
        { type: 'h3', level: 3, label: t('edit.textStyleSubheading', 'Subheading'), textStyle: styles.styleSubheading },
        { type: 'paragraph', level: 0, label: t('edit.textStyleBody', 'Body'), textStyle: styles.styleBody },
    ];

    const activeHighlight = activeFormats.find((f) => f.startsWith('highlight:'));
    const activeHighlightName = activeHighlight
        ? findHighlightPaletteEntry(activeHighlight.slice('highlight:'.length))?.name
        : 'white';
    const highlightColors = HIGHLIGHT_ORDER
        .map((name) => highlightPalette.find((color) => color.name === name))
        .filter((color): color is NonNullable<typeof color> => !!color);
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

    const handleLayout = (event: LayoutChangeEvent) => {
        onHeightChange?.(Math.round(event.nativeEvent.layout.height));
    };

    // `grow` fills the three-row panel's width; the compact row sizes to content.
    const renderTextStyles = (grow: boolean) => textStyles.map((item) => {
        const selected = headingLevel === item.level;
        return (
            <TouchableOpacity
                key={item.type}
                onPress={() => {
                    if (!selected) format(item.type);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={[styles.styleChip, !grow && styles.styleChipCompact, selected && styles.buttonActive]}
                activeOpacity={0.6}
            >
                <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit={grow}
                    minimumFontScale={0.75}
                    style={[item.textStyle, { color: selected ? colors.primary : colors.text }]}
                >
                    {item.label}
                </Text>
            </TouchableOpacity>
        );
    });

    const renderCharacterButtons = (grow: boolean) => (
        <>
            <ToolbarButton grow={grow} iconName="format-bold" isActive={isActive('bold')} onPress={() => format('bold')} accessibilityLabel={t('a11y.bold', 'Bold')} />
            <ToolbarButton grow={grow} iconName="format-italic" isActive={isActive('italic')} onPress={() => format('italic')} accessibilityLabel={t('a11y.italic', 'Italic')} />
            <ToolbarButton grow={grow} iconName="format-underlined" isActive={isActive('underline')} onPress={() => format('underline')} accessibilityLabel={t('a11y.underline', 'Underline')} />
            <ToolbarButton grow={grow} iconName="format-strikethrough" isActive={isActive('strikethrough')} onPress={() => format('strikethrough')} accessibilityLabel={t('a11y.strikethrough', 'Strikethrough')} />
        </>
    );

    const renderSwatches = (style: object) => (
        <View style={style} accessibilityRole="radiogroup" accessibilityLabel={t('a11y.highlight', 'Highlight')}>
            {highlightColors.map((color) => {
                const selected = activeHighlightName === color.name;
                const isNone = color.name === 'white';
                return (
                    <TouchableOpacity
                        key={color.name}
                        onPress={() => format(`highlight:${isNone ? 'white' : color.hex}`)}
                        accessibilityRole="radio"
                        accessibilityLabel={getHighlightColorLabel(color.name)}
                        accessibilityState={{ selected }}
                        style={styles.swatchTarget}
                        activeOpacity={0.7}
                    >
                        <View style={[
                            styles.swatch,
                            { backgroundColor: isNone ? colors.surface : color.hex },
                            selected && styles.swatchSelected,
                        ]}>
                            {isNone && (
                                <MaterialIcons name="format-color-reset" size={16} color={colors.textSecondary} />
                            )}
                        </View>
                    </TouchableOpacity>
                );
            })}
        </View>
    );

    const renderStructureButtons = (grow: boolean) => (
        <>
            <ToolbarButton grow={grow} iconName="format-list-bulleted" isActive={isActive('list')} onPress={() => format('list')} accessibilityLabel={t('a11y.bulletList', 'Bulleted list')} />
            <ToolbarButton grow={grow} iconName="format-list-numbered" isActive={isActive('ordered')} onPress={() => format('ordered')} accessibilityLabel={t('a11y.numberedList', 'Numbered list')} />
            <ToolbarButton grow={grow} iconName="format-indent-decrease" disabled={!isActive('can-outdent')} onPress={() => format('outdent')} accessibilityLabel={t('a11y.outdent', 'Decrease indent')} />
            <ToolbarButton grow={grow} iconName="format-indent-increase" disabled={!isActive('can-indent')} onPress={() => format('indent')} accessibilityLabel={t('a11y.indent', 'Increase indent')} />
            <ToolbarButton grow={grow} iconName="format-quote" isActive={isActive('quote')} onPress={() => format('quote')} accessibilityLabel={t('a11y.quote', 'Quote')} />
        </>
    );

    return (
        <View style={styles.container} onLayout={handleLayout}>
            {panelOpen && (compact ? (
                // Short window: every group in one row that scrolls sideways,
                // so several lines of the note stay visible above the keyboard.
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    keyboardShouldPersistTaps="always"
                    contentContainerStyle={styles.compactPanel}
                >
                    <View style={[styles.segment, styles.panelRow]}>{renderTextStyles(false)}</View>
                    <View style={[styles.segment, styles.panelRow]}>{renderCharacterButtons(false)}</View>
                    {renderSwatches(styles.compactSwatches)}
                    <View style={[styles.segment, styles.panelRow]}>{renderStructureButtons(false)}</View>
                </ScrollView>
            ) : (
                <View style={styles.panel}>
                    {/* Text style of the current line */}
                    <View style={[styles.segment, styles.panelRow]}>{renderTextStyles(true)}</View>

                    {/* Character styles and highlight. Wraps onto two lines on a
                        narrow phone instead of shrinking the targets. */}
                    <View style={[styles.panelRow, styles.wrapRow]}>
                        <View style={[styles.segment, styles.characterGroup]}>{renderCharacterButtons(true)}</View>
                        {renderSwatches(styles.swatches)}
                    </View>

                    {/* Lists and paragraph structure */}
                    <View style={[styles.segment, styles.panelRow]}>{renderStructureButtons(true)}</View>
                </View>
            ))}

            <View style={styles.row}>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    keyboardShouldPersistTaps="always"
                    style={styles.rowScroll}
                    contentContainerStyle={styles.rowContent}
                >
                    <TouchableOpacity
                        onPress={togglePanel}
                        disabled={formattingDisabled}
                        accessibilityRole="button"
                        accessibilityLabel={t('a11y.textFormatting', 'Text formatting')}
                        accessibilityState={{ expanded: panelOpen, disabled: formattingDisabled }}
                        style={[styles.button, panelOpen && styles.buttonActive, formattingDisabled && styles.buttonDisabled]}
                        activeOpacity={0.6}
                    >
                        <Text style={[styles.aaLabel, { color: panelOpen ? colors.primary : colors.text }]}>Aa</Text>
                    </TouchableOpacity>
                    <ToolbarButton iconName="format-bold" disabled={formattingDisabled} isActive={!formattingDisabled && isActive('bold')} onPress={() => format('bold')} accessibilityLabel={t('a11y.bold', 'Bold')} />
                    <ToolbarButton iconName="format-italic" disabled={formattingDisabled} isActive={!formattingDisabled && isActive('italic')} onPress={() => format('italic')} accessibilityLabel={t('a11y.italic', 'Italic')} />
                    <ToolbarButton iconName="checklist" disabled={formattingDisabled} isActive={!formattingDisabled && isActive('todo')} onPress={() => format('todo')} accessibilityLabel={t('a11y.checklist', 'Checklist')} />
                    <ToolbarButton iconName="format-list-bulleted" disabled={formattingDisabled} isActive={!formattingDisabled && isActive('list')} onPress={() => format('list')} accessibilityLabel={t('a11y.bulletList', 'Bulleted list')} />
                    {showDictate && (
                        <ToolbarButton iconName="mic-none" disabled={formattingDisabled && !isActive('dictate')} isActive={isActive('dictate')} onPress={() => format('dictate')} accessibilityLabel={t('a11y.dictate', 'Dictate')} />
                    )}
                </ScrollView>
                <View style={styles.divider} />
                <ToolbarButton
                    iconName="keyboard-hide"
                    onPress={dismissKeyboard}
                    accessibilityLabel={t('a11y.hideKeyboard', 'Hide keyboard')}
                />
            </View>
        </View>
    );
};

const styles = createStyles(() => ({
    container: {
        backgroundColor: colors.surface,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: colors.border,
        ...Platform.select({
            ios: {
                shadowColor: '#000',
                shadowOffset: { width: 0, height: -2 },
                shadowOpacity: 0.06,
                shadowRadius: 4,
                zIndex: 10,
            },
            android: {
                elevation: 8,
            },
        }),
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        height: BUTTON_SIZE + spacing.s,
        paddingRight: spacing.xs,
    },
    rowScroll: {
        flex: 1,
    },
    rowContent: {
        alignItems: 'center',
        paddingHorizontal: spacing.xs,
        gap: spacing.xxs,
    },
    divider: {
        width: StyleSheet.hairlineWidth,
        height: 24,
        backgroundColor: colors.border,
        marginHorizontal: spacing.xs,
    },
    button: {
        width: BUTTON_SIZE,
        height: BUTTON_SIZE,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 10,
    },
    buttonGrow: {
        flex: 1,
        width: undefined,
    },
    buttonActive: {
        backgroundColor: colors.primaryLight,
    },
    buttonDisabled: {
        opacity: 0.3,
    },
    aaLabel: {
        fontSize: 19,
        fontWeight: '600',
        includeFontPadding: false,
    },
    panel: {
        paddingHorizontal: spacing.s,
        paddingTop: spacing.s,
        gap: spacing.s,
        // Keep the groups at phone width on a tablet instead of stretching.
        width: '100%',
        maxWidth: 520,
    },
    panelRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    compactPanel: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
        paddingHorizontal: spacing.s,
        paddingTop: spacing.xs,
    },
    compactSwatches: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    styleChipCompact: {
        flex: 0,
        paddingHorizontal: spacing.s,
    },
    wrapRow: {
        flexWrap: 'wrap',
        columnGap: spacing.s,
        rowGap: spacing.s,
    },
    segment: {
        backgroundColor: colors.background,
        borderRadius: 12,
        padding: spacing.xxs,
    },
    characterGroup: {
        flexDirection: 'row',
        flexGrow: 1,
        // With 32dp swatch cells this keeps the row on one line at 360dp.
        minWidth: 4 * 42,
    },
    styleChip: {
        flex: 1,
        height: BUTTON_SIZE,
        borderRadius: 10,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: spacing.xs,
    },
    // Each style label previews itself, as in Apple Notes.
    styleTitle: {
        fontSize: 17,
        fontWeight: '700',
    },
    styleHeading: {
        fontSize: 15,
        fontWeight: '700',
    },
    styleSubheading: {
        fontSize: 14,
        fontWeight: '600',
    },
    styleBody: {
        fontSize: 14,
        fontWeight: '400',
    },
    swatches: {
        flexDirection: 'row',
        alignItems: 'center',
        flexGrow: 1,
        justifyContent: 'space-between',
    },
    swatchTarget: {
        width: 32,
        height: BUTTON_SIZE,
        justifyContent: 'center',
        alignItems: 'center',
    },
    swatch: {
        width: 26,
        height: 26,
        borderRadius: 13,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.borderHover,
        justifyContent: 'center',
        alignItems: 'center',
    },
    swatchSelected: {
        borderWidth: 2,
        borderColor: colors.primary,
    },
}));
