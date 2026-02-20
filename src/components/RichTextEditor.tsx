import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import {
    View,
    Text,
    TextInput,
    StyleSheet,
    TouchableOpacity,
    NativeSyntheticEvent,
    TextInputKeyPressEventData,
    Platform,
    TextInputSelectionChangeEventData,
    Animated
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { MarkdownFormatType } from './MarkdownToolbar';
import { parseMarkdownToData, serializeBlockToMarkdown, renderFormattedText, BlockFormat } from '../utils/markdownUtils';
import { AudioPlayer } from './AudioPlayer';
import {
    VOICE_PROCESSING_LABEL,
    getVoiceProcessingText,
    isVoiceProcessingMarkerLine,
} from '../utils/voiceDraft';

interface RichTextEditorProps {
    initialContent: string;
    onChange: (text: string) => void;
    onSelectionChange?: (selection: { start: number; end: number }) => void;
    onActiveStylesChange?: (styles: MarkdownFormatType[]) => void;
    onFocus?: () => void;
    reparseTrigger?: number;
    placeholder?: string;
    ListHeaderComponent?: React.ComponentType<any> | React.ReactElement | null;
    baseFontSize?: number;
    autoScalingEnabled?: boolean;
}

export interface RichTextEditorHandle {
    handleFormat: (type: MarkdownFormatType) => void;
    focusBlockAt: (lineIndex: number, ratio?: number) => void;
    removeAudioBlock: (audioPath: string) => void;
}

interface Block {
    id: string;
    type: 'text' | 'todo' | 'h1' | 'h2' | 'h3' | 'audio' | 'processing';
    content: string;
    checked?: boolean;
    formats: BlockFormat[];
}

const generateId = () => Math.random().toString(36).substr(2, 9);

const ProcessingBadge = ({ content }: { content: string }) => {
    const spinAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.loop(
            Animated.timing(spinAnim, {
                toValue: 1,
                duration: 2000,
                useNativeDriver: true,
            })
        ).start();
    }, [spinAnim]);

    const spin = spinAnim.interpolate({
        inputRange: [0, 1],
        outputRange: ['0deg', '360deg']
    });

    return (
        <View style={styles.processingBadge}>
            <Animated.View style={{ transform: [{ rotate: spin }] }}>
                <MaterialIcons name="hourglass-top" size={14} color={colors.textSecondary} />
            </Animated.View>
            <Text style={styles.processingText}>
                {content || VOICE_PROCESSING_LABEL}
            </Text>
        </View>
    );
};

