import React from 'react';
import { Text, TextStyle, StyleProp, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';

export interface BlockFormat {
    type: 'bold' | 'italic' | 'strikethrough' | 'underline' | 'code' | 'highlight';
    start: number;
    end: number;
    data?: string; // e.g., 'red', 'blue'
}

export interface FormattedBlockData {
    content: string;
    formats: BlockFormat[];
}

/**
 * Parses raw markdown text into separated content and format ranges.
 * Example: "**Bold**" -> { content: "Bold", formats: [{type:'bold', start:0, end:4}] }
 */
export const parseMarkdownToData = (text: string, depth: number = 0): FormattedBlockData => {
    if (!text) return { content: '', formats: [] };
    if (depth > 100) {
        // Recursion depth exceeded - safely return plain text to prevent stack overflow
        return { content: text, formats: [] };
    }

    // We need to parse strictly from left to right, handling nesting.
    // For simplicity in this v1 refactor, we will focus on the main regex strategy 
    // but extracting content instead of keeping syntax.

    // Pattern designed to capture outermost format pairs.
    // We will recursively parse the inner content to handle nesting if needed,
    // but simplified flat parsing is often enough for standard usage.

    // Regex Logic: Match any of our supported tags.
    const pattern = /(\*\*(?:[\s\S]*?)\*\*|~~(?:[\s\S]*?)~~|`[^`]*?`|_(?:[\s\S]*?)_|\*(?:[\s\S]*?)\*|==(?:[\s\S]*?)==|<u>(?:[\s\S]*?)<\/u>)/g;

    let plainText = '';
    const formats: BlockFormat[] = [];

    let lastIndex = 0;
    let match;

    // Helper to add segments
    const addText = (str: string) => {
        plainText += str;
    };

    while ((match = pattern.exec(text)) !== null) {
        // Add preceding text
        if (match.index > lastIndex) {
            addText(text.substring(lastIndex, match.index));
        }

        const chunk = match[0];
        let innerRaw = '';
        let type: BlockFormat['type'] | null = null;
        let data: string | undefined = undefined;

        if (chunk.startsWith('**')) {
            type = 'bold';
            innerRaw = chunk.substring(2, chunk.length - 2);
        } else if (chunk.startsWith('~~')) {
            type = 'strikethrough';
            innerRaw = chunk.substring(2, chunk.length - 2);
        } else if (chunk.startsWith('`')) {
            type = 'code';
            innerRaw = chunk.substring(1, chunk.length - 1);
        } else if (chunk.startsWith('==')) {
            type = 'highlight';
            innerRaw = chunk.substring(2, chunk.length - 2);
            // Check for color
            const colMatch = innerRaw.match(/^([a-z]+):([\s\S]*)$/);
            if (colMatch) {
                data = colMatch[1];
                innerRaw = colMatch[2];
            } else {
                data = 'yellow'; // default
            }
        } else if (chunk.startsWith('<u>')) {
            type = 'underline';
            innerRaw = chunk.substring(3, chunk.length - 4);
        } else if (chunk.startsWith('_')) {
            type = 'italic';
            innerRaw = chunk.substring(1, chunk.length - 1);
        } else if (chunk.startsWith('*')) {
            type = 'italic';
            innerRaw = chunk.substring(1, chunk.length - 1);
        }

        if (type) {
            const startIndex = plainText.length;
            // Recursively parse inner content if we want nested formats support (e.g. bold inside highlight)
            // For now, let's treat inner as plain text to ensure we strip *all* syntax
            // If we blindly add innerRaw, we might miss nested syntax like `==red:**bold**==`
            // Ideally we recursively call parseMarkdownToData(innerRaw).

            // @ts-ignore
            const innerData = parseMarkdownToData(innerRaw, depth + 1);

            // Add the format for this wrapper
            formats.push({
                type,
                start: startIndex,
                end: startIndex + innerData.content.length,
                data
            });

            // Shift and add inner formats
            innerData.formats.forEach(f => {
                formats.push({
                    ...f,
                    start: f.start + startIndex,
                    end: f.end + startIndex
                });
            });

            addText(innerData.content);
        } else {
            addText(chunk);
        }

        lastIndex = pattern.lastIndex;
    }

    if (lastIndex < text.length) {
        addText(text.substring(lastIndex));
    }

    return { content: plainText, formats };
};

