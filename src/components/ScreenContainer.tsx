import React, { ReactNode } from 'react';
import { View, ViewStyle, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, isDarkScheme } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { createStyles } from '../theme/createStyles';

interface ScreenContainerProps {
    children: ReactNode;
    style?: ViewStyle;
}

export const ScreenContainer = ({ children, style }: ScreenContainerProps) => {
    return (
        <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
            <StatusBar barStyle={isDarkScheme() ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />
            <View style={[styles.container, style]}>{children}</View>
        </SafeAreaView>
    );
};

const styles = createStyles(() => ({
    safeArea: {
        flex: 1,
        backgroundColor: colors.background,
    },
    container: {
        flex: 1,
        paddingHorizontal: spacing.m,
        backgroundColor: colors.background,
    },
}));
