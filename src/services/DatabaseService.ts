import { Platform } from 'react-native';
import * as SQLite from 'expo-sqlite';
import { Note } from '../api/notes';
import { decrypt } from '../crypto/encryption';

const STORAGE_KEY = 'vaulto_notes_local_store';

// Web Store Implementation
const getWebStore = (): Note[] => {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch (e) {
        console.error('[DatabaseService] Failed to load from localStorage', e);
        return [];
    }
};

const saveWebStore = (notes: Note[]) => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
    } catch (e) {
        console.error('[DatabaseService] Failed to save to localStorage', e);
    }
};

// Native Store Implementation
let db: SQLite.SQLiteDatabase | null = null;

const getDb = async () => {
    if (Platform.OS === 'web') return null;
    if (!db) {
        db = await SQLite.openDatabaseAsync('vaulto.db');
        await db.execAsync(`
            CREATE TABLE IF NOT EXISTS notes (
                id TEXT PRIMARY KEY,
                encrypted_title TEXT,
                encrypted_content TEXT,
                created_at TEXT,
                updated_at TEXT,
                audio_file_path TEXT,
                audio_duration REAL,
                encrypted_transcription TEXT,
                has_audio INTEGER,
                synced INTEGER DEFAULT 0,
                dirty INTEGER DEFAULT 0,
                deleted INTEGER DEFAULT 0
            );
        `);

        // Migration for existing tables
        try {
            await db.execAsync('ALTER TABLE notes ADD COLUMN dirty INTEGER DEFAULT 0;');
        } catch (e) {
            // Ignore if column exists
        }
        try {
            await db.execAsync('ALTER TABLE notes ADD COLUMN deleted INTEGER DEFAULT 0;');
        } catch (e) {
            // Ignore if column exists
        }
    }
    return db;
};

export const initDatabase = async (): Promise<void> => {
    if (Platform.OS === 'web') {
        console.log('[DatabaseService] Web detected, using localStorage');
        return;
    }
    try {
        await getDb();
        console.log('[DatabaseService] Native DB initialized');
    } catch (e) {
        console.error('[DatabaseService] Failed to init native DB', e);
    }
};

export const saveNoteLocal = async (note: Note): Promise<void> => {
    if (Platform.OS === 'web') {
        const notes = getWebStore();
        const index = notes.findIndex(n => n.id === note.id);
        const normalizedNote = {
            ...note,
            synced: note.synced ?? 1,
            dirty: note.dirty ?? false,
            deleted: note.deleted ?? false,
            version: note.version ?? (index >= 0 ? notes[index].version ?? 0 : 0),
            server_updated_at: note.server_updated_at ?? note.updated_at,
            content_nonce: note.content_nonce ?? null,
            pending_delete: note.pending_delete ?? false,
        } as Note;
        if (index >= 0) {
            notes[index] = normalizedNote;
        } else {
            notes.push(normalizedNote);
        }
        saveWebStore(notes);
        console.log(`[DatabaseService] Note saved to web store: ${note.id}`);
        return;
    }

    try {
        const database = await getDb();
        if (!database) return;

        const isDirty = note.dirty ? 1 : 0;
        const isDeleted = note.deleted || note.pending_delete ? 1 : 0;

        await database.runAsync(
            `INSERT OR REPLACE INTO notes (
                id, encrypted_title, encrypted_content, created_at, updated_at, 
                audio_file_path, audio_duration, encrypted_transcription, has_audio, synced, dirty, deleted
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                note.id,
                note.encrypted_title || '',
                note.encrypted_content,
                note.created_at || new Date().toISOString(),
                note.updated_at || new Date().toISOString(),
                note.audio_file_path || null,
                note.audio_duration || 0,
                note.encrypted_transcription || null,
                note.has_audio ? 1 : 0,
                note.synced ?? 1,
                isDirty,
                isDeleted
            ]
        );
        console.log(`[DatabaseService] Note saved to native DB: ${note.id} (dirty=${isDirty}, deleted=${isDeleted})`);
    } catch (e) {
        console.error('[DatabaseService] Failed to save to native DB', e);
    }
};

export const deleteNoteLocal = async (id: string): Promise<void> => {
    if (Platform.OS === 'web') {
        let notes = getWebStore();
        notes = notes.filter(n => n.id !== id);
        saveWebStore(notes);
        console.log(`[DatabaseService] Note deleted from web store: ${id}`);
        return;
    }

    try {
        const database = await getDb();
        if (!database) return;
        await database.runAsync('DELETE FROM notes WHERE id = ?', [id]);
        console.log(`[DatabaseService] Note deleted from native DB: ${id}`);
    } catch (e) {
        console.error('[DatabaseService] Failed to delete from native DB', e);
    }
};

export const getNotesLocal = async (): Promise<Note[]> => {
    if (Platform.OS === 'web') {
        const rawNotes = getWebStore();
        return processNotes(rawNotes);
    }

    try {
        const database = await getDb();
        if (!database) return [];
        const rawNotes = await database.getAllAsync<any>('SELECT * FROM notes ORDER BY updated_at DESC');
        return processNotes(rawNotes);
    } catch (e) {
        console.error('[DatabaseService] Failed to get notes from native DB', e);
        return [];
    }
};

const processNotes = async (rawNotes: any[]): Promise<Note[]> => {
    const notes: Note[] = [];
    for (const n of rawNotes) {
        try {
            const hasEncryptedTitle = n.encrypted_title !== undefined && n.encrypted_title !== null;
            const title = hasEncryptedTitle
                ? await decrypt(n.encrypted_title)
                : '';
            const content = await decrypt(n.encrypted_content);
            const transcription = n.encrypted_transcription
                ? await decrypt(n.encrypted_transcription)
                : undefined;

            notes.push({
                ...n,
                title,
                content,
                transcription,
                has_audio: !!n.has_audio,
                synced: n.synced ?? 1,
                dirty: !!n.dirty,
                deleted: !!n.deleted,
                version: n.version ?? 0,
                server_updated_at: n.server_updated_at,
                content_nonce: n.content_nonce ?? null,
                pending_delete: !!n.deleted || !!n.pending_delete,
            });
        } catch (e) {
            console.error(`[DatabaseService] Failed to decrypt note ${n.id}`, e);
        }
    }
    // Sort by updated_at desc (in case DB sort wasn't enough or for web)
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

export const wipeLocalDatabase = async (): Promise<void> => {
    if (Platform.OS === 'web') {
        try {
            localStorage.removeItem(STORAGE_KEY);
            console.log('[DatabaseService] Web store cleared');
        } catch (e) {
            console.error('[DatabaseService] Failed to clear web store', e);
            throw e;
        }
        return;
    }

    try {
        const database = await getDb();
        if (!database) return;
        await database.runAsync('DELETE FROM notes;');
        console.log('[DatabaseService] Native DB wiped');
    } catch (e) {
        console.error('[DatabaseService] Failed to wipe native DB', e);
        throw e;
    }
};
