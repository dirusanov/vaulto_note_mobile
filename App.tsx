import 'react-native-gesture-handler';
import 'react-native-reanimated';
import React, { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from './src/context/AuthContext';
import { SubscriptionProvider } from './src/context/SubscriptionContext';
import { EncryptionProvider } from './src/context/EncryptionContext';
import { NotesProvider } from './src/contexts/NotesContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { EncryptionGate } from './src/components/EncryptionGate';
import * as SplashScreen from 'expo-splash-screen';
import { useAuth } from './src/hooks/useAuth';
import { useEncryption } from './src/context/EncryptionContext';

const AppBootstrap = ({ children }: { children: React.ReactNode }) => {
    const { isLoading } = useAuth();
    const { status } = useEncryption();
    const [splashHidden, setSplashHidden] = useState(false);
    const appReady = !isLoading && status !== 'loading';

    useEffect(() => {
        if (!appReady || splashHidden) {
            return;
        }

        const hideSplash = async () => {
            try {
                await SplashScreen.hideAsync();
            } catch (error) {
                console.warn('[App] Failed to hide splash screen', error);
            } finally {
                setSplashHidden(true);
            }
        };

        void hideSplash();
    }, [appReady, splashHidden]);

    if (!splashHidden) {
        return null;
    }

    return <>{children}</>;
};

export default function App() {
    useEffect(() => {
        const prepare = async () => {
            try {
                await SplashScreen.preventAutoHideAsync();
            } catch (error) {
                console.warn('[App] Failed to prevent auto hide of splash screen', error);
            }
        };

        void prepare();
    }, []);

    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
            <SafeAreaProvider>
                <AuthProvider>
                    <SubscriptionProvider>
                        <EncryptionProvider>
                            <AppBootstrap>
                                <EncryptionGate>
                                    <NotesProvider>
                                        <StatusBar style="auto" />
                                        <RootNavigator />
                                    </NotesProvider>
                                </EncryptionGate>
                            </AppBootstrap>
                        </EncryptionProvider>
                    </SubscriptionProvider>
                </AuthProvider>
            </SafeAreaProvider>
        </GestureHandlerRootView>
    );
}