export const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>((props, ref) => {
    const {
        initialContent,
        onChange,
        onSelectionChange,
        onActiveStylesChange,
        onFocus,
        reparseTrigger,
        placeholder,
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

        // Inline styles via Formats
        if (!block.formats) return styles;

        // Check intersection of selection and formats
        // Logic: specific style is active if the selection START is inside the defined range,
        // or if proper intersection logic is desired (e.g. whole selection must be bold).
        const cursor = selection.start;

        block.formats.forEach(f => {
            // Check if cursor is strictly inside or at boundaries?
            // Usually styles are inclusive.
            if (cursor >= f.start && cursor <= f.end) {
                if (f.type === 'highlight' && f.data) {
                    styles.push(`highlight:${f.data}`);
                    if (!styles.includes('highlight')) styles.push('highlight');
                } else {
                    styles.push(f.type);
                }
            }
        });

        return Array.from(new Set(styles)); // unique
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
            if (block.type === 'processing') {
                return;
            }
            let selection = blockSelections.current[focusedBlockId] || { start: block.content.length, end: block.content.length };
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

                    // We need to slice formats logic if we care about preserving inline styles when splitting block.
                    // For this V1 refactor, we can attempt to split formats.
                    // Filter formats that fall into the extracted line.
                    const targetFormats = block.formats
                        .filter(f => f.end > lineStart && f.start < lineEnd)
                        .map(f => ({
                            ...f,
                            start: Math.max(0, f.start - lineStart),
                            end: Math.min(lineContent.length, f.end - lineStart)
                        }));

                    const targetBlock: Block = {
                        id: newBlockId,
                        type: 'text', // to be converted below
                        content: lineContent,
                        formats: targetFormats
                    };

                    // Construct new blocks list
                    const replacementBlocks: Block[] = [];
                    // Before Block formats
                    if (beforeContent) {
                        const beforeFormats = block.formats
                            .filter(f => f.start < lineStart) // crude filter
                            .map(f => ({ ...f, end: Math.min(f.end, beforeContent.length) }));
                        replacementBlocks.push({ id: block.id, type: 'text', content: beforeContent, formats: beforeFormats });
                    }

                    replacementBlocks.push(targetBlock);

                    // After Block formats
                    if (afterContent) {
                        const offset = lineEnd + 1;
                        const afterFormats = block.formats
                            .filter(f => f.end > offset)
                            .map(f => ({
                                ...f,
                                start: Math.max(0, f.start - offset),
                                end: Math.max(0, f.end - offset)
                            }));
                        replacementBlocks.push({ id: generateId(), type: 'text', content: afterContent, formats: afterFormats });
                    }

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

                    // For structure types, do we keep inline formats? Yes usually.

                    if (type !== 'list') {
                        if (type === 'todo') {
                            targetBlock.type = 'todo';
                            targetBlock.checked = false;
                        } else {
                            targetBlock.type = newType as any;
                        }
                    } else {
                        targetBlock.content = newContent;
                        // Shift formats if we added/removed '- '
                        if (newContent.length !== lineContent.length) {
                            const delta = newContent.length - lineContent.length;
                            targetBlock.formats = targetBlock.formats.map(f => ({
                                ...f,
                                start: f.start + delta,
                                end: f.end + delta
                            }));
                        }
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
                            const newContent = block.content.substring(2);
                            newBlocks[blockIndex] = {
                                ...block,
                                content: newContent,
                                formats: block.formats.map(f => ({ ...f, start: f.start - 2, end: f.end - 2 })).filter(f => f.end > f.start)
                            };
                        } else {
                            const newContent = '- ' + block.content;
                            newBlocks[blockIndex] = {
                                ...block,
                                content: newContent,
                                formats: block.formats.map(f => ({ ...f, start: f.start + 2, end: f.end + 2 }))
                            };
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
                // Inline formatting (bold, italic, strikethrough, highlight)
                let { start, end } = selection;
                const text = block.content;
                let currentFormats = block.formats || [];

                // Smart Selection: If cursor is collapsed, expand to word boundaries
                if (start === end) {
                    const wordCharRegex = /[^\s.,;:!?(){}\[\]"']/;
                    let wordStart = start;
                    while (wordStart > 0 && wordCharRegex.test(text[wordStart - 1])) {
                        wordStart--;
                    }
                    let wordEnd = end;
                    while (wordEnd < text.length && wordCharRegex.test(text[wordEnd])) {
                        wordEnd++;
                    }
                    if (wordEnd > wordStart) {
                        start = wordStart;
                        end = wordEnd;
                        selection = { start, end };
                    }
                }

                // Parse Type
                let targetType: BlockFormat['type'] = 'bold';
                let targetData: string | undefined = undefined;

                if (type === 'bold') targetType = 'bold';
                else if (type === 'italic') targetType = 'italic';
                else if (type === 'strikethrough') targetType = 'strikethrough';
                else if (type === 'underline') targetType = 'underline';
                else if (type.startsWith('highlight')) {
                    targetType = 'highlight';
                    const parts = type.split(':');
                    targetData = parts[1] || 'yellow';
                }

                if (start === end) return; // Cannot format empty range without pending state

                // Check if we are adding or removing?
                // Logic: If ANY part of the selection has this format, we REMOVE it from the overlap?
                // Or "Toggle"? Standard logic: if fully covered -> Remove. If partially/not covered -> Add.

                // Let's implement ADD/REMOVE based on coverage.
                // 1. Check coverage.
                const coveredArea = currentFormats.reduce((acc, f) => {
                    if (f.type !== targetType) return acc;
                    if (targetType === 'highlight' && f.data !== targetData && targetData !== 'white') return acc; // Different color highlight is technically not "same style"

                    const intersectStart = Math.max(start, f.start);
                    const intersectEnd = Math.min(end, f.end);
                    if (intersectEnd > intersectStart) {
                        return acc + (intersectEnd - intersectStart);
                    }
                    return acc;
                }, 0);

                // If coverage is substantial (e.g. > 50% or > 0?), toggle off.
                // Simple toggle: If fully active at start? 

                // If coverage is substantial (e.g. > 50% or > 0?), toggle off.
                // Simple toggle: If fully active at start?
                // Professional editors: B button status determines action.
                // Here we essentially check "Is B active at cursor/selection?"
                // Our `detectActiveStyles` says yes if start is covered.

                const activeAtStart = currentFormats.some(f =>
                    f.type === targetType &&
                    (targetType !== 'highlight' || f.data === targetData) &&
                    start >= f.start && start < f.end
                );

                // Re-evaluate: If I select "Hello World", and "Hello" is bold. 
                // Pressing Bold -> usually makes "World" bold too. (Add to gap).
                // Only untoggles if EVERYTHING is bold.

                const operation = (activeAtStart && coveredArea === (end - start)) ? 'remove' : 'add';

                // Special Highlight Logic: 'white' means remove highlights.
                if (targetType === 'highlight' && targetData === 'white') {
                    // Remove all overlapping highlights regardless of data
                    currentFormats = currentFormats.reduce<BlockFormat[]>((acc, f) => {
                        if (f.type !== 'highlight') {
                            acc.push(f);
                            return acc;
                        }
                        // Subtract selection from format
                        // f: [----------], sel: [--]
                        // Result: [---]   [-----]

                        const overlapStart = Math.max(f.start, start);
                        const overlapEnd = Math.min(f.end, end);

                        if (overlapEnd <= overlapStart) {
                            acc.push(f); // No overlap
                            return acc;
                        }

                        if (f.start < overlapStart) {
                            acc.push({ ...f, end: overlapStart });
                        }
                        if (f.end > overlapEnd) {
                            acc.push({ ...f, start: overlapEnd });
                        }
                        return acc;
                    }, []);

                } else if (operation === 'remove') {
                    // Subtract selection from matching formats
                    currentFormats = currentFormats.reduce<BlockFormat[]>((acc, f) => {
                        if (f.type !== targetType || (targetType === 'highlight' && f.data !== targetData)) {
                            acc.push(f);
                            return acc;
                        }

                        const overlapStart = Math.max(f.start, start);
                        const overlapEnd = Math.min(f.end, end);

                        if (overlapEnd <= overlapStart) {
                            acc.push(f);
                            return acc;
                        }

                        if (f.start < overlapStart) {
                            acc.push({ ...f, end: overlapStart });
                        }
                        if (f.end > overlapEnd) {
                            acc.push({ ...f, start: overlapEnd });
                        }
                        return acc;
                    }, []);

                } else {
                    // Add Format
                    // 1. Remove overlapping formats of same type (merge logic implicitly handles by creating one big, but we assume distinct ranges usually)
                    // Actually we should merge.
                    // Simplified Add:

                    // Specific highlight logic: If adding Red, remove Yellow overlap?
                    if (targetType === 'highlight') {
                        // Remove ANY highlight in range
                        currentFormats = currentFormats.reduce<BlockFormat[]>((acc, f) => {
                            if (f.type !== 'highlight') {
                                acc.push(f);
                                return acc;
                            }
                            const overlapStart = Math.max(f.start, start);
                            const overlapEnd = Math.min(f.end, end);

                            if (overlapEnd <= overlapStart) {
                                acc.push(f);
                                return acc;
                            }

                            if (f.start < overlapStart) {
                                acc.push({ ...f, end: overlapStart });
                            }
                            if (f.end > overlapEnd) {
                                acc.push({ ...f, start: overlapEnd });
                            }
                            return acc;
                        }, []);
                    }

                    // Add new range
                    const newRange: BlockFormat = {
                        type: targetType,
                        start,
                        end,
                        data: targetData
                    };

                    // Optimization: Merge with Touching/Overlapping ranges of same type & data
                    // This keeps format list clean.
                    // Filter out compatible ranges, merge into newRange, re-add.

                    const compatible = currentFormats.filter(f =>
                        f.type === targetType && f.data === targetData &&
                        ((f.end >= newRange.start && f.start <= newRange.end) || f.end === newRange.start || f.start === newRange.end)
                    );

                    if (compatible.length > 0) {
                        // Remove compatible from current
                        currentFormats = currentFormats.filter(f => !compatible.includes(f));
                        // Merge into newRange
                        const combinedStart = Math.min(newRange.start, ...compatible.map(f => f.start));
                        const combinedEnd = Math.max(newRange.end, ...compatible.map(f => f.end));
                        newRange.start = combinedStart;
                        newRange.end = combinedEnd;
                    }

                    currentFormats.push(newRange);
                }

                newBlocks[blockIndex] = { ...block, formats: currentFormats };
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
        },
        removeAudioBlock: (audioPath: string) => {
            // Robust match: Check full URI or Filename
            const filename = audioPath.split('/').pop();

            // Filter out matching audio blocks
            const newBlocks = blocks.filter(b => {
                if (b.type !== 'audio') return true;

                // Check strict match or filename inclusion (to handle path variations)
                const content = b.content;
                if (content === audioPath) return false;
                if (filename && content.includes(filename)) return false;

                return true;
            });

            if (newBlocks.length !== blocks.length) {
                setBlocks(newBlocks);
                isInternalUpdate.current = true;
                onChange(serializeBlocks(newBlocks));
            }
        }
    }));

    // Reconstruct markdown
    const serializeBlocks = (currentBlocks: Block[]) => {
        return currentBlocks.map(block => {
            const serializedContent = serializeBlockToMarkdown(block.content, block.formats);

            if (block.type === 'todo') {
                return `- [${block.checked ? 'x' : ' '}] ${serializedContent}`;
            }
            if (block.type === 'h1') return `# ${serializedContent}`;
            if (block.type === 'h2') return `## ${serializedContent}`;
            if (block.type === 'h3') return `### ${serializedContent}`;
            if (block.type === 'audio') return `![audio](${block.content})`;
            if (block.type === 'processing') return `![processing](${encodeURIComponent(block.content || '')})`;
            return serializedContent;
        }).join('\n');
    };

    // Initial parsing
    useEffect(() => {
        // 1. If we marked this as an internal update, definitely skip re-parsing
        if (isInternalUpdate.current) {
            isInternalUpdate.current = false;
            return;
        }

        // 2. Even if not marked, check if content is actually different to avoid race conditions
        // serializeBlocks is relatively cheap compared to a full re-parse and re-mount
        const currentSerialized = serializeBlocks(blocks);
        // On a fresh empty note we still need to create the first editable block.
        // Skip reparse only when blocks are already initialized and content truly matches.
        if (blocks.length > 0 && initialContent === currentSerialized) {
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
            const audioMatch = line.match(/^\s*!\[audio\]\((.*?)\)\s*$/);
            const processingMatch = isVoiceProcessingMarkerLine(line);

            const isStructure = todoMatch || header1Match || header2Match || header3Match || audioMatch || processingMatch;

            if (isStructure) {
                // Determine type
                let type: Block['type'] = 'text'; // Fallback
                let rawContent = line;
                let checked = false;

                if (todoMatch) {
                    type = 'todo';
                    checked = todoMatch[2].toLowerCase() === 'x';
                    rawContent = todoMatch[3];
                } else if (header3Match) {
                    type = 'h3';
                    rawContent = line.substring(4);
                } else if (header2Match) {
                    type = 'h2';
                    rawContent = line.substring(3);
                } else if (header1Match) {
                    type = 'h1';
                    rawContent = line.substring(2);
                } else if (audioMatch) {
                    type = 'audio';
                    rawContent = audioMatch[1];
                } else if (processingMatch) {
                    type = 'processing';
                    rawContent = getVoiceProcessingText(line);
                }

                // Parse inner markdown for formats
                const { content, formats } = parseMarkdownToData(rawContent);

                const id = generateId();
                parsedBlocks.push({ id, type, content, checked, formats });
                currentTextBlock = null; // Break text continuity

            } else {
                // It's text.
                // Do we merge with previous text block?
                if (currentTextBlock) {
                    // Merging is complex with formats. 
                    // Previous content len
                    const prevLen = currentTextBlock.content.length;
                    const { content, formats } = parseMarkdownToData(line);

                    currentTextBlock.content += '\n' + content;
                    // Shift new formats
                    const shiftedFormats = formats.map(f => ({
                        ...f,
                        start: f.start + prevLen + 1, // +1 for \n
                        end: f.end + prevLen + 1
                    }));
                    currentTextBlock.formats = [...currentTextBlock.formats, ...shiftedFormats];

                } else {
                    const id = generateId();
                    const { content, formats } = parseMarkdownToData(line);
                    currentTextBlock = { id, type: 'text', content, formats };
                    parsedBlocks.push(currentTextBlock);
                }
            }
        });

        // Ensure at least one block
        if (parsedBlocks.length === 0) {
            parsedBlocks.push({ id: generateId(), type: 'text', content: '', formats: [] });
        }

        setBlocks(parsedBlocks);
    }, [initialContent, reparseTrigger]);


    const handleBlockChange = (id: string, text: string) => {
        let newBlocks = [...blocks];
        const index = newBlocks.findIndex(b => b.id === id);
        if (index === -1) return;

        const block = newBlocks[index];
        const oldText = block.content;

        // Calculate Diff
        // We know text changed. 
        // Find start index of change.
        let commonStart = 0;
        while (commonStart < oldText.length && commonStart < text.length && oldText[commonStart] === text[commonStart]) {
            commonStart++;
        }

        // Find end index of change? Not strictly necessary for simple offset shifting if we assume single contiguous change.
        // But for "Select All + Replace" it might be complex.
        // Simple heuristic: 
        // Delta = newLen - oldLen. 
        // If we assume the change happened at `commonStart`.

        const delta = text.length - oldText.length;

        // Update Formats
        let newFormats = block.formats.map(f => {
            // 1. Format is fully before change. Unchanged.
            if (f.end <= commonStart) return f;

            // 2. Format is fully after change. Shift start and end.
            if (f.start >= commonStart) {
                // But wait, if we deleted (delta < 0), we might shift it back?
                // If we deleted text *before* this format, yes. 
                // If commonStart is before f.start, then we definitely shift.

                // Special Case: Deletion overlapping the start of the format?
                // If we have `**Bold**` (2-6). 
                // Delete char at 1. commonStart=1. f.start=2. 
                // Shift to 1-5. Correct.
                return { ...f, start: Math.max(commonStart, f.start + delta), end: Math.max(commonStart, f.end + delta) };
            }

            // 3. Change is INSIDE the format. 
            // Extend or Shrink.
            // `**Bo|ld**` -> Insert 'a' -> `**Boa|ld**`.
            // f.end += delta.
            return { ...f, end: Math.max(f.start, f.end + delta) };
        }).filter(f => f.end > f.start); // Remove collapsed formats

        // Check for Auto-Formatting Trigger (Space after specific chars)
        // Only trigger if we just typed a space?
        // Or check Start of Line.

        // Simple check: Just updated text.

        if (block.type === 'text') {
            // Headers
            const header1Match = text.match(/^#\s+(.*)$/);
            const header2Match = text.match(/^##\s+(.*)$/);
            const header3Match = text.match(/^###\s+(.*)$/);
            const todoMatch = text.match(/^(\s*-\s\[([ xX])\]\s)(.*)$/);

            if (header1Match) {
                newBlocks[index] = { ...block, type: 'h1', content: header1Match[1], formats: newFormats };
                // Note: We might want to clear formats if converting to header? Or keep them? Keeping is safer.
            } else if (header2Match) {
                newBlocks[index] = { ...block, type: 'h2', content: header2Match[1], formats: newFormats };
            } else if (header3Match) {
                newBlocks[index] = { ...block, type: 'h3', content: header3Match[1], formats: newFormats };
            } else if (todoMatch) {
                newBlocks[index] = {
                    ...block,
                    type: 'todo',
                    checked: todoMatch[2].toLowerCase() === 'x',
                    content: todoMatch[3],
                    formats: newFormats // TODO: Shift formats back because we removed prefix? Yes.
                };
                // Fix formats for Todo conversion (stripping "- [ ] ")
                // prefix length = text.length - todoMatch[3].length
                const prefixLen = text.length - todoMatch[3].length;
                newBlocks[index].formats = newFormats.map(f => ({
                    ...f,
                    start: Math.max(0, f.start - prefixLen),
                    end: Math.max(0, f.end - prefixLen)
                })).filter(f => f.end > f.start);

            } else {
                newBlocks[index] = { ...block, content: text, formats: newFormats };
            }
        } else {
            // Already structured
            newBlocks[index] = { ...block, content: text, formats: newFormats };
        }

        // Auto-List Continuation Logic
        if (block.type === 'text') {
            const insertedText = text.substring(commonStart, commonStart + delta);

            // Check if a newline was inserted
            if (delta > 0 && insertedText === '\n') {
                const newlineIndexInInsertion = insertedText.lastIndexOf('\n');
                const cursor = commonStart + newlineIndexInInsertion;

                // Check line before this specific newline
                const lastNewlineBefore = text.lastIndexOf('\n', cursor - 1);
                const lineStart = lastNewlineBefore === -1 ? 0 : lastNewlineBefore + 1;
                const lineText = text.substring(lineStart, cursor);

                const unorderedMatch = lineText.match(/^(\s*)([-\*])(\s+)$/);
                const orderedMatch = lineText.match(/^(\s*)(\d+)(\.\s+)$/);

                const unorderedStartMatch = lineText.match(/^(\s*)([-\*])(\s+)/);
                const orderedStartMatch = lineText.match(/^(\s*)(\d+)(\.\s+)/);

                let modification: { type: 'insert' | 'replace', text: string, index: number, length: number } | null = null;

                // Check for Empty List Item (Termination)
                if (unorderedMatch) {
                    modification = { type: 'replace', text: '', index: lineStart, length: cursor - lineStart };
                } else if (orderedMatch) {
                    modification = { type: 'replace', text: '', index: lineStart, length: cursor - lineStart };
                } else {
                    // Check for Continuation
                    if (unorderedStartMatch) {
                        const nextItem = `${unorderedStartMatch[1]}${unorderedStartMatch[2]}${unorderedStartMatch[3]}`;
                        modification = { type: 'insert', text: nextItem, index: cursor + 1, length: 0 };
                    } else if (orderedStartMatch) {
                        const num = parseInt(orderedStartMatch[2], 10);
                        const nextItem = `${orderedStartMatch[1]}${num + 1}${orderedStartMatch[3]}`;
                        modification = { type: 'insert', text: nextItem, index: cursor + 1, length: 0 };
                    }
                }

                if (modification) {
                    const currentContent = newBlocks[index].content;
                    let finalContent = currentContent;
                    let newCursor = cursor + 1;

                    if (modification.type === 'insert') {
                        finalContent = currentContent.substring(0, modification.index) + modification.text + currentContent.substring(modification.index);
                        newCursor += modification.text.length;

                        newBlocks[index].formats = newBlocks[index].formats.map(f => {
                            if (f.start >= modification!.index) return { ...f, start: f.start + modification!.text.length, end: f.end + modification!.text.length };
                            if (f.end > modification!.index) return { ...f, end: f.end + modification!.text.length };
                            return f;
                        });

                    } else if (modification.type === 'replace') {
                        finalContent = currentContent.substring(0, modification.index) + modification.text + currentContent.substring(modification.index + modification.length);
                        newCursor = (cursor + 1) - modification.length;

                        const delStart = modification!.index;
                        const delEnd = modification!.index + modification!.length;

                        newBlocks[index].formats = newBlocks[index].formats.reduce<BlockFormat[]>((acc, f) => {
                            let newStart = f.start;
                            let newEnd = f.end;

                            if (newStart >= delStart && newEnd <= delEnd) return acc;

                            if (newStart >= delEnd) newStart -= modification!.length;
                            else if (newStart > delStart) newStart = delStart;

                            if (newEnd >= delEnd) newEnd -= modification!.length;
                            else if (newEnd > delStart) newEnd = delStart;

                            if (newEnd > newStart) acc.push({ ...f, start: newStart, end: newEnd });
                            return acc;
                        }, []);
                    }

                    newBlocks[index].content = finalContent;

                    setTimeout(() => {
                        const ref = inputRefs.current[id];
                        ref?.setNativeProps({ selection: { start: newCursor, end: newCursor } });
                        if (blockSelections.current[id]) {
                            blockSelections.current[id] = { start: newCursor, end: newCursor };
                        }
                    }, 10);
                }
            }
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
                return;
            }

            e.preventDefault();
            const newBlockId = generateId();

            // Structure Block Logic (Todo/Header): Split/Create new
            let nextType: Block['type'] = 'text';
            let nextChecked = false;

            if (currentBlock.content.trim() === '' && currentBlock.type === 'todo') {
                // Empty todo + Enter -> Convert to text
                const updatedBlocks = [...blocks];
                updatedBlocks[index] = { ...currentBlock, type: 'text' };
                setBlocks(updatedBlocks);
                isInternalUpdate.current = true;
                onChange(serializeBlocks(updatedBlocks));
                return;
            } else if (currentBlock.type === 'todo') {
                nextType = 'todo';
            }


            const newBlock: Block = {
                id: newBlockId,
                type: nextType,
                content: '',
                checked: nextChecked,
                formats: []
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

            // Cursor at 0,0
            const isCursorAtStart = selection?.start === 0 && selection?.end === 0;
            const hasPrevBlock = index > 0;
            const isEffectivelyEmpty = currentBlock.content.length === 0;

            // REMOVED Smart Backspace Logic (Range-based doesn't need it)

            if (!hasPrevBlock && isCursorAtStart) {
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

                // Merge Formats
                const shiftedFormats = currentBlock.formats.map(f => ({
                    ...f,
                    start: f.start + prevLength,
                    end: f.end + prevLength
                }));
                const mergedFormats = [...prevBlock.formats, ...shiftedFormats];

                const newBlocks = [...blocks];
                newBlocks[prevIndex] = { ...prevBlock, content: mergedContent, formats: mergedFormats };
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
    // Headers scale based on baseFontSize but NOT the density scaleFactor (usually) 
    // OR we might want everything to scale? 
    // Let's scale text only for todos via scaleFactor as before, but Headers relative to baseFontSize.
    const fontSizeH1 = baseFontSize * 1.5; // e.g. 16 -> 24
    const fontSizeH2 = baseFontSize * 1.25; // e.g. 16 -> 20
    const fontSizeH3 = baseFontSize * 1.125; // e.g. 16 -> 18

    const focusForTypingAtEnd = () => {
        if (blocks.length === 0) {
            const newId = generateId();
            setBlocks([{ id: newId, type: 'text', content: '', formats: [] }]);
            setFocusedBlockId(newId);
            blockSelections.current[newId] = { start: 0, end: 0 };
            requestAnimationFrame(() => {
                inputRefs.current[newId]?.focus();
            });
            return;
        }

        const lastBlock = blocks[blocks.length - 1];
        if (lastBlock.type === 'audio' || lastBlock.type === 'processing') {
            const newId = generateId();
            const newBlocks = [...blocks, { id: newId, type: 'text' as const, content: '', formats: [] }];
            setBlocks(newBlocks);
            setFocusedBlockId(newId);
            blockSelections.current[newId] = { start: 0, end: 0 };
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    inputRefs.current[newId]?.focus();
                });
            });
            return;
        }

        const lastId = lastBlock.id;
        const lastLength = lastBlock.content.length;
        blockSelections.current[lastId] = { start: lastLength, end: lastLength };
        setFocusedBlockId(lastId);
        requestAnimationFrame(() => {
            inputRefs.current[lastId]?.focus();
            requestAnimationFrame(() => {
                inputRefs.current[lastId]?.setNativeProps({ selection: blockSelections.current[lastId] });
            });
        });
    };

    const renderItem = ({ item, drag, isActive }: RenderItemParams<Block>) => {
        const isTodo = item.type === 'todo';
        const isAudio = item.type === 'audio';
        const isProcessing = item.type === 'processing';

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
                        },
                        isAudio && {
                            paddingVertical: spacing.s,
                            backgroundColor: 'transparent',
                        },
                        isProcessing && {
                            paddingVertical: spacing.xs,
                            backgroundColor: 'transparent',
                        }
                    ]}
                >
                    {isAudio ? (
                        <View style={{ flex: 1 }}>
                            <TouchableOpacity onLongPress={drag} activeOpacity={0.9}>
                                <AudioPlayer
                                    audioUri={item.content}
                                    duration={0}
                                    hasTranscription={false}
                                    onDelete={() => {
                                        // Delete this block
                                        const newBlocks = [...blocks];
                                        newBlocks.splice(blocks.findIndex(b => b.id === item.id), 1);
                                        setBlocks(newBlocks);
                                        onChange(serializeBlocks(newBlocks));
                                        isInternalUpdate.current = true;
                                    }}
                                />
                            </TouchableOpacity>
                        </View>
                    ) : isProcessing ? (
                        <ProcessingBadge content={item.content} />
                    ) : (
                        <>
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
                                autoCorrect={false}
                                spellCheck={false}
                                onFocus={() => {
                                    if (onFocus) onFocus();
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

                                {item.content || (item.formats && item.formats.length > 0)
                                    ? renderFormattedText(item.content, item.formats || [], textStyles)
                                    : null}
                            </TextInput>
                        </>
                    )}
                </View>
            </ScaleDecorator >
        );
    };


    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
            <DraggableFlatList
                data={blocks}
                nestedScrollEnabled
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
                            onPress={focusForTypingAtEnd}
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
    processingBadge: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingVertical: spacing.s,
        paddingHorizontal: spacing.s,
        borderRadius: 10,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: colors.border,
        backgroundColor: colors.backgroundSecondary,
        marginVertical: spacing.xs,
    },
    processingText: {
        flex: 1,
        marginLeft: spacing.s,
        color: colors.textSecondary,
        fontStyle: 'italic',
        fontSize: 16,
        lineHeight: 22,
    },
    h1: { fontSize: 24, fontWeight: 'bold', marginBottom: 8, marginTop: 8 },
    h2: { fontSize: 20, fontWeight: 'bold', marginBottom: 6, marginTop: 6 },
    h3: { fontSize: 18, fontWeight: 'bold', marginBottom: 4, marginTop: 4 },
});
