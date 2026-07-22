import { Platform } from 'react-native';
import * as SQLite from 'expo-sqlite';
import { Note, NoteImprovement, VoiceRecording } from '../api/notes';
import { decrypt, encrypt, getCryptoMode, isMasterCiphertext } from '../crypto/encryption';
import { hasMasterKey } from '../crypto/e2ee';

import { AudioService } from './AudioService';

const STORAGE_KEY_PREFIX = 'vaulto_notes_local_store_';

const normalizeStorageScope = (value: unknown): 'sync' | 'local_only' => {
    return value === 'local_only' ? 'local_only' : 'sync';
};

const normalizePrivacy = (value: unknown): 'normal' | 'hidden' => {
    if (value === 'hidden') return value;
    return 'normal';
};

const encryptForPrivacy = async (plaintext: string): Promise<string> => {
    if (!plaintext) return '';
    return await encrypt(plaintext);
};

const decryptByPrivacy = async (ciphertext: string): Promise<string> => {
    if (!ciphertext) return '';
    return await decrypt(ciphertext);
};

const getStorageKey = (userId: string): string => {
    return `${STORAGE_KEY_PREFIX}${userId}`;
};

// Web Store Implementation
const getWebStore = (userId: string): Note[] => {
    try {
        const stored = localStorage.getItem(getStorageKey(userId));
        if (!stored) return [];
        return JSON.parse(stored) as Note[];
    } catch (e) {
        console.error('[DatabaseService] Failed to load from localStorage', e);
        return [];
    }
};

const saveWebStore = (userId: string, notes: Note[]) => {
    try {
        localStorage.setItem(getStorageKey(userId), JSON.stringify(notes));
    } catch (e) {
        console.error('[DatabaseService] Failed to save to localStorage', e);
    }
};

const getUniqueAudioPaths = (paths: Array<string | null | undefined>): string[] => {
    return Array.from(
        new Set(paths.filter((path): path is string => typeof path === 'string' && path.length > 0))
    );
};

const purgeAudioFiles = async (paths: Array<string | null | undefined>, reason: string): Promise<void> => {
    const uniquePaths = getUniqueAudioPaths(paths);
    for (const path of uniquePaths) {
        try {
            // Critical: remove on-disk audio blobs when note/recording is deleted.
            await AudioService.deleteAudioFile(path);
        } catch (error) {
            console.warn(`[DatabaseService] Failed to delete audio file (${reason})`, path, error);
        }
    }
};

// Native Store Implementation
let db: SQLite.SQLiteDatabase | null = null;
let dbInitPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let lastHealthCheckAt = 0;
const DB_HEALTHCHECK_INTERVAL_MS = 5000;
let deletionGuardEnabled = false;

// Callback registered by SyncService to trigger an immediate re-sync
// when stuck E2EE notes are detected in local mode.
let resyncCallback: (() => void) | null = null;
export const registerResyncCallback = (cb: () => void) => { resyncCallback = cb; };

export type LocalMigrationProgress = {
    completed: number;
    total: number;
};

export const setDeletionGuard = (enabled: boolean) => {
    deletionGuardEnabled = enabled;
    console.log(`[DatabaseService] Deletion guard ${enabled ? 'ENABLED' : 'DISABLED'}`);
};

const createTables = async (database: SQLite.SQLiteDatabase) => {
    await database.runAsync(`
        CREATE TABLE IF NOT EXISTS notes (
            id TEXT PRIMARY KEY,
            user_id TEXT,
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
            deleted INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 0,
            is_pinned INTEGER DEFAULT 0,
            storage_scope TEXT DEFAULT 'sync',
            reset_archived INTEGER DEFAULT 0,
            privacy TEXT DEFAULT 'normal',
            pending_server_delete INTEGER DEFAULT 0,
            version INTEGER DEFAULT 0
        );
    `);

    await database.runAsync(`
        CREATE TABLE IF NOT EXISTS note_improvements (
            id TEXT PRIMARY KEY,
            note_id TEXT NOT NULL,
            user_id TEXT,
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
            is_active INTEGER DEFAULT 0,
            version INTEGER DEFAULT 0,
            server_updated_at TEXT,
            FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE
        );
    `);

    await database.runAsync('CREATE INDEX IF NOT EXISTS idx_note_improvements_note_id ON note_improvements(note_id);');
    await database.runAsync('CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id);');

    await database.runAsync(`
        CREATE TABLE IF NOT EXISTS voice_recordings (
            id TEXT PRIMARY KEY,
            note_id TEXT NOT NULL,
            user_id TEXT,
            file_path TEXT NOT NULL,
            duration REAL,
            transcription TEXT,
            created_at TEXT,
            iso_code TEXT,
            FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE
        );
    `);
    await database.runAsync('CREATE INDEX IF NOT EXISTS idx_voice_recordings_note_id ON voice_recordings(note_id);');
};

const openDb = async (): Promise<SQLite.SQLiteDatabase> => {
    const database = await SQLite.openDatabaseAsync('vaulto.db');
    await database.runAsync('PRAGMA foreign_keys = ON;');
    await createTables(database);

    // Migration for existing tables
    try { await database.runAsync('ALTER TABLE notes ADD COLUMN dirty INTEGER DEFAULT 0;'); } catch (e) {}
    try { await database.runAsync('ALTER TABLE notes ADD COLUMN deleted INTEGER DEFAULT 0;'); } catch (e) {}
    try { await database.runAsync('ALTER TABLE notes ADD COLUMN is_pinned INTEGER DEFAULT 0;'); } catch (e) {}
    try { await database.runAsync('ALTER TABLE notes ADD COLUMN is_active INTEGER DEFAULT 0;'); } catch (e) {}
    try { await database.runAsync("ALTER TABLE notes ADD COLUMN storage_scope TEXT DEFAULT 'sync';"); } catch (e) {}
    try { await database.runAsync('ALTER TABLE notes ADD COLUMN reset_archived INTEGER DEFAULT 0;'); } catch (e) {}
    try { await database.runAsync("ALTER TABLE notes ADD COLUMN privacy TEXT DEFAULT 'normal';"); } catch (e) {}
    try { await database.runAsync('ALTER TABLE notes ADD COLUMN pending_server_delete INTEGER DEFAULT 0;'); } catch (e) {}

    // USER ID MIGRATION
    try {
        await database.runAsync('ALTER TABLE notes ADD COLUMN user_id TEXT;');
        await database.runAsync('CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id);');
    } catch (e) {}
    try { await database.runAsync('ALTER TABLE note_improvements ADD COLUMN user_id TEXT;'); } catch (e) {}
    try { await database.runAsync('ALTER TABLE voice_recordings ADD COLUMN user_id TEXT;'); } catch (e) {}

    // VERSION MIGRATION
    try { await database.runAsync('ALTER TABLE notes ADD COLUMN version INTEGER DEFAULT 0;'); } catch (e) {}
    try { await database.runAsync('ALTER TABLE note_improvements ADD COLUMN version INTEGER DEFAULT 0;'); } catch (e) {}

    // AUDIO SYNC MIGRATION: blob upload/download state for voice notes.
    // audio_synced: local recording has been uploaded to server storage.
    // audio_remote: server storage holds a blob for this note (download source).
    // audio_sha256: hash of the plaintext audio, for change detection.
    try { await database.runAsync('ALTER TABLE notes ADD COLUMN audio_synced INTEGER DEFAULT 0;'); } catch (e) {}
    try { await database.runAsync('ALTER TABLE notes ADD COLUMN audio_remote INTEGER DEFAULT 0;'); } catch (e) {}
    try { await database.runAsync('ALTER TABLE notes ADD COLUMN audio_sha256 TEXT;'); } catch (e) {}

    return database;
};

