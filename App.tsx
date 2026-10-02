import 'react-native-gesture-handler';
import 'react-native-reanimated';
import './src/i18n';
import React, { useEffect, useRef, useState } from 'react';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ThemeProvider } from './src/theme/ThemeContext';
import { AuthProvider } from './src/context/AuthContext';
import { SubscriptionProvider } from './src/context/SubscriptionContext';
import { EncryptionProvider } from './src/context/EncryptionContext';
import { NotesProvider } from './src/contexts/NotesContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { EncryptionGate } from './src/components/EncryptionGate';
import * as SplashScreen from 'expo-splash-screen';
import { useAuth } from './src/hooks/useAuth';
import { useEncryption } from './src/context/EncryptionContext';
import { useNotesContext } from './src/contexts/NotesContext';

const MIN_SPLASH_MS = 1600;
const BOOT_TIMEOUT_MS = 6000;

const AppBootstrap = ({ children }: { children: React.ReactNode }) => {
    const { isLoading, userId } = useAuth();
    const { status } = useEncryption();
    const { isHydrated, isInitialSyncComplete } = useNotesContext();
    const [splashHidden, setSplashHidden] = useState(false);
    const [bootTimedOut, setBootTimedOut] = useState(false);
    const bootStartedAtRef = useRef(Date.now());
    const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const appReady =
        !isLoading &&
        status !== 'loading' &&
        isHydrated &&
        isInitialSyncComplete &&
        (!!userId || bootTimedOut);

    useEffect(() => {
        const timeout = setTimeout(() => {
            setBootTimedOut(true);
        }, BOOT_TIMEOUT_MS);
        return () => clearTimeout(timeout);
    }, []);

    useEffect(() => {
        if (!appReady || splashHidden) {
            return;
        }

        const elapsed = Date.now() - bootStartedAtRef.current;
        const remaining = Math.max(MIN_SPLASH_MS - elapsed, 0);

        const hideSplash = async () => {
            try {
                await SplashScreen.hideAsync();
            } catch (error) {
                console.warn('[App] Failed to hide splash screen', error);
            } finally {
                setSplashHidden(true);
            }
        };

        if (remaining === 0) {
            void hideSplash();
            return;
        }

        if (hideTimeoutRef.current) {
            clearTimeout(hideTimeoutRef.current);
        }
        hideTimeoutRef.current = setTimeout(() => {
            hideTimeoutRef.current = null;
            void hideSplash();
        }, remaining);

        return () => {
            if (hideTimeoutRef.current) {
                clearTimeout(hideTimeoutRef.current);
                hideTimeoutRef.current = null;
            }
        };
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
            <SafeAreaProvider initialMetrics={initialWindowMetrics}>
                <AuthProvider>
                    <SubscriptionProvider>
                        <EncryptionProvider>
                            <NotesProvider>
                                <AppBootstrap>
                                    <ThemeProvider>
                                        <EncryptionGate>
                                            <RootNavigator />
                                        </EncryptionGate>
                                    </ThemeProvider>
                                </AppBootstrap>
                            </NotesProvider>
                        </EncryptionProvider>
                    </SubscriptionProvider>
                </AuthProvider>
            </SafeAreaProvider>
        </GestureHandlerRootView>
    );
}
