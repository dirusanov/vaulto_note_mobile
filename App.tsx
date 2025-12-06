import 'react-native-gesture-handler';
import 'react-native-reanimated';
import React, { useCallback, useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from './src/context/AuthContext';
import { NotesProvider } from './src/contexts/NotesContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import * as SplashScreen from 'expo-splash-screen';

export default function App() {
    const [appIsReady, setAppIsReady] = useState(false);

    useEffect(() => {
        const prepare = async () => {
            try {
                await SplashScreen.preventAutoHideAsync();
            } catch (error) {
                console.warn('[App] Failed to prevent auto hide of splash screen', error);
            } finally {
                setAppIsReady(true);
            }
        };

        void prepare();
    }, []);

    const onLayoutRootView = useCallback(async () => {
        if (appIsReady) {
            try {
                await SplashScreen.hideAsync();
            } catch (error) {
                console.warn('[App] Failed to hide splash screen', error);
            }
        }
    }, [appIsReady]);

    if (!appIsReady) {
        return null;
    }

    return (
        <GestureHandlerRootView style={{ flex: 1 }} onLayout={onLayoutRootView}>
            <SafeAreaProvider>
                <AuthProvider>
                    <NotesProvider>
                        <StatusBar style="auto" />
                        <RootNavigator />
                    </NotesProvider>
                </AuthProvider>
            </SafeAreaProvider>
        </GestureHandlerRootView>
    );
}
