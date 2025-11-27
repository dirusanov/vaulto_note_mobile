import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { useAuth } from '../hooks/useAuth';
import { AuthNavigator } from './AuthNavigator';
import { AppNavigator } from './AppNavigator';
import { Loader } from '../components/Loader';

import { storage } from '../utils/storage';

export const RootNavigator = () => {
    const { isAuthenticated, isLoading } = useAuth();
    const [isGuest, setIsGuest] = React.useState<boolean | null>(null);

    React.useEffect(() => {
        const checkGuest = async () => {
            const guest = await storage.getGuestMode();
            setIsGuest(guest);
        };
        checkGuest();
    }, []);

    if (isLoading || isGuest === null) {
        return <Loader />;
    }

    // If authenticated OR guest, we go to NotesList (which is inside AppNavigator).
    // If neither, we go to Welcome (also inside AppNavigator).
    // We can pass `initialRouteName` to AppNavigator if we want, but AppNavigator is a component.
    // We can't easily pass props to the Navigator inside AppNavigator without prop drilling or context.
    // EASIER: Just let AppNavigator handle it? No, AppNavigator defines the stack.
    // We can use a ref or just conditional rendering of screens?
    // NO, we merged them.
    // So we need to set `initialRouteName` on the Stack.Navigator in AppNavigator.
    // Let's pass a prop to AppNavigator.

    const initialRoute = (isAuthenticated || isGuest) ? 'NotesList' : 'Welcome';

    return (
        <NavigationContainer>
            <AppNavigator initialRouteName={initialRoute} />
        </NavigationContainer>
    );
};
