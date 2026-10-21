import 'react-native-gesture-handler';
import 'react-native-reanimated';
import './src/i18n';
import React, { useEffect, useState } from 'react';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ThemeProvider } from './src/theme/ThemeContext';
import { AuthProvider } from './src/context/AuthContext';
import { SubscriptionProvider } from './src/context/SubscriptionContext';
import { EncryptionProvider } from './src/context/EncryptionContext';
import { NotesProvider } from './src/contexts/NotesContext';
import { RecoveryKeyPrompt } from './src/components/RecoveryKeyPrompt';
import { RootNavigator } from './src/navigation/RootNavigator';
import { EncryptionGate } from './src/components/EncryptionGate';
import * as SplashScreen from 'expo-splash-screen';
import { useAuth } from './src/hooks/useAuth';
import { useEncryption } from './src/context/EncryptionContext';
import { useNotesContext } from './src/contexts/NotesContext';
import { hasMasterKey } from './src/crypto/e2ee';

// Before the first render: called later, the native splash can already be gone and
// the app shows a blank screen until it is ready.
SplashScreen.preventAutoHideAsync().catch((error) => {
    console.warn('[App] Failed to prevent auto hide of splash screen', error);
});

const BOOT_TIMEOUT_MS = 6000;

const AppBootstrap = ({ children }: { children: React.ReactNode }) => {
    const { isLoading, userId } = useAuth();
    const { status } = useEncryption();
    const { notes, lockedCount, isHydrated, isInitialSyncComplete } = useNotesContext();
    const [splashHidden, setSplashHidden] = useState(false);
    const [bootTimedOut, setBootTimedOut] = useState(false);
    // Notes already on the device are shown at once and the first sync carries on
    // in the background; an empty device waits for it so it does not flash empty.
    const hasLocalNotes = notes.length > 0 || lockedCount > 0;
    // Read before the key was restored, the list is all locked; the key's arrival
    // re-reads it (useNotes), so wait for that instead of showing an empty list.
    const listAwaitsKey = notes.length === 0 && lockedCount > 0 && hasMasterKey();
    const appReady =
        !isLoading &&
        status !== 'loading' &&
        isHydrated &&
        (isInitialSyncComplete || hasLocalNotes) &&
        (!listAwaitsKey || bootTimedOut) &&
        (!!userId || bootTimedOut);

    useEffect(() => {
        const timeout = setTimeout(() => {
            setBootTimedOut(true);
        }, BOOT_TIMEOUT_MS);
        return () => clearTimeout(timeout);
    }, []);

    // An offline-model download the app was closed during carries on (on Android
    // it never stopped: the system keeps it going and shows it in notifications).
    useEffect(() => {
        if (!appReady) return;
        void import('./src/services/offlineMode').then((m) => m.resumeOfflineDownload());
    }, [appReady]);

    useEffect(() => {
        if (!appReady || splashHidden) {
            return;
        }

        void (async () => {
            try {
                await SplashScreen.hideAsync();
            } catch (error) {
                console.warn('[App] Failed to hide splash screen', error);
            } finally {
                setSplashHidden(true);
            }
        })();
    }, [appReady, splashHidden]);

    if (!splashHidden) {
        return null;
    }

    return <>{children}</>;
};

export default function App() {
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
                                            <RecoveryKeyPrompt />
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
