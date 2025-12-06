import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { useAuth } from '../hooks/useAuth';
import { AppNavigator } from './AppNavigator';
import { Loader } from '../components/Loader';

export const RootNavigator = () => {
    const { isLoading } = useAuth();

    if (isLoading) {
        return <Loader />;
    }

    return (
        <NavigationContainer>
            <AppNavigator initialRouteName="NotesList" />
        </NavigationContainer>
    );
};
