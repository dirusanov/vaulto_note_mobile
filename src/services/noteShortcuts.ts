import { useEffect } from 'react';
import { AppState, NativeModules, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { Note } from '../api/notes';

export const noteShortcuts = Platform.OS === 'android' ? NativeModules.NoteShortcut as {
    requestPin(id: string, label: string): Promise<boolean>;
    getPinnedLabels(): Promise<Record<string, string>>;
    updateLabels(labels: Record<string, string>): Promise<boolean>;
} | undefined : undefined;

export function shortcutLabel(note: Note | undefined, t: TFunction): string {
    if (!note || note.deleted || note.pending_delete || note.locked || note.is_protected || note.privacy === 'hidden') {
        return t('notes.note');
    }
    return note.title?.trim() || (note.has_audio ? t('notes.voiceRecording') : t('ask.untitled'));
}

/** Launchers keep their own copy of a pinned title, even after an account change. */
export function useNoteShortcutLabels(notes: Note[], hydrated: boolean) {
    const { t } = useTranslation();
    useEffect(() => {
        const shortcuts = noteShortcuts;
        if (!hydrated || !shortcuts?.getPinnedLabels) return;
        let cancelled = false;
        const sync = async () => {
            try {
                const pinned = await shortcuts.getPinnedLabels();
                if (cancelled || !Object.keys(pinned).length) return;
                const notesById = new Map(notes.map(note => [note.id, note]));
                const updates: Record<string, string> = {};
                for (const [id, oldLabel] of Object.entries(pinned)) {
                    const label = shortcutLabel(notesById.get(id), t);
                    if (label !== oldLabel) updates[id] = label;
                }
                if (Object.keys(updates).length) await shortcuts.updateLabels(updates);
            } catch {
                // A locked Android profile can reject access. Retry on foreground.
            }
        };
        void sync();
        const subscription = AppState.addEventListener('change', state => {
            if (state === 'active') void sync();
        });
        return () => {
            cancelled = true;
            subscription.remove();
        };
    }, [hydrated, notes, t]);
}
