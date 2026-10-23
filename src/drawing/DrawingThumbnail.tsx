import React, { useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { colors } from '../theme/colors';

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
 * what is on it. It is drawn on its own sheet in both themes: the ink colours
 * are made for light paper. The pencil grain filter is left out (the SVG
 * renderer here does not support it; the ink shows plain).
 */
export const DrawingThumbnail = React.memo(({ svg }: { svg: string }) => {
    const xml = useMemo(() => svg.replace(/<filter\b.*?<\/filter>/g, '').replace(/ filter='url\(#g\)'/g, ''), [svg]);
    const aspect = useMemo(() => aspectOf(svg), [svg]);
    const [width, setWidth] = useState(0);
    const natural = width ? width / aspect : MIN_HEIGHT;
    const height = Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, natural)));
    const onLayout = (event: LayoutChangeEvent) => setWidth(Math.round(event.nativeEvent.layout.width));
    return (
        <View style={[styles.sheet, { height }]} onLayout={onLayout}>
            {width > 0 && (
                <SvgXml
                    xml={xml}
                    width={width}
                    height={height}
                    // Taller than the card allows: fill the width and show the top.
                    preserveAspectRatio={natural > MAX_HEIGHT ? 'xMidYMin slice' : 'xMidYMid meet'}
                />
            )}
        </View>
    );
});
DrawingThumbnail.displayName = 'DrawingThumbnail';

const styles = StyleSheet.create({
    sheet: {
        marginTop: 6,
        borderRadius: 10,
        overflow: 'hidden',
        backgroundColor: '#FFFFFF',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
    },
});
