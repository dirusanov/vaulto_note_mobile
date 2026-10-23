import React, { useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { createStyles } from '../theme/createStyles';
import { SvgXml } from 'react-native-svg';
import { colors, isDarkScheme } from '../theme/colors';
import { invertedInkColor } from './ink';

/** Height of a thumbnail in a note card: tall drawings show their top part. */
const MAX_HEIGHT = 140;
const MIN_HEIGHT = 56;

/** Width / height of the picture, from its viewBox. */
const aspectOf = (svg: string): number => {
    const match = /viewBox='([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)'/.exec(svg);
    const width = match ? Number(match[3]) : 0;
    const height = match ? Number(match[4]) : 0;
    return width > 0 && height > 0 ? width / height : 2;
};

/**
 * A drawing as a small picture in the notes list, so a handwritten note shows
 * what is on it. On the theme paper in dark mode its colours are inverted, as
 * the note and the canvas show it; a sheet with its own colour keeps it. The
 * pencil grain filter is left out (the SVG renderer here does not support it;
 * the ink shows plain).
 */
export const DrawingThumbnail = React.memo(({ svg }: { svg: string }) => {
    const invert = isDarkScheme() && !svg.includes("class='vp'");
    const xml = useMemo(() => {
        const plain = svg.replace(/<filter\b.*?<\/filter>/g, '').replace(/ filter='url\(#g\)'/g, '');
        return invert
            ? plain.replace(/(fill|stroke)='(#[0-9A-Fa-f]{6})'/g, (_m, attr, hex) => `${attr}='${invertedInkColor(hex)}'`)
            : plain;
    }, [svg, invert]);
    const aspect = useMemo(() => aspectOf(svg), [svg]);
    const [width, setWidth] = useState(0);
    const natural = width ? width / aspect : MIN_HEIGHT;
    const height = Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, natural)));
    const onLayout = (event: LayoutChangeEvent) => setWidth(Math.round(event.nativeEvent.layout.width));
    return (
        <View style={[styles.sheet, invert && styles.sheetDark, { height }]} onLayout={onLayout}>
            {width > 0 && (
                <SvgXml
                    xml={xml}
                    width={width}
                    height={height}
                    // Much taller than the card allows (pages): fill the width and show the top.
                    preserveAspectRatio={natural > MAX_HEIGHT * 2 ? 'xMidYMin slice' : 'xMidYMid meet'}
                />
            )}
        </View>
    );
});
DrawingThumbnail.displayName = 'DrawingThumbnail';

// Theme-aware: the dark sheet follows the colour scheme active at render time.
const styles = createStyles(() => ({
    sheet: {
        marginTop: 6,
        borderRadius: 10,
        overflow: 'hidden',
        backgroundColor: '#FFFFFF',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
    },
    sheetDark: { backgroundColor: colors.background },
}));
