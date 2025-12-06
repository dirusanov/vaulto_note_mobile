import * as SQLite from 'expo-sqlite';
import { Note } from '../api/notes';
import { decrypt } from '../crypto/encryption';

let db: SQLite.SQLiteDatabase | null = null;

const getDb = async (): Promise<SQLite.SQLiteDatabase | null> => {
    if (!db) {
        db = await SQLite.openDatabaseAsync('notes.db');
    }
    return db;
};

export const initDatabase = async (): Promise<void> => {
    try {
        const database = await getDb();
        if (!database) return;
        await database.execAsync(`
            CREATE TABLE IF NOT EXISTS notes (
                id TEXT PRIMARY KEY NOT NULL,
                encrypted_title TEXT,
                encrypted_content TEXT NOT NULL,
                created_at TEXT,
                updated_at TEXT,
                audio_file_path TEXT,
                audio_duration INTEGER,
                encrypted_transcription TEXT,
                has_audio INTEGER DEFAULT 0,
                synced INTEGER DEFAULT 0,
                dirty INTEGER DEFAULT 0,
                deleted INTEGER DEFAULT 0,
                version INTEGER DEFAULT 0,
                server_updated_at TEXT,
                content_nonce TEXT,
                pending_delete INTEGER DEFAULT 0
            );
        `);
        // Ensure new columns exist for existing installs
        const columns = await database.getAllAsync<any>('PRAGMA table_info(notes);');
        const columnNames = columns.map((c: any) => c.name);
        const ensureColumn = async (name: string, type: string): Promise<boolean> => {
            if (!columnNames.includes(name)) {
                await database.execAsync(`ALTER TABLE notes ADD COLUMN ${name} ${type};`);
                return true;
            }
            return false;
        };
        await ensureColumn('audio_file_path', 'TEXT');
        await ensureColumn('audio_duration', 'INTEGER');
        await ensureColumn('encrypted_transcription', 'TEXT');
        await ensureColumn('has_audio', 'INTEGER DEFAULT 0');
        const addedDirty = await ensureColumn('dirty', 'INTEGER DEFAULT 0');
        const addedDeleted = await ensureColumn('deleted', 'INTEGER DEFAULT 0');
        await ensureColumn('version', 'INTEGER DEFAULT 0');
        await ensureColumn('server_updated_at', 'TEXT');
        await ensureColumn('content_nonce', 'TEXT');
        await ensureColumn('pending_delete', 'INTEGER DEFAULT 0');

        // Mark previously unsynced rows as dirty so they are picked up on the next sync
        if (addedDirty) {
            await database.execAsync('UPDATE notes SET dirty = 1 WHERE synced = 0 OR pending_delete = 1;');
        }
        // Keep deleted in sync with pending_delete for older installs
        if (addedDeleted) {
            await database.execAsync('UPDATE notes SET deleted = pending_delete WHERE pending_delete = 1;');
        }
        console.log('[DatabaseService] Database initialized');
    } catch (error) {
        console.error('[DatabaseService] Failed to initialize database', error);
        throw error;
    }
};

export const saveNoteLocal = async (note: Note): Promise<void> => {
    try {
        const database = await getDb();
        if (!database) return;

        const isDirty = note.dirty ? 1 : 0;
        const isDeleted = note.deleted || note.pending_delete ? 1 : 0;
        const isPendingDelete = note.pending_delete || note.deleted ? 1 : 0;

        await database.runAsync(
            `INSERT OR REPLACE INTO notes (
                id, encrypted_title, encrypted_content, created_at, updated_at,
                audio_file_path, audio_duration, encrypted_transcription, has_audio,
                synced, dirty, deleted, version, server_updated_at, content_nonce, pending_delete
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            [
                note.id,
                note.encrypted_title ?? null,
                note.encrypted_content,
                note.created_at ?? null,
                note.updated_at ?? null,
                note.audio_file_path ?? null,
                note.audio_duration ?? null,
                note.encrypted_transcription ?? null,
                note.has_audio ? 1 : 0,
                note.synced ?? 1,
                isDirty,
                isDeleted,
                note.version ?? 0,
                note.server_updated_at ?? note.updated_at ?? null,
                note.content_nonce ?? null,
                isPendingDelete ? 1 : 0,
            ]
        );
        console.log(`[DatabaseService] Note saved locally: ${note.id}`);
    } catch (error) {
        console.error(`[DatabaseService] Failed to save note ${note.id}`, error);
        throw error;
    }
};

export const deleteNoteLocal = async (id: string): Promise<void> => {
    try {
        const database = await getDb();
        if (!database) return;

        await database.runAsync('DELETE FROM notes WHERE id = ?;', [id]);
        console.log(`[DatabaseService] Note deleted locally: ${id}`);
    } catch (error) {
        console.error(`[DatabaseService] Failed to delete note ${id}`, error);
        throw error;
    }
};

export const getNotesLocal = async (): Promise<Note[]> => {
    try {
        const database = await getDb();
        if (!database) return [];

        const rows = await database.getAllAsync<any>('SELECT * FROM notes ORDER BY updated_at DESC;');

        const notes: Note[] = [];
        for (const row of rows) {
            try {
                // Decrypt on load
                const title = row.encrypted_title
                    ? await decrypt(row.encrypted_title)
                    : '';
                const content = await decrypt(row.encrypted_content);
                const transcription = row.encrypted_transcription
                    ? await decrypt(row.encrypted_transcription)
                    : undefined;

                notes.push({
                    id: row.id,
                    encrypted_title: row.encrypted_title,
                    encrypted_content: row.encrypted_content,
                    title,
                    content,
                    transcription,
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                    audio_file_path: row.audio_file_path ?? undefined,
                    audio_duration: row.audio_duration ?? undefined,
                    encrypted_transcription: row.encrypted_transcription ?? undefined,
                    has_audio: !!row.audio_file_path,
                    synced: row.synced ?? 1,
                    dirty: row.dirty === 1,
                    deleted: row.deleted === 1,
                    version: row.version ?? 0,
                    server_updated_at: row.server_updated_at ?? undefined,
                    content_nonce: row.content_nonce ?? null,
                    pending_delete: row.pending_delete === 1 || row.deleted === 1,
                });
            } catch (e) {
                console.error(`[DatabaseService] Failed to decrypt note ${row.id}`, e);
                // Skip corrupted notes or handle gracefully
            }
        }
        console.log(`[DatabaseService] Loaded ${notes.length} notes from local DB`);
        return notes;
    } catch (error) {
        console.error('[DatabaseService] Failed to load notes', error);
        throw error;
    }
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
    try {
        await initDatabase();
        const database = await getDb();
        if (!database) return;
        await database.runAsync('DELETE FROM notes;');
        console.log('[DatabaseService] Local DB wiped');
    } catch (error) {
        console.error('[DatabaseService] Failed to wipe local DB', error);
        throw error;
    }
};
