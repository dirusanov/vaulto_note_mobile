import React from 'react';
import { Text, TextStyle, StyleProp, StyleSheet } from 'react-native';

/**
 * Basic markdown parser for inline formatting.
 * Supports:
 * - **Bold**
 * - *Italic* or _Italic_
 * - ~~Strikethrough~~
 */

interface MarkdownPart {
    text: string;
    style?: StyleProp<TextStyle>;
}

export const parseMarkdownText = (text: string, baseStyle?: StyleProp<TextStyle>): React.ReactNode[] => {
    if (!text) return [];

    // Regex for tokens:
    // 1. Bold: \*\*([^*]+)\*\*
    // 2. Italic: _([^_]+)_ or \*([^*]+)\*
    // 3. Strikethrough: ~~([^~]+)~~
    // 4. Code: `([^`]+)` (Optional, but good to have)

    // We need to split and tokenise.
    // A simple way is to use a master regex and matching groups.
    // Order matters. Bold should check ** before * checks italic.

    // Regex Explanation:
    // (\*\*[^*]+\*\*)  -> Capture Bold chunks
    // (~~[^~]+~~)      -> Capture Strikethrough chunks
    // (`[^`]+`)        -> Capture Code chunks
    // (_[^_]+_)        -> Capture Italic chunks (underscore)
    // (\*[^*]+\*)      -> Capture Italic chunks (asterisk) - CAUTION: conflict with bold if not careful, but since we match bold first in the OR chain, it might work if we are careful.
    // However, string.split with regex capture groups includes the separators.

    // Better strategy: Simple scanner or splitting by priority.
    // Given the complexity of nested items, let's stick to non-nested for this simple implementation as requested.

    // Pattern: 
    // Bold: \*\*([^\*]+?)\*\*
    // Strike: ~~([^~]+?)~~
    // Code: `([^`]+?)`
    // Italic: _([^_]+?)_
    // Italic2: \*([^\*]+?)\*

    // We will use a sequence of Replacers or a split-map approach. 
    // React Native needs nodes, not just a string string.

    const parts: { key: string; match: string; type: 'bold' | 'italic' | 'strike' | 'code' | 'text' }[] = [];

    // Let's assume text is a single line for now as per NoteContentRenderer logic.

    // Simple parser: Text -> Tokens
    const pattern = /(\*\*[^*]+?\*\*|~~[^~]+?~~|`[^`]+?`|_[^_]+?_)/g;
    // Note: Intentionally omitting single '*' for italic for now to avoid conflict with list items like '* item' if user does that, 
    // though the request specifically mentioned '*' as well. 
    // User content often uses '*' for lists. 
    // Let's include `\*([^*]+?)\*` but strict: must have closing `*`.

    const fullPattern = /(\*\*[^*]+?\*\*|~~[^~]+?~~|`[^`]+?`|_[^_]+?_|\*[^\s*][^*]*[^\s*]\*)/g;

    // Split text by pattern
    const split = text.split(fullPattern);

    return split.map((chunk, index) => {
        if (!chunk) return null; // Empty splits

        let content = chunk;
        const style: TextStyle[] = [StyleSheet.flatten(baseStyle)];

        // Bold
        if (chunk.startsWith('**') && chunk.endsWith('**') && chunk.length >= 4) {
            content = chunk.substring(2, chunk.length - 2);
            style.push({ fontWeight: 'bold' });
        }
        // Strikethrough
        else if (chunk.startsWith('~~') && chunk.endsWith('~~') && chunk.length >= 4) {
            content = chunk.substring(2, chunk.length - 2);
            style.push({ textDecorationLine: 'line-through' });
        }
        // Code
        else if (chunk.startsWith('`') && chunk.endsWith('`') && chunk.length >= 2) {
            content = chunk.substring(1, chunk.length - 1);
            style.push({ fontFamily: 'monospace', backgroundColor: '#f0f0f0' });
        }
        // Italic (underscore)
        else if (chunk.startsWith('_') && chunk.endsWith('_') && chunk.length >= 2) {
            content = chunk.substring(1, chunk.length - 1);
            style.push({ fontStyle: 'italic' });
        }
        // Italic (asterisk) - Check length and that it's not actually bold (already handled by priority in split if regex works right)
        // But `split` separates them. If regex matched `**foo**`, it comes here as `**foo**`.
        // If it matched `*foo*`, it comes here as `*foo*`.
        else if (chunk.startsWith('*') && chunk.endsWith('*') && chunk.length >= 2) {
            // Edge case: is it bold? `**` starts with `*`. 
            // BUT earlier Bold check caught `**...**`.
            // So this must be single `*`.
            content = chunk.substring(1, chunk.length - 1);
            style.push({ fontStyle: 'italic' });
        }

        return (
            <Text key={index} style={style} >
                {content}
            </Text>
        );
    });
};

