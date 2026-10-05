import React, { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Text, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEncryption } from '../context/EncryptionContext';
import { RecoveryCodeModal } from './RecoveryCodeModal';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { createStyles } from '../theme/createStyles';

// How long to wait for the platform backup before falling back to the 24 words.
const BACKUP_WAIT_MS = 6000;
const BANNER_MS = 5000;

/**
 * After automatic end-to-end setup:
 * - the key reached the user's Google / iCloud backup: a short banner, nothing to
 *   save (the key stays in Settings → Recovery key);
 * - otherwise: the 24 words once, until the user confirms they are saved.
 */
export const RecoveryKeyPrompt: React.FC = () => {
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    const { recoveryKeyNeedsSaving, recoveryCode, confirmRecoveryKeySaved, keyBackup, keyBackupChecked } = useEncryption();
    const [waitedOut, setWaitedOut] = useState(false);
    const [bannerVisible, setBannerVisible] = useState(false);
    const opacity = useRef(new Animated.Value(0)).current;

    const pending = recoveryKeyNeedsSaving && !!recoveryCode;
    const savedInCloud = keyBackupChecked && !!keyBackup?.cloud;

    // Give the backup a moment; a slow or failed one shows the 24 words.
    useEffect(() => {
        if (!pending || keyBackupChecked) {
            setWaitedOut(false);
            return;
        }
        const timer = setTimeout(() => setWaitedOut(true), BACKUP_WAIT_MS);
        return () => clearTimeout(timer);
    }, [pending, keyBackupChecked]);

    // Saved in the cloud: nothing to keep, so mark it saved and show the banner.
    useEffect(() => {
        if (!pending || !savedInCloud) return;
        void confirmRecoveryKeySaved();
        setBannerVisible(true);
    }, [pending, savedInCloud, confirmRecoveryKeySaved]);

    // Its own timer: confirming above changes `pending`, which must not cancel it.
    useEffect(() => {
        if (!bannerVisible) return;
        Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }).start();
        const timer = setTimeout(() => {
            Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true })
                .start(() => setBannerVisible(false));
        }, BANNER_MS);
        return () => clearTimeout(timer);
    }, [bannerVisible, opacity]);

    const showWords = pending && !savedInCloud && (keyBackupChecked || waitedOut);

    return (
        <>
            <RecoveryCodeModal
                visible={showWords}
                recoveryCode={recoveryCode}
                firstTime
                backup={keyBackup}
                onClose={() => { void confirmRecoveryKeySaved(); }}
            />
            {bannerVisible ? (
                <Animated.View
                    pointerEvents="box-none"
                    style={[styles.bannerWrap, { top: insets.top + spacing.s, opacity }]}
                >
                    <TouchableOpacity
                        activeOpacity={0.9}
                        style={styles.banner}
                        onPress={() => setBannerVisible(false)}
                        accessibilityRole="alert"
                    >
                        <MaterialCommunityIcons name="shield-check" size={22} color={colors.success} />
                        <View style={{ flex: 1 }}>
                            <Text style={styles.bannerTitle}>{t('settings.recovery.bannerTitle', 'Notes are end-to-end encrypted')}</Text>
                            <Text style={styles.bannerText}>
                                {Platform.OS === 'ios'
                                    ? t('settings.recovery.bannerIcloud', 'Key saved in iCloud Keychain. It is also in Settings → Recovery key.')
                                    : t('settings.recovery.bannerGoogle', 'Key saved in your Google backup. It is also in Settings → Recovery key.')}
                            </Text>
                        </View>
                    </TouchableOpacity>
                </Animated.View>
            ) : null}
        </>
    );
};

const styles = createStyles(() => ({
    bannerWrap: {
        position: 'absolute',
        left: spacing.m,
        right: spacing.m,
        zIndex: 1000,
        elevation: 12,
    },
    banner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
        padding: spacing.m,
        borderRadius: 16,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        shadowColor: '#000',
        shadowOpacity: 0.12,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
    },
    bannerTitle: {
        ...typography.body,
        fontWeight: '600',
        color: colors.text,
    },
    bannerText: {
        ...typography.caption,
        color: colors.textSecondary,
        marginTop: 2,
    },
}));
