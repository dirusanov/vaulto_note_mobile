import React, { useCallback, useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import {
    View,
    TextInput,
    StyleSheet,
    TouchableOpacity,
    NativeSyntheticEvent,
    TextInputKeyPressEventData,
    Platform,
    TextInputSelectionChangeEventData,
    Text
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { MarkdownFormatType } from './MarkdownToolbar';
import { parseMarkdownForInput } from '../utils/markdownUtils';

interface RichTextEditorProps {
    initialContent: string;
    onChange: (text: string) => void;
    onSelectionChange?: (selection: { start: number; end: number }) => void;
    onActiveStylesChange?: (styles: MarkdownFormatType[]) => void;
    placeholder?: string;
    editable?: boolean;
    ListHeaderComponent?: React.ComponentType<any> | React.ReactElement | null;
    baseFontSize?: number;
    autoScalingEnabled?: boolean;
}

export interface RichTextEditorHandle {
    handleFormat: (type: MarkdownFormatType) => void;
    focusBlockAt: (lineIndex: number, ratio?: number) => void;
}

interface Block {
    id: string;
    type: 'text' | 'todo' | 'h1' | 'h2' | 'h3';
    content: string;
    checked?: boolean;
}

// Simple ID generator for blocks to avoid async uuid overhead during typing
const generateId = () => Math.random().toString(36).substr(2, 9);

export const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>((props, ref) => {
    const {
        initialContent,
        onChange,
        onSelectionChange,
        onActiveStylesChange,
        placeholder,
        editable = true,
        ListHeaderComponent,
        baseFontSize = 16,
        autoScalingEnabled = true,
    } = props;
    const [blocks, setBlocks] = useState<Block[]>([]);
    const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
    const inputRefs = useRef<Record<string, TextInput>>({});
    const isInternalUpdate = useRef(false);

    // Track selection for each block to support inline formatting
    const blockSelections = useRef<Record<string, { start: number; end: number }>>({});
    const pendingFocusRef = useRef<{ index: number; ratio: number } | null>(null);

    const focusBlockByIndex = (blockIndex: number, ratio: number) => {
        const targetBlock = blocks[blockIndex];
        if (!targetBlock) return false;

        const maxIndex = targetBlock.content.length;
        const caretPosition = Math.min(Math.round(targetBlock.content.length * ratio), maxIndex);

        // Ensure valid selection range
        const selection = {
            start: caretPosition,
            end: caretPosition
        };

        blockSelections.current[targetBlock.id] = selection;
        setFocusedBlockId(targetBlock.id);

        requestAnimationFrame(() => {
            const input = inputRefs.current[targetBlock.id];
            input?.focus();
            // Small delay to ensure focus is active before setting selection
            // otherwise it might be ignored on some devices
            setTimeout(() => {
                input?.setNativeProps({ selection });
            }, 10);
        });

        return true;
    };

    const detectActiveStyles = (block: Block, selection: { start: number; end: number }) => {
        const styles: MarkdownFormatType[] = [];

        // Block types
        if (block.type === 'h1') styles.push('h1');
        if (block.type === 'h2') styles.push('h2');
        if (block.type === 'h3') styles.push('h3');
        if (block.type === 'todo') styles.push('todo');
        if (block.content.startsWith('- ')) styles.push('list');

        // Inline styles
        const text = block.content;

        // Helper to check overlap
        const checkOverlap = (regex: RegExp, type: MarkdownFormatType, dLen: number) => {
            let match;
            // Reset regex lastIndex just in case
            regex.lastIndex = 0;

            while ((match = regex.exec(text)) !== null) {
                const matchStart = match.index;
                const matchEnd = matchStart + match[0].length;

                // Check if selection is fully within the styled range (inclusive of boundaries for user feel)
                // For multiline, we just check intersection
                if ((selection.start >= matchStart && selection.start <= matchEnd) ||
                    (selection.end >= matchStart && selection.end <= matchEnd) ||
                    (selection.start <= matchStart && selection.end >= matchEnd)) {
                    styles.push(type);
                    return; // Found one instance causing activation
                }
            }
        };

        // Bold (**...**)
        checkOverlap(/\*\*(.*?)\*\*/g, 'bold', 2);

        // Italic (_..._ or *...*)
        // checkOverlap(/_(.*?)_/g, 'italic', 1);
        // We need to check both. But we can combine regex or check individually.
        checkOverlap(/(_(.*?)_|\*(.*?)\*)/g, 'italic', 1);

        // Strikethrough (~~...~~)
        checkOverlap(/~~(.*?)~~/g, 'strikethrough', 2);

        return styles;
    };

    const updateActiveStyles = (blockId: string, selection?: { start: number; end: number }) => {
        if (!blockId || !onActiveStylesChange) return;

        const block = blocks.find(b => b.id === blockId);
        if (!block) return;

        const sel = selection || blockSelections.current[blockId] || { start: block.content.length, end: block.content.length };
        const styles = detectActiveStyles(block, sel);
        onActiveStylesChange(styles);
    };

    useImperativeHandle(ref, () => ({
        handleFormat: (type: MarkdownFormatType) => {
            if (!focusedBlockId) return;

            const blockIndex = blocks.findIndex(b => b.id === focusedBlockId);
            if (blockIndex === -1) return;

            const block = blocks[blockIndex];
            const selection = blockSelections.current[focusedBlockId] || { start: block.content.length, end: block.content.length };
            let newBlocks = [...blocks];

            if (['h1', 'h2', 'h3', 'todo', 'list'].includes(type)) {

                if (block.type === 'text' && block.content.includes('\n')) {
                    // Split multiline block logic
                    const text = block.content;
                    const cursor = selection.start;

                    // Find line boundaries
                    let lineStart = text.lastIndexOf('\n', cursor - 1);
                    if (lineStart === -1) lineStart = 0;
                    else lineStart += 1; // skip \n

                    let lineEnd = text.indexOf('\n', cursor);
                    if (lineEnd === -1) lineEnd = text.length;

                    const lineContent = text.substring(lineStart, lineEnd);
                    const beforeContent = text.substring(0, lineStart > 0 ? lineStart - 1 : 0);
                    const afterContent = text.substring(lineEnd + 1);

                    const newBlockId = generateId();
                    const targetBlock: Block = {
                        id: newBlockId,
                        type: 'text', // to be converted below
                        content: lineContent
                    };

                    // Construct new blocks list
                    const replacementBlocks: Block[] = [];
                    if (beforeContent) replacementBlocks.push({ id: block.id, type: 'text', content: beforeContent });
                    replacementBlocks.push(targetBlock);
                    if (afterContent) replacementBlocks.push({ id: generateId(), type: 'text', content: afterContent });

                    // Replace the original block
                    newBlocks.splice(blockIndex, 1, ...replacementBlocks);

                    // Convert targetBlock
                    let newType: Block['type'] = 'text';
                    let newContent = lineContent;

                    if (type === 'h1') newType = 'h1';
                    else if (type === 'h2') newType = 'h2';
                    else if (type === 'h3') newType = 'h3';
                    else if (type === 'todo') { newType = 'todo'; }
                    else if (type === 'list') {
                        if (newContent.startsWith('- ')) newContent = newContent.substring(2);
                        else newContent = '- ' + newContent;
                    }

                    if (type !== 'list') {
                        if (type === 'todo') {
                            targetBlock.type = 'todo';
                            targetBlock.checked = false;
                        } else {
                            targetBlock.type = newType as any;
                        }
                    } else {
                        targetBlock.content = newContent;
                    }

                    blockSelections.current[newBlockId] = {
                        start: selection.start - lineStart,
                        end: selection.end - lineStart
                    };
                    setFocusedBlockId(newBlockId);

                } else {
                    // Simple Case: Block is single line or non-text
                    let newType: Block['type'] = 'text';

                    if (type === 'h1') { newType = 'h1'; }
                    else if (type === 'h2') { newType = 'h2'; }
                    else if (type === 'h3') { newType = 'h3'; }
                    else if (type === 'todo') { newType = 'todo'; }
                    else if (type === 'list') { newType = 'text'; }

                    if (type === 'list') {
                        if (block.content.startsWith('- ')) {
                            newBlocks[blockIndex] = { ...block, content: block.content.substring(2) };
                        } else {
                            newBlocks[blockIndex] = { ...block, content: '- ' + block.content };
                        }
                    } else if (block.type === type) {
                        newBlocks[blockIndex] = { ...block, type: 'text' };
                    } else {
                        newBlocks[blockIndex] = { ...block, type: newType as any };
                        if (type === 'todo' && block.type !== 'todo') {
                            newBlocks[blockIndex].checked = false;
                        }
                    }
                }
            } else {
                // Inline formatting (bold, italic, strikethrough)
                const { start, end } = selection;
                let text = block.content;
                let wrapper = '';
                let regex: RegExp | null = null;

                if (type === 'bold') { wrapper = '**'; regex = /\*\*(.*?)\*\*/g; }
                else if (type === 'italic') {
                    regex = /(_(.*?)_|\*(.*?)\*)/g;
                    wrapper = '_';
                }
                else if (type === 'strikethrough') { wrapper = '~~'; regex = /~~(.*?)~~/g; }

                let newText = text;

                // Check if active (toggle off)
                const activeStyles = detectActiveStyles(block, selection);
                if (activeStyles.includes(type) && regex) {
                    // Remove formatting
                    let match;
                    let found = false;
                    while ((match = regex.exec(text)) !== null) {
                        const matchStart = match.index;
                        const matchEnd = matchStart + match[0].length;
                        const matchContent = match[0];

                        let currentWrapperLen = wrapper.length;
                        let currentWrapperStr = wrapper;
                        if (type === 'italic') {
                            if (matchContent.startsWith('_')) {
                                currentWrapperLen = 1;
                                currentWrapperStr = '_';
                            } else if (matchContent.startsWith('*')) {
                                currentWrapperLen = 1;
                                currentWrapperStr = '*';
                            }
                        } else if (type === 'bold' || type === 'strikethrough') {
                            currentWrapperLen = 2;
                            currentWrapperStr = matchContent.substring(0, 2);
                        }

                        if ((start >= matchStart && start <= matchEnd) ||
                            (end >= matchStart && end <= matchEnd) ||
                            (start <= matchStart && end >= matchEnd)) {
                            found = true;

                            const innerStart = matchStart + currentWrapperLen;
                            const innerEnd = matchEnd - currentWrapperLen;

                            const prefix = text.substring(0, matchStart);
                            const content = text.substring(innerStart, innerEnd);
                            const suffix = text.substring(matchEnd);

                            newText = prefix + content + suffix;
                            break;
                        }
                    }
                } else {
                    // Add formatting
                    const selectedText = text.substring(start, end);
                    newText = text.substring(0, start) + wrapper + selectedText + wrapper + text.substring(end);

                    blockSelections.current[block.id] = {
                        start: start + wrapper.length,
                        end: end + wrapper.length
                    };
                }

                newBlocks[blockIndex] = { ...block, content: newText };
            }

            setBlocks(newBlocks);
            isInternalUpdate.current = true;
            onChange(serializeBlocks(newBlocks));

            setTimeout(() => {
                inputRefs.current[focusedBlockId]?.focus();
            }, 10);
        },
        focusBlockAt: (lineIndex: number, ratio: number = 1) => {
            if (blocks.length === 0) {
                pendingFocusRef.current = { index: lineIndex, ratio };
                return;
            }

            const clampedIndex = Math.min(Math.max(lineIndex, 0), blocks.length - 1);
            const clampedRatio = Math.min(Math.max(ratio, 0), 1);
            const success = focusBlockByIndex(clampedIndex, clampedRatio);

            if (!success) {
                pendingFocusRef.current = { index: clampedIndex, ratio: clampedRatio };
            } else {
                pendingFocusRef.current = null;
            }
        }
    }));

    // Initial parsing
    // Initial parsing
    useEffect(() => {
        if (isInternalUpdate.current) {
            isInternalUpdate.current = false;
            return;
        }

        const lines = initialContent.split('\n');
        const parsedBlocks: Block[] = [];
        let currentTextBlock: Block | null = null;

        lines.forEach(line => {
            // Check for structured types
            const todoMatch = line.match(/^(\s*-\s\[([ xX])\]\s)(.*)$/);
            const header1Match = line.startsWith('# ');
            const header2Match = line.startsWith('## ');
            const header3Match = line.startsWith('### ');

            const isStructure = todoMatch || header1Match || header2Match || header3Match;

            if (isStructure) {
                // Determine type
                let type: Block['type'] = 'text'; // Fallback
                let content = line;
                let checked = false;

                if (todoMatch) {
                    type = 'todo';
                    checked = todoMatch[2].toLowerCase() === 'x';
                    content = todoMatch[3];
                } else if (header3Match) {
                    type = 'h3';
                    content = line.substring(4);
                } else if (header2Match) {
                    type = 'h2';
                    content = line.substring(3);
                } else if (header1Match) {
                    type = 'h1';
                    content = line.substring(2);
                }

                const id = generateId();
                parsedBlocks.push({ id, type, content, checked });
                currentTextBlock = null; // Break text continuity

            } else {
                // It's text.
                // Do we merge with previous text block?
                if (currentTextBlock) {
                    currentTextBlock.content += '\n' + line;
                } else {
                    const id = generateId();
                    currentTextBlock = { id, type: 'text', content: line };
                    parsedBlocks.push(currentTextBlock);
                }
            }
        });

        // Ensure at least one block
        if (parsedBlocks.length === 0) {
            parsedBlocks.push({ id: generateId(), type: 'text', content: '' });
        }

        setBlocks(parsedBlocks);
    }, [initialContent]);

    // Reconstruct markdown
    const serializeBlocks = (currentBlocks: Block[]) => {
        return currentBlocks.map(block => {
            if (block.type === 'todo') {
                return `- [${block.checked ? 'x' : ' '}] ${block.content}`;
            }
            if (block.type === 'h1') return `# ${block.content}`;
            if (block.type === 'h2') return `## ${block.content}`;
            if (block.type === 'h3') return `### ${block.content}`;
            return block.content;
        }).join('\n');
    };

    const handleBlockChange = (id: string, text: string) => {
        let newBlocks = [...blocks];
        const index = newBlocks.findIndex(b => b.id === id);
        if (index === -1) return;

        const block = newBlocks[index];

        // Check for Auto-Formatting (Text -> Todo/Header)
        if (block.type === 'text') {
            const todoMatch = text.match(/^(\s*-\s\[([ xX])\]\s)(.*)$/);
            const header1Match = text.match(/^#\s+(.*)$/);
            const header2Match = text.match(/^##\s+(.*)$/);
            const header3Match = text.match(/^###\s+(.*)$/);

            if (todoMatch) {
                newBlocks[index] = {
                    ...block,
                    type: 'todo',
                    checked: todoMatch[2].toLowerCase() === 'x',
                    content: todoMatch[3]
                };
            } else if (header1Match) {
                newBlocks[index] = { ...block, type: 'h1', content: header1Match[1] };
            } else if (header2Match) {
                newBlocks[index] = { ...block, type: 'h2', content: header2Match[1] };
            } else if (header3Match) {
                newBlocks[index] = { ...block, type: 'h3', content: header3Match[1] };
            } else {
                newBlocks[index] = { ...block, content: text };
            }
        } else {
            newBlocks[index] = { ...block, content: text };
        }

        setBlocks(newBlocks);
        isInternalUpdate.current = true;
        onChange(serializeBlocks(newBlocks));
    };

    const handleKeyPress = (id: string, e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
        const key = e.nativeEvent.key;
        if (key === 'Enter') {
            const index = blocks.findIndex(b => b.id === id);
            if (index === -1) return;

            const currentBlock = blocks[index];

            // Multiline Text Logic:
            // If Text block, Enter = New line in same block.
            if (currentBlock.type === 'text') {
                // ALLOW DEFAULT BEHAVIOR.
                return;
            }

            e.preventDefault();
            const newBlockId = generateId();

            // Structure Block Logic (Todo/Header): Split/Create new
            let nextType: Block['type'] = 'text';
            let nextChecked = false;

            if (currentBlock.type === 'todo') {
                if (currentBlock.content.trim() === '') {
                    // Empty todo + Enter -> Convert to text
                    const updatedBlocks = [...blocks];
                    updatedBlocks[index] = { ...currentBlock, type: 'text' };
                    setBlocks(updatedBlocks);
                    isInternalUpdate.current = true;
                    onChange(serializeBlocks(updatedBlocks));
                    return;
                }
                nextType = 'todo';
            }

            const newBlock: Block = {
                id: newBlockId,
                type: nextType,
                content: '',
                checked: nextChecked
            };

            const newBlocks = [...blocks];
            newBlocks.splice(index + 1, 0, newBlock);
            setBlocks(newBlocks);

            setTimeout(() => inputRefs.current[newBlockId]?.focus(), 10);
            isInternalUpdate.current = true;
            onChange(serializeBlocks(newBlocks));

        } else if (key === 'Backspace') {
            const index = blocks.findIndex(b => b.id === id);
            if (index === -1) return;

            const currentBlock = blocks[index];
            const selection = blockSelections.current[id];
            // Only merge if cursor is at the very beginning (0,0)
            const isCursorAtStart = selection?.start === 0 && selection?.end === 0;
            const hasPrevBlock = index > 0;
            const isEffectivelyEmpty = currentBlock.content.length === 0;

            if (!hasPrevBlock && isCursorAtStart) {
                // At very start of doc, nothing to do
                return;
            }

            if (!hasPrevBlock) return;

            if (isEffectivelyEmpty) {
                // Delete empty block
                e.preventDefault();
                const prevId = blocks[index - 1].id;
                const prevBlock = blocks[index - 1];
                const newBlocks = blocks.filter(b => b.id !== id);
                setBlocks(newBlocks);

                blockSelections.current[prevId] = {
                    start: prevBlock.content.length,
                    end: prevBlock.content.length,
                };
                setFocusedBlockId(prevId);

                setTimeout(() => {
                    const ref = inputRefs.current[prevId];
                    ref?.focus();
                    ref?.setNativeProps({ selection: blockSelections.current[prevId] });
                }, 10);

                isInternalUpdate.current = true;
                onChange(serializeBlocks(newBlocks));
            } else if (isCursorAtStart) {
                // Merge with previous block
                e.preventDefault();
                const prevIndex = index - 1;
                const prevBlock = blocks[prevIndex];

                const prevLength = prevBlock.content.length;
                const mergedContent = prevBlock.content + currentBlock.content;

                const newBlocks = [...blocks];
                newBlocks[prevIndex] = { ...prevBlock, content: mergedContent };
                newBlocks.splice(index, 1);
                setBlocks(newBlocks);

                blockSelections.current[prevBlock.id] = {
                    start: prevLength,
                    end: prevLength,
                };
                setFocusedBlockId(prevBlock.id);

                setTimeout(() => {
                    const ref = inputRefs.current[prevBlock.id];
                    ref?.focus();
                    // setTimeout again to be safe with Layout
                    setTimeout(() => {
                        ref?.setNativeProps({ selection: blockSelections.current[prevBlock.id] });
                    }, 10);
                }, 10);

                isInternalUpdate.current = true;
                onChange(serializeBlocks(newBlocks));
            }
        }
    };

    const toggleTodo = (id: string) => {
        const newBlocks = blocks.map(b => b.id === id ? { ...b, checked: !b.checked } : b);
        setBlocks(newBlocks);
        isInternalUpdate.current = true;
        onChange(serializeBlocks(newBlocks));
    };

    const handleSelectionChange = (id: string, event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
        blockSelections.current[id] = event.nativeEvent.selection;
        updateActiveStyles(id, event.nativeEvent.selection);
        if (onSelectionChange) {
            onSelectionChange(event.nativeEvent.selection);
        }
    };

    useEffect(() => {
        if (pendingFocusRef.current && blocks.length > 0) {
            const { index, ratio } = pendingFocusRef.current;
            const clampedIndex = Math.min(Math.max(index, 0), blocks.length - 1);
            const clampedRatio = Math.min(Math.max(ratio, 0), 1);
            const success = focusBlockByIndex(clampedIndex, clampedRatio);
            if (success) {
                pendingFocusRef.current = null;
            }
        }
    }, [blocks]);

    useEffect(() => {
        if (focusedBlockId) {
            // Use current selection ref if available, safely
            const selection = blockSelections.current[focusedBlockId];
            if (selection) {
                updateActiveStyles(focusedBlockId, selection);
            }
        }
    }, [blocks, focusedBlockId]);

    // Dynamic scaling logic based on content density
    const getScaleFactor = () => {
        if (!autoScalingEnabled) return 1.0;
        const count = blocks.length;
        if (count <= 8) return 1.25; // Large Mode
        if (count <= 15) return 1.15; // Medium Mode
        return 1.0; // Standard Mode
    };

    const scaleFactor = getScaleFactor();

    // Derived font sizes
    const fontSizeBody = baseFontSize * (scaleFactor); // Base body also scales if it's todo, treated below
    // Headers scale based on baseFontSize but NOT the density scaleFactor (usually) 
    // OR we might want everything to scale? 
    // Let's scale text only for todos via scaleFactor as before, but Headers relative to baseFontSize.
    const fontSizeH1 = baseFontSize * 1.5; // e.g. 16 -> 24
    const fontSizeH2 = baseFontSize * 1.25; // e.g. 16 -> 20
    const fontSizeH3 = baseFontSize * 1.125; // e.g. 16 -> 18

    const renderItem = ({ item, drag, isActive }: RenderItemParams<Block>) => {
        const isTodo = item.type === 'todo';
        const isHeader = item.type === 'h1' || item.type === 'h2' || item.type === 'h3';

        // Font size logic:
        // Todo: base * scaleFactor
        // Text: base
        // Headers: proportional
        let currentFontSize = baseFontSize;
        if (isTodo) {
            currentFontSize = baseFontSize * scaleFactor;
        } else if (item.type === 'h1') currentFontSize = fontSizeH1;
        else if (item.type === 'h2') currentFontSize = fontSizeH2;
        else if (item.type === 'h3') currentFontSize = fontSizeH3;

        // Base text styles for consistency
        const textStyles = [
            styles.input,
            { fontSize: currentFontSize },
            isTodo && {
                ...styles.todoInput,
                minHeight: (baseFontSize * 1.8) * scaleFactor, // Scale height with font
                paddingTop: 4 * scaleFactor,
                paddingBottom: 4 * scaleFactor
            },
            item.checked && styles.todoInputChecked,
            item.type === 'h1' && { ...styles.h1, fontSize: fontSizeH1, marginBottom: 8 * (baseFontSize / 16) },
            item.type === 'h2' && { ...styles.h2, fontSize: fontSizeH2, marginBottom: 6 * (baseFontSize / 16) },
            item.type === 'h3' && { ...styles.h3, fontSize: fontSizeH3, marginBottom: 4 * (baseFontSize / 16) },
        ];

        return (
            <ScaleDecorator>
                <View
                    style={[
                        styles.blockContainer,
                        isActive && styles.draggingBlock,
                        isTodo && {
                            minHeight: (baseFontSize * 2.5) * scaleFactor, // Touch target
                            paddingVertical: 4 * scaleFactor,
                            // alignItems: 'center' // Removed to support multiline text top-alignment
                        }
                    ]}
                >
                    {isTodo && (
                        <TouchableOpacity
                            style={[styles.checkbox, {
                                marginTop: (4 * scaleFactor) + (baseFontSize * 0.1), // Heuristic alignment
                                marginRight: spacing.s * scaleFactor
                            }]}
                            onPress={() => toggleTodo(item.id)}
                            hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
                        >
                            <MaterialIcons
                                name={item.checked ? 'check-box' : 'check-box-outline-blank'}
                                size={(baseFontSize * 1.5) * scaleFactor} // Scales with font
                                color={item.checked ? colors.primary : colors.textTertiary}
                            />
                        </TouchableOpacity>
                    )}

                    <TextInput
                        ref={ref => { if (ref) inputRefs.current[item.id] = ref; }}
                        style={textStyles}
                        onChangeText={(text) => handleBlockChange(item.id, text)}
                        onKeyPress={(e) => handleKeyPress(item.id, e)}
                        onSelectionChange={(e) => handleSelectionChange(item.id, e)}
                        placeholder={placeholder && blocks.length === 1 ? placeholder : undefined}
                        placeholderTextColor={colors.textMuted}
                        multiline={true}
                        scrollEnabled={false}
                        onFocus={() => {
                            setFocusedBlockId(item.id);
                            const selection = blockSelections.current[item.id];
                            if (selection) {
                                requestAnimationFrame(() => {
                                    inputRefs.current[item.id]?.setNativeProps({ selection });
                                });
                            }
                        }}
                        onBlur={() => {
                            setFocusedBlockId(null);
                        }}
                    >
                        {item.content
                            ? parseMarkdownForInput(item.content, textStyles)
                            : null}
                    </TextInput>
                </View>
            </ScaleDecorator >
        );
    };


    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
            <DraggableFlatList
                data={blocks}
                onDragEnd={({ data }) => {
                    setBlocks(data);
                    isInternalUpdate.current = true;
                    onChange(serializeBlocks(data));
                }}
                ListHeaderComponent={ListHeaderComponent}
                keyExtractor={(item) => item.id}
                renderItem={renderItem}
                keyboardShouldPersistTaps="always"
                removeClippedSubviews={Platform.OS === 'android'} // Optimize android
                contentContainerStyle={{ flexGrow: 1 }}
                ListFooterComponent={
                    <>
                        <TouchableOpacity
                            style={{ flex: 1, minHeight: 100 }}
                            activeOpacity={1}
                            onPress={() => {
                                if (blocks.length > 0) {
                                    const lastId = blocks[blocks.length - 1].id;
                                    inputRefs.current[lastId]?.focus();
                                }
                            }}
                        />
                    </>
                }
            />
        </GestureHandlerRootView>
    );
});

const styles = StyleSheet.create({
    blockContainer: {
        flexDirection: 'row',
        alignItems: 'flex-start', // Align top for multiline
        // marginBottom: 2, // Removed for unified feel
        paddingHorizontal: spacing.xs,
        minHeight: 30,
        backgroundColor: 'transparent',
    },
    textRenderContainer: {
        flex: 1,
        minHeight: 30,
        justifyContent: 'center', // Center vertically for single lines? No, emulate input
        paddingTop: 4, // Align with checkbox text and input padding
        paddingBottom: 4,
    },
    draggingBlock: {
        opacity: 0.7,
        backgroundColor: colors.surface,
    },
    checkbox: {
        marginTop: 4,
        marginRight: spacing.s,
    },
    input: {
        flex: 1,
        fontSize: 16,
        color: colors.text,
        paddingTop: 4, // Align with checkbox text
        paddingBottom: 4,
        minHeight: 30,
    },
    todoInput: {
        // Specific styles for todo text
    },
    todoInputChecked: {
        textDecorationLine: 'line-through',
        color: colors.textMuted,
    },
    h1: { fontSize: 24, fontWeight: 'bold', marginBottom: 8, marginTop: 8 },
    h2: { fontSize: 20, fontWeight: 'bold', marginBottom: 6, marginTop: 6 },
    h3: { fontSize: 18, fontWeight: 'bold', marginBottom: 4, marginTop: 4 },
});