const resetDbConnection = () => {
    db = null;
    dbInitPromise = null;
    lastHealthCheckAt = 0;
};

const isRecoverableDbError = (error: unknown): boolean => {
    const message = error instanceof Error ? error.message : String(error);
    const lowered = message.toLowerCase();
    return (
        lowered.includes('nativedatabase.prepareasync') ||
        lowered.includes('nullpointerexception') ||
        lowered.includes('database is closed') ||
        lowered.includes('failed to prepare')
    );
};

const getDb = async () => {
    if (Platform.OS === 'web') return null;
    if (!db) {
        if (!dbInitPromise) {
            dbInitPromise = openDb().catch((err) => {
                resetDbConnection();
                throw err;
            });
        }
        db = await dbInitPromise;
    }

    const now = Date.now();
    if (now - lastHealthCheckAt > DB_HEALTHCHECK_INTERVAL_MS) {
        try {
            await db.getAllAsync('SELECT 1;');
            lastHealthCheckAt = now;
        } catch (error) {
            if (isRecoverableDbError(error)) {
                console.warn('[DatabaseService] DB connection lost, reopening...', error);
                // Fully reset — must null both refs before opening new promise
                db = null;
                dbInitPromise = null;
                lastHealthCheckAt = 0;
                await new Promise<void>((resolve) => setTimeout(resolve, 200));
                dbInitPromise = openDb().catch((err) => {
                    db = null;
                    dbInitPromise = null;
                    lastHealthCheckAt = 0;
                    throw err;
                });
                db = await dbInitPromise;
                lastHealthCheckAt = Date.now();
            } else {
                throw error;
            }
        }
    }
    return db;
};

const withDbRetry = async <T>(
    label: string,
    operation: (database: SQLite.SQLiteDatabase) => Promise<T>
): Promise<T> => {
    const database = await getDb();
    if (!database) {
        throw new Error('Database unavailable');
    }
    try {
        return await operation(database);
    } catch (error) {
        if (!isRecoverableDbError(error)) {
            throw error;
        }
        console.warn(`[DatabaseService] ${label} failed, reopening database`, error);
        // Fully reset so getDb() opens a brand-new connection
        db = null;
        dbInitPromise = null;
        lastHealthCheckAt = 0;
        // Give Android's SQLite layer time to release the old handle
        await new Promise<void>((resolve) => setTimeout(resolve, 300));
        const retryDb = await getDb();
        if (!retryDb) {
            throw error;
        }
        return await operation(retryDb);
    }
};

export const initDatabase = async (): Promise<void> => {
    if (Platform.OS === 'web') return;
    try {
        await getDb();
    } catch (e) {
        console.error('[DatabaseService] Failed to init native DB', e);
    }
};

export const rescueAllNotes = async (userId: string): Promise<number> => {
    if (!userId) return 0;
    try {
        return await withDbRetry('rescue notes', async (database) => {
            const result = await database.runAsync(
                "UPDATE notes SET deleted = 0, dirty = 1, synced = 0, is_active = 1 WHERE user_id = ?",
                [userId]
            );
            await database.runAsync(
                "UPDATE note_improvements SET deleted = 0, dirty = 1, synced = 0 WHERE user_id = ?",
                [userId]
            );
            return result.changes;
        });
    } catch (e) {
        console.error('[DatabaseService] Rescue failed', e);
        return 0;
    }
};

export const decryptAndRescueAllNotes = async (
    userId: string,
    markDirty = true,
    strict = false,
): Promise<number> => {
    if (!userId) return 0;
    try {
        // Fetch RAW rows to avoid the placeholder logic in processNotes.
        const { rawNotes, rawImprovements } = await withDbRetry('get raw notes for rescue', async (database) => {
            const notes = await database.getAllAsync<any>('SELECT * FROM notes WHERE user_id = ?', [userId]);
            const imps = await database.getAllAsync<any>('SELECT * FROM note_improvements WHERE user_id = ?', [userId]);
            return { rawNotes: notes, rawImprovements: imps };
        });

        let count = 0;

        // Process each note in its own atomic UPDATE (not one big transaction).
        // This way, if the app crashes mid-way, already-processed notes keep their
        // new encryption, and on restart only unprocessed notes need re-migrating.
        for (const n of rawNotes) {
            if (!n.id) continue;
            try {
                const title = n.encrypted_title ? await decrypt(n.encrypted_title) : '';
                const content = await decrypt(n.encrypted_content);
                const transcription = n.encrypted_transcription ? await decrypt(n.encrypted_transcription) : undefined;

                const encTitle = await encrypt(title);
                const encContent = await encrypt(content);
                const encTranscription = transcription ? await encrypt(transcription) : undefined;

                await withDbRetry(`rescue note ${n.id}`, (database) => markDirty
                    ? database.runAsync(
                        "UPDATE notes SET encrypted_title = ?, encrypted_content = ?, encrypted_transcription = ?, dirty = 1, synced = 0, deleted = 0, updated_at = ? WHERE id = ? AND user_id = ?",
                        [encTitle, encContent, encTranscription ?? null, new Date().toISOString(), n.id, userId]
                    )
                    : database.runAsync(
                        "UPDATE notes SET encrypted_title = ?, encrypted_content = ?, encrypted_transcription = ? WHERE id = ? AND user_id = ?",
                        [encTitle, encContent, encTranscription ?? null, n.id, userId]
                    )
                );
                count++;
            } catch (err) {
                console.warn(`[DatabaseService] Failed to rescue note ${n.id}, skipping`, err);
                if (strict) throw err;
            }
        }

        for (const imp of rawImprovements) {
            if (!imp.id) continue;
            try {
                const title = imp.encrypted_title ? await decrypt(imp.encrypted_title) : '';
                const content = await decrypt(imp.encrypted_content);

                const encTitle = await encrypt(title);
                const encContent = await encrypt(content);

                await withDbRetry(`rescue improvement ${imp.id}`, (database) => markDirty
                    ? database.runAsync(
                        "UPDATE note_improvements SET encrypted_title = ?, encrypted_content = ?, dirty = 1, synced = 0, deleted = 0, updated_at = ? WHERE id = ? AND user_id = ?",
                        [encTitle, encContent, new Date().toISOString(), imp.id, userId]
                    )
                    : database.runAsync(
                        "UPDATE note_improvements SET encrypted_title = ?, encrypted_content = ? WHERE id = ? AND user_id = ?",
                        [encTitle, encContent, imp.id, userId]
                    )
                );
            } catch (err) {
                console.warn(`[DatabaseService] Failed to rescue improvement ${imp.id}, skipping`, err);
                if (strict) throw err;
            }
        }

        console.log(`[DatabaseService] Decrypted and rescued ${count} notes for user ${userId}`);
        return count;
    } catch (e) {
        console.error('[DatabaseService] Decrypt and rescue failed', e);
        throw e;
    }
};

