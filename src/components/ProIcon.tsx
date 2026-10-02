import React from 'react';
import { Image, View } from 'react-native';
import { colors } from '../theme/colors';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { createStyles } from '../theme/createStyles';

interface ProIconProps {
    size?: number;
    containerSize?: number;
    backgroundColor?: string;
    borderColor?: string;
    // When undefined, tint is chosen automatically based on backgroundColor.
    // When null, tint is disabled and the full-color icon is used.
    tintColor?: string | null;
}

const parseHexColor = (value: string): { r: number; g: number; b: number } | null => {
    const raw = value.trim();
    if (!raw.startsWith('#')) return null;
    const hex = raw.slice(1);
    if (hex.length === 3) {
        const r = parseInt(hex[0] + hex[0], 16);
        const g = parseInt(hex[1] + hex[1], 16);
        const b = parseInt(hex[2] + hex[2], 16);
        return Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b) ? { r, g, b } : null;
    }
    if (hex.length === 6) {
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b) ? { r, g, b } : null;
    }
    return null;
};

const isLightColor = (value: string): boolean => {
    const parsed = parseHexColor(value);
    if (!parsed) return false;
    // Relative luminance approximation.
    const { r, g, b } = parsed;
    const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return luma >= 0.72;
};

export const ProIcon: React.FC<ProIconProps> = ({
    size = 20,
    containerSize = 40,
    backgroundColor = colors.primary, // Default to Blue
    borderColor = 'transparent',
    tintColor,
}) => {
    const resolvedTintColor =
        tintColor === null
            ? undefined
            : (typeof tintColor === 'string'
                ? tintColor
                : (isLightColor(backgroundColor) ? undefined : '#FFFFFF'));
    const resolvedBorderWidth = borderColor && borderColor !== 'transparent' ? 1 : 0;
    const resolvedShadowColor = borderColor && borderColor !== 'transparent' ? borderColor : colors.primary;

    return (
        <View style={[styles.wrapper, { width: containerSize, height: containerSize }]}>
            <View
                style={[
                    styles.container,
                    {
                        width: containerSize,
                        height: containerSize,
                        borderRadius: containerSize / 2,
                        backgroundColor,
                        borderColor,
                        borderWidth: resolvedBorderWidth,
                        shadowColor: resolvedShadowColor,
                        shadowOffset: { width: 0, height: 4 },
                        shadowOpacity: 0.3,
                        shadowRadius: 8,
                        elevation: 4,
                    },
                ]}
            >
                <View style={{ position: 'absolute', top: -20, zIndex: 10 }}>
                    <MaterialCommunityIcons
                        name="crown"
                        size={containerSize * 0.9}
                        color="#FCD34D"
                        style={{
                            transform: [{ rotate: '-15deg' }],
                            shadowColor: '#FCD34D',
                            shadowOffset: { width: 0, height: 3 },
                            shadowOpacity: 0.7,
                            shadowRadius: 4,
                        }}
                    />
                </View>
                <Image
                    source={require('../../assets/icon.png')}
                    style={{
                        width: size,
                        height: size,
                        tintColor: resolvedTintColor,
                        opacity: 1,
                    }}
                    resizeMode="contain"
                />
            </View>
        </View>
    );
};

const styles = createStyles(() => ({
    wrapper: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    container: {
        borderWidth: 0,
        alignItems: 'center',
        justifyContent: 'center',
    },
}));
