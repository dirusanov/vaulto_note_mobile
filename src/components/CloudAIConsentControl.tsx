import React, { useCallback, useState } from 'react';
import { Alert, Platform, Switch, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { hasCloudAIConsent, isCloudAIConsentError, requireCloudAIConsent, revokeCloudAIConsent } from '../services/cloudAIConsent';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { createStyles } from '../theme/createStyles';

export const CloudAIConsentControl = () => {
    const { t } = useTranslation();
    const [allowed, setAllowed] = useState(false);
    const [busy, setBusy] = useState(false);
    useFocusEffect(useCallback(() => {
        if (Platform.OS !== 'ios') return;
        let active = true;
        void hasCloudAIConsent().then(value => { if (active) setAllowed(value); }).catch(() => {});
        return () => { active = false; };
    }, []));
    if (Platform.OS !== 'ios') return null;
    const changePermission = async (enabled: boolean) => {
        setBusy(true);
        try {
            if (enabled) await requireCloudAIConsent();
            else await revokeCloudAIConsent();
        } catch (error) {
            if (!isCloudAIConsentError(error)) Alert.alert(t('common.error'), t('cloudAIConsent.updateError'));
        } finally {
            setAllowed(await hasCloudAIConsent().catch(() => false));
            setBusy(false);
        }
    };
    return <View style={styles.row}>
        <View style={styles.copy}>
            <Text style={styles.title}>{t('cloudAIConsent.settingTitle')}</Text>
            <Text style={styles.description}>{t(allowed ? 'cloudAIConsent.allowed' : 'cloudAIConsent.ask')}</Text>
        </View>
        <Switch value={allowed} onValueChange={value => { void changePermission(value); }} disabled={busy}
            accessibilityLabel={t('cloudAIConsent.settingTitle')}
            trackColor={{ false: colors.textTertiary, true: colors.primary }} thumbColor={colors.onPrimary} />
    </View>;
};
const styles = createStyles(() => ({
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.m, gap: spacing.m },
    copy: { flex: 1 },
    title: { ...typography.body, color: colors.text },
    description: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
}));
