import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from './src/context/AuthContext';
import { NotesProvider } from './src/contexts/NotesContext';
import { RootNavigator } from './src/navigation/RootNavigator';

export default function App() {
    return (
        <SafeAreaProvider>
            <AuthProvider>
                <NotesProvider>
                    <StatusBar style="auto" />
                    <RootNavigator />
                </NotesProvider>
            </AuthProvider>
        </SafeAreaProvider>
    );
}
