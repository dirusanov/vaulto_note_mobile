import React, { useEffect, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { Canvas, Circle, LinearGradient, Rect, vec } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { Hsv, hexToHsv, hsvToHex } from './colorMath';

type Props = {
    color: string;
    onChange: (hex: string) => void;
};

const SV_HEIGHT = 168;
const HUE_HEIGHT = 28;
const RAINBOW = ['#FF0000', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF', '#FF00FF', '#FF0000'];

/** Saturation/brightness square plus a hue strip, drawn with Skia gradients. */
export const ColorPicker: React.FC<Props> = ({ color, onChange }) => {
    const [width, setWidth] = useState(0);
    const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(color));

    // Follow outside changes (a swatch tapped elsewhere), keeping the hue of
    // greys, which hex alone cannot carry.
    useEffect(() => {
        if (hsvToHex(hsv) !== color.toUpperCase()) {
            const next = hexToHsv(color);
            setHsv(next.s === 0 ? { ...next, h: hsv.h } : next);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [color]);

    const update = (next: Hsv) => {
        setHsv(next);
        onChange(hsvToHex(next));
    };
    const pickSv = (x: number, y: number) => {
        update({ h: hsv.h, s: Math.min(1, Math.max(0, x / width)), v: 1 - Math.min(1, Math.max(0, y / SV_HEIGHT)) });
    };
    const pickHue = (x: number) => {
        update({ ...hsv, h: Math.min(359.9, Math.max(0, (x / width) * 360)) });
    };

    const svGesture = Gesture.Pan().minDistance(0)
        .onBegin((e) => runOnJS(pickSv)(e.x, e.y))
        .onUpdate((e) => runOnJS(pickSv)(e.x, e.y));
    const hueGesture = Gesture.Pan().minDistance(0)
        .onBegin((e) => runOnJS(pickHue)(e.x))
        .onUpdate((e) => runOnJS(pickHue)(e.x));

    const hueColor = hsvToHex({ h: hsv.h, s: 1, v: 1 });
    const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

    return (
        <View onLayout={onLayout} style={styles.root}>
            {width > 0 && (
                <>
                    <GestureDetector gesture={svGesture}>
                        <View style={[styles.sv, { height: SV_HEIGHT }]}>
                            <Canvas style={StyleSheet.absoluteFill}>
                                <Rect x={0} y={0} width={width} height={SV_HEIGHT}>
                                    <LinearGradient start={vec(0, 0)} end={vec(width, 0)} colors={['#FFFFFF', hueColor]} />
                                </Rect>
                                <Rect x={0} y={0} width={width} height={SV_HEIGHT}>
                                    <LinearGradient start={vec(0, 0)} end={vec(0, SV_HEIGHT)} colors={['rgba(0,0,0,0)', '#000000']} />
                                </Rect>
                                <Circle cx={hsv.s * width} cy={(1 - hsv.v) * SV_HEIGHT} r={11} color="#FFFFFF" style="stroke" strokeWidth={3} />
                                <Circle cx={hsv.s * width} cy={(1 - hsv.v) * SV_HEIGHT} r={8} color={hsvToHex(hsv)} />
                            </Canvas>
                        </View>
                    </GestureDetector>
                    <GestureDetector gesture={hueGesture}>
                        <View style={[styles.hue, { height: HUE_HEIGHT }]}>
                            <Canvas style={StyleSheet.absoluteFill}>
                                <Rect x={0} y={0} width={width} height={HUE_HEIGHT}>
                                    <LinearGradient start={vec(0, 0)} end={vec(width, 0)} colors={RAINBOW} />
                                </Rect>
                                <Circle cx={(hsv.h / 360) * width} cy={HUE_HEIGHT / 2} r={11} color="#FFFFFF" style="stroke" strokeWidth={3} />
                                <Circle cx={(hsv.h / 360) * width} cy={HUE_HEIGHT / 2} r={8} color={hueColor} />
                            </Canvas>
                        </View>
                    </GestureDetector>
                </>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    root: { gap: 12 },
    sv: { borderRadius: 12, overflow: 'hidden' },
    hue: { borderRadius: 14, overflow: 'hidden' },
});
