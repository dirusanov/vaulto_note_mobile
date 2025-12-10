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

    // Assume text is processed line-by-line by the renderer.

    // Simple parser: Text -> Tokens
    const pattern = /(\*\*[^*]+?\*\*|~~[^~]+?~~|`[^`]+?`|_[^_]+?_)/g;
    // Note: Intentionally omitting single '*' for italic for now to avoid conflict with list items like '* item' if user does that, 
    // though the request specifically mentioned '*' as well. 
    // User content often uses '*' for lists. 
    // Let's include `\*([^*]+?)\*` but strict: must have closing `*`.

    // We also want to capture checkboxes: "- [ ] " or "- [x] "
    // But for completed items "- [x] text...", we want to capture the whole line to strike it through.
    // The previous implementation splits by token. 
    // If we want to style the content of a todo item, we have to capture it as a block.
    // However, the `split` logic is flat.
    // Let's modify the strategy:
    // Capture "Completed Todo Line":  `-\s\[[xX]\]\s[^-\n]+` (until newline or next dash)
    // But since `text` is single line (newlines replaced by spaces in NoteCard), we just go until next token or end?
    // Actually, `NoteCard` replaces newlines with space. So the content is one long string "foo - [ ] bar - [x] baz...".

    // We need to match "- [x] ... " carefully.
    // Let's match: `(-\s\[[xX]\]\s.*?(?=(?:\s-\s\[|$)))`  -> Match "- [x] content" until next "- [" or End of String.
    // And for unchecked: `(-\s\[ \]\s)` -> Just the checkbox itself is fine, or match the whole thing to be consistent, but we don't style unchecked text special.
    // Matches:
    // 1. Completed Todo Block
    // 2. Unchecked Todo Marker (we'll just render the box)
    // 3. Bold, Italic, Code etc (for parts outside the Todo Block)

    // Pattern order matters! Longer specific matches first.
    const fullPattern = /((?:^|\s)-\s\[[xX]\]\s.*?(?=(?:\s-\s\[|$))|(?:\s|^)-\s\[ \]\s|\*\*[^*]+?\*\*|~~[^~]+?~~|`[^`]+?`|_[^_]+?_|\*[^\s*][^*]*[^\s*]\*)/g;

    // Split text by pattern
    // Note: capturing group causes split to include the separator.
    const split = text.split(fullPattern);

    return split.map((chunk, index) => {
        if (!chunk) return null; // Empty splits

        let content = chunk;
        const style: TextStyle[] = [StyleSheet.flatten(baseStyle)];

        // Completed Todo Block: "- [x] content..."
        const completedMatch = chunk.match(/^\s*-\s\[[xX]\]\s(.*)$/);
        if (completedMatch) {
            // Render checkbox
            // Then recursively parse the content with strikethrough style
            const innerContent = completedMatch[1];
            return (
                <Text key={index} style={style}>
                    <Text>☑ </Text>
                    <Text style={{ textDecorationLine: 'line-through', opacity: 0.6 }}>
                        {parseMarkdownText(innerContent, baseStyle)}
                    </Text>
                </Text>
            );
        }

        // Unchecked Todo Marker: "- [ ] " (with optional leading space)
        if (chunk.match(/^\s*-\s\[ \]\s$/)) {
            return (
                <Text key={index} style={style}>
                    ☐{" "}
                </Text>
            );
        }

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
        // Italic (asterisk)
        else if (chunk.startsWith('*') && chunk.endsWith('*') && chunk.length >= 2) {
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
