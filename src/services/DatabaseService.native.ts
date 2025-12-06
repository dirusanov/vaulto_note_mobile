import * as SQLite from 'expo-sqlite';
import { Note, NoteImprovement } from '../api/notes';
import { decrypt } from '../crypto/encryption';

let db: SQLite.SQLiteDatabase | null = null;

const getDb = async (): Promise<SQLite.SQLiteDatabase | null> => {
    if (!db) {
        db = await SQLite.openDatabaseAsync('notes.db');
        await db.execAsync('PRAGMA foreign_keys = ON;');
    }
    return db;
};

const ensureColumnExists = async (
    database: SQLite.SQLiteDatabase,
    table: string,
    column: string,
    type: string
): Promise<boolean> => {
    const columns = await database.getAllAsync<any>(`PRAGMA table_info(${table});`);
    const columnNames = columns.map((c: any) => c.name);
    const exists = columnNames.includes(column);
    if (!exists) {
        await database.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${type};`);
        return true;
    }
    return false;
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
        await database.execAsync(`
            CREATE TABLE IF NOT EXISTS note_improvements (
                id TEXT PRIMARY KEY NOT NULL,
                note_id TEXT NOT NULL,
                encrypted_content TEXT NOT NULL,
                encrypted_title TEXT,
                content_nonce TEXT,
                label TEXT,
                option_id TEXT,
                created_at TEXT,
                updated_at TEXT,
                synced INTEGER DEFAULT 0,
                dirty INTEGER DEFAULT 0,
                deleted INTEGER DEFAULT 0,
                version INTEGER DEFAULT 0,
                server_updated_at TEXT,
                FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
            );
        `);

        const addedDirty = await ensureColumnExists(database, 'notes', 'dirty', 'INTEGER DEFAULT 0');
        await ensureColumnExists(database, 'notes', 'audio_file_path', 'TEXT');
        await ensureColumnExists(database, 'notes', 'audio_duration', 'INTEGER');
        await ensureColumnExists(database, 'notes', 'encrypted_transcription', 'TEXT');
        await ensureColumnExists(database, 'notes', 'has_audio', 'INTEGER DEFAULT 0');
        await ensureColumnExists(database, 'notes', 'deleted', 'INTEGER DEFAULT 0');
        await ensureColumnExists(database, 'notes', 'version', 'INTEGER DEFAULT 0');
        await ensureColumnExists(database, 'notes', 'server_updated_at', 'TEXT');
        await ensureColumnExists(database, 'notes', 'content_nonce', 'TEXT');
        await ensureColumnExists(database, 'notes', 'pending_delete', 'INTEGER DEFAULT 0');

        await ensureColumnExists(database, 'note_improvements', 'content_nonce', 'TEXT');
        await ensureColumnExists(database, 'note_improvements', 'label', 'TEXT');
        await ensureColumnExists(database, 'note_improvements', 'option_id', 'TEXT');
        await ensureColumnExists(database, 'note_improvements', 'server_updated_at', 'TEXT');

        if (addedDirty) {
            await database.execAsync('UPDATE notes SET dirty = 1 WHERE synced = 0 OR pending_delete = 1;');
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

        await database.runAsync('DELETE FROM note_improvements WHERE note_id = ?;', [id]);
        await database.runAsync('DELETE FROM notes WHERE id = ?;', [id]);
        console.log(`[DatabaseService] Note deleted locally: ${id}`);
    } catch (error) {
        console.error(`[DatabaseService] Failed to delete note ${id}`, error);
        throw error;
    }
};

const processImprovements = async (
    rows: any[],
    includeDeleted: boolean = false
): Promise<Map<string, NoteImprovement[]>> => {
    const grouped = new Map<string, NoteImprovement[]>();
    for (const row of rows) {
        try {
            const noteId = row.note_id || row.noteId;
            if (!noteId) continue;
            const content = await decrypt(row.encrypted_content);
            const improvement: NoteImprovement = {
                id: row.id,
                note_id: noteId,
                encrypted_content: row.encrypted_content,
                encrypted_title: row.encrypted_title ?? null,
                content_nonce: row.content_nonce ?? null,
                label: row.label ?? null,
                option_id: row.option_id ?? null,
                created_at: row.created_at ?? undefined,
                updated_at: row.updated_at ?? undefined,
                deleted: row.deleted === 1,
                synced: row.synced ?? 1,
                version: row.version ?? 0,
                server_updated_at: row.server_updated_at ?? undefined,
                dirty: row.dirty === 1,
                content,
            };
            if (improvement.deleted && !includeDeleted) {
                continue;
            }
            const list = grouped.get(noteId) ?? [];
            list.push(improvement);
            grouped.set(noteId, list);
        } catch (error) {
            console.error(`[DatabaseService] Failed to decrypt improvement ${row.id}`, error);
        }
    }

    grouped.forEach(list => {
        list.sort((a, b) => {
            const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0;
            const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0;
            return bTime - aTime;
        });
    });

    return grouped;
};

export const getNotesLocal = async (): Promise<Note[]> => {
    try {
        const database = await getDb();
        if (!database) return [];

        const rows = await database.getAllAsync<any>('SELECT * FROM notes ORDER BY updated_at DESC;');
        const improvementRows = await database.getAllAsync<any>('SELECT * FROM note_improvements;');
        const groupedImprovements = await processImprovements(improvementRows);

        const notes: Note[] = [];
        for (const row of rows) {
            try {
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
                    improvements: groupedImprovements.get(row.id) ?? [],
                });
            } catch (e) {
                console.error(`[DatabaseService] Failed to decrypt note ${row.id}`, e);
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
        (note.transcription && note.transcription.toLowerCase().includes(lowerQuery)) ||
        (note.improvements && note.improvements.some(imp => imp.content?.toLowerCase().includes(lowerQuery)))
    );
};

export const wipeLocalDatabase = async (): Promise<void> => {
    try {
        await initDatabase();
        const database = await getDb();
        if (!database) return;
        await database.runAsync('DELETE FROM note_improvements;');
        await database.runAsync('DELETE FROM notes;');
        console.log('[DatabaseService] Local DB wiped');
    } catch (error) {
        console.error('[DatabaseService] Failed to wipe local DB', error);
        throw error;
    }
};

export const saveImprovementLocal = async (improvement: NoteImprovement): Promise<void> => {
    try {
        const database = await getDb();
        if (!database) return;
        await database.runAsync(
            `INSERT OR REPLACE INTO note_improvements (
                id, note_id, encrypted_content, encrypted_title, content_nonce, label, option_id,
                created_at, updated_at, synced, dirty, deleted, version, server_updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            [
                improvement.id,
                improvement.note_id,
                improvement.encrypted_content,
                improvement.encrypted_title ?? null,
                improvement.content_nonce ?? null,
                improvement.label ?? null,
                improvement.option_id ?? null,
                improvement.created_at ?? new Date().toISOString(),
                improvement.updated_at ?? new Date().toISOString(),
                improvement.synced ?? 1,
                improvement.dirty ? 1 : 0,
                improvement.deleted ? 1 : 0,
                improvement.version ?? 0,
                improvement.server_updated_at ?? improvement.updated_at ?? null,
            ]
        );
        console.log(`[DatabaseService] Improvement saved locally: ${improvement.id}`);
    } catch (error) {
        console.error(`[DatabaseService] Failed to save improvement ${improvement.id}`, error);
        throw error;
    }
};

export const deleteImprovementLocal = async (id: string): Promise<void> => {
    try {
        const database = await getDb();
        if (!database) return;
        await database.runAsync('DELETE FROM note_improvements WHERE id = ?;', [id]);
        console.log(`[DatabaseService] Improvement deleted locally: ${id}`);
    } catch (error) {
        console.error(`[DatabaseService] Failed to delete improvement ${id}`, error);
        throw error;
    }
};

export const getAllImprovementsLocal = async (): Promise<NoteImprovement[]> => {
    try {
        const database = await getDb();
        if (!database) return [];
        const rows = await database.getAllAsync<any>('SELECT * FROM note_improvements;');
        const grouped = await processImprovements(rows, true);
        return Array.from(grouped.values()).flat();
    } catch (error) {
        console.error('[DatabaseService] Failed to load improvements', error);
        throw error;
    }
};