export const forceReencryptionLocal = async (
    userId: string,
    onProgress?: (progress: LocalMigrationProgress) => void,
): Promise<number> => {
    if (!userId) return 0;
    try {
        const { rawNotes, rawImprovements } = await withDbRetry('get raw notes for re-encryption', async (database) => {
            const notes = await database.getAllAsync<any>('SELECT * FROM notes WHERE user_id = ?', [userId]);
            const imps = await database.getAllAsync<any>('SELECT * FROM note_improvements WHERE user_id = ?', [userId]);
            return { rawNotes: notes, rawImprovements: imps };
        });

        const notesToProcess = rawNotes.filter((n: any) => !!n.id);
        const improvementsToProcess = rawImprovements.filter((imp: any) => !!imp.id);
        const total = notesToProcess.length + improvementsToProcess.length;
        let completed = 0;
        let count = 0;
        const reportProgress = () => {
            onProgress?.({ completed, total });
        };

        reportProgress();

        // Each note is updated atomically and independently.
        // If the app crashes mid-loop, only already-processed notes are changed.
        // On restart, unprocessed notes still have the old prefix and will be retried.
        for (const n of notesToProcess) {
            try {
                const title = n.encrypted_title ? await decrypt(n.encrypted_title) : '';
                const content = await decrypt(n.encrypted_content);
                const transcription = n.encrypted_transcription ? await decrypt(n.encrypted_transcription) : undefined;

                const encTitle = await encrypt(title);
                const encContent = await encrypt(content);
                const encTranscription = transcription ? await encrypt(transcription) : undefined;

                await withDbRetry(`re-encrypt note ${n.id}`, (database) =>
                    database.runAsync(
                        "UPDATE notes SET encrypted_title = ?, encrypted_content = ?, encrypted_transcription = ?, dirty = 1, synced = 0, updated_at = ? WHERE id = ? AND user_id = ?",
                        [encTitle, encContent, encTranscription ?? null, new Date().toISOString(), n.id, userId]
                    )
                );
                count++;
            } catch (err) {
                console.warn(`[DatabaseService] Failed to re-encrypt note ${n.id}, skipping`, err);
            } finally {
                completed++;
                reportProgress();
            }
        }

        for (const imp of improvementsToProcess) {
            try {
                const title = imp.encrypted_title ? await decrypt(imp.encrypted_title) : '';
                const content = await decrypt(imp.encrypted_content);

                const encTitle = await encrypt(title);
                const encContent = await encrypt(content);

                await withDbRetry(`re-encrypt improvement ${imp.id}`, (database) =>
                    database.runAsync(
                        "UPDATE note_improvements SET encrypted_title = ?, encrypted_content = ?, dirty = 1, synced = 0, updated_at = ? WHERE id = ? AND user_id = ?",
                        [encTitle, encContent, new Date().toISOString(), imp.id, userId]
                    )
                );
            } catch (err) {
                console.warn(`[DatabaseService] Failed to re-encrypt improvement ${imp.id}, skipping`, err);
            } finally {
                completed++;
                reportProgress();
            }
        }

        console.log(`[DatabaseService] Re-encrypted ${count} notes for user ${userId}`);
        return count;
    } catch (e) {
        console.error('[DatabaseService] Force re-encryption failed', e);
        throw e;
    }
};