/**
 * Serializes plain text + formats back into Markdown.
 */
export const serializeBlockToMarkdown = (content: string, formats: BlockFormat[]): string => {
    if (formats.length === 0) return content;

    // Strategy: We need to insert tags at specific indices.
    // Sorting formats by start index, then nest order?
    // It is complex to serialize arbitrary overlapping ranges.
    // We assume mostly hierarchical or independent ranges for this simple editor.

    // Simple verification: Sort by start asc, end desc (outer first)
    const sortedFormats = [...formats].sort((a, b) => {
        if (a.start !== b.start) return a.start - b.start;
        return b.end - a.end;
    });

    // We will construct the string by slicing. 
    // This is hard to do linearly with array splices.
    // Better approach: recursive reconstruction or token map?

    // Let's use a "Marker" approach. 
    // Insert StartMarker and EndMarker objects into a list of characters, then join.

    interface Marker {
        index: number;
        type: 'start' | 'end';
        format: BlockFormat;
        priority: number; // to handle nesting order: end tags should come before start tags at same index?
    }

    const markers: Marker[] = [];
    sortedFormats.forEach((f) => {
        markers.push({ index: f.start, type: 'start', format: f, priority: 1 });
        markers.push({ index: f.end, type: 'end', format: f, priority: 0 }); // end processed before start?
    });

    // Sort markers: index asc. 
    // At same index: 'end' markers before 'start' markers (close inner before opening next?)
    // Actually for nesting `<b><i>text</i></b>`:
    // Start b at 0. Start i at 0. -> Order logic: Outer starts first? 
    // <b><i> gives: b_start(0), i_start(0). Correct. So b should be processed, then i.
    // Closing: i_end(4), b_end(4). Correct. So i should close, then b.

    // Markers sort:
    // 1. Index Asc
    // 2. Type: End before Start? (Close tags before Open tags at same index? `</i></b>` vs `</b><i>` - wait.
    // If we have `</b><b>`, index is same. We must Close then Open. Yes.
    // So End priority < Start priority.

    // Nesting logic: If two Starts at 0. `<b>` and `<i>`.
    // If Format B encloses Format I (B.end > I.end), then B start is before I start.
    // If B.end == I.end, arbitrary?

    markers.sort((a, b) => {
        if (a.index !== b.index) return a.index - b.index;
        // Same index
        if (a.type !== b.type) {
            // End (0) before Start (1)
            return a.type === 'start' ? 1 : -1;
        }

        // Same Type
        if (a.type === 'start') {
            // Both starts. Outer ends later.
            // Longer span starts first.
            const lenA = a.format.end - a.format.start;
            const lenB = b.format.end - b.format.start;
            return lenB - lenA; // Descending length
        } else {
            // Both ends. Inner ends first (so we close inner tag then outer tag).
            // Shorter span ends first.
            const lenA = a.format.end - a.format.start;
            const lenB = b.format.end - b.format.start;
            return lenA - lenB; // Ascending length
        }
    });

    let result = '';
    let currIdx = 0;

    for (const marker of markers) {
        // Append text up to marker
        if (marker.index > currIdx) {
            result += content.substring(currIdx, marker.index);
            currIdx = marker.index;
        }

        // Append Tag
        const f = marker.format;
        if (marker.type === 'start') {
            switch (f.type) {
                case 'bold': result += '**'; break;
                case 'italic': result += '_'; break; // prefer _ for internal consistency
                case 'strikethrough': result += '~~'; break;
                case 'code': result += '`'; break;
                case 'underline': result += '<u>'; break;
                case 'highlight':
                    result += '==';
                    if (f.data && f.data !== 'yellow') result += f.data + ':';
                    break;
            }
        } else {
            switch (f.type) {
                case 'bold': result += '**'; break;
                case 'italic': result += '_'; break;
                case 'strikethrough': result += '~~'; break;
                case 'code': result += '`'; break;
                case 'underline': result += '</u>'; break;
                case 'highlight': result += '=='; break;
            }
        }
    }

    // Remaining text
    if (currIdx < content.length) {
        result += content.substring(currIdx);
    }

    return result;
};

