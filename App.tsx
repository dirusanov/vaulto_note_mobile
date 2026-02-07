import 'react-native-gesture-handler';
import 'react-native-reanimated';
import React, { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from './src/context/AuthContext';
import { EncryptionProvider } from './src/context/EncryptionContext';
import { NotesProvider } from './src/contexts/NotesContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { EncryptionGate } from './src/components/EncryptionGate';
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

    useEffect(() => {
        if (!appIsReady) {
            return;
        }

        const hideSplash = async () => {
            try {
                await SplashScreen.hideAsync();
            } catch (error) {
                console.warn('[App] Failed to hide splash screen', error);
            }
        };

        void hideSplash();
    }, [appIsReady]);

    if (!appIsReady) {
        return null;
    }

    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
            <SafeAreaProvider>
                <AuthProvider>
                    <EncryptionProvider>
                        <EncryptionGate>
                            <NotesProvider>
                                <StatusBar style="auto" />
                                <RootNavigator />
                            </NotesProvider>
                        </EncryptionGate>
                    </EncryptionProvider>
                </AuthProvider>
            </SafeAreaProvider>
        </GestureHandlerRootView>
    );
}
