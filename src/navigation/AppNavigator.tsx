import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { NotesListScreen } from '../screens/NotesListScreen';
import { NoteEditScreen } from '../screens/NoteEditScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { colors } from '../theme/colors';

import { SignInScreen } from '../screens/SignInScreen';
import { SignUpScreen } from '../screens/SignUpScreen';

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
                name="NotesList"
                component={NotesListScreen}
                options={{ headerShown: false }}
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
        </Stack.Navigator>
    );
};