export const saveNoteLocal = async (userId: string, note: Note): Promise<void> => {
    if (!userId || !note || !note.id) return;

    if (Platform.OS === 'web') {
        const requestedPrivacy = normalizePrivacy(note.privacy);
        const notes = getWebStore(userId);
        const index = notes.findIndex(n => n.id === note.id);
        const storageScope = normalizeStorageScope(note.storage_scope);
        const encryptedTitle = (typeof note.title === 'string' && (note.title.length > 0 || !note.encrypted_title))
            ? await encryptForPrivacy(note.title)
            : note.encrypted_title;
        const encryptedContent = (typeof note.content === 'string' && (note.content.length > 0 || !note.encrypted_content))
            ? await encryptForPrivacy(note.content)
            : note.encrypted_content;
        const encryptedTranscription = (typeof note.transcription === 'string' && (note.transcription.length > 0 || !note.encrypted_transcription))
            ? await encryptForPrivacy(note.transcription)
            : note.encrypted_transcription;

        const normalizedNote = {
            ...note,
            encrypted_title: encryptedTitle,
            encrypted_content: encryptedContent,
            encrypted_transcription: encryptedTranscription,
            dirty: note.dirty ?? false,
            deleted: note.deleted ?? false,
            version: note.version ?? (index >= 0 ? notes[index].version ?? 0 : 0),
            storage_scope: storageScope,
            privacy: requestedPrivacy,
            synced: note.synced ?? 1,
        } as Note;

        const safeNote = { ...normalizedNote };
        delete (safeNote as any).title;
        delete (safeNote as any).content;
        delete (safeNote as any).transcription;

        if (index >= 0) {
            notes[index] = { ...notes[index], ...safeNote };
        } else {
            notes.push(safeNote);
        }
        saveWebStore(userId, notes);
        return;
    }

    try {
        const privacy = normalizePrivacy(note.privacy);
        const storageScope = normalizeStorageScope(note.storage_scope);
        const isDirty = note.dirty ? 1 : 0;
        const isDeleted = note.deleted || note.pending_delete ? 1 : 0;
        const isActive = note.is_active ? 1 : 0;
        const pendingServerDelete = note.pending_server_delete ? 1 : 0;

        const encryptedTitle = (typeof note.title === 'string' && (note.title.length > 0 || !note.encrypted_title))
            ? await encryptForPrivacy(note.title)
            : note.encrypted_title;
        const encryptedContent = (typeof note.content === 'string' && (note.content.length > 0 || !note.encrypted_content))
            ? await encryptForPrivacy(note.content)
            : note.encrypted_content;
        const encryptedTranscription = (typeof note.transcription === 'string' && (note.transcription.length > 0 || !note.encrypted_transcription))
            ? await encryptForPrivacy(note.transcription)
            : note.encrypted_transcription;

        await withDbRetry('save note', (database) => (
            database.runAsync(
                `INSERT INTO notes (
                    id, user_id, encrypted_title, encrypted_content, created_at, updated_at,
                    audio_file_path, audio_duration, encrypted_transcription, has_audio, is_pinned, synced, dirty, deleted, is_active,
                    storage_scope, reset_archived, privacy, pending_server_delete, version, audio_synced, audio_remote, audio_sha256
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    user_id=excluded.user_id,
                    encrypted_title=excluded.encrypted_title,
                    encrypted_content=excluded.encrypted_content,
                    updated_at=excluded.updated_at,
                    audio_file_path=excluded.audio_file_path,
                    audio_duration=excluded.audio_duration,
                    encrypted_transcription=excluded.encrypted_transcription,
                    has_audio=excluded.has_audio,
                    is_pinned=excluded.is_pinned,
                    synced=excluded.synced,
                    dirty=excluded.dirty,
                    deleted=excluded.deleted,
                    is_active=excluded.is_active,
                    storage_scope=excluded.storage_scope,
                    reset_archived=excluded.reset_archived,
                    privacy=excluded.privacy,
                    pending_server_delete=excluded.pending_server_delete,
                    version=excluded.version,
                    -- A different recording invalidates the upload state no matter
                    -- what the caller passed (UI paths just spread the old note).
                    audio_synced=CASE WHEN excluded.audio_file_path IS notes.audio_file_path THEN excluded.audio_synced ELSE 0 END,
                    audio_sha256=CASE WHEN excluded.audio_file_path IS notes.audio_file_path THEN excluded.audio_sha256 ELSE NULL END,
                    audio_remote=excluded.audio_remote
                `,
                [
                    note.id, userId, encryptedTitle || '', encryptedContent,
                    note.created_at || new Date().toISOString(), note.updated_at || new Date().toISOString(),
                    note.audio_file_path || null, note.audio_duration || 0,
                    encryptedTranscription || null, note.has_audio ? 1 : 0, note.is_pinned ? 1 : 0,
                    note.synced ?? 1, isDirty, isDeleted, isActive, storageScope, note.reset_archived ? 1 : 0, privacy, pendingServerDelete,
                    note.version ?? 0,
                    note.audio_synced ?? 0, note.audio_remote ?? 0, note.audio_sha256 ?? null
                ]
            )
        ));
    } catch (e) {
        console.error('[DatabaseService] Failed to save note', e);
    }
};

/**
 * Direct update of the audio blob sync state, bypassing saveNoteLocal's
 * "path changed → reset" heuristic (which would wrongly clear the state the
 * sync engine just recorded for a freshly downloaded/uploaded file).
 */
export const setNoteAudioSyncState = async (
    userId: string,
    noteId: string,
    state: {
        audio_file_path?: string | null;
        audio_synced?: number;
        audio_remote?: number;
        audio_sha256?: string | null;
        has_audio?: boolean;
        audio_duration?: number | null;
    }
): Promise<void> => {
    if (Platform.OS === 'web') return;
    const assignments: string[] = [];
    const params: any[] = [];
    if (state.audio_file_path !== undefined) { assignments.push('audio_file_path = ?'); params.push(state.audio_file_path || null); }
    if (state.audio_synced !== undefined) { assignments.push('audio_synced = ?'); params.push(state.audio_synced); }
    if (state.audio_remote !== undefined) { assignments.push('audio_remote = ?'); params.push(state.audio_remote); }
    if (state.audio_sha256 !== undefined) { assignments.push('audio_sha256 = ?'); params.push(state.audio_sha256); }
    if (state.has_audio !== undefined) { assignments.push('has_audio = ?'); params.push(state.has_audio ? 1 : 0); }
    if (state.audio_duration !== undefined) { assignments.push('audio_duration = ?'); params.push(state.audio_duration ?? 0); }
    if (assignments.length === 0) return;
    params.push(noteId, userId);
    try {
        await withDbRetry('set audio sync state', (database) => (
            database.runAsync(`UPDATE notes SET ${assignments.join(', ')} WHERE id = ? AND user_id = ?`, params)
        ));
    } catch (e) {
        console.error('[DatabaseService] Failed to set audio sync state', e);
    }
};

export const deleteNoteLocal = async (userId: string, id: string): Promise<void> => {
    if (!userId || !id) return;
    if (Platform.OS === 'web') {
        let notes = getWebStore(userId);
        const toDeleteIds = new Set([id]);
        notes.forEach(n => { if (n.parent_id === id) toDeleteIds.add(n.id); });
        notes = notes.filter(n => !toDeleteIds.has(n.id));
        saveWebStore(userId, notes);
        return;
    }

    if (deletionGuardEnabled) return;

    try {
        await withDbRetry('soft delete note', async (database) => {
            await database.runAsync(
                'UPDATE notes SET deleted = 1, synced = 0, dirty = 1, updated_at = ? WHERE id = ? AND user_id = ?',
                [new Date().toISOString(), id, userId]
            );
            await database.runAsync('UPDATE note_improvements SET deleted = 1, synced = 0, dirty = 1 WHERE note_id = ? AND user_id = ?', [id, userId]);
        });
    } catch (e) {
        console.error('[DatabaseService] Failed to soft-delete note', e);
    }
};

export const hardDeleteNoteLocal = async (userId: string, id: string): Promise<void> => {
    if (!userId || !id) return;
    if (Platform.OS === 'web') return;
    try {
        await withDbRetry('hard delete note', (database) => (
            database.runAsync('DELETE FROM notes WHERE id = ? AND user_id = ?', [id, userId])
        ));
    } catch (e) {
        console.error('[DatabaseService] Failed to hard-delete note', e);
    }
};

export const hardDeleteImprovementLocal = async (userId: string, id: string): Promise<void> => {
    if (!userId || !id) return;
    if (Platform.OS === 'web') return;
    try {
        await withDbRetry('hard delete improvement', (database) => (
            database.runAsync('DELETE FROM note_improvements WHERE id = ? AND user_id = ?', [id, userId])
        ));
    } catch (e) {
        console.error('[DatabaseService] Failed to hard-delete improvement', e);
    }
};

