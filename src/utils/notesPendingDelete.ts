import { UNDO_WINDOW_MS } from '../components/UndoSnackbar';
import { createPendingDeleteStore } from './pendingDelete';

/**
 * Notes deleted from the list or from an open note wait here for the Undo
 * window to close; the list shows the Undo bar for both. Kept outside the
 * screens so a remount (a theme change remounts the whole tree) or a re-render
 * can never move them to the trash before the window is over.
 */
export const notesPendingDelete = createPendingDeleteStore({
    windowMs: UNDO_WINDOW_MS,
    onError: (error) => console.error('[Notes] Delete failed', error),
});
