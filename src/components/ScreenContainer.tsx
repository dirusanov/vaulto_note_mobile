import React, { ReactNode } from 'react';
import { View, ViewStyle, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, isDarkScheme } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { createStyles } from '../theme/createStyles';

interface ScreenContainerProps {
    children: ReactNode;
    style?: ViewStyle;
}

/**
 * Insets come from the root provider (known from the first frame) rather than
 * the native SafeAreaView, which measures itself once laid out: while a screen
 * was opening it rendered with no top inset and the header slid in under the
 * status bar, then jumped down.
 */
export const ScreenContainer = ({ children, style }: ScreenContainerProps) => {
    const insets = useSafeAreaInsets();
    return (
        <View style={[styles.safeArea, { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }]}>
            <StatusBar barStyle={isDarkScheme() ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />
            <View style={[styles.container, style]}>{children}</View>
        </View>
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
