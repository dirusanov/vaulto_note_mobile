import React, { useCallback, useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import {
    View,
    TextInput,
    StyleSheet,
    TouchableOpacity,
    NativeSyntheticEvent,
    TextInputKeyPressEventData,
    Keyboard,
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
import { parseMarkdownText, parseMarkdownForInput } from '../utils/markdownUtils';

interface RichTextEditorProps {
    initialContent: string;
    onChange: (text: string) => void;
    onSelectionChange?: (selection: { start: number; end: number }) => void;
    placeholder?: string;
    editable?: boolean;
    ListHeaderComponent?: React.ComponentType<any> | React.ReactElement | null;
}

export interface RichTextEditorHandle {
    handleFormat: (type: MarkdownFormatType) => void;
}

interface Block {
    id: string;
    type: 'text' | 'todo' | 'h1' | 'h2' | 'h3';
    content: string;
    checked?: boolean;
}

// Simple ID generator for blocks to avoid async uuid overhead during typing
const generateId = () => Math.random().toString(36).substr(2, 9);

export const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(({
    initialContent,
    onChange,
    onSelectionChange,
    placeholder,
    editable = true,
    ListHeaderComponent,
}, ref) => {
    const [blocks, setBlocks] = useState<Block[]>([]);
    const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
    const inputRefs = useRef<Record<string, TextInput>>({});
    const isInternalUpdate = useRef(false);

    // Track selection for each block to support inline formatting
    const blockSelections = useRef<Record<string, { start: number; end: number }>>({});

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
                const selectedText = text.substring(start, end);

                let wrapper = '';
                if (type === 'bold') wrapper = '**';
                else if (type === 'italic') wrapper = '_';
                else if (type === 'strikethrough') wrapper = '~~';

                const newText = text.substring(0, start) + wrapper + selectedText + wrapper + text.substring(end);

                newBlocks[blockIndex] = { ...block, content: newText };

                // Update selection to wrap around? or stay inside?
                // Ideally move cursor to end of inserted wrapper if no selection, or keep selection if wrapping.
                // For simplicity, just update content.
            }

            setBlocks(newBlocks);
            isInternalUpdate.current = true;
            onChange(serializeBlocks(newBlocks));

            // Maintain focus
            // Need to wait for render if we changed layout significantly
            setTimeout(() => {
                inputRefs.current[focusedBlockId]?.focus();
            }, 10);
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
            if (index > 0 && blocks[index].content === '') {
                // Merge with previous if empty
                e.preventDefault();
                const prevId = blocks[index - 1].id;
                const newBlocks = blocks.filter(b => b.id !== id);
                setBlocks(newBlocks);
                setTimeout(() => inputRefs.current[prevId]?.focus(), 10);
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
        if (onSelectionChange) {
            onSelectionChange(event.nativeEvent.selection);
        }
    };

    const renderItem = ({ item, drag, isActive }: RenderItemParams<Block>) => {
        const isTodo = item.type === 'todo';
        const isHeader = item.type === 'h1' || item.type === 'h2' || item.type === 'h3';
        const isFocused = focusedBlockId === item.id;

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
                <View style={[styles.blockContainer, isActive && styles.draggingBlock]}>
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

                    {isFocused ? (
                        <TextInput
                            ref={ref => { if (ref) inputRefs.current[item.id] = ref; }}
                            style={textStyles}
                            // Value removed in favor of children for formatting?
                            // React Native 0.70+ TextInput supports children for mixed formatting.
                            // We must pass `children` OR `value`.
                            // If we pass children, we should set value to undefined BUT we need to handle controlled input.
                            // Official docs say: <TextInput>{textComponents}</TextInput> works.
                            // But keeping `value` prop alongside children might be conflicting.
                            // Let's rely on `children` solely.
                            // children={parseMarkdownForInput(item.content, textStyles)}
                            onChangeText={(text) => handleBlockChange(item.id, text)}
                            onKeyPress={(e) => handleKeyPress(item.id, e)}
                            onSelectionChange={(e) => handleSelectionChange(item.id, e)}
                            placeholder={placeholder && blocks.length === 1 ? placeholder : undefined}
                            placeholderTextColor={colors.textMuted}
                            multiline={true} // Needed for scroll, but we intercept Enter
                            scrollEnabled={false} // Allow container to scroll
                            onFocus={() => setFocusedBlockId(item.id)}
                            onBlur={() => {
                                setFocusedBlockId(null);
                            }}
                        >
                            {parseMarkdownForInput(item.content, textStyles)}
                        </TextInput>
                    ) : (
                        <TouchableOpacity
                            style={styles.textRenderContainer}
                            activeOpacity={1}
                            onPress={() => {
                                setFocusedBlockId(item.id);
                                setTimeout(() => inputRefs.current[item.id]?.focus(), 10);
                            }}
                        >
                            <Text style={textStyles}>
                                {item.content ? parseMarkdownText(item.content, textStyles) : (blocks.length === 1 && placeholder ? <Text style={{ color: colors.textMuted }}>{placeholder}</Text> : null)}
                            </Text>
                        </TouchableOpacity>
                    )}
                </View>
            </ScaleDecorator>
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
            />
        </GestureHandlerRootView>
    );
});

const styles = StyleSheet.create({
    blockContainer: {
        flexDirection: 'row',
        alignItems: 'flex-start', // Align top for multiline
        marginBottom: 2,
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
