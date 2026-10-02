import { createNavigationContainerRef } from '@react-navigation/native';
import i18n from 'i18next';
import type { RootStackParamList } from './types';

/**
 * Deep links from outside the app: the home-screen widget, the Quick Settings
 * tile and notification taps all open `vaultonote://<path>`.
 *   record      start a voice recording on the notes list
 *   new         open a new empty note
 *   ask         open the notes chat
 *   digest      open the chat with the weekly summary question
 *   note/<id>   open a note (task reminders)
 *   home        the notes list
 */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

let pendingUrl: string | null = null;

export type DeepLinkAction =
    | { screen: 'NotesList'; params?: RootStackParamList['NotesList'] }
    | { screen: 'NoteEdit'; params: RootStackParamList['NoteEdit'] }
    | { screen: 'AskNotes'; params?: RootStackParamList['AskNotes'] };

export const parseDeepLink = (url: string, now: number = Date.now()): DeepLinkAction | null => {
    const match = url.match(/^vaultonote:\/\/+([^?#]*)/i);
    if (!match) return null;
    const [head, ...rest] = match[1].split('/').filter(Boolean);
    switch ((head || 'home').toLowerCase()) {
        case 'record':
            return { screen: 'NotesList', params: { startRecordingAt: now } };
        case 'new':
            return { screen: 'NoteEdit', params: {} };
        case 'ask':
            return { screen: 'AskNotes' };
        case 'digest':
            return { screen: 'AskNotes', params: { question: i18n.t('digest.question', 'What happened in my notes this week? Summarise the main points and the open tasks.') } };
        case 'note':
            return rest[0] ? { screen: 'NoteEdit', params: { noteId: decodeURIComponent(rest[0]) } } : null;
        case 'home':
            return { screen: 'NotesList' };
        default:
            return null;
    }
};

const run = (action: DeepLinkAction) => {
    // `navigate` with a new param object re-triggers screens that are already open.
    (navigationRef.navigate as any)(action.screen, action.params);
};

export const handleDeepLink = (url: string | null | undefined) => {
    if (!url) return;
    const action = parseDeepLink(url);
    if (!action) return;
    if (!navigationRef.isReady()) {
        pendingUrl = url;
        return;
    }
    run(action);
};

/** Called once the navigator is mounted: replays a link that arrived earlier. */
export const flushPendingDeepLink = () => {
    const url = pendingUrl;
    pendingUrl = null;
    if (url) handleDeepLink(url);
};
