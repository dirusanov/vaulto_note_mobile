import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { colors } from '../theme/colors';
import { createStyles } from '../theme/createStyles';

export const Loader = () => {
    return (
        <View style={styles.container}>
            <ActivityIndicator size="large" color={colors.primary} />
        </View>
    );
};

const styles = createStyles(() => ({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
}));
