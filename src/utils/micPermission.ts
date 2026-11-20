import { Linking } from 'react-native';
import i18n from '../i18n';
import { appAlert } from '../components/AppAlert';

/**
 * The microphone was refused. Not a dead end: say what it is for and take the
 * user to the app's system settings, where it can be allowed.
 */
export const showMicPermissionDenied = (): void => {
    appAlert(
        i18n.t('voice.micAllowTitle', { defaultValue: 'Allow the microphone to record' }),
        i18n.t('voice.micAllowText', {
            defaultValue: 'Vaulto needs the microphone to record voice notes. You can allow it in the app’s settings.',
        }),
        [
            { text: i18n.t('common.notNow', { defaultValue: 'Not now' }), style: 'cancel' },
            {
                text: i18n.t('voice.micOpenSettings', { defaultValue: 'Open settings' }),
                onPress: () => { void Linking.openSettings().catch(() => undefined); },
            },
        ],
        { cancelable: true },
    );
};
