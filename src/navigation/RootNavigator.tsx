import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { AppNavigator } from './AppNavigator';

export const RootNavigator = () => {
    return (
        <NavigationContainer>
            <AppNavigator initialRouteName="NotesList" />
        </NavigationContainer>
    );
};