export const saveImprovementLocal = async (userId: string, improvement: NoteImprovement): Promise<void> => {
    if (!userId || !improvement || !improvement.id) return;
    if (Platform.OS === 'web') {
        const notes = getWebStore(userId);
        const index = notes.findIndex(n => n.id === improvement.id);
        const childNote: Note = {
            ...improvement,
            parent_id: improvement.note_id,
            encrypted_title: improvement.encrypted_title || undefined,
            title: improvement.title || undefined,
            is_active: !!improvement.is_active,
            privacy: 'normal',
            storage_scope: 'sync',
        } as any;
        const safeChild = { ...childNote };
        delete (safeChild as any).content;
        if (index >= 0) { notes[index] = { ...notes[index], ...safeChild }; }
        else { notes.push(safeChild); }
        saveWebStore(userId, notes);
        return;
    }

    try {
        const isDirty = improvement.dirty ? 1 : 0;
        const isDeleted = improvement.deleted ? 1 : 0;
        const isActive = improvement.is_active ? 1 : 0;

        await withDbRetry('save improvement', (database) => (
            database.runAsync(
                `INSERT INTO note_improvements (
                    id, note_id, user_id, encrypted_content, encrypted_title, content_nonce, label, option_id,
                    created_at, updated_at, synced, dirty, deleted, version, server_updated_at, is_active
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    note_id=excluded.note_id, user_id=excluded.user_id,
                    encrypted_content=excluded.encrypted_content, encrypted_title=excluded.encrypted_title,
                    content_nonce=excluded.content_nonce, label=excluded.label, option_id=excluded.option_id,
                    created_at=excluded.created_at, updated_at=excluded.updated_at, synced=excluded.synced,
                    dirty=excluded.dirty, deleted=excluded.deleted, version=excluded.version,
                    server_updated_at=excluded.server_updated_at, is_active=excluded.is_active
                `,
                [
                    improvement.id, improvement.note_id, userId, improvement.encrypted_content, improvement.encrypted_title || null,
                    improvement.content_nonce || null, improvement.label || null, improvement.option_id || null,
                    improvement.created_at || new Date().toISOString(), improvement.updated_at || new Date().toISOString(),
                    improvement.synced ?? 1, isDirty, isDeleted, improvement.version ?? 0, improvement.server_updated_at || null, isActive
                ]
            )
        ));
    } catch (e) {
        console.error('[DatabaseService] Failed to save improvement', e);
    }
};

export const getNotesLocal = async (userId: string): Promise<Note[]> => {
    if (!userId) return [];
    if (Platform.OS === 'web') {
        const allNotes = getWebStore(userId);
        const processed = await Promise.all(allNotes.map(async (n): Promise<Note | null> => {
            try {
                return {
                    ...n,
                    title: n.encrypted_title ? await decryptByPrivacy(n.encrypted_title) : '',
                    content: await decryptByPrivacy(n.encrypted_content),
                    transcription: n.encrypted_transcription ? await decryptByPrivacy(n.encrypted_transcription) : undefined,
                };
            } catch { return null; }
        }));
        const valid = processed.filter((n): n is Note => n !== null);
        const parents = valid.filter(n => !n.parent_id);
        const children = valid.filter(n => !!n.parent_id);
        const childrenMap = new Map<string, Note[]>();
        children.forEach(c => { const list = childrenMap.get(c.parent_id!) ?? []; list.push(c); childrenMap.set(c.parent_id!, list); });
        return parents.map(p => ({ ...p, improvements: childrenMap.get(p.id) || [] }))
            .sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());
    }

    try {
        const { rawNotes, rawImprovements, allVoice } = await withDbRetry('get notes', async (database) => {
            const notes = await database.getAllAsync<any>('SELECT * FROM notes WHERE user_id = ? ORDER BY updated_at DESC', [userId]);
            const imps = await database.getAllAsync<any>('SELECT * FROM note_improvements WHERE user_id = ?', [userId]);
            const voice = await database.getAllAsync<VoiceRecording>('SELECT * FROM voice_recordings WHERE user_id = ?', [userId]);
            return { rawNotes: notes, rawImprovements: imps, allVoice: voice };
        });

        const improvementsMap = await processImprovements(rawImprovements);
        const voiceMap = new Map<string, VoiceRecording[]>();
        allVoice.forEach(v => { const list = voiceMap.get(v.note_id) ?? []; list.push(v); voiceMap.set(v.note_id, list); });
        const { notes, hasStuckE2EE } = await processNotes(rawNotes, improvementsMap, voiceMap);

        // If stuck E2EE notes were found in local mode, trigger an immediate
        // re-sync so the server provides the plaintext version without delay.
        if (hasStuckE2EE && resyncCallback) {
            resyncCallback();
        }

        return notes;
    } catch (e) {
        console.error('[DatabaseService] Failed to get notes', e);
        return [];
    }
};

export const getAllImprovementsLocal = async (userId: string): Promise<NoteImprovement[]> => {
    if (!userId) return [];
    if (Platform.OS === 'web') {
        const allNotes = getWebStore(userId);
        return allNotes.filter(n => n.parent_id) as any[];
    }
    try {
        const raw = await withDbRetry('get improvements', (database) => (
            database.getAllAsync<any>('SELECT * FROM note_improvements WHERE user_id = ?', [userId])
        ));
        const map = await processImprovements(raw, true);
        return Array.from(map.values()).flat();
    } catch (e) {
        console.error('[DatabaseService] Failed to fetch improvements', e);
        return [];
    }
};

const processImprovements = async (rawImprovements: any[], includeDeleted: boolean = false): Promise<Map<string, NoteImprovement[]>> => {
    const grouped = new Map<string, NoteImprovement[]>();
    for (const imp of rawImprovements) {
        try {
            const content = await decryptByPrivacy(imp.encrypted_content);
            const title = imp.encrypted_title ? await decryptByPrivacy(imp.encrypted_title) : '';
            const improvement: NoteImprovement = {
                ...imp, title, content,
                deleted: !!imp.deleted, dirty: !!imp.dirty, synced: imp.synced ?? 1,
            };
            if (improvement.deleted && !includeDeleted) continue;
            const list = grouped.get(improvement.note_id) ?? [];
            list.push(improvement);
            grouped.set(improvement.note_id, list);
        } catch (e) { console.error(`[DatabaseService] Failed to decrypt improvement ${imp.id}`, e); }
    }
    return grouped;
};

