import React, { useMemo } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Canvas, Circle, Path, Rect, Skia } from '@shopify/react-native-skia';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import { createStyles } from '../theme/createStyles';
import {
    PAPER_COLORS,
    PAPER_LAYOUTS,
    PAPER_MARGIN_COLOR,
    PAPER_MARGIN_X,
    PAPER_PATTERNS,
    PaperLayout,
    PaperPattern,
    PaperStyle,
    paperDotRadius,
    paperGeometry,
    paperLineColor,
} from './paper';

type Props = {
    paper: PaperStyle;
    onChange: (paper: PaperStyle) => void;
};

const TILE_W = 64;
const TILE_H = 84;
/** Previews show the pattern at half size, so a tile holds a few rows. */
const PREVIEW_SCALE = 0.5;

const PATTERN_LABELS: Record<PaperPattern, string> = {
    blank: 'Blank',
    dots: 'Dots',
    grid: 'Grid',
    smallGrid: 'Fine grid',
    lines: 'Lined',
    wideLines: 'Wide lines',
    margin: 'Notebook',
};

const LAYOUTS: Record<PaperLayout, { icon: keyof typeof MaterialCommunityIcons.glyphMap; label: string; hint: string }> = {
    pages: { icon: 'book-open-page-variant-outline', label: 'Pages', hint: 'Page by page, like a notebook' },
    canvas: { icon: 'arrow-expand-all', label: 'Canvas', hint: 'Endless in every direction' },
};

const PatternPreview: React.FC<{ pattern: PaperPattern; sheet: string; line: string }> = ({ pattern, sheet, line }) => {
    const geometry = useMemo(
        () => paperGeometry(pattern, TILE_W / PREVIEW_SCALE, TILE_H / PREVIEW_SCALE),
        [pattern]
    );
    const path = useMemo(() => {
        if (!geometry.lines.length) {
            return null;
        }
        const builder = Skia.PathBuilder.Make();
        for (let i = 0; i < geometry.lines.length; i += 4) {
            builder.moveTo(geometry.lines[i] * PREVIEW_SCALE, geometry.lines[i + 1] * PREVIEW_SCALE);
            builder.lineTo(geometry.lines[i + 2] * PREVIEW_SCALE, geometry.lines[i + 3] * PREVIEW_SCALE);
        }
        return builder.build();
    }, [geometry]);
    return (
        <Canvas style={{ width: TILE_W, height: TILE_H }}>
            <Rect x={0} y={0} width={TILE_W} height={TILE_H} color={sheet} />
            {path && <Path path={path} color={line} style="stroke" strokeWidth={1} />}
            {Array.from({ length: geometry.dots.length / 2 }, (_, i) => (
                <Circle key={i} cx={geometry.dots[i * 2] * PREVIEW_SCALE} cy={geometry.dots[i * 2 + 1] * PREVIEW_SCALE} r={paperDotRadius * 0.8} color={line} />
            ))}
            {pattern === 'margin' && (
                <Rect x={PAPER_MARGIN_X * PREVIEW_SCALE} y={0} width={1} height={TILE_H} color={PAPER_MARGIN_COLOR} />
            )}
        </Canvas>
    );
};

export const PaperPicker: React.FC<Props> = ({ paper, onChange }) => {
    const { t } = useTranslation();
    const sheet = paper.color || colors.background;
    const line = paperLineColor(paper.color, colors.border);

    return (
        <View style={styles.root}>
            <Text style={styles.heading}>{t('drawing.paper.layout', 'Layout')}</Text>
            <View style={styles.layouts}>
                {PAPER_LAYOUTS.map((layout) => {
                    const active = layout === paper.layout;
                    const spec = LAYOUTS[layout];
                    return (
                        <TouchableOpacity
                            key={layout}
                            onPress={() => onChange({ ...paper, layout })}
                            style={[styles.layout, active && styles.layoutActive]}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active }}
                        >
                            <MaterialCommunityIcons name={spec.icon} size={22} color={active ? colors.primary : colors.textSecondary} />
                            <View style={styles.layoutText}>
                                <Text style={[styles.layoutLabel, active && styles.patternLabelActive]}>{t(`drawing.paper.${layout}`, spec.label)}</Text>
                                <Text style={styles.layoutHint} numberOfLines={2}>{t(`drawing.paper.${layout}Hint`, spec.hint)}</Text>
                            </View>
                        </TouchableOpacity>
                    );
                })}
            </View>
            <Text style={styles.heading}>{t('drawing.paper.pattern', 'Pattern')}</Text>
            <View style={styles.patterns}>
                {PAPER_PATTERNS.map((pattern) => {
                    const active = pattern === paper.pattern;
                    return (
                        <TouchableOpacity
                            key={pattern}
                            onPress={() => onChange({ ...paper, pattern })}
                            style={styles.patternItem}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active }}
                            accessibilityLabel={t(`drawing.paper.${pattern}`, PATTERN_LABELS[pattern])}
                        >
                            <View style={[styles.tile, active && styles.tileActive]}>
                                <PatternPreview pattern={pattern} sheet={sheet} line={line} />
                            </View>
                            {/* Two lines: "Мелкая клетка" and the like did not fit one under a tile. */}
                            <Text style={[styles.patternLabel, active && styles.patternLabelActive]} numberOfLines={2}>
                                {t(`drawing.paper.${pattern}`, PATTERN_LABELS[pattern])}
                            </Text>
                        </TouchableOpacity>
                    );
                })}
            </View>
            <Text style={styles.heading}>{t('drawing.paper.color', 'Paper color')}</Text>
            <View style={styles.colors}>
                {PAPER_COLORS.map((value) => {
                    const active = value === paper.color;
                    return (
                        <TouchableOpacity
                            key={value ?? 'theme'}
                            onPress={() => onChange({ ...paper, color: value })}
                            style={[styles.colorRing, active && styles.colorRingActive]}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active }}
                            accessibilityLabel={value ?? t('drawing.paper.themeColor', 'Same as the app')}
                        >
                            <View style={[styles.colorDot, { backgroundColor: value ?? colors.background }]}>
                                {value === null && <Text style={styles.autoLabel}>A</Text>}
                            </View>
                        </TouchableOpacity>
                    );
                })}
            </View>
        </View>
    );
};

const styles = createStyles(() => ({
    root: { gap: 10 },
    heading: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
    layouts: { flexDirection: 'row', gap: 8 },
    layout: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        padding: 10,
        borderRadius: 12,
        borderWidth: 2,
        borderColor: colors.border,
    },
    layoutActive: { borderColor: colors.primary },
    layoutText: { flex: 1 },
    layoutLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
    layoutHint: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
    patterns: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    patternItem: { alignItems: 'center', width: TILE_W + 8 },
    tile: { borderRadius: 10, overflow: 'hidden', borderWidth: 2, borderColor: colors.border },
    tileActive: { borderColor: colors.primary },
    patternLabel: { fontSize: 11, lineHeight: 13, minHeight: 26, textAlign: 'center', color: colors.textSecondary, marginTop: 4 },
    patternLabelActive: { color: colors.primary, fontWeight: '600' },
    colors: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    colorRing: { width: 42, height: 42, borderRadius: 21, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
    colorRingActive: { borderColor: colors.primary },
    colorDot: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    autoLabel: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
}));
