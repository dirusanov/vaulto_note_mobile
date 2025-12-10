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

        // We must flatten baseStyle to avoid nested array issues, but we shouldn't keep re-applying it deeply if inherited?
        // Actually, RN Text inheritance works by nesting.
        // If we just output <Text style={addedStyle}>{recursive}</Text>, recursive children inherit addedStyle+parent.
        // But `parseMarkdownText` wraps non-matches in `Text` with `style`.
        // If we pass `baseStyle` recursively, the inner-most text gets `baseStyle` N times?
        // Actually, if we pass `style` (accumulated) to recursive call?
        // No, we should NOT pass any style to recursive call if we want pure nesting, 
        // OR we pass nothing and rely on inheritance.
        // However, `parseMarkdownText` *always* applies `baseStyle` to chunks it creates.
        // If we pass nothing: `parse(content)` -> creates Text with `baseStyle` (undefined).
        // Parent `<Text style={bold}> <RecursiveChild> </Text>`
        // RecursiveChild = `<Text style={undefined}>content</Text>`
        // Result: Bold -> Undefined.
        // In RN, nested Text inherits. So Child inherits Bold.
        // If we passed `baseStyle` again: Child has `baseStyle`.
        // If `baseStyle` has color red. Parent (Red+Bold) -> Child (Red).
        // Result: Red+Bold. Consistent.
        // But if we have overlapping font sizes etc, it might be an issue. 
        // Usually safer to pass nothing or minimal props recursively and rely on context/inheritance.
        // Let's pass `[]` or `undefined` to recursive calls to strictly rely on inheritance for attributes established by PARENTS,
        // BUT we must preserve the original `baseStyle` for the "leaf" text nodes if they are not nested?
        // Actually, every node returned by parseMarkdownText is a Text node.
        // If we pass `undefined`, the leaf node is `<Text style={undefined}>text</Text>`.
        // Nested in `<Text style={Bold}>...</Text>`.
        // Uses Bold.
        // If `baseStyle` had {color: 'red'}.
        // The top-level call wraps in `<Text style={red}>`.
        // Recursion returns `<Text>{inner}</Text>`.
        // Nesting: `<Text style={red}> <Text style={bold}> <Text>inner</Text> </Text> </Text>`.
        // Inner inherits Bold and Red. Correct.
        // So we pass `undefined` (or skip arg) for recursive calls.

        let content: React.ReactNode = chunk;
        const style: TextStyle[] = [StyleSheet.flatten(baseStyle)];

        // Completed Todo Block: "- [x] content..."
        const completedMatch = chunk.match(/^\s*-\s\[[xX]\]\s(.*)$/);
        if (completedMatch) {
            const innerContent = completedMatch[1];
            return (
                <Text key={index} style={style}>
                    <Text>☑ </Text>
                    <Text style={{ textDecorationLine: 'line-through', opacity: 0.6 }}>
                        {parseMarkdownText(innerContent)}
                    </Text>
                </Text>
            );
        }

        // Unchecked Todo Marker
        if (chunk.match(/^\s*-\s\[ \]\s$/)) {
            return (
                <Text key={index} style={style}>
                    ☐{" "}
                </Text>
            );
        }

        // Bold
        if (chunk.startsWith('**') && chunk.endsWith('**') && chunk.length >= 4) {
            const innerText = chunk.substring(2, chunk.length - 2);
            style.push({ fontWeight: 'bold' });
            return (
                <Text key={index} style={style}>
                    {parseMarkdownText(innerText)}
                </Text>
            );
        }
        // Strikethrough
        else if (chunk.startsWith('~~') && chunk.endsWith('~~') && chunk.length >= 4) {
            const innerText = chunk.substring(2, chunk.length - 2);
            style.push({ textDecorationLine: 'line-through' });
            return (
                <Text key={index} style={style}>
                    {parseMarkdownText(innerText)}
                </Text>
            );
        }
        // Code
        else if (chunk.startsWith('`') && chunk.endsWith('`') && chunk.length >= 2) {
            const innerText = chunk.substring(1, chunk.length - 1);
            style.push({ fontFamily: 'monospace', backgroundColor: '#f0f0f0' });
            return (
                <Text key={index} style={style}>
                    {innerText}
                </Text>
            );
        }
        // Italic (underscore)
        else if (chunk.startsWith('_') && chunk.endsWith('_') && chunk.length >= 2) {
            const innerText = chunk.substring(1, chunk.length - 1);
            style.push({ fontStyle: 'italic' });
            return (
                <Text key={index} style={style}>
                    {parseMarkdownText(innerText)}
                </Text>
            );
        }
        // Italic (asterisk)
        else if (chunk.startsWith('*') && chunk.endsWith('*') && chunk.length >= 2) {
            const innerText = chunk.substring(1, chunk.length - 1);
            style.push({ fontStyle: 'italic' });
            return (
                <Text key={index} style={style}>
                    {parseMarkdownText(innerText)}
                </Text>
            );
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
                    {parseMarkdownForInput(content)}
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
                    {parseMarkdownForInput(content)}
                    <Text style={hiddenStyle}>~~</Text>
                </Text>
            );
        }
        // Code: `content`
        else if (chunk.startsWith('`') && chunk.endsWith('`') && chunk.length >= 2) {
            const content = chunk.substring(1, chunk.length - 1);
            style.push({ fontFamily: 'monospace', backgroundColor: '#f0f0f0' });
            // Code usually doesn't nest other markdown?
            // Let's assume no recursion for code to preserve syntax if user types `**` inside code.
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
                    {parseMarkdownForInput(content)}
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
                    {parseMarkdownForInput(content)}
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
