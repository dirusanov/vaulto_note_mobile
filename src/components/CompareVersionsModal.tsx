import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, isDarkScheme } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { diffWords, hasDifferences } from '../utils/textDiff';
import {
    changeIndexOfSegment,
    groupDiffChanges,
    splitDiffIntoParagraphs,
    stepChange,
} from '../utils/versionLineage';
import { createStyles } from '../theme/createStyles';

export interface CompareBase {
    id: string;
    /** "Original", "Summarize", … */
    label: string;
    /** Plain text (checklist marks kept) of the base. */
    text: string;
}

interface CompareVersionsModalProps {
    visible: boolean;
    versionLabel: string;
    versionText: string;
    /**
     * What the version can be read against, most useful first: the version it
     * was made from, then the original. One base hides the switch.
     */
    bases: CompareBase[];
    onClose: () => void;
}

/** Room above a change when it is scrolled to, so it is not glued to the edge. */
const SCROLL_MARGIN = 32;

/**
 * What a version changed relative to a base: removals struck red, additions
 * green. The base can be the version it was made from or the original; long
 * texts step through changes with Previous / Next.
 */
export const CompareVersionsModal = ({ visible, versionLabel, versionText, bases, onClose }: CompareVersionsModalProps) => {
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    const [baseId, setBaseId] = useState<string>(bases[0]?.id ?? 'original');
    const [currentChange, setCurrentChange] = useState(-1);
    const scrollRef = useRef<ScrollView>(null);
    const paragraphY = useRef<Record<number, number>>({});
    const bodyTop = useRef(0);

    const baseKey = bases.map((base) => base.id).join('|');
    // Each opening starts from the most useful base and the top of the text.
    useEffect(() => {
        if (visible) {
            setBaseId(bases[0]?.id ?? 'original');
            setCurrentChange(-1);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible, baseKey]);

    const base = bases.find((item) => item.id === baseId) || bases[0];
    const baseText = base?.text ?? '';
    const segments = useMemo(
        () => (visible ? diffWords(baseText, versionText) : []),
        [visible, baseText, versionText]
    );
    const changed = hasDifferences(segments);
    const changes = useMemo(() => groupDiffChanges(segments), [segments]);
    const paragraphs = useMemo(() => splitDiffIntoParagraphs(segments), [segments]);
    /** change index -> paragraph that holds its first piece, for scrolling. */
    const changeParagraph = useMemo(() => {
        const result: number[] = [];
        paragraphs.forEach((pieces, paragraphIndex) => {
            pieces.forEach((piece) => {
                const index = changeIndexOfSegment(changes, piece.segmentIndex);
                if (index >= 0 && result[index] === undefined) result[index] = paragraphIndex;
            });
        });
        return result;
    }, [changes, paragraphs]);

    const selectBase = (id: string) => {
        if (id === baseId) return;
        paragraphY.current = {};
        setCurrentChange(-1);
        setBaseId(id);
        scrollRef.current?.scrollTo({ y: 0, animated: false });
    };

    const goTo = (direction: 1 | -1) => {
        const next = stepChange(currentChange, direction, changes.length);
        if (next < 0) return;
        setCurrentChange(next);
        const y = paragraphY.current[changeParagraph[next]];
        if (typeof y === 'number') {
            scrollRef.current?.scrollTo({ y: Math.max(0, bodyTop.current + y - SCROLL_MARGIN), animated: true });
        }
    };

    const current = currentChange >= 0 ? changes[currentChange] : null;
    const isCurrent = (segmentIndex: number) => !!current && segmentIndex >= current.start && segmentIndex <= current.end;
    const removedWord = t('edit.versions.legendRemoved', 'removed');
    const addedWord = t('edit.versions.legendAdded', 'added');

    return (
        // Drawn under the system bars (insets below), so the screen behind does
        // not show through the navigation bar on Android.
        <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
            <View style={[styles.container, { paddingTop: insets.top + spacing.s }]}>
                <View style={styles.header}>
                    <TouchableOpacity
                        onPress={onClose}
                        style={styles.closeButton}
                        accessibilityRole="button"
                        accessibilityLabel={t('a11y.close', 'Close')}
                    >
                        <MaterialIcons name="close" size={24} color={colors.text} />
                    </TouchableOpacity>
                    <View style={styles.headerText}>
                        <Text style={styles.title} accessibilityRole="header">{t('edit.versions.compareChangesTitle', 'What changed')}</Text>
                        <Text style={styles.subtitle} numberOfLines={2}>{`${base?.label ?? ''} → ${versionLabel}`}</Text>
                    </View>
                </View>

                {bases.length > 1 && (
                    <View style={styles.baseRow}>
                        <Text style={styles.baseLabel}>{t('edit.versions.compareWith', 'Compare with')}</Text>
                        <View style={styles.segments} accessibilityRole="radiogroup">
                            {bases.map((item) => {
                                const selected = item.id === base?.id;
                                return (
                                    <TouchableOpacity
                                        key={item.id}
                                        style={[styles.segment, selected && styles.segmentActive]}
                                        onPress={() => selectBase(item.id)}
                                        accessibilityRole="radio"
                                        accessibilityState={{ selected }}
                                        accessibilityLabel={item.label}
                                    >
                                        <Text style={[styles.segmentText, selected && styles.segmentTextActive]} numberOfLines={1}>
                                            {item.label}
                                        </Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>
                    </View>
                )}

                <View style={styles.legend}>
                    <Text style={[styles.legendItem, styles.removed]}>{removedWord}</Text>
                    <Text style={[styles.legendItem, styles.added]}>{addedWord}</Text>
                    {changes.length === 1 && (
                        // More than one: the count lives in the Previous / Next bar.
                        <Text style={styles.changeCount}>
                            {t('edit.versions.changeCount', { count: changes.length, defaultValue: '{{count}} changes' })}
                        </Text>
                    )}
                </View>

                <ScrollView ref={scrollRef} contentContainerStyle={styles.bodyOuter}>
                    <View style={styles.body} onLayout={(event) => { bodyTop.current = event.nativeEvent.layout.y; }}>
                        {changed ? (
                            paragraphs.map((pieces, paragraphIndex) => {
                                const holdsCurrent = pieces.some((piece) => isCurrent(piece.segmentIndex));
                                // Screen readers do not announce strike-through or colour.
                                const spoken = pieces.map((piece) => (
                                    piece.type === 'removed' ? ` ${removedWord}: ${piece.text}. `
                                        : piece.type === 'added' ? ` ${addedWord}: ${piece.text}. `
                                            : piece.text
                                )).join('');
                                return (
                                    <View
                                        key={paragraphIndex}
                                        style={[styles.paragraph, holdsCurrent && styles.paragraphCurrent]}
                                        onLayout={(event) => { paragraphY.current[paragraphIndex] = event.nativeEvent.layout.y; }}
                                    >
                                        <Text style={styles.text} selectable accessibilityLabel={spoken || ' '}>
                                            {pieces.length === 0 ? ' ' : pieces.map((piece, pieceIndex) => {
                                                const style = piece.type === 'removed'
                                                    ? styles.removed
                                                    : piece.type === 'added' ? styles.added : undefined;
                                                const next = pieces[pieceIndex + 1];
                                                return (
                                                    <React.Fragment key={pieceIndex}>
                                                        <Text style={[style, piece.type !== 'same' && isCurrent(piece.segmentIndex) && styles.currentChange]}>
                                                            {piece.text}
                                                        </Text>
                                                        {/* A removed word directly followed by its replacement would read as one word. */}
                                                        {piece.type === 'removed' && next?.type === 'added' && !/\s$/.test(piece.text) ? ' ' : null}
                                                    </React.Fragment>
                                                );
                                            })}
                                        </Text>
                                    </View>
                                );
                            })
                        ) : (
                            <Text style={styles.empty}>
                                {t('edit.versions.noDifferencesFrom', 'No differences from {{name}}.', { name: base?.label ?? '' })}
                            </Text>
                        )}
                    </View>
                </ScrollView>

                {changes.length > 1 && (
                    // Long recordings: step through the edits instead of hunting for colour.
                    <View style={[styles.navBar, { paddingBottom: Math.max(insets.bottom, spacing.s) }]}>
                        <View style={styles.navInner}>
                        <TouchableOpacity
                            style={[styles.navButton, currentChange === 0 && styles.navButtonDisabled]}
                            onPress={() => goTo(-1)}
                            disabled={currentChange === 0}
                            accessibilityRole="button"
                            accessibilityLabel={t('edit.versions.previousChange', 'Previous change')}
                            accessibilityState={{ disabled: currentChange === 0 }}
                        >
                            <MaterialIcons name="keyboard-arrow-up" size={24} color={colors.primary} />
                            <Text style={styles.navButtonText} numberOfLines={1}>{t('edit.versions.previousShort', 'Previous')}</Text>
                        </TouchableOpacity>
                        <Text style={styles.navCounter} accessibilityLiveRegion="polite" numberOfLines={1}>
                            {currentChange >= 0
                                ? t('edit.versions.changeOf', '{{current}} of {{total}}', { current: currentChange + 1, total: changes.length })
                                : t('edit.versions.changeCount', { count: changes.length, defaultValue: '{{count}} changes' })}
                        </Text>
                        <TouchableOpacity
                            style={[styles.navButton, currentChange === changes.length - 1 && styles.navButtonDisabled]}
                            onPress={() => goTo(1)}
                            disabled={currentChange === changes.length - 1}
                            accessibilityRole="button"
                            accessibilityLabel={t('edit.versions.nextChange', 'Next change')}
                            accessibilityState={{ disabled: currentChange === changes.length - 1 }}
                        >
                            <Text style={styles.navButtonText} numberOfLines={1}>{t('edit.versions.nextShort', 'Next')}</Text>
                            <MaterialIcons name="keyboard-arrow-down" size={24} color={colors.primary} />
                        </TouchableOpacity>
                        </View>
                    </View>
                )}
                {changes.length <= 1 && <View style={{ height: insets.bottom }} />}
            </View>
        </Modal>
    );
};

const READABLE_WIDTH = 760;

const styles = createStyles(() => ({
    container: {
        flex: 1,
        backgroundColor: colors.background,
    },
    // Header, legend and text share the editor's readable column on tablets.
    header: {
        width: '100%',
        maxWidth: READABLE_WIDTH,
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.m,
        paddingBottom: spacing.s,
        gap: spacing.m,
    },
    closeButton: {
        width: 48,
        height: 48,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: -12,
    },
    headerText: {
        flex: 1,
    },
    title: {
        fontSize: 18,
        fontWeight: '700',
        color: colors.text,
    },
    subtitle: {
        fontSize: 13,
        color: colors.textSecondary,
        marginTop: 2,
    },
    baseRow: {
        width: '100%',
        maxWidth: READABLE_WIDTH,
        alignSelf: 'center',
        paddingHorizontal: spacing.m,
        paddingBottom: spacing.s,
        gap: spacing.xs,
    },
    baseLabel: {
        fontSize: 13,
        fontWeight: '600',
        color: colors.textSecondary,
    },
    // The same segmented track as the versions bar.
    segments: {
        flexDirection: 'row',
        backgroundColor: colors.backgroundSecondary,
        borderRadius: 10,
        padding: 2,
    },
    segment: {
        flex: 1,
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.s,
        borderRadius: 8,
    },
    segmentActive: {
        backgroundColor: isDarkScheme() ? colors.borderHover : colors.surface,
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowRadius: 2,
        shadowOffset: { width: 0, height: 1 },
        elevation: 1,
    },
    segmentText: {
        fontSize: 14,
        fontWeight: '500',
        color: colors.textSecondary,
    },
    segmentTextActive: {
        color: colors.text,
        fontWeight: '600',
    },
    legend: {
        width: '100%',
        maxWidth: READABLE_WIDTH,
        alignSelf: 'center',
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: spacing.s,
        paddingHorizontal: spacing.m,
        paddingBottom: spacing.s,
    },
    legendItem: {
        fontSize: 12,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
        overflow: 'hidden',
    },
    // Large text: wraps under the legend instead of being cut.
    changeCount: {
        flexGrow: 1,
        textAlign: 'right',
        fontSize: 13,
        color: colors.textSecondary,
        fontVariant: ['tabular-nums'],
    },
    bodyOuter: {
        paddingBottom: spacing.xl,
    },
    body: {
        width: '100%',
        maxWidth: READABLE_WIDTH,
        alignSelf: 'center',
        paddingHorizontal: spacing.m,
        paddingTop: spacing.s,
    },
    // The border is reserved at rest so the text does not shift when a change is focused.
    paragraph: {
        borderLeftWidth: 3,
        borderLeftColor: 'transparent',
        paddingLeft: spacing.s,
        marginLeft: -(spacing.s + 3),
    },
    paragraphCurrent: {
        borderLeftColor: colors.primary,
    },
    text: {
        fontSize: 16,
        lineHeight: 24,
        color: colors.text,
    },
    removed: {
        color: colors.error,
        backgroundColor: colors.errorLight,
        textDecorationLine: 'line-through',
    },
    added: {
        color: isDarkScheme() ? '#4ADE80' : '#0B7A55',
        backgroundColor: colors.successLight,
    },
    currentChange: {
        fontWeight: '700',
    },
    empty: {
        fontSize: 15,
        color: colors.textSecondary,
    },
    navBar: {
        paddingTop: spacing.xs,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        backgroundColor: colors.background,
    },
    // Buttons stay near the text column on tablets instead of the screen edges.
    navInner: {
        width: '100%',
        maxWidth: READABLE_WIDTH,
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.s,
        paddingHorizontal: spacing.xs,
    },
    navButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        minHeight: 48,
        minWidth: 48,
        paddingHorizontal: spacing.s,
    },
    navButtonDisabled: {
        opacity: 0.35,
    },
    navButtonText: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.primary,
    },
    navCounter: {
        flexShrink: 1,
        fontSize: 14,
        color: colors.textSecondary,
        fontVariant: ['tabular-nums'],
        textAlign: 'center',
    },
}));
