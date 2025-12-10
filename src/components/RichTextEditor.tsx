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

        const caretPosition = Math.round(targetBlock.content.length * ratio);
        const selection = { start: caretPosition, end: caretPosition };
        blockSelections.current[targetBlock.id] = selection;
        setFocusedBlockId(targetBlock.id);

        requestAnimationFrame(() => {
            const input = inputRefs.current[targetBlock.id];
            input?.focus();
            input?.setNativeProps({ selection });
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
                const innerStart = matchStart + dLen;
                const innerEnd = matchEnd - dLen;

                // Check if selection is fully within the styled range (inclusive of boundaries for user feel)
                if (selection.start >= matchStart && selection.end <= matchEnd) {
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
            let shouldWaitRefocus = false;

            if (['h1', 'h2', 'h3', 'todo', 'list'].includes(type)) {
                // Block-level formatting
                let newType: Block['type'] = 'text';
                let newPrefix = '';

                if (type === 'h1') { newType = 'h1'; newPrefix = '# '; }
                else if (type === 'h2') { newType = 'h2'; newPrefix = '## '; }
                else if (type === 'h3') { newType = 'h3'; newPrefix = '### '; }
                else if (type === 'todo') { newType = 'todo'; newPrefix = '- [ ] '; }
                else if (type === 'list') { newType = 'text'; newPrefix = '- '; } // List is just text with bullet

                // Toggle logic: If already this type, revert to text. 
                // Note: For list and todo, we might want to toggle simply by removing the prefix if it exists.

                if (type === 'list') {
                    if (block.content.startsWith('- ')) {
                        newBlocks[blockIndex] = { ...block, content: block.content.substring(2) };
                    } else {
                        newBlocks[blockIndex] = { ...block, content: '- ' + block.content };
                    }
                } else if (block.type === type) {
                    // Revert to text
                    newBlocks[blockIndex] = { ...block, type: 'text' };
                } else {
                    // Change type
                    newBlocks[blockIndex] = { ...block, type: newType as any };
                }

                // For todo/headers, we usually don't need to add prefix to content if the type dictates styling,
                // BUT current implementation seems to parse prefixes.
                // Let's stick to the parsing logic: the type is derived from content in `handleBlockChange`.
                // So we should modify CONTENT to trigger the type change logic or explicitly set type + content.
                // The existing `handleBlockChange` logic parses `text` inputs.
                // If we explicitly set `type` in state, we must ensure content matches or we strip prefix.
                // SIMPLIFICATION: current implementation parses content to determine block look.
                // We should probably just update `type` and let the renderer handle styles, 
                // OR update content to include markdown syntax which `serializeBlocks` expects.

                // Looking at `serializeBlocks`:
                // h1 -> `# content`
                // todo -> `- [x] content`

                // Looking at `handleBlockChange`:
                // It auto-detects type from regex.

                // So best approach: Update the block properties directly.
                // If we want to switch to H1, we set type='h1' AND perhaps strip existing markers from content if we want clean content.
                // The `input` value is `block.content`.
                // `handleBlockChange` separates `type` and `content`.
                // e.g. type='h1', content='Title'.

                // So on Toggle:
                if (block.type === type) {
                    newBlocks[blockIndex] = { ...block, type: 'text' };
                } else if (type === 'list') {
                    // List isn't a separate type in Block interface, it's just text starting with '- '
                    if (block.content.startsWith('- ')) {
                        newBlocks[blockIndex] = { ...block, content: block.content.substring(2) };
                    } else {
                        newBlocks[blockIndex] = { ...block, content: '- ' + block.content };
                    }
                } else {
                    newBlocks[blockIndex] = { ...block, type: type as any };
                    // If converting to Todo, default to unchecked
                    if (type === 'todo' && block.type !== 'todo') {
                        newBlocks[blockIndex].checked = false;
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
                    // Italic can be _ or *
                    // To remove, we need to match what is there.
                    // We'll use a combined regex to find the match, then determine wrapper from match.
                    regex = /(_(.*?)_|\*(.*?)\*)/g;
                    wrapper = '_'; // Default for adding
                }
                else if (type === 'strikethrough') { wrapper = '~~'; regex = /~~(.*?)~~/g; }

                let newText = text;

                // Check if active (toggle off)
                const activeStyles = detectActiveStyles(block, selection);
                if (activeStyles.includes(type) && regex) {
                    // Remove formatting
                    // Use regex to find the match containing the selection
                    let match;
                    let found = false;
                    while ((match = regex.exec(text)) !== null) {
                        const matchStart = match.index;
                        const matchEnd = matchStart + match[0].length;
                        const matchContent = match[0]; // e.g., "**bold**" or "_italic_"

                        // Determine current wrapper length for this specific match
                        // Italic: _ or * (len 1). Bold/Strike (len 2).
                        // If type is italic, check char at matchStart.
                        let currentWrapperLen = wrapper.length; // Default to the 'add' wrapper length
                        let currentWrapperStr = wrapper; // Default to the 'add' wrapper string
                        if (type === 'italic') {
                            // Check the actual wrapper used in the match
                            if (matchContent.startsWith('_')) {
                                currentWrapperLen = 1;
                                currentWrapperStr = '_';
                            } else if (matchContent.startsWith('*')) {
                                currentWrapperLen = 1;
                                currentWrapperStr = '*';
                            }
                        } else if (type === 'bold' || type === 'strikethrough') {
                            currentWrapperLen = 2;
                            currentWrapperStr = matchContent.substring(0, 2); // Get the actual wrapper string
                        }

                        // Check if selection intersects this match
                        if (start >= matchStart && end <= matchEnd) {
                            found = true;

                            // Reconstruct text
                            // We want to keep the content but remove wrappers AROUND the selection intersection?
                            // Actually we want to removing the formatting for the SELECTED range.
                            // If selected range covers the whole formatted block, we remove wrappers.
                            // If selected range is partial, we split.

                            // Content limits (inner text)
                            const innerStart = matchStart + currentWrapperLen;
                            const innerEnd = matchEnd - currentWrapperLen;

                            // Calculate the intersection of Selection and Inner Content
                            // This gives us the text that should be "Unwrapped"
                            const intersectionStart = Math.max(start, innerStart);
                            const intersectionEnd = Math.min(end, innerEnd);

                            // Get the text pieces

                            // 1. Text BEFORE the match (preserved)
                            const prefix = text.substring(0, matchStart);

                            // 2. Inner Content BEFORE the selection (needs to stay wrapped)
                            let beforeContent = '';
                            if (intersectionStart > innerStart) {
                                // There is content before selection inside the wrappers. 
                                // We must wrap it.
                                beforeContent = currentWrapperStr + text.substring(innerStart, intersectionStart) + currentWrapperStr;
                            }

                            // 3. Inner Content INSIDE the selection (Unwrapped!)
                            // But wait, if selection includes the wrappers (start < innerStart), we just want the content.
                            // intersectionStart/End handles the clamping to content.
                            let middleContent = '';
                            if (intersectionEnd > intersectionStart) {
                                middleContent = text.substring(intersectionStart, intersectionEnd);
                            } else if (start === end) {
                                // Zero-length selection inside (cursor). Toggling off means... splitting?
                                // Usually means "start writing normal text here".
                                // e.g. **bold|** -> click B -> **bold**| (move out?) or **bold**| (normal).
                                // Complex for simple editor. Logic implies splitting: **bold** -> **bol**d**d** ?? No.
                                // If cursor is inside, we usually split the block.
                                // **bo|ld** -> **bo**|**ld**. New char inserted will be normal.
                                // So we insert empty gap?
                                // For now, let's just assume selection range > 0 or handle splitting logic.
                                // If selection is empty, we just split.
                                // middleContent is empty.
                            }

                            // 4. Inner Content AFTER the selection (stay wrapped)
                            let afterContent = '';
                            if (intersectionEnd < innerEnd) {
                                afterContent = currentWrapperStr + text.substring(intersectionEnd, innerEnd) + currentWrapperStr;
                            }

                            // 5. Text AFTER the match (preserved)
                            const realSuffix = text.substring(matchEnd);

                            newText = prefix + beforeContent + middleContent + afterContent + realSuffix;

                            break;
                        }
                    } if (!found) {
                        // Fallback/Should handle error? Just ignore
                    }
                } else {
                    // Add formatting
                    const selectedText = text.substring(start, end);
                    newText = text.substring(0, start) + wrapper + selectedText + wrapper + text.substring(end);
                }

                newBlocks[blockIndex] = { ...block, content: newText };
            }

            setBlocks(newBlocks);
            isInternalUpdate.current = true;
            onChange(serializeBlocks(newBlocks));

            // Determine active styles after change?
            // It's async due to state, but we can guess or wait for effect?
            // Effect will trigger block change -> we can trigger update.
            // But immediate update is better.

            // Maintain focus
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
            const focused = focusBlockByIndex(clampedIndex, clampedRatio);

            if (!focused) {
                pendingFocusRef.current = { index: clampedIndex, ratio: clampedRatio };
            } else {
                pendingFocusRef.current = null;
            }
        }
    }));

    // Initial parsing
    useEffect(() => {
        if (isInternalUpdate.current) {
            isInternalUpdate.current = false;
            return;
        }

        const parsedBlocks: Block[] = initialContent.split('\n').map(line => {
            const id = generateId();

            // Todo Check
            const todoMatch = line.match(/^(\s*-\s\[([ xX])\]\s)(.*)$/);
            if (todoMatch) {
                return {
                    id,
                    type: 'todo',
                    checked: todoMatch[2].toLowerCase() === 'x',
                    content: todoMatch[3]
                };
            }

            // Headers
            if (line.startsWith('# ')) return { id, type: 'h1', content: line.substring(2) };
            if (line.startsWith('## ')) return { id, type: 'h2', content: line.substring(3) };
            if (line.startsWith('### ')) return { id, type: 'h3', content: line.substring(4) };

            return { id, type: 'text', content: line };
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
            e.preventDefault(); // Prevent default newline in input if possible
            const index = blocks.findIndex(b => b.id === id);
            if (index === -1) return;

            const currentBlock = blocks[index];
            const newBlockId = generateId();

            // Should next block inherit type?
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

            // Focus next
            setTimeout(() => inputRefs.current[newBlockId]?.focus(), 10);

            isInternalUpdate.current = true;
            onChange(serializeBlocks(newBlocks));
        } else if (key === 'Backspace') {
            const index = blocks.findIndex(b => b.id === id);
            if (index === -1) return;

            const currentBlock = blocks[index];
            const selection = blockSelections.current[id];
            const isCursorAtStart = selection?.start === 0 && selection?.end === 0;
            const hasPrevBlock = index > 0;
            const isEffectivelyEmpty = currentBlock.content.trim().length === 0;

            if (!hasPrevBlock) return;

            if (isEffectivelyEmpty) {
                e.preventDefault();
                const prevId = blocks[index - 1].id;
                const newBlocks = blocks.filter(b => b.id !== id);
                setBlocks(newBlocks);
                blockSelections.current[prevId] = {
                    start: blocks[index - 1].content.length,
                    end: blocks[index - 1].content.length,
                };
                setTimeout(() => {
                    const ref = inputRefs.current[prevId];
                    ref?.focus();
                    ref?.setNativeProps({ selection: blockSelections.current[prevId] });
                }, 10);
                isInternalUpdate.current = true;
                onChange(serializeBlocks(newBlocks));
            } else if (isCursorAtStart) {
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

                setTimeout(() => {
                    const ref = inputRefs.current[prevBlock.id];
                    ref?.focus();
                    ref?.setNativeProps({ selection: blockSelections.current[prevBlock.id] });
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

    const renderItem = ({ item, drag, isActive }: RenderItemParams<Block>) => {
        const isTodo = item.type === 'todo';
        const isHeader = item.type === 'h1' || item.type === 'h2' || item.type === 'h3';

        // Base text styles for consistency
        const textStyles = [
            styles.input,
            isTodo && styles.todoInput,
            item.checked && styles.todoInputChecked,
            item.type === 'h1' && styles.h1,
            item.type === 'h2' && styles.h2,
            item.type === 'h3' && styles.h3,
        ];

        return (
            <ScaleDecorator>
                <TouchableOpacity
                    activeOpacity={1}
                    style={[styles.blockContainer, isActive && styles.draggingBlock]}
                    onPress={() => {
                        inputRefs.current[item.id]?.focus();
                    }}
                >
                    {isTodo && (
                        <TouchableOpacity
                            style={styles.checkbox}
                            onPress={() => toggleTodo(item.id)}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        >
                            <MaterialIcons
                                name={item.checked ? 'check-box' : 'check-box-outline-blank'}
                                size={24}
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
                            : (blocks.length === 1 && placeholder
                                ? <Text style={{ color: colors.textMuted }}>{placeholder}</Text>
                                : null)}
                    </TextInput>
                </TouchableOpacity>
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
