import React from 'react';
import { Text, TextStyle, StyleProp, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';

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

    // Consolidated pattern for tokens
    // Simplified Highlight to ==...== to avoid complex nested grouping issues in regex engine
    // Bold, Strike, Code, Italic _, Italic *, Highlight, Checkboxes, Underline
    const fullPattern = /(\*\*(?:[\s\S]+?)\*\*|~~(?:[\s\S]+?)~~|`[^`]+?`|_(?:==(?:[\s\S]+?)==|[^_]+?)+?_|\*(?:[\s\S]+?)\*|==(?:[\s\S]+?)==|<u>(?:[\s\S]*?)<\/u>|(?:^|\s)-\s\[[xX]\]\s.*?(?=(?:\s-\s\[|$))|(?:\s|^)-\s\[ \]\s)/g;

    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    while ((match = fullPattern.exec(text)) !== null) {
        if (match.index > lastIndex) {
            parts.push(
                <Text key={`text-${lastIndex}`} style={baseStyle}>
                    {text.substring(lastIndex, match.index)}
                </Text>
            );
        }

        const chunk = match[0];
        const index = match.index;
        const style: TextStyle[] = [StyleSheet.flatten(baseStyle)];

        if (chunk.startsWith('**') && chunk.endsWith('**') && chunk.length >= 4) {
            const innerText = chunk.substring(2, chunk.length - 2);
            style.push({ fontWeight: 'bold' });
            parts.push(
                <Text key={`bold-${index}`} style={style}>
                    {parseMarkdownText(innerText, baseStyle)}
                </Text>
            );
        }
        else if (chunk.startsWith('~~') && chunk.endsWith('~~') && chunk.length >= 4) {
            const innerText = chunk.substring(2, chunk.length - 2);
            style.push({ textDecorationLine: 'line-through' });
            parts.push(
                <Text key={`strike-${index}`} style={style}>
                    {parseMarkdownText(innerText, baseStyle)}
                </Text>
            );
        }
        else if (chunk.startsWith('`') && chunk.endsWith('`') && chunk.length >= 2) {
            const innerText = chunk.substring(1, chunk.length - 1);
            style.push({ fontFamily: 'monospace', backgroundColor: '#f0f0f0' });
            parts.push(
                <Text key={`code-${index}`} style={style}>
                    {innerText}
                </Text>
            );
        }
        else if (chunk.startsWith('==') && chunk.endsWith('==') && chunk.length >= 4) {
            const inner = chunk.substring(2, chunk.length - 2);
            let colorKey = 'yellow';
            let innerText = inner;
            const colorMatch = inner.match(/^(red|orange|yellow|green|blue|purple):([\s\S]*)$/);
            if (colorMatch) {
                colorKey = colorMatch[1];
                innerText = colorMatch[2];
            }
            const highlightColor = (colors.highlight as any)[colorKey] || colors.highlight.yellow;
            style.push({ backgroundColor: highlightColor });
            parts.push(
                <Text key={`highlight-${index}`} style={style}>
                    {parseMarkdownText(innerText, baseStyle)}
                </Text>
            );
        }
        else if (chunk.startsWith('<u>') && chunk.endsWith('</u>')) {
            const innerText = chunk.substring(3, chunk.length - 4);
            style.push({ textDecorationLine: 'underline' });
            parts.push(
                <Text key={`underline-${index}`} style={style}>
                    {parseMarkdownText(innerText, baseStyle)}
                </Text>
            );
        }
        else if (chunk.startsWith('_') && chunk.endsWith('_')) {
            const innerText = chunk.substring(1, chunk.length - 1);
            style.push({ fontStyle: 'italic' });
            parts.push(
                <Text key={`italic-${index}`} style={style}>
                    {parseMarkdownText(innerText, baseStyle)}
                </Text>
            );
        }
        else if (chunk.startsWith('*') && chunk.endsWith('*')) {
            const innerText = chunk.substring(1, chunk.length - 1);
            style.push({ fontStyle: 'italic' });
            parts.push(
                <Text key={`italic-star-${index}`} style={style}>
                    {parseMarkdownText(innerText, baseStyle)}
                </Text>
            );
        }
        else if (chunk.match(/^\s*-\s\[[xX]\]\s/)) {
            const innerMatch = chunk.match(/^\s*-\s\[[xX]\]\s(.*)$/);
            const innerText = innerMatch ? innerMatch[1] : '';
            parts.push(
                <Text key={`todo-done-${index}`} style={style}>
                    <Text>☑ </Text>
                    <Text style={{ textDecorationLine: 'line-through', opacity: 0.6 }}>
                        {parseMarkdownText(innerText, baseStyle)}
                    </Text>
                </Text>
            );
        }
        else if (chunk.match(/^\s*-\s\[ \]\s/)) {
            parts.push(
                <Text key={`todo-open-${index}`} style={style}>
                    ☐{" "}
                </Text>
            );
        } else {
            parts.push(<Text key={`unknown-${index}`} style={style}>{chunk}</Text>);
        }

        lastIndex = fullPattern.lastIndex;
    }

    if (lastIndex < text.length) {
        parts.push(
            <Text key={`text-end`} style={baseStyle}>
                {text.substring(lastIndex)}
            </Text>
        );
    }
    return parts;
};

/**
 * Parses markdown for TextInput children.
 * Syntax markers are rendered with almost-zero size to hide them but keep them in the DOM.
 */
export const parseMarkdownForInput = (text: string, baseStyle?: StyleProp<TextStyle>): React.ReactNode[] => {
    if (!text) return [];

    // Same pattern logic, simplified highlight
    const fullPattern = /(\*\*(?:[\s\S]+?)\*\*|~~(?:[\s\S]+?)~~|`[^`]+?`|_(?:==(?:[\s\S]+?)==|[^_]+?)+?_|\*(?:[\s\S]+?)\*|==(?:[\s\S]+?)==|<u>(?:[\s\S]*?)<\/u>)/g;

    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;
    const hiddenStyle: TextStyle = { fontSize: 1, color: '#00000000' };

    while ((match = fullPattern.exec(text)) !== null) {
        if (match.index > lastIndex) {
            parts.push(
                <Text key={`text-${lastIndex}`} style={baseStyle}>
                    {text.substring(lastIndex, match.index)}
                </Text>
            );
        }

        const chunk = match[0];
        const index = match.index;
        const style: TextStyle[] = [StyleSheet.flatten(baseStyle)];

        if (chunk.startsWith('**') && chunk.endsWith('**')) {
            const content = chunk.substring(2, chunk.length - 2);
            style.push({ fontWeight: 'bold' });
            parts.push(
                <Text key={`bold-${index}`} style={style}>
                    <Text style={hiddenStyle}>**</Text>
                    {parseMarkdownForInput(content, baseStyle)}
                    <Text style={hiddenStyle}>**</Text>
                </Text>
            );
        }
        else if (chunk.startsWith('~~') && chunk.endsWith('~~')) {
            const content = chunk.substring(2, chunk.length - 2);
            style.push({ textDecorationLine: 'line-through' });
            parts.push(
                <Text key={`strike-${index}`} style={style}>
                    <Text style={hiddenStyle}>~~</Text>
                    {parseMarkdownForInput(content, baseStyle)}
                    <Text style={hiddenStyle}>~~</Text>
                </Text>
            );
        }
        else if (chunk.startsWith('`') && chunk.endsWith('`')) {
            const content = chunk.substring(1, chunk.length - 1);
            style.push({ fontFamily: 'monospace', backgroundColor: '#f0f0f0' });
            parts.push(
                <Text key={`code-${index}`} style={style}>
                    <Text style={hiddenStyle}>`</Text>
                    {content}
                    <Text style={hiddenStyle}>`</Text>
                </Text>
            );
        }
        else if (chunk.startsWith('==') && chunk.endsWith('==')) {
            const inner = chunk.substring(2, chunk.length - 2);
            let colorKey = 'yellow';
            let content = inner;
            const colorMatch = inner.match(/^(red|orange|yellow|green|blue|purple):([\s\S]*)$/);
            if (colorMatch) {
                colorKey = colorMatch[1];
                content = colorMatch[2];
            }
            const highlightColor = (colors.highlight as any)[colorKey] || colors.highlight.yellow;
            style.push({ backgroundColor: highlightColor });
            parts.push(
                <Text key={`highlight-${index}`} style={style}>
                    <Text style={hiddenStyle}>=={colorMatch ? colorKey + ':' : ''}</Text>
                    {parseMarkdownForInput(content, baseStyle)}
                    <Text style={hiddenStyle}>==</Text>
                </Text>
            );
        }
        else if (chunk.startsWith('<u>') && chunk.endsWith('</u>')) {
            const content = chunk.substring(3, chunk.length - 4);
            style.push({ textDecorationLine: 'underline' });
            parts.push(
                <Text key={`underline-${index}`} style={style}>
                    <Text style={hiddenStyle}>&lt;u&gt;</Text>
                    {parseMarkdownForInput(content, baseStyle)}
                    <Text style={hiddenStyle}>&lt;/u&gt;</Text>
                </Text>
            );
        }
        else if (chunk.startsWith('_') && chunk.endsWith('_')) {
            const content = chunk.substring(1, chunk.length - 1);
            style.push({ fontStyle: 'italic' });
            parts.push(
                <Text key={`italic-${index}`} style={style}>
                    <Text style={hiddenStyle}>_</Text>
                    {parseMarkdownForInput(content, baseStyle)}
                    <Text style={hiddenStyle}>_</Text>
                </Text>
            );
        }
        else if (chunk.startsWith('*') && chunk.endsWith('*')) {
            const content = chunk.substring(1, chunk.length - 1);
            style.push({ fontStyle: 'italic' });
            parts.push(
                <Text key={`italic-star-${index}`} style={style}>
                    <Text style={hiddenStyle}>*</Text>
                    {parseMarkdownForInput(content, baseStyle)}
                    <Text style={hiddenStyle}>*</Text>
                </Text>
            );
        }
        else {
            parts.push(<Text key={`unknown-${index}`} style={style}>{chunk}</Text>);
        }

        lastIndex = fullPattern.lastIndex;
    }

    if (lastIndex < text.length) {
        parts.push(
            <Text key={`end-${lastIndex}`} style={baseStyle}>
                {text.substring(lastIndex)}
            </Text>
        );
    }
    return parts;
};
