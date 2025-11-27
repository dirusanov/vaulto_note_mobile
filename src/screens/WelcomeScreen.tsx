import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ScreenContainer } from '../components/ScreenContainer';
import { Button } from '../components/Button';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { spacing } from '../theme/spacing';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

export const WelcomeScreen = () => {
    const navigation = useNavigation<NativeStackNavigationProp<any>>();

    return (
        <ScreenContainer style={styles.container}>
            <View style={styles.content}>
                <View style={styles.header}>
                    <Text style={styles.logo}>VN</Text>
                    <Text style={styles.title}>Vaulto Note</Text>
                    <Text style={styles.subtitle}>
                        Encrypted notes. Only you can read them.
                    </Text>
                </View>

                <View style={styles.footer}>
                    <Button
                        title="Sign In"
                        onPress={() => navigation.navigate('SignIn')}
                        style={styles.button}
                    />
                    <Button
                        title="Create account"
                        onPress={() => navigation.navigate('SignUp')}
                        variant="secondary"
                        style={styles.button}
                    />
                    <Button
                        title="Continue Offline"
                        onPress={async () => {
                            const { storage } = require('../utils/storage');
                            await storage.setGuestMode(true);
                            navigation.replace('NotesList');
                        }}
                        variant="outline"
                        style={styles.button}
                    />
                </View>
            </View>
        </ScreenContainer>
    );
};

const styles = StyleSheet.create({
    container: {
        justifyContent: 'center',
    },
    content: {
        flex: 1,
        justifyContent: 'space-between',
        paddingVertical: spacing.xxl,
    },
    header: {
        alignItems: 'center',
        marginTop: spacing.xxl,
    },
    logo: {
        fontSize: 64,
        fontWeight: '800',
        color: colors.primary,
        marginBottom: spacing.m,
    },
    title: {
        ...typography.h1,
        textAlign: 'center',
        marginBottom: spacing.s,
    },
    subtitle: {
        ...typography.body,
        textAlign: 'center',
        color: colors.textMuted,
        maxWidth: '80%',
    },
    footer: {
        width: '100%',
    },
    button: {
        marginBottom: spacing.m,
    },
});