const processNotes = async (
    rawNotes: any[],
    improvements: Map<string, NoteImprovement[]>,
    voiceRecordings: Map<string, VoiceRecording[]>
): Promise<{ notes: Note[]; hasStuckE2EE: boolean }> => {
    let hasStuckE2EE = false;
    const notes = await Promise.all(rawNotes.map(async (n): Promise<Note | null> => {
        const baseNote = {
            ...n,
            has_audio: !!n.has_audio,
            is_pinned: !!n.is_pinned,
            synced: n.synced ?? 1,
            dirty: !!n.dirty,
            deleted: !!n.deleted,
            version: n.version ?? 0,
            pending_delete: !!n.deleted || !!n.pending_delete,
            storage_scope: normalizeStorageScope(n.storage_scope),
            reset_archived: !!n.reset_archived,
            privacy: normalizePrivacy(n.privacy),
            improvements: improvements.get(n.id) || [],
            voice_files: voiceRecordings.get(n.id) || [],
        };

        try {
            const [title, content, transcription] = await Promise.all([
                n.encrypted_title ? decryptByPrivacy(n.encrypted_title) : Promise.resolve(''),
                decryptByPrivacy(n.encrypted_content),
                n.encrypted_transcription ? decryptByPrivacy(n.encrypted_transcription) : Promise.resolve(undefined)
            ]);
            return { ...baseNote, title, content, transcription };
        } catch (e: any) {
            const isLocked = e?.message === 'E2EE locked' || e?.message === 'Master key missing';
            const currentMode = getCryptoMode();
            const masterKeyAvailable = hasMasterKey();

            // Case 1: local mode but note has master-key prefix (incomplete migration).
            // Mark dirty so it gets fetched fresh from server on next sync.
            if (isLocked && currentMode === 'local' && !masterKeyAvailable) {
                const rawContent = n.encrypted_content || '';
                if (isMasterCiphertext(rawContent)) {
                    console.warn(`[processNotes] Note ${n.id} has E2EE prefix in local mode — marking dirty for re-sync`);
                    hasStuckE2EE = true;
                    void withDbRetry(`mark note ${n.id} dirty`, (database) =>
                        database.runAsync('UPDATE notes SET dirty = 1, synced = 0 WHERE id = ?', [n.id])
                    ).catch(() => {});
                    return { ...baseNote, title: '', content: '', transcription: undefined };
                }
            }

            // Case 2: E2EE locked (user hasn't entered passphrase yet)
            if (isLocked && currentMode === 'e2ee') {
                return { ...baseNote, title: '', content: '', transcription: undefined } as any;
            }

            // Case 3: Genuine decryption error (corrupted data)
            const message = (e?.message || '').toLowerCase();
            const isExpected = 
                message.includes('invalid tag') || 
                message.includes('ghash tag') ||
                message.includes('invalid ciphertext');

            if (!isExpected) {
                console.error(`[processNotes] Failed to decrypt note ${n.id}:`, e);
            }
            return {
                ...baseNote,
                title: '[Encrypted]',
                content: '[Encrypted]',
                transcription: n.encrypted_transcription ? '[Encrypted]' : undefined,
            } as any;
        }
    }));
    const sorted = (notes.filter(n => n !== null) as Note[])
        .sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());
    return { notes: sorted, hasStuckE2EE };
};

export const searchNotesLocal = async (userId: string, query: string): Promise<Note[]> => {
    const allNotes = await getNotesLocal(userId);
    if (!query) return allNotes;
    const lowerQuery = query.toLowerCase();
    return allNotes.filter(note =>
        (note.title?.toLowerCase().includes(lowerQuery)) ||
        (note.content?.toLowerCase().includes(lowerQuery)) ||
        (note.transcription?.toLowerCase().includes(lowerQuery)) ||
        (note.improvements?.some(imp => imp.content?.toLowerCase().includes(lowerQuery)))
    );
};

export const getNoteById = async (userId: string, id: string): Promise<Note | null> => {
    if (Platform.OS === 'web') {
        const allNotes = await getNotesLocal(userId);
        return allNotes.find(n => n.id === id) || null;
    }
    try {
        const { rawNote, rawImprovements, voiceRecordings } = await withDbRetry('get note by id', async (database) => {
            const note = await database.getFirstAsync<any>('SELECT * FROM notes WHERE id = ? AND user_id = ?', [id, userId]);
            if (!note) return { rawNote: null, rawImprovements: [], voiceRecordings: [] };
            const imps = await database.getAllAsync<any>('SELECT * FROM note_improvements WHERE note_id = ?', [id]);
            const voice = await database.getAllAsync<VoiceRecording>('SELECT * FROM voice_recordings WHERE note_id = ?', [id]);
            return { rawNote: note, rawImprovements: imps, voiceRecordings: voice };
        });
        if (!rawNote) return null;
        const impsMap = await processImprovements(rawImprovements);
        const voiceMap = new Map([[id, voiceRecordings]]);
        const processed = await processNotes([rawNote], impsMap, voiceMap);
        return processed.notes[0] || null;
    } catch (e) { return null; }
};

export const wipeLocalDatabase = async (): Promise<void> => {
    if (Platform.OS === 'web') {
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (key?.startsWith(STORAGE_KEY_PREFIX)) localStorage.removeItem(key);
        }
        return;
    }
    try {
        const audioPaths = await withDbRetry('wipe (collect)', async (database) => {
            const notes = await database.getAllAsync<{ audio_file_path: string | null }>("SELECT audio_file_path FROM notes WHERE audio_file_path IS NOT NULL AND audio_file_path != ''");
            const voice = await database.getAllAsync<{ file_path: string }>("SELECT file_path FROM voice_recordings WHERE file_path IS NOT NULL AND file_path != ''");
            return [...notes.map(r => r.audio_file_path), ...voice.map(r => r.file_path)];
        });
        await purgeAudioFiles(audioPaths, 'wipe');
        await withDbRetry('wipe (delete)', async (database) => {
            await database.runAsync('DELETE FROM voice_recordings;');
            await database.runAsync('DELETE FROM note_improvements;');
            await database.runAsync('DELETE FROM notes;');
        });
    } catch (e) { throw e; }
};

/**
 * Preserve readable notes from an older, remotely reset encrypted vault.
 * They become an explicitly local-only archive and therefore cannot be
 * uploaded by normal sync, even if the user later enables the sync toggle.
 */
