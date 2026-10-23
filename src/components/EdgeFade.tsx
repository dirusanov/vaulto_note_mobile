import React from 'react';
import { I18nManager, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

interface EdgeFadeProps {
    /** Which edge of a horizontal scroller the fade sits on (flipped in RTL). */
    side: 'start' | 'end';
    /** The colour behind the scroller, so content dissolves into it. */
    color: string;
    width?: number;
}

/**
 * A fade over the edge of a horizontal scroller while more content is hidden
 * there, so the row reads as scrollable instead of cut off.
 */
export const EdgeFade = ({ side, color, width = 32 }: EdgeFadeProps) => {
    // Opaque at the outer edge, clear towards the content.
    const leftEdge = (side === 'start') !== I18nManager.isRTL;
    const id = `edgeFade-${side}`;
    return (
        <View
            pointerEvents="none"
            style={{ position: 'absolute', top: 0, bottom: 0, width, [side]: 0 }}
        >
            <Svg width="100%" height="100%">
                <Defs>
                    <LinearGradient id={id} x1={leftEdge ? '1' : '0'} y1="0" x2={leftEdge ? '0' : '1'} y2="0">
                        <Stop offset="0" stopColor={color} stopOpacity="0" />
                        <Stop offset="1" stopColor={color} stopOpacity="1" />
                    </LinearGradient>
                </Defs>
                <Rect width="100%" height="100%" fill={`url(#${id})`} />
            </Svg>
        </View>
    );
};
