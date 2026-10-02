import React from 'react';
import { DefaultTheme, DarkTheme, NavigationContainer, NavigationState } from '@react-navigation/native';
import { AppNavigator } from './AppNavigator';
import { colors } from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';

// The ThemeProvider remounts the tree when the color scheme changes; the last
// navigation state is kept here so the user stays on the screen they were on.
let lastNavigationState: NavigationState | undefined;

export const RootNavigator = () => {
    const { scheme } = useTheme();
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    const theme = {
        ...base,
        colors: {
            ...base.colors,
            primary: colors.primary,
            background: colors.background,
            card: colors.surface,
            text: colors.text,
            border: colors.border,
        },
    };

    return (
        <NavigationContainer
            theme={theme}
            initialState={lastNavigationState}
            onStateChange={(state) => { lastNavigationState = state; }}
        >
            <AppNavigator initialRouteName="NotesList" />
        </NavigationContainer>
    );
};