/**
 * Renders the content as nested Text components with styles applied based on formats.
 */
export const renderFormattedText = (content: string, formats: BlockFormat[], baseStyle?: StyleProp<TextStyle>): React.ReactNode[] => {
    if (!content && formats.length === 0) return [];
    if (content.length === 0) return [];

    // To render properly, we need to handle potentially overlapping ranges by splitting content into
    // atomic segments where the set of active styles is constant.

    // 1. Identify all boundary indices (start and end of all formats + 0 + length)
    const boundaries = new Set<number>([0, content.length]);
    formats.forEach(f => {
        boundaries.add(Math.max(0, Math.min(f.start, content.length)));
        boundaries.add(Math.max(0, Math.min(f.end, content.length)));
    });

    const sortedBoundaries = Array.from(boundaries).sort((a, b) => a - b);
    const segments: React.ReactNode[] = [];

    for (let i = 0; i < sortedBoundaries.length - 1; i++) {
        const start = sortedBoundaries[i];
        const end = sortedBoundaries[i + 1];
        if (start === end) continue;

        const segmentText = content.substring(start, end);

        // Find all active formats for this segment
        // A format is active if f.start <= start && f.end >= end
        const activeFormats = formats.filter(f => f.start <= start && f.end >= end);

        const style: TextStyle[] = [StyleSheet.flatten(baseStyle)];

        activeFormats.forEach(f => {
            if (f.type === 'bold') style.push({ fontWeight: 'bold' });
            if (f.type === 'italic') style.push({ fontStyle: 'italic' });
            if (f.type === 'strikethrough') style.push({ textDecorationLine: 'line-through' });
            if (f.type === 'underline') style.push({ textDecorationLine: 'underline' });
            if (f.type === 'code') style.push({ fontFamily: 'monospace', backgroundColor: '#f0f0f0' });
            if (f.type === 'highlight') {
                const colorKey = f.data || 'yellow';
                // @ts-ignore
                const highlightColor = (colors?.highlight as any)?.[colorKey] || 'yellow';
                style.push({ backgroundColor: highlightColor });
            }
        });

        segments.push(
            <Text key={`${start}-${end}`} style={style}>
                {segmentText}
            </Text>
        );
    }

    return segments;
};

/**
 * Legacy support for simple text rendering (reading mode).
 * Wraps the new range-based logic.
 */
export const parseMarkdownText = (text: string, baseStyle?: StyleProp<TextStyle>): React.ReactNode[] => {
    const { content, formats } = parseMarkdownToData(text);
    return renderFormattedText(content, formats, baseStyle);

    /**
     * Strips markdown syntax from text to return plain text.
     */
};

/**
 * Strips markdown syntax from text to return plain text.
 */
export const stripMarkdownSyntax = (text: string): string => {
    if (!text) return '';

    // 1. Strip Block Elements
    // Headers (# Header)
    let stripped = text.replace(/^#+\s+/gm, '');

    // Lists (- Item, * Item, 1. Item)
    stripped = stripped.replace(/^\s*[-*+]\s+/gm, '');
    stripped = stripped.replace(/^\s*\d+\.\s+/gm, ''); // Ordered list

    // Blockquotes (> Quote)
    stripped = stripped.replace(/^\s*>\s+/gm, '');

    // Todos (- [ ] Todo)
    stripped = stripped.replace(/^\s*-\s\[[ xX]\]\s+/gm, '');

    // Audio tags - remove entirely
    stripped = stripped.replace(/!\[audio\]\([^)]+\)/g, '');

    // Other Images (![alt](url)) - Keep alt text
    stripped = stripped.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');

    // horizontal rules
    stripped = stripped.replace(/^-{3,}$/gm, '');

    // 2. Strip Inline Elements using our existing logic logic
    // We can reuse parseMarkdownToData which strips syntax by regex capturing group 1?
    // Actually parseMarkdownToData already creates a plain text structure "content".
    // Does it recursively strip? Yes, basic inline.

    // Let's use parseMarkdownToData on the block-stripped text.
    // However, parseMarkdownToData returns "plainText" which it constructs by taking INNER content.
    // Example: "**Bold**" -> "Bold".

    const { content } = parseMarkdownToData(stripped);
    return content;
};
