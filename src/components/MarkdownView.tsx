import React from 'react';
import { StyleSheet, ScrollView, View, Platform, TextStyle, Pressable } from 'react-native';
import Markdown, { MarkdownIt } from 'react-native-markdown-display';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { spacing } from '../theme/spacing';

interface MarkdownViewProps {
    content: string;
    onPress?: () => void;
    baseFontSize?: number;
}

export const MarkdownView: React.FC<MarkdownViewProps> = ({
    content,
    onPress,
    baseFontSize = 16
}) => {
    // Custom styles for the markdown renderer to match app theme
    const markdownStyles = StyleSheet.create({
        body: {
            fontSize: baseFontSize,
            fontFamily: typography.fontFamily as string,
            color: colors.text,
            lineHeight: baseFontSize * 1.5,
        },
        heading1: {
            fontSize: baseFontSize * 1.75, // ~28px if base is 16
            fontFamily: typography.fontFamilyBold as string,
            color: colors.text,
            marginTop: spacing.l,
            marginBottom: spacing.m,
        },
        heading2: {
            fontSize: baseFontSize * 1.5, // ~24px
            fontFamily: typography.fontFamilyBold as string,
            color: colors.text,
            marginTop: spacing.m,
            marginBottom: spacing.s,
        },
        heading3: {
            fontSize: baseFontSize * 1.25, // ~20px
            fontFamily: typography.fontFamilyBold as string,
            color: colors.text,
            marginTop: spacing.s,
            marginBottom: spacing.xs,
        },
        paragraph: {
            marginVertical: spacing.xxs,
            fontSize: baseFontSize,
            lineHeight: baseFontSize * 1.5,
        },
        list_item: {
            marginVertical: spacing.xxs,
        },
        bullet_list: {
            marginVertical: spacing.xs,
        },
        ordered_list: {
            marginVertical: spacing.xs,
        },
        code_inline: {
            backgroundColor: colors.surface,
            fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
            paddingHorizontal: 4,
            borderRadius: 4,
            borderWidth: 1,
            borderColor: colors.border,
            color: colors.primary,
        },
        code_block: {
            backgroundColor: colors.surface,
            fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
            padding: spacing.s,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.border,
            marginVertical: spacing.s,
        },
        blockquote: {
            borderLeftWidth: 4,
            borderLeftColor: colors.primary,
            backgroundColor: colors.surface,
            paddingHorizontal: spacing.s,
            paddingVertical: spacing.xs,
            marginVertical: spacing.s,
        },
        link: {
            color: colors.primary,
            textDecorationLine: 'underline',
        },
        strong: {
            fontFamily: typography.fontFamilyBold as string,
            fontWeight: 'bold',
        },
        em: {
            fontFamily: typography.fontFamilyItalic as string,
            fontStyle: 'italic',
        },
    });

    return (
        <ScrollView
            style={styles.container}
            contentContainerStyle={styles.contentContainer}
            onTouchEnd={onPress} // allow tapping to edit
        >
            <View style={styles.markdownWrapper} onStartShouldSetResponder={() => true} onResponderRelease={onPress}>
                <Markdown
                    style={markdownStyles}
                    mergeStyle={true}
                >
                    {/* Pre-process content to render checkboxes nicely */
                        content
                            .replace(/- \[\s\]/g, '- ☐')
                            .replace(/- \[[xX]\]/g, '- ☑')
                    }
                </Markdown>
            </View>
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.background,
    },
    contentContainer: {
        padding: spacing.m,
        paddingBottom: 100, // Extra space at bottom
    },
    markdownWrapper: {
        minHeight: 200, // Ensure touchable area
    }
});
