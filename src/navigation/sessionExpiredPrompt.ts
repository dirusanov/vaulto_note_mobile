import i18n from '../i18n';
import { appAlert } from '../components/AppAlert';
import { onSessionExpired } from '../api/sessionFetch';
import { navigationRef } from './deepLinks';

/**
 * The session could not be renewed (api/sessionFetch): one calm sentence and
 * the way back, instead of the server's "Invalid credentials". The notes stay.
 */
export const installSessionExpiredPrompt = (): (() => void) => onSessionExpired(() => {
    appAlert(
        i18n.t('auth.sessionExpiredTitle', { defaultValue: 'Your session has expired' }),
        i18n.t('auth.sessionExpiredText', { defaultValue: 'Sign in again to keep using AI and sync. Your notes stay on this phone.' }),
        [
            { text: i18n.t('common.notNow', { defaultValue: 'Not now' }), style: 'cancel' },
            {
                text: i18n.t('auth.signInAgain', { defaultValue: 'Sign in again' }),
                onPress: () => {
                    if (navigationRef.isReady()) (navigationRef.navigate as any)('SignIn');
                },
            },
        ],
        { cancelable: true },
    );
});