/**
 * Parses markdown for TextInput children.
 * Syntax markers are rendered with almost-zero size to hide them but keep them in the DOM.
 */
export const parseMarkdownForInput = (text: string, baseStyle?: StyleProp<TextStyle>): React.ReactNode[] => {
    if (!text) return [];

    // Same pattern as above
    const fullPattern = /(\*\*[^*]+?\*\*|~~[^~]+?~~|`[^`]+?`|_[^_]+?_|\*[^\s*][^*]*[^\s*]\*)/g;
    const split = text.split(fullPattern);

    // Hidden style for markers
    const hiddenStyle: TextStyle = {
        fontSize: 0.1,
        color: 'transparent',
    };

    return split.map((chunk, index) => {
        if (!chunk) return null;

        const style: TextStyle[] = [StyleSheet.flatten(baseStyle)];

        // Bold: **content**
        if (chunk.startsWith('**') && chunk.endsWith('**') && chunk.length >= 4) {
            const content = chunk.substring(2, chunk.length - 2);
            style.push({ fontWeight: 'bold' });
            return (
                <Text key={index} style={style}>
                    <Text style={hiddenStyle}>**</Text>
                    {content}
                    <Text style={hiddenStyle}>**</Text>
                </Text>
            );
        }
        // Strikethrough: ~~content~~
        else if (chunk.startsWith('~~') && chunk.endsWith('~~') && chunk.length >= 4) {
            const content = chunk.substring(2, chunk.length - 2);
            style.push({ textDecorationLine: 'line-through' });
            return (
                <Text key={index} style={style}>
                    <Text style={hiddenStyle}>~~</Text>
                    {content}
                    <Text style={hiddenStyle}>~~</Text>
                </Text>
            );
        }
        // Code: `content`
        else if (chunk.startsWith('`') && chunk.endsWith('`') && chunk.length >= 2) {
            const content = chunk.substring(1, chunk.length - 1);
            style.push({ fontFamily: 'monospace', backgroundColor: '#f0f0f0' });
            return (
                <Text key={index} style={style}>
                    <Text style={hiddenStyle}>`</Text>
                    {content}
                    <Text style={hiddenStyle}>`</Text>
                </Text>
            );
        }
        // Italic: _content_
        else if (chunk.startsWith('_') && chunk.endsWith('_') && chunk.length >= 2) {
            const content = chunk.substring(1, chunk.length - 1);
            style.push({ fontStyle: 'italic' });
            return (
                <Text key={index} style={style}>
                    <Text style={hiddenStyle}>_</Text>
                    {content}
                    <Text style={hiddenStyle}>_</Text>
                </Text>
            );
        }
        // Italic: *content*
        else if (chunk.startsWith('*') && chunk.endsWith('*') && chunk.length >= 2) {
            const content = chunk.substring(1, chunk.length - 1);
            style.push({ fontStyle: 'italic' });
            return (
                <Text key={index} style={style}>
                    <Text style={hiddenStyle}>*</Text>
                    {content}
                    <Text style={hiddenStyle}>*</Text>
                </Text>
            );
        }

        return (
            <Text key={index} style={style}>
                {chunk}
            </Text>
        );
    });
};
