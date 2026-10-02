import React, { useEffect } from 'react';
import { Linking } from 'react-native';
import { DefaultTheme, DarkTheme, NavigationContainer, NavigationState } from '@react-navigation/native';
import { AppNavigator } from './AppNavigator';
import { colors } from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';
import { flushPendingDeepLink, handleDeepLink, navigationRef } from './deepLinks';
import { useShareIntake } from '../services/shareIntake';
import { useNotesContext } from '../contexts/NotesContext';
import { useNotificationRouting } from '../services/notifications';

// The ThemeProvider remounts the tree when the color scheme changes; the last
// navigation state is kept here so the user stays on the screen they were on.
let lastNavigationState: NavigationState | undefined;
// The launch link is handled once, not again when a theme change remounts this.
let initialUrlHandled = false;

export const RootNavigator = () => {
    const { scheme } = useTheme();
    const { createNote } = useNotesContext();
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

    // Widget, Quick Settings tile and notification taps arrive as deep links.
    useEffect(() => {
        if (!initialUrlHandled) {
            initialUrlHandled = true;
            void Linking.getInitialURL().then(handleDeepLink).catch(() => undefined);
        }
        const subscription = Linking.addEventListener('url', ({ url }) => handleDeepLink(url));
        return () => subscription.remove();
    }, []);

    useShareIntake(createNote);
    useNotificationRouting();

    return (
        <NavigationContainer
            ref={navigationRef}
            theme={theme}
            initialState={lastNavigationState}
            onReady={flushPendingDeepLink}
            onStateChange={(state) => { lastNavigationState = state; }}
        >
            <AppNavigator initialRouteName="NotesList" />
        </NavigationContainer>
    );
};
