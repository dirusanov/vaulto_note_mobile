import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { ColorScheme, colors, getColorScheme, setColorScheme } from './colors';

export type ThemePreference = 'system' | 'light' | 'dark';

const THEME_PREFERENCE_KEY = 'vaulto_theme_preference';

type ThemeContextValue = {
    scheme: ColorScheme;
    preference: ThemePreference;
    setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
    scheme: 'light',
    preference: 'system',
    setPreference: () => undefined,
});

export const useTheme = () => useContext(ThemeContext);

const isPreference = (value: unknown): value is ThemePreference =>
    value === 'system' || value === 'light' || value === 'dark';

/**
 * Resolves the theme from the user's choice and the system setting, switches
 * the palette before its children render, and remounts them when the scheme
 * changes so every memoized component and cached style picks the new colors
 * up. Navigation keeps its stack across the remount (see RootNavigator).
 */
export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
    const systemScheme = useColorScheme();
    const [preference, setPreferenceState] = useState<ThemePreference | null>(null);

    useEffect(() => {
        AsyncStorage.getItem(THEME_PREFERENCE_KEY)
            .then((value) => setPreferenceState(isPreference(value) ? value : 'system'))
            .catch(() => setPreferenceState('system'));
    }, []);

    const setPreference = useCallback((next: ThemePreference) => {
        setPreferenceState(next);
        AsyncStorage.setItem(THEME_PREFERENCE_KEY, next).catch(() => undefined);
    }, []);

    const effectivePreference = preference ?? 'system';
    const scheme: ColorScheme = effectivePreference === 'system'
        ? (systemScheme === 'dark' ? 'dark' : 'light')
        : effectivePreference;

    // Must happen during render, before children read `colors`.
    if (getColorScheme() !== scheme) {
        setColorScheme(scheme);
    }

    const value = useMemo(
        () => ({ scheme, preference: effectivePreference, setPreference }),
        [scheme, effectivePreference, setPreference],
    );

    // Hold rendering until the stored choice is known (the splash screen is
    // still up), so a dark-theme user never sees a light first frame.
    if (preference === null) {
        return null;
    }

    return (
        <ThemeContext.Provider value={value}>
            <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
            <View key={scheme} style={{ flex: 1, backgroundColor: colors.background }}>
                {children}
            </View>
        </ThemeContext.Provider>
    );
};
