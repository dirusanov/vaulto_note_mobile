import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { NotesListScreen } from '../screens/NotesListScreen';
import { NoteEditScreen } from '../screens/NoteEditScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { AskNotesScreen } from '../screens/AskNotesScreen';
import { PaywallScreen } from '../screens/PaywallScreen';
import { colors } from '../theme/colors';

import { SignInScreen } from '../screens/SignInScreen';
import { SignUpScreen } from '../screens/SignUpScreen';
import { EmailVerificationScreen } from '../screens/EmailVerificationScreen';
import { ForgotPasswordScreen } from '../screens/ForgotPasswordScreen';
import { ResetPasswordScreen } from '../screens/ResetPasswordScreen';
import { LegalAcceptanceScreen } from '../screens/LegalAcceptanceScreen';


const Stack = createNativeStackNavigator();

export const AppNavigator = ({ initialRouteName }: { initialRouteName?: string }) => {
    const resolvedInitialRoute = initialRouteName ?? 'NotesList';
    return (
        <Stack.Navigator
            initialRouteName={resolvedInitialRoute}
            screenOptions={{
                headerShown: true,
                headerStyle: {
                    backgroundColor: colors.background,
                },
                headerTintColor: colors.text,
                headerShadowVisible: false,
                // Keeps transitions from flashing white in the dark theme.
                contentStyle: { backgroundColor: colors.background },
            }}
        >
            <Stack.Screen
                name="SignIn"
                component={SignInScreen}
                options={{ headerShown: false }}
            />
            <Stack.Screen
                name="SignUp"
                component={SignUpScreen}
                options={{ headerShown: false }}
            />
            <Stack.Screen
                name="EmailVerification"
                component={EmailVerificationScreen}
                options={{ headerShown: false }}
            />
            <Stack.Screen
                name="ForgotPassword"
                component={ForgotPasswordScreen}
                options={{ headerShown: false }}
            />
            <Stack.Screen
                name="ResetPassword"
                component={ResetPasswordScreen}
                options={{ headerShown: false }}
            />
            <Stack.Screen
                name="LegalAcceptance"
                component={LegalAcceptanceScreen}
                options={{ headerShown: false }}
            />

            <Stack.Screen
                name="NotesList"
                component={NotesListScreen}
                options={{
                    headerShown: false,
                    animation: 'none', // Disable animation for the initial screen
                }}
            />
            <Stack.Screen
                name="NoteEdit"
                component={NoteEditScreen}
                options={{
                    headerShown: false,
                }}
            />
            <Stack.Screen
                name="Settings"
                component={SettingsScreen}
                options={{
                    headerShown: false,
                }}
            />
            <Stack.Screen
                name="AskNotes"
                component={AskNotesScreen}
                options={{
                    headerShown: false,
                }}
            />
            <Stack.Screen
                name="Paywall"
                component={PaywallScreen}
                options={{
                    headerShown: false,
                    presentation: 'modal',
                }}
            />
        </Stack.Navigator>
    );
};
