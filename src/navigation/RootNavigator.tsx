import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { useAuth } from '../hooks/useAuth';
import { AppNavigator } from './AppNavigator';
import { Loader } from '../components/Loader';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

export const RootNavigator = () => {
    const { isLoading } = useAuth();

    useEffect(() => {
        if (!isLoading) {
            SplashScreen.hideAsync();
        }
    }, [isLoading]);

    if (isLoading) {
        return <Loader />;
    }

    return (
        <NavigationContainer>
            <AppNavigator initialRouteName="NotesList" />
        </NavigationContainer>
    );
};
