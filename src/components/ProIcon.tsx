import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { colors } from '../theme/colors';

interface ProIconProps {
    size?: number;
    containerSize?: number;
    backgroundColor?: string;
    borderColor?: string;
    variant?: 'default' | 'medal'; // Kept for interface compatibility but treated as minimal
}

export const ProIcon: React.FC<ProIconProps> = ({
    size = 20,
    containerSize = 40,
    backgroundColor = colors.primary, // Default to Blue
    borderColor = 'transparent',
    variant,
}) => {
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
                        shadowColor: colors.primary,
                        shadowOffset: { width: 0, height: 4 },
                        shadowOpacity: 0.3,
                        shadowRadius: 8,
                        elevation: 4,
                    },
                ]}
            >
                <Image
                    source={require('../../assets/icon.png')}
                    style={{
                        width: size,
                        height: size,
                        tintColor: '#FFFFFF', // White logo on Blue
                        opacity: 1,
                    }}
                    resizeMode="contain"
                />
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    wrapper: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    container: {
        borderWidth: 0,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