export const archiveSyncedNotesAfterReset = async (userId: string): Promise<number> => {
    if (!userId) return 0;
    if (Platform.OS === 'web') {
        const notes = getWebStore(userId);
        let archived = 0;
        const retained = notes.flatMap((note) => {
            if (normalizeStorageScope(note.storage_scope) !== 'sync') return [note];
            if (note.deleted || note.pending_delete) return [];
            archived += 1;
            return [{
                ...note,
                storage_scope: 'local_only' as const,
                reset_archived: true,
                dirty: false,
                synced: 0,
                pending_server_delete: false,
            }];
        });
        saveWebStore(userId, retained);
        return archived;
    }

    return await withDbRetry('archive reset vault', async (database) => {
        // User-deleted rows are not useful recovery material and must not be
        // turned back into visible notes by the archive operation.
        await database.runAsync(
            "DELETE FROM notes WHERE user_id = ? AND (storage_scope IS NULL OR storage_scope = 'sync') AND deleted = 1",
            [userId],
        );
        const result = await database.runAsync(
            `UPDATE notes
             SET storage_scope = 'local_only', reset_archived = 1,
                 dirty = 0, synced = 0, pending_server_delete = 0
             WHERE user_id = ?
               AND (storage_scope IS NULL OR storage_scope = 'sync')
               AND deleted = 0`,
            [userId],
        );
        await database.runAsync(
            `UPDATE note_improvements
             SET dirty = 0, synced = 0
             WHERE user_id = ?
               AND note_id IN (
                   SELECT id FROM notes WHERE user_id = ? AND reset_archived = 1
               )`,
            [userId, userId],
        );
        return result.changes;
    });
};

/** Promote only the reset archive back into sync after explicit consent. */
export const promoteResetArchiveToSync = async (userId: string): Promise<number> => {
    if (!userId) return 0;
    if (Platform.OS === 'web') {
        let promoted = 0;
        const notes = getWebStore(userId).map((note) => {
            if (!note.reset_archived) return note;
            promoted += 1;
            return {
                ...note,
                storage_scope: 'sync' as const,
                reset_archived: false,
                dirty: true,
                synced: 0,
            };
        });
        saveWebStore(userId, notes);
        return promoted;
    }

    return await withDbRetry('promote reset archive', async (database) => {
        await database.runAsync(
            `UPDATE note_improvements
             SET dirty = 1, synced = 0
             WHERE user_id = ?
               AND note_id IN (
                   SELECT id FROM notes WHERE user_id = ? AND reset_archived = 1
               )`,
            [userId, userId],
        );
        const result = await database.runAsync(
            `UPDATE notes
             SET storage_scope = 'sync', reset_archived = 0,
                 dirty = 1, synced = 0, audio_synced = 0
             WHERE user_id = ? AND reset_archived = 1`,
            [userId],
        );
        return result.changes;
    });
};

/** Keep recovered rows local permanently and dismiss the recovery marker. */
export const finalizeResetArchiveAsLocal = async (userId: string): Promise<number> => {
    if (!userId) return 0;
    if (Platform.OS === 'web') {
        let finalized = 0;
        const notes = getWebStore(userId).map((note) => {
            if (!note.reset_archived) return note;
            finalized += 1;
            return { ...note, reset_archived: false, storage_scope: 'local_only' as const };
        });
        saveWebStore(userId, notes);
        return finalized;
    }
    return await withDbRetry('finalize reset archive', async (database) => {
        const result = await database.runAsync(
            `UPDATE notes SET reset_archived = 0
             WHERE user_id = ? AND reset_archived = 1`,
            [userId],
        );
        return result.changes;
    });
};

/** Delete only sync-scoped rows for one account; preserve local-only notes. */
export const purgeSyncedNotesForUser = async (userId: string): Promise<number> => {
    if (!userId) return 0;
    if (Platform.OS === 'web') {
        const notes = getWebStore(userId);
        const retained = notes.filter(
            (note) => normalizeStorageScope(note.storage_scope) === 'local_only',
        );
        saveWebStore(userId, retained);
        return notes.length - retained.length;
    }

    const audioPaths = await withDbRetry('purge synced notes (collect)', async (database) => {
        const noteAudio = await database.getAllAsync<{ audio_file_path: string | null }>(
            `SELECT audio_file_path FROM notes
             WHERE user_id = ?
               AND (storage_scope IS NULL OR storage_scope = 'sync')
               AND audio_file_path IS NOT NULL AND audio_file_path != ''`,
            [userId],
        );
        const voiceAudio = await database.getAllAsync<{ file_path: string }>(
            `SELECT vr.file_path FROM voice_recordings vr
             JOIN notes n ON n.id = vr.note_id AND n.user_id = vr.user_id
             WHERE n.user_id = ?
               AND (n.storage_scope IS NULL OR n.storage_scope = 'sync')
               AND vr.file_path IS NOT NULL AND vr.file_path != ''`,
            [userId],
        );
        return [
            ...noteAudio.map((row) => row.audio_file_path),
            ...voiceAudio.map((row) => row.file_path),
        ];
    });
    await purgeAudioFiles(audioPaths, 'encrypted vault reset');

    return await withDbRetry('purge synced notes (delete)', async (database) => {
        const result = await database.runAsync(
            `DELETE FROM notes
             WHERE user_id = ?
               AND (storage_scope IS NULL OR storage_scope = 'sync')`,
            [userId],
        );
        return result.changes;
    });
};

/**
 * Remove local-only rows that are still protected by a master key which is no
 * longer available during a forgotten-passphrase reset. Keeping those rows
 * would misleadingly show blank/locked notes after the key bundle is erased.
 * Device-key local-only rows are preserved.
 */
export const purgeUnreadableLocalOnlyNotesForUser = async (userId: string): Promise<number> => {
    if (!userId) return 0;
    if (Platform.OS === 'web') {
        const notes = getWebStore(userId);
        const unreadable = (note: Note) => (
            normalizeStorageScope(note.storage_scope) === 'local_only'
            && [note.encrypted_title, note.encrypted_content, note.encrypted_transcription]
                .some((value) => typeof value === 'string' && isMasterCiphertext(value))
        );
        const retained = notes.filter((note) => !unreadable(note));
        saveWebStore(userId, retained);
        return notes.length - retained.length;
    }

    const masterCipherPredicate = `(
        encrypted_title LIKE 'v3m.%' OR encrypted_title LIKE 'v3.%'
        OR encrypted_title LIKE 'v2m.%' OR encrypted_title LIKE 'v2.%'
        OR encrypted_content LIKE 'v3m.%' OR encrypted_content LIKE 'v3.%'
        OR encrypted_content LIKE 'v2m.%' OR encrypted_content LIKE 'v2.%'
        OR encrypted_transcription LIKE 'v3m.%' OR encrypted_transcription LIKE 'v3.%'
        OR encrypted_transcription LIKE 'v2m.%' OR encrypted_transcription LIKE 'v2.%'
    )`;

    const audioPaths = await withDbRetry('purge unreadable local notes (collect)', async (database) => {
        const noteAudio = await database.getAllAsync<{ audio_file_path: string | null }>(
            `SELECT audio_file_path FROM notes
             WHERE user_id = ? AND storage_scope = 'local_only'
               AND ${masterCipherPredicate}
               AND audio_file_path IS NOT NULL AND audio_file_path != ''`,
            [userId],
        );
        const voiceAudio = await database.getAllAsync<{ file_path: string }>(
            `SELECT vr.file_path FROM voice_recordings vr
             JOIN notes n ON n.id = vr.note_id AND n.user_id = vr.user_id
             WHERE n.user_id = ? AND n.storage_scope = 'local_only'
               AND ${masterCipherPredicate.replaceAll('encrypted_', 'n.encrypted_')}
               AND vr.file_path IS NOT NULL AND vr.file_path != ''`,
            [userId],
        );
        return [
            ...noteAudio.map((row) => row.audio_file_path),
            ...voiceAudio.map((row) => row.file_path),
        ];
    });
    await purgeAudioFiles(audioPaths, 'unreadable local-only reset data');

    return await withDbRetry('purge unreadable local notes (delete)', async (database) => {
        const result = await database.runAsync(
            `DELETE FROM notes
             WHERE user_id = ? AND storage_scope = 'local_only'
               AND ${masterCipherPredicate}`,
            [userId],
        );
        return result.changes;
    });
};

