import { Note } from '../api/notes';
import { decrypt } from '../crypto/encryption';

const STORAGE_KEY = 'vaulto_notes_local_store';

// Helper to get notes from localStorage
const getWebStore = (): Note[] => {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch (e) {
        console.error('[DatabaseService] Failed to load from localStorage', e);
        return [];
    }
};

// Helper to save notes to localStorage
const saveWebStore = (notes: Note[]) => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
    } catch (e) {
        console.error('[DatabaseService] Failed to save to localStorage', e);
    }
};

export const initDatabase = async (): Promise<void> => {
    console.log('[DatabaseService] Web detected, using localStorage');
};

export const saveNoteLocal = async (note: Note): Promise<void> => {
    const notes = getWebStore();
    const index = notes.findIndex(n => n.id === note.id);
    if (index >= 0) {
        notes[index] = { ...note, synced: 1 } as any;
    } else {
        notes.push({ ...note, synced: 1 } as any);
    }
    saveWebStore(notes);
    console.log(`[DatabaseService] Note saved to web store: ${note.id}`);
};

export const deleteNoteLocal = async (id: string): Promise<void> => {
    let notes = getWebStore();
    notes = notes.filter(n => n.id !== id);
    saveWebStore(notes);
    console.log(`[DatabaseService] Note deleted from web store: ${id}`);
};

export const getNotesLocal = async (): Promise<Note[]> => {
    const rawNotes = getWebStore();
    const notes: Note[] = [];
    for (const n of rawNotes) {
        try {
            const title = n.encrypted_title
                ? await decrypt(n.encrypted_title)
                : await decrypt(n.encrypted_content).then(content => {
                    const lines = content.trim().split('\n');
                    return lines[0] || 'Untitled';
                });
            const content = await decrypt(n.encrypted_content);
            const transcription = n.encrypted_transcription
                ? await decrypt(n.encrypted_transcription)
                : undefined;
            notes.push({
                ...n,
                title,
                content,
                transcription,
            });
        } catch (e) {
            console.error(`[DatabaseService] Failed to decrypt web note ${n.id}`, e);
        }
    }
    // Sort by updated_at desc
    return notes.sort((a, b) => {
        const dateA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const dateB = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        return dateB - dateA;
    });
};

export const searchNotesLocal = async (query: string): Promise<Note[]> => {
    const allNotes = await getNotesLocal();
    if (!query) return allNotes;

    const lowerQuery = query.toLowerCase();
    return allNotes.filter(note =>
        (note.title && note.title.toLowerCase().includes(lowerQuery)) ||
        (note.content && note.content.toLowerCase().includes(lowerQuery)) ||
        (note.transcription && note.transcription.toLowerCase().includes(lowerQuery))
    );
};
