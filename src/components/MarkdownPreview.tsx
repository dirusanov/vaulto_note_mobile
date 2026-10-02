import React, { useMemo } from 'react';
import { StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { parseMarkdownText } from '../utils/markdownUtils';
import { createStyles } from '../theme/createStyles';

/**
 * Read-only markdown renderer for AI output shown outside the editor
 * (suggestion preview, comparisons). The editor itself is Tiptap-based; this is
 * the lightweight path for "show me the result before I accept it", where a
 * plain <Text> used to print "**Итоги**" and "## План" literally.
 */

type Block =
    | { kind: 'heading'; level: number; text: string }
    | { kind: 'paragraph'; text: string }
    | { kind: 'bullet'; text: string; depth: number; ordered?: string }
    | { kind: 'task'; text: string; depth: number; checked: boolean }
    | { kind: 'quote'; text: string }
    | { kind: 'code'; text: string }
    | { kind: 'rule' };

const HEADING_REGEX = /^ {0,3}(#{1,6})\s+(.*)$/;
const TASK_REGEX = /^(\s*)[-*+]\s*\[([ xX])\]\s+(.*)$/;
const BULLET_REGEX = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED_REGEX = /^(\s*)(\d+)[.)]\s+(.*)$/;
const QUOTE_REGEX = /^\s*>\s?(.*)$/;
const RULE_REGEX = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE_REGEX = /^\s*(?:```|~~~)/;

const LINK_REGEX = /!?\[([^\]]*)\]\(([^)]*)\)/g;

/**
 * parseMarkdownToData only knows inline emphasis, so links would survive as
 * literal "[label](url)". Split them out here and style the label instead.
 */
const renderInline = (
    text: string,
    style: StyleProp<TextStyle>,
    keyPrefix: string
): React.ReactNode[] => {
    const nodes: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    LINK_REGEX.lastIndex = 0;
    while ((match = LINK_REGEX.exec(text)) !== null) {
        if (match.index > lastIndex) {
            nodes.push(
                ...parseMarkdownText(text.slice(lastIndex, match.index), style, `${keyPrefix}t${lastIndex}-`)
            );
        }
        const label = match[1] || match[2];
        const isImage = match[0].startsWith('!');
        nodes.push(
            <Text key={`${keyPrefix}l${match.index}`} style={isImage ? style : [style, styles.link]}>
                {parseMarkdownText(label, isImage ? style : [style, styles.link], `${keyPrefix}l${match.index}-`)}
            </Text>
        );
        lastIndex = LINK_REGEX.lastIndex;
    }

    if (lastIndex < text.length) {
        nodes.push(...parseMarkdownText(text.slice(lastIndex), style, `${keyPrefix}t${lastIndex}-`));
    }

    return nodes;
};

const indentDepth = (indent: string): number =>
    Math.min(2, Math.floor(indent.replace(/\t/g, '  ').length / 2));

const parseBlocks = (source: string): Block[] => {
    const lines = source.replace(/\r\n?/g, '\n').split('\n');
    const blocks: Block[] = [];
    let paragraph: string[] = [];
    let codeLines: string[] | null = null;

    const flushParagraph = () => {
        if (paragraph.length === 0) return;
        blocks.push({ kind: 'paragraph', text: paragraph.join('\n') });
        paragraph = [];
    };

    for (const line of lines) {
        if (codeLines) {
            if (FENCE_REGEX.test(line)) {
                blocks.push({ kind: 'code', text: codeLines.join('\n') });
                codeLines = null;
            } else {
                codeLines.push(line);
            }
            continue;
        }

        if (FENCE_REGEX.test(line)) {
            flushParagraph();
            codeLines = [];
            continue;
        }

        if (!line.trim()) {
            flushParagraph();
            continue;
        }

        if (RULE_REGEX.test(line)) {
            flushParagraph();
            blocks.push({ kind: 'rule' });
            continue;
        }

        const heading = line.match(HEADING_REGEX);
        if (heading) {
            flushParagraph();
            blocks.push({
                kind: 'heading',
                level: heading[1].length,
                text: heading[2].replace(/\s+#+\s*$/, '').trim(),
            });
            continue;
        }

        const task = line.match(TASK_REGEX);
        if (task) {
            flushParagraph();
            blocks.push({
                kind: 'task',
                depth: indentDepth(task[1]),
                checked: task[2].toLowerCase() === 'x',
                text: task[3],
            });
            continue;
        }

        const bullet = line.match(BULLET_REGEX);
        if (bullet) {
            flushParagraph();
            blocks.push({ kind: 'bullet', depth: indentDepth(bullet[1]), text: bullet[2] });
            continue;
        }

        const ordered = line.match(ORDERED_REGEX);
        if (ordered) {
            flushParagraph();
            blocks.push({
                kind: 'bullet',
                depth: indentDepth(ordered[1]),
                ordered: `${ordered[2]}.`,
                text: ordered[3],
            });
            continue;
        }

        const quote = line.match(QUOTE_REGEX);
        if (quote) {
            flushParagraph();
            blocks.push({ kind: 'quote', text: quote[1] });
            continue;
        }

        paragraph.push(line);
    }

    if (codeLines) {
        blocks.push({ kind: 'code', text: codeLines.join('\n') });
    }
    flushParagraph();

    return blocks;
};

interface MarkdownPreviewProps {
    content: string;
    style?: StyleProp<ViewStyle>;
    /** Body size; headings and code scale from it. */
    fontSize?: number;
    selectable?: boolean;
}

export const MarkdownPreview = ({
    content,
    style,
    fontSize = 16,
    selectable = false,
}: MarkdownPreviewProps) => {
    const blocks = useMemo(() => parseBlocks(content || ''), [content]);

    const bodyStyle = { fontSize, lineHeight: Math.round(fontSize * 1.5) };

    return (
        <View style={style}>
            {blocks.map((block, index) => {
                const key = `md-${index}`;

                if (block.kind === 'rule') {
                    return <View key={key} style={styles.rule} />;
                }

                if (block.kind === 'code') {
                    return (
                        <View key={key} style={styles.codeBlock}>
                            <Text
                                selectable={selectable}
                                style={[styles.codeText, { fontSize: fontSize - 2 }]}
                            >
                                {block.text}
                            </Text>
                        </View>
                    );
                }

                if (block.kind === 'heading') {
                    const headingSize = fontSize + Math.max(0, 8 - (block.level - 1) * 2);
                    const headingStyle = {
                        fontSize: headingSize,
                        lineHeight: Math.round(headingSize * 1.35),
                    };
                    return (
                        <Text key={key} selectable={selectable} style={[styles.heading, headingStyle]}>
                            {renderInline(block.text, [styles.heading, headingStyle], `${key}-`)}
                        </Text>
                    );
                }

                if (block.kind === 'quote') {
                    return (
                        <View key={key} style={styles.quote}>
                            <Text selectable={selectable} style={[styles.quoteText, bodyStyle]}>
                                {renderInline(block.text, [styles.quoteText, bodyStyle], `${key}-`)}
                            </Text>
                        </View>
                    );
                }

                if (block.kind === 'task' || block.kind === 'bullet') {
                    const isTask = block.kind === 'task';
                    const marker = isTask
                        ? (block.checked ? '☑' : '☐')
                        : (block.ordered ?? '•');
                    const textStyle = [
                        styles.body,
                        bodyStyle,
                        isTask && block.checked ? styles.taskDone : null,
                    ];
                    return (
                        <View
                            key={key}
                            style={[styles.listRow, { paddingLeft: block.depth * spacing.m }]}
                        >
                            <Text style={[styles.listMarker, bodyStyle]}>{marker}</Text>
                            {/* listText last: it has to win over the paragraph
                                margin baked into styles.body, or every list item
                                would carry a paragraph gap under it. */}
                            <Text selectable={selectable} style={[textStyle, styles.listText]}>
                                {renderInline(block.text, textStyle, `${key}-`)}
                            </Text>
                        </View>
                    );
                }

                return (
                    <Text key={key} selectable={selectable} style={[styles.body, bodyStyle]}>
                        {renderInline(block.text, [styles.body, bodyStyle], `${key}-`)}
                    </Text>
                );
            })}
        </View>
    );
};

const styles = createStyles(() => ({
    body: {
        color: colors.text,
        marginBottom: spacing.s,
    },
    heading: {
        color: colors.text,
        fontWeight: '700',
        marginTop: spacing.s,
        marginBottom: spacing.xs,
    },
    listRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: spacing.xs,
    },
    listMarker: {
        color: colors.textSecondary,
        marginRight: spacing.s,
        minWidth: 18,
    },
    listText: {
        flex: 1,
        marginBottom: 0,
    },
    taskDone: {
        color: colors.textSecondary,
        textDecorationLine: 'line-through',
    },
    quote: {
        borderLeftWidth: 3,
        borderLeftColor: colors.border,
        paddingLeft: spacing.s,
        marginBottom: spacing.s,
    },
    quoteText: {
        color: colors.textSecondary,
        fontStyle: 'italic',
    },
    codeBlock: {
        backgroundColor: colors.backgroundSecondary,
        borderRadius: 8,
        padding: spacing.s,
        marginBottom: spacing.s,
    },
    codeText: {
        color: colors.text,
        fontFamily: 'monospace',
    },
    link: {
        color: colors.primary,
        textDecorationLine: 'underline',
    },
    rule: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: colors.border,
        marginVertical: spacing.s,
    },
}));