export const markAllDirty = async (userId: string): Promise<void> => {
    if (!userId) return;
    if (Platform.OS === 'web') {
        const updated = getWebStore(userId).map(n => ({ ...n, dirty: normalizeStorageScope(n.storage_scope) === 'sync', synced: 0 }));
        saveWebStore(userId, updated);
        return;
    }
    try {
        await withDbRetry('mark dirty', async (database) => {
            // audio_synced is reset too: mark-all-dirty runs on encryption mode /
            // key-epoch transitions, after which every blob must be re-uploaded
            // under the new scheme.
            await database.runAsync("UPDATE notes SET dirty = 1, synced = 0, audio_synced = 0 WHERE user_id = ? AND (storage_scope IS NULL OR storage_scope = 'sync')", [userId]);
            await database.runAsync('UPDATE note_improvements SET dirty = 1, synced = 0 WHERE user_id = ?', [userId]);
        });
    } catch (e) {}
};

export const getVoiceRecordingsLocal = async (userId: string, noteId: string): Promise<VoiceRecording[]> => {
    if (Platform.OS === 'web') return [];
    try {
        return await withDbRetry('get voice', (database) => (
            database.getAllAsync<VoiceRecording>('SELECT * FROM voice_recordings WHERE note_id = ? AND user_id = ? ORDER BY created_at DESC', [noteId, userId])
        ));
    } catch (e) { return []; }
};

export const saveVoiceRecordingLocal = async (userId: string, recording: VoiceRecording): Promise<void> => {
    if (Platform.OS === 'web') return;
    try {
        await withDbRetry('save voice', (database) => (
            database.runAsync(
                `INSERT INTO voice_recordings (id, note_id, user_id, file_path, duration, transcription, created_at, iso_code)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id, file_path=excluded.file_path, transcription=excluded.transcription, iso_code=excluded.iso_code`,
                [recording.id, recording.note_id, userId, recording.file_path, recording.duration, recording.transcription || null, recording.created_at, recording.iso_code || null]
            )
        ));
    } catch (e) {}
};

export const deleteVoiceRecordingLocal = async (userId: string, id: string): Promise<void> => {
    if (Platform.OS === 'web') return;
    try {
        const paths = await withDbRetry('delete voice', async (database) => {
            const rows = await database.getAllAsync<{ file_path: string | null }>('SELECT file_path FROM voice_recordings WHERE id = ? AND user_id = ?', [id, userId]);
            await database.runAsync('DELETE FROM voice_recordings WHERE id = ? AND user_id = ?', [id, userId]);
            return rows.map(r => r.file_path);
        });
        await purgeAudioFiles(paths, 'delete voice');
    } catch (e) {}
};

export const setActiveVariant = async (userId: string, parentNoteId: string, activeChildId: string | null): Promise<void> => {
    if (Platform.OS === 'web') {
        const notes = getWebStore(userId);
        const parent = notes.find(n => n.id === parentNoteId);
        if (!parent) return;
        if (activeChildId === null) {
            parent.is_active = true;
            notes.forEach(n => { if (n.parent_id === parentNoteId) n.is_active = false; });
        } else {
            parent.is_active = false;
            notes.forEach(n => { if (n.parent_id === parentNoteId) n.is_active = (n.id === activeChildId); });
        }
        saveWebStore(userId, notes);
        return;
    }
    try {
        await withDbRetry('set active', (database) => (
            database.withTransactionAsync(async () => {
                await database.runAsync('UPDATE notes SET is_active = 0, dirty = 1, updated_at = ? WHERE id = ? AND user_id = ?', [new Date().toISOString(), parentNoteId, userId]);
                await database.runAsync('UPDATE note_improvements SET is_active = 0, dirty = 1, updated_at = ? WHERE note_id = ? AND user_id = ?', [new Date().toISOString(), parentNoteId, userId]);
                if (activeChildId) await database.runAsync('UPDATE note_improvements SET is_active = 1, dirty = 1, updated_at = ? WHERE id = ? AND user_id = ?', [new Date().toISOString(), activeChildId, userId]);
                else await database.runAsync('UPDATE notes SET is_active = 1, dirty = 1, updated_at = ? WHERE id = ? AND user_id = ?', [new Date().toISOString(), parentNoteId, userId]);
            })
        ));
    } catch (e) {}
};

export const migrateGuestData = async (fromUserId: string, toUserId: string): Promise<void> => {
    if (!fromUserId || !toUserId || fromUserId === toUserId) return;
    if (Platform.OS === 'web') {
        const guest = getWebStore(fromUserId);
        if (guest.length === 0) return;
        const target = getWebStore(toUserId);
        const targetIds = new Set(target.map(n => n.id));
        const merged = [...target, ...guest.filter(n => !targetIds.has(n.id)).map(n => ({ ...n, dirty: normalizeStorageScope(n.storage_scope) === 'sync', synced: 0 }))];
        saveWebStore(toUserId, merged);
        localStorage.removeItem(getStorageKey(fromUserId));
        return;
    }
    try {
        await withDbRetry('migrate', (database) => (
            database.withTransactionAsync(async () => {
                await database.runAsync("UPDATE notes SET user_id = ?, dirty = 1, synced = 0, audio_synced = 0, audio_remote = 0 WHERE user_id = ? AND (storage_scope IS NULL OR storage_scope = 'sync')", [toUserId, fromUserId]);
                await database.runAsync("UPDATE notes SET user_id = ? WHERE user_id = ? AND storage_scope = 'local_only'", [toUserId, fromUserId]);
                await database.runAsync("UPDATE note_improvements SET user_id = ?, dirty = 1, synced = 0 WHERE user_id = ?", [toUserId, fromUserId]);
                await database.runAsync("UPDATE voice_recordings SET user_id = ? WHERE user_id = ?", [toUserId, fromUserId]);
            })
        ));
    } catch (e) {}
};
