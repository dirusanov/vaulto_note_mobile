import { Platform } from 'react-native';
import * as SQLite from 'expo-sqlite';
import { Note, NoteImprovement, VoiceRecording } from '../api/notes';
import { decrypt, encrypt } from '../crypto/encryption';
import { AudioService } from './AudioService';

const STORAGE_KEY_PREFIX = 'vaulto_notes_local_store_';

const normalizeStorageScope = (value: unknown): 'sync' | 'local_only' => {
    return value === 'local_only' ? 'local_only' : 'sync';
};

const normalizePrivacy = (value: unknown): 'normal' | 'hidden' => {
    if (value === 'hidden') return value;
    return 'normal';
};

const encryptForPrivacy = async (plaintext: string, privacy: unknown): Promise<string> => {
    if (!plaintext) return '';
    return await encrypt(plaintext);
};

const decryptByPrivacy = async (ciphertext: string, privacy: unknown): Promise<string> => {
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
            privacy TEXT DEFAULT 'normal',
            pending_server_delete INTEGER DEFAULT 0
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

const getDb = async () => {
    if (Platform.OS === 'web') return null;
    if (!db) {
        db = await SQLite.openDatabaseAsync('vaulto.db');
        await db.runAsync('PRAGMA foreign_keys = ON;');
        await createTables(db);

        // Migration for existing tables
        try {
            await db.runAsync('ALTER TABLE notes ADD COLUMN dirty INTEGER DEFAULT 0;');
        } catch (e) { /* Ignore */ }
        try {
            await db.runAsync('ALTER TABLE notes ADD COLUMN deleted INTEGER DEFAULT 0;');
        } catch (e) { /* Ignore */ }
        try {
            await db.runAsync('ALTER TABLE notes ADD COLUMN is_pinned INTEGER DEFAULT 0;');
        } catch (e) { /* Ignore */ }
        try {
            await db.runAsync('ALTER TABLE notes ADD COLUMN is_active INTEGER DEFAULT 0;');
        } catch (e) { /* Ignore */ }
        try {
            await db.runAsync("ALTER TABLE notes ADD COLUMN storage_scope TEXT DEFAULT 'sync';");
        } catch (e) { /* Ignore */ }
        try {
            await db.runAsync("ALTER TABLE notes ADD COLUMN privacy TEXT DEFAULT 'normal';");
        } catch (e) { /* Ignore */ }
        try {
            await db.runAsync('ALTER TABLE notes ADD COLUMN pending_server_delete INTEGER DEFAULT 0;');
        } catch (e) { /* Ignore */ }

        // USER ID MIGRATION
        try {
            await db.runAsync('ALTER TABLE notes ADD COLUMN user_id TEXT;');
            await db.runAsync('CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id);');
        } catch (e) { /* Ignore */ }

        try {
            await db.runAsync('ALTER TABLE note_improvements ADD COLUMN user_id TEXT;');
        } catch (e) { /* Ignore */ }

        try {
            await db.runAsync('ALTER TABLE voice_recordings ADD COLUMN user_id TEXT;');
        } catch (e) { /* Ignore */ }

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

export const saveNoteLocal = async (userId: string, note: Note): Promise<void> => {
    if (!userId) {
        console.warn('[DatabaseService] saveNoteLocal called without userId');
        return;
    }
    if (!note || !note.id) {
        console.error('[DatabaseService] saveNoteLocal called with invalid note:', note);
        return;
    }

    if (Platform.OS === 'web') {
        const requestedPrivacy = normalizePrivacy(note.privacy);
        const notes = getWebStore(userId);
        const index = notes.findIndex(n => n.id === note.id);
        const privacy = requestedPrivacy;
        const storageScope = normalizeStorageScope(note.storage_scope);
        const encryptedTitle = (typeof note.title === 'string' && (note.title.length > 0 || !note.encrypted_title))
            ? await encryptForPrivacy(note.title, privacy)
            : note.encrypted_title;
        const encryptedContent = (typeof note.content === 'string' && (note.content.length > 0 || !note.encrypted_content))
            ? await encryptForPrivacy(note.content, privacy)
            : note.encrypted_content;
        const encryptedTranscription = (typeof note.transcription === 'string' && (note.transcription.length > 0 || !note.encrypted_transcription))
            ? await encryptForPrivacy(note.transcription, privacy)
            : note.encrypted_transcription;
        const normalizedNote = {
            ...note,
            encrypted_title: encryptedTitle,
            encrypted_content: encryptedContent,
            encrypted_transcription: encryptedTranscription,
            dirty: note.dirty ?? false,
            deleted: note.deleted ?? false,
            version: note.version ?? (index >= 0 ? notes[index].version ?? 0 : 0),
            server_updated_at: note.server_updated_at ?? note.updated_at,
            content_nonce: note.content_nonce ?? null,
            pending_delete: note.pending_delete ?? false,
            parent_id: note.parent_id ?? null,
            is_pinned: note.is_pinned ?? false,
            label: note.label ?? null,
            option_id: note.option_id ?? null,
            storage_scope: storageScope,
            privacy,
            pending_server_delete: note.pending_server_delete ?? false,
            synced: note.synced ?? 1,
        } as Note;

        const safeNote = { ...normalizedNote };
        delete safeNote.title;
        delete safeNote.content;
        delete safeNote.transcription;

        if (index >= 0) {
            notes[index] = {
                ...notes[index],
                ...safeNote,
                improvements: safeNote.improvements ?? notes[index].improvements ?? [],
            };
        } else {
            notes.push(safeNote);
        }
        saveWebStore(userId, notes);
        console.log(`[DatabaseService] Note saved to web store: ${note.id} (user=${userId})`);
        return;
    }

    try {
        const database = await getDb();
        if (!database) return;

        const privacy = normalizePrivacy(note.privacy);
        const storageScope = normalizeStorageScope(note.storage_scope);
        const isDirty = note.dirty ? 1 : 0;
        const isDeleted = note.deleted || note.pending_delete ? 1 : 0;
        const isActive = note.is_active ? 1 : 0;
        const pendingServerDelete = note.pending_server_delete ? 1 : 0;

        const encryptedTitle = (typeof note.title === 'string' && (note.title.length > 0 || !note.encrypted_title))
            ? await encryptForPrivacy(note.title, privacy)
            : note.encrypted_title;
        const encryptedContent = (typeof note.content === 'string' && (note.content.length > 0 || !note.encrypted_content))
            ? await encryptForPrivacy(note.content, privacy)
            : note.encrypted_content;
        const encryptedTranscription = (typeof note.transcription === 'string' && (note.transcription.length > 0 || !note.encrypted_transcription))
            ? await encryptForPrivacy(note.transcription, privacy)
            : note.encrypted_transcription;

        await database.runAsync(
            `INSERT INTO notes (
                id, user_id, encrypted_title, encrypted_content, created_at, updated_at, 
                audio_file_path, audio_duration, encrypted_transcription, has_audio, is_pinned, synced, dirty, deleted, is_active,
                storage_scope, privacy, pending_server_delete
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                privacy=excluded.privacy,
                pending_server_delete=excluded.pending_server_delete
            `,
            [
                note.id,
                userId,
                encryptedTitle || '',
                encryptedContent,
                note.created_at || new Date().toISOString(),
                note.updated_at || new Date().toISOString(),
                note.audio_file_path || null,
                note.audio_duration || 0,
                encryptedTranscription || null,
                note.has_audio ? 1 : 0,
                note.is_pinned ? 1 : 0,
                note.synced ?? 1,
                isDirty,
                isDeleted,
                isActive,
                storageScope,
                privacy,
                pendingServerDelete,
            ]
        );
        console.log(`[DatabaseService] Note saved to native DB: ${note.id} (user=${userId})`);
    } catch (e) {
        console.error('[DatabaseService] Failed to save to native DB', e);
    }
};

export const deleteNoteLocal = async (userId: string, id: string): Promise<void> => {
    if (!id) {
        console.warn('[DatabaseService] deleteNoteLocal called without id');
        return;
    }
    if (Platform.OS === 'web') {
        let notes = getWebStore(userId);
        const toDeleteIds = new Set<string>();
        toDeleteIds.add(id);

        notes.forEach(n => {
            if (n.parent_id === id) {
                toDeleteIds.add(n.id);
            }
        });

        notes = notes.filter(n => !toDeleteIds.has(n.id));
        saveWebStore(userId, notes);
        console.log(`[DatabaseService] Note deleted from web store: ${id}`);
        return;
    }

    try {
        const database = await getDb();
        if (!database) return;
        // Native DB does not store improvements as child notes, so we only delete the note itself.
        const relatedIds = [id];
        let audioPathsToDelete: Array<string | null | undefined> = [];

        const [voiceRows, noteRows] = await Promise.all([
            database.getAllAsync<{ file_path: string | null }>(
                'SELECT file_path FROM voice_recordings WHERE user_id = ? AND note_id = ?',
                [userId, id]
            ),
            database.getAllAsync<{ audio_file_path: string | null }>(
                'SELECT audio_file_path FROM notes WHERE user_id = ? AND id = ?',
                [userId, id]
            ),
        ]);
        audioPathsToDelete = [
            ...voiceRows.map((row) => row.file_path),
            ...noteRows.map((row) => row.audio_file_path),
        ];

        await database.runAsync('DELETE FROM voice_recordings WHERE note_id = ? AND user_id = ?', [id, userId]);
        await database.runAsync('DELETE FROM note_improvements WHERE note_id = ? AND user_id = ?', [id, userId]);
        await database.runAsync('DELETE FROM notes WHERE id = ? AND user_id = ?', [id, userId]);
        await purgeAudioFiles(audioPathsToDelete, `delete note ${id}`);
        await AudioService.cleanupTempFiles();
        console.log(`[DatabaseService] Note deleted from native DB: ${id}`);
    } catch (e) {
        console.error('[DatabaseService] Failed to delete from native DB', e);
    }
};

export const getVoiceRecordingsLocal = async (userId: string, noteId: string): Promise<VoiceRecording[]> => {
    if (Platform.OS === 'web') return [];
    try {
        const database = await getDb();
        if (!database) return [];
        // Filter by user_id for isolation
        const rows = await database.getAllAsync<VoiceRecording>(
            'SELECT * FROM voice_recordings WHERE note_id = ? AND user_id = ? ORDER BY created_at DESC',
            [noteId, userId]
        );
        return rows;
    } catch (e) {
        console.error('[DatabaseService] Failed to get voice recordings', e);
        return [];
    }
};

export const saveVoiceRecordingLocal = async (userId: string, recording: VoiceRecording): Promise<void> => {
    if (Platform.OS === 'web') return;
    try {
        const database = await getDb();
        if (!database) return;
        const noteMeta = await database.getFirstAsync<{ privacy: string | null; storage_scope: string | null }>(
            'SELECT privacy, storage_scope FROM notes WHERE id = ? AND user_id = ? LIMIT 1',
            [recording.note_id, userId]
        );
        const isPrivateRecording = !noteMeta
            || normalizePrivacy(noteMeta.privacy) !== 'normal'
            || normalizeStorageScope(noteMeta.storage_scope) === 'local_only';
        const safeTranscription = isPrivateRecording ? null : (recording.transcription || null);
        await database.runAsync(
            `INSERT INTO voice_recordings (id, note_id, user_id, file_path, duration, transcription, created_at, iso_code)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
             user_id=excluded.user_id,
             file_path=excluded.file_path,
             duration=excluded.duration,
             transcription=excluded.transcription,
             iso_code=excluded.iso_code
            `,
            [
                recording.id,
                recording.note_id,
                userId,
                recording.file_path,
                recording.duration,
                safeTranscription,
                recording.created_at,
                recording.iso_code || null
            ]
        );
        console.log(`[DatabaseService] Voice recording saved: ${recording.id}`);
    } catch (e) {
        console.error('[DatabaseService] Failed to save voice recording', e);
    }
};

export const deleteVoiceRecordingLocal = async (userId: string, id: string): Promise<void> => {
    if (Platform.OS === 'web') return;
    try {
        const database = await getDb();
        if (!database) return;
        const rows = await database.getAllAsync<{ file_path: string | null }>(
            'SELECT file_path FROM voice_recordings WHERE id = ? AND user_id = ?',
            [id, userId]
        );
        await database.runAsync('DELETE FROM voice_recordings WHERE id = ? AND user_id = ?', [id, userId]);
        await purgeAudioFiles(rows.map((row) => row.file_path), `delete voice recording ${id}`);
    } catch (e) {
        console.error('[DatabaseService] Failed to delete voice recording', e);
    }
};

export const markAllDirty = async (userId: string): Promise<void> => {
    if (!userId) return;

    if (Platform.OS === 'web') {
        const notes = getWebStore(userId);
        const updated = notes.map(note => ({
            ...note,
            dirty: normalizeStorageScope(note.storage_scope) === 'sync',
            synced: 0,
        }));
        saveWebStore(userId, updated);
        console.log(`[DatabaseService] Marked all notes dirty in web store for user ${userId}`);
        return;
    }

    try {
        const database = await getDb();
        if (!database) return;
        await database.runAsync(
            "UPDATE notes SET dirty = 1, synced = 0 WHERE user_id = ? AND (storage_scope IS NULL OR storage_scope = 'sync')",
            [userId]
        );
        await database.runAsync('UPDATE note_improvements SET dirty = 1, synced = 0 WHERE user_id = ?', [userId]);
        console.log(`[DatabaseService] Marked all notes dirty for user ${userId}`);
    } catch (e) {
        console.error('[DatabaseService] Failed to mark notes dirty', e);
    }
};

export const getNotesLocal = async (userId: string): Promise<Note[]> => {
    if (!userId) return [];

    if (Platform.OS === 'web') {
        const allNotes = getWebStore(userId);

        const decryptedNotes = await Promise.all(allNotes.map(async (n): Promise<Note | null> => {
            try {
                const privacy = normalizePrivacy(n.privacy);
                const title = n.encrypted_title ? await decryptByPrivacy(n.encrypted_title, privacy) : '';
                const content = await decryptByPrivacy(n.encrypted_content, privacy);
                const transcription = n.encrypted_transcription
                    ? await decryptByPrivacy(n.encrypted_transcription, privacy)
                    : undefined;

                return {
                    ...n,
                    is_active: !!n.is_active,
                    storage_scope: normalizeStorageScope(n.storage_scope),
                    privacy,
                    pending_server_delete: !!n.pending_server_delete,
                    title,
                    content,
                    transcription,
                };
            } catch (e) {
                console.error(`[DatabaseService] Failed to decrypt note ${n.id}`, e);
                return null;
            }
        }));

        const validNotes = decryptedNotes.filter((n): n is Note => n !== null);
        const parents = validNotes.filter(n => !n.parent_id);
        const children = validNotes.filter((n): n is Note & { parent_id: string } =>
            typeof n.parent_id === 'string' && n.parent_id.length > 0
        );
        const childrenMap = new Map<string, Note[]>();
        children.forEach(c => {
            const pid = c.parent_id;
            const list = childrenMap.get(pid) ?? [];
            list.push(c);
            childrenMap.set(pid, list);
        });

        const processedNotes: Note[] = [];
        for (const parent of parents) {
            const childNotes = childrenMap.get(parent.id) ?? [];
            childNotes.sort((a, b) => (new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()));

            processedNotes.push({
                ...parent,
                improvements: childNotes
            });
        }

        return processedNotes.sort((a, b) => {
            const dateA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
            const dateB = b.updated_at ? new Date(b.updated_at).getTime() : 0;
            return dateB - dateA;
        });
    }

    try {
        const database = await getDb();
        if (!database) return [];
        // FILTER BY USER ID
        const rawNotes = await database.getAllAsync<any>(
            'SELECT * FROM notes WHERE user_id = ? ORDER BY updated_at DESC',
            [userId]
        );
        const rawImprovements = await database.getAllAsync<any>(
            'SELECT * FROM note_improvements WHERE user_id = ?',
            [userId]
        );
        // Optimally filter voice too, though note mapping handles filtering via note_id
        const allVoice = await database.getAllAsync<VoiceRecording>(
            'SELECT * FROM voice_recordings WHERE user_id = ?',
            [userId]
        );

        const improvementsMap = await processImprovements(rawImprovements);
        const voiceMap = new Map<string, VoiceRecording[]>();
        allVoice.forEach(v => {
            const list = voiceMap.get(v.note_id) ?? [];
            list.push(v);
            voiceMap.set(v.note_id, list);
        });

        return processNotes(rawNotes, improvementsMap, voiceMap);
    } catch (e) {
        console.error('[DatabaseService] Failed to get notes from native DB', e);
        return [];
    }
};

const processImprovements = async (
    rawImprovements: any[],
    includeDeleted: boolean = false,
): Promise<Map<string, NoteImprovement[]>> => {
    const grouped = new Map<string, NoteImprovement[]>();
    for (const imp of rawImprovements) {
        try {
            const noteId = imp.note_id || imp.noteId;
            if (!noteId) continue;

            const privacy = normalizePrivacy(imp.privacy);
            const content = await decryptByPrivacy(imp.encrypted_content, privacy);
            const improvement: NoteImprovement = {
                ...imp,
                note_id: noteId,
                label: imp.label,
                option_id: imp.option_id,
                encrypted_title: imp.encrypted_title,
                content_nonce: imp.content_nonce,
                content,
                deleted: !!imp.deleted,
                dirty: !!imp.dirty,
                synced: imp.synced ?? 1,
                version: imp.version ?? 0,
                server_updated_at: imp.server_updated_at,
                ...(imp.storage_scope ? { storage_scope: normalizeStorageScope(imp.storage_scope) } : {}),
                ...(imp.privacy ? { privacy } : {}),
                ...(imp.pending_server_delete ? { pending_server_delete: !!imp.pending_server_delete } : {}),
            };
            if (improvement.deleted && !includeDeleted) {
                continue;
            }
            const list = grouped.get(improvement.note_id) ?? [];
            list.push(improvement);
            grouped.set(improvement.note_id, list);
        } catch (e) {
            console.error(`[DatabaseService] Failed to decrypt improvement ${imp.id}`, e);
        }
    }

    grouped.forEach(list => {
        list.sort((a, b) => {
            const dateA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
            const dateB = b.updated_at ? new Date(b.updated_at).getTime() : 0;
            return dateB - dateA;
        });
    });

    return grouped;
};

const processNotes = async (
    rawNotes: any[],
    improvements?: Map<string, NoteImprovement[]>,
    voiceRecordings?: Map<string, VoiceRecording[]>
): Promise<Note[]> => {
    const notes = await Promise.all(rawNotes.map(async (n): Promise<Note | null> => {
        try {
            const privacy = normalizePrivacy(n.privacy);
            const hasEncryptedTitle = n.encrypted_title !== undefined && n.encrypted_title !== null;
            const titlePromise = hasEncryptedTitle ? decryptByPrivacy(n.encrypted_title, privacy) : Promise.resolve('');
            const contentPromise = decryptByPrivacy(n.encrypted_content, privacy);
            const transcriptionPromise = n.encrypted_transcription
                ? decryptByPrivacy(n.encrypted_transcription, privacy)
                : Promise.resolve(undefined);

            const [title, content, transcription] = await Promise.all([titlePromise, contentPromise, transcriptionPromise]);

            const noteImprovements = improvements?.get(n.id) ?? [];
            const voiceFiles = voiceRecordings?.get(n.id) ?? [];
            voiceFiles.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

            return {
                ...n,
                title,
                content,
                transcription,
                has_audio: !!n.has_audio,
                is_pinned: !!n.is_pinned,
                synced: n.synced ?? 1,
                dirty: !!n.dirty,
                deleted: !!n.deleted,
                version: n.version ?? 0,
                server_updated_at: n.server_updated_at,
                content_nonce: n.content_nonce ?? null,
                pending_delete: !!n.deleted || !!n.pending_delete,
                storage_scope: normalizeStorageScope(n.storage_scope),
                privacy,
                pending_server_delete: !!n.pending_server_delete,
                improvements: noteImprovements,
                voice_files: voiceFiles,
            };
        } catch (e) {
            console.error(`[DatabaseService] Failed to decrypt note ${n.id}`, e);
            return null;
        }
    }));
    const validNotes = notes.filter((n): n is Note => n !== null);

    return validNotes.sort((a, b) => {
        const dateA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const dateB = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        return dateB - dateA;
    });
};

export const searchNotesLocal = async (userId: string, query: string): Promise<Note[]> => {
    let allNotes: Note[];
    if (Platform.OS === 'web') {
        const rawMainNotes = getWebStore(userId);
        const decrypted = await Promise.all(rawMainNotes.map(async (n): Promise<Note | null> => {
            try {
                const privacy = normalizePrivacy(n.privacy);
                const title = n.encrypted_title ? await decryptByPrivacy(n.encrypted_title, privacy) : '';
                const content = await decryptByPrivacy(n.encrypted_content, privacy);
                const transcription = n.encrypted_transcription
                    ? await decryptByPrivacy(n.encrypted_transcription, privacy)
                    : undefined;
                return {
                    ...n,
                    title,
                    content,
                    transcription,
                    privacy,
                    storage_scope: normalizeStorageScope(n.storage_scope),
                };
            } catch {
                return null;
            }
        }));
        allNotes = decrypted.filter((n): n is Note => n !== null);
    } else {
        allNotes = await getNotesLocal(userId);
    }
    if (!query) return allNotes;

    const lowerQuery = query.toLowerCase();
    return allNotes.filter(note =>
        (note.title && note.title.toLowerCase().includes(lowerQuery)) ||
        (note.content && note.content.toLowerCase().includes(lowerQuery)) ||
        (note.transcription && note.transcription.toLowerCase().includes(lowerQuery)) ||
        (note.improvements && note.improvements.some(imp => imp.content?.toLowerCase().includes(lowerQuery)))
    );
};

export const getNoteById = async (userId: string, id: string): Promise<Note | null> => {
    if (Platform.OS === 'web') {
        const allNotes = await getNotesLocal(userId);
        return allNotes.find(n => n.id === id) || null;
    }

    try {
        const database = await getDb();
        if (!database) return null;
        const rawNote = await database.getFirstAsync<any>('SELECT * FROM notes WHERE id = ? AND user_id = ?', [id, userId]);
        if (!rawNote) return null;

        const rawImprovements = await database.getAllAsync<any>('SELECT * FROM note_improvements WHERE note_id = ?', [id]);
        const voiceRecordings = await database.getAllAsync<VoiceRecording>('SELECT * FROM voice_recordings WHERE note_id = ?', [id]);

        const improvementsMap = await processImprovements(rawImprovements);
        const voiceMap = new Map<string, VoiceRecording[]>();
        voiceMap.set(id, voiceRecordings);

        const processed = await processNotes([rawNote], improvementsMap, voiceMap);
        return processed[0] || null;
    } catch (e) {
        console.error('[DatabaseService] Failed to get note by id', e);
        return null;
    }
};

export const wipeLocalDatabase = async (): Promise<void> => {
    if (Platform.OS === 'web') {
        // Remove only note storage keys; keep auth/preferences keys intact.
        try {
            for (let i = localStorage.length - 1; i >= 0; i -= 1) {
                const key = localStorage.key(i);
                if (key && key.startsWith(STORAGE_KEY_PREFIX)) {
                    localStorage.removeItem(key);
                }
            }
        } catch (e) {
            console.error('[DatabaseService] Failed to wipe web store', e);
        }
        return;
    }

    try {
        const database = await getDb();
        if (!database) return;

        // Purge on-disk audio blobs before deleting DB rows.
        const noteAudio = await database.getAllAsync<{ audio_file_path: string | null }>(
            "SELECT audio_file_path FROM notes WHERE audio_file_path IS NOT NULL AND audio_file_path != ''",
        );
        const recordingAudio = await database.getAllAsync<{ file_path: string }>(
            "SELECT file_path FROM voice_recordings WHERE file_path IS NOT NULL AND file_path != ''",
        );
        await purgeAudioFiles(
            [
                ...noteAudio.map((row) => row.audio_file_path),
                ...recordingAudio.map((row) => row.file_path),
            ],
            'wipe local database',
        );

        // Delete in child->parent order to be resilient even if foreign_keys is off.
        await database.runAsync('DELETE FROM voice_recordings;');
        await database.runAsync('DELETE FROM note_improvements;');
        await database.runAsync('DELETE FROM notes;');
    } catch (e) {
        console.error('[DatabaseService] Failed to wipe native DB', e);
        throw e;
    }
};



export const saveImprovementLocal = async (userId: string, improvement: NoteImprovement): Promise<void> => {
    if (Platform.OS === 'web') {
        const notes = getWebStore(userId);
        const index = notes.findIndex(n => n.id === improvement.id);

        const childNote: Note = {
            id: improvement.id,
            parent_id: improvement.note_id,
            encrypted_content: improvement.encrypted_content,
            encrypted_title: improvement.encrypted_title || undefined,
            content_nonce: improvement.content_nonce,
            label: improvement.label || undefined,
            option_id: improvement.option_id || undefined,
            created_at: improvement.created_at,
            updated_at: improvement.updated_at,
            synced: improvement.synced,
            dirty: improvement.dirty,
            version: improvement.version,
            server_updated_at: improvement.server_updated_at,
            content: improvement.content,
            is_active: false,
            privacy: 'normal',
            storage_scope: 'sync',
        };

        const safeChild = { ...childNote };
        delete safeChild.content;

        if (index >= 0) {
            notes[index] = { ...notes[index], ...safeChild };
        } else {
            notes.push(safeChild);
        }
        saveWebStore(userId, notes);
        console.log(`[DatabaseService] Improvement saved to web store as child note: ${improvement.id}`);
        return;
    }

    try {
        const database = await getDb();
        if (!database) return;
        const isDirty = improvement.dirty ? 1 : 0;
        const isDeleted = improvement.deleted ? 1 : 0;
        const isActive = improvement.is_active ? 1 : 0;

        await database.runAsync(
            `INSERT INTO note_improvements (
                id, note_id, user_id, encrypted_content, encrypted_title, content_nonce, label, option_id,
                created_at, updated_at, synced, dirty, deleted, version, server_updated_at, is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                note_id=excluded.note_id,
                user_id=excluded.user_id,
                encrypted_content=excluded.encrypted_content,
                encrypted_title=excluded.encrypted_title,
                content_nonce=excluded.content_nonce,
                label=excluded.label,
                option_id=excluded.option_id,
                created_at=excluded.created_at,
                updated_at=excluded.updated_at,
                synced=excluded.synced,
                dirty=excluded.dirty,
                deleted=excluded.deleted,
                version=excluded.version,
                server_updated_at=excluded.server_updated_at,
                is_active=excluded.is_active
            `,
            [
                improvement.id,
                improvement.note_id,
                userId,
                improvement.encrypted_content,
                improvement.encrypted_title || null,
                improvement.content_nonce || null,
                improvement.label || null,
                improvement.option_id || null,
                improvement.created_at || new Date().toISOString(),
                improvement.updated_at || new Date().toISOString(),
                improvement.synced ?? 1,
                isDirty,
                isDeleted,
                improvement.version ?? 0,
                improvement.server_updated_at || null,
                isActive
            ]
        );
        console.log(`[DatabaseService] Improvement saved to native DB: ${improvement.id} (user=${userId})`);
    } catch (e) {
        console.error('[DatabaseService] Failed to save improvement to native DB', e);
    }
};

export const deleteImprovementLocal = async (userId: string, id: string): Promise<void> => {
    if (Platform.OS === 'web') {
        return deleteNoteLocal(userId, id);
    }

    try {
        const database = await getDb();
        if (!database) return;
        await database.runAsync('DELETE FROM note_improvements WHERE id = ?', [id]);
        console.log(`[DatabaseService] Improvement deleted from native DB: ${id}`);
    } catch (e) {
        console.error('[DatabaseService] Failed to delete improvement from native DB', e);
    }
};

export const getAllImprovementsLocal = async (userId: string): Promise<NoteImprovement[]> => {
    if (Platform.OS === 'web') {
        const allNotes = getWebStore(userId);
        return allNotes.filter(n => n.parent_id) as any[];
    }
    try {
        const database = await getDb();
        if (!database) return [];
        // FILTER BY USER ID
        const raw = await database.getAllAsync<any>('SELECT * FROM note_improvements WHERE user_id = ?', [userId]);
        const map = await processImprovements(raw, true);
        return Array.from(map.values()).flat();
    } catch (e) {
        console.error('[DatabaseService] Failed to fetch improvements', e);
        return [];
    }
};

export const setActiveVariant = async (userId: string, parentNoteId: string, activeChildId: string | null): Promise<void> => {
    if (Platform.OS === 'web') {
        const notes = getWebStore(userId);

        const parentIndex = notes.findIndex(n => n.id === parentNoteId);
        if (parentIndex === -1) {
            console.warn(`[DatabaseService] Parent note ${parentNoteId} not found`);
            return;
        }

        if (activeChildId === null) {
            notes[parentIndex].is_active = true;
            notes.forEach((n, i) => {
                if (n.parent_id === parentNoteId) {
                    notes[i].is_active = false;
                }
            });
        } else {
            notes[parentIndex].is_active = false;
            notes.forEach((n, i) => {
                if (n.parent_id === parentNoteId) {
                    notes[i].is_active = (n.id === activeChildId);
                }
            });
        }

        saveWebStore(userId, notes);
        return;
    }

    try {
        const database = await getDb();
        if (!database) return;

        // Transaction to update flags
        await database.withTransactionAsync(async () => {
            // Verify ownership first (optional, but safer)

            // 1. Reset all for this note family
            await database.runAsync('UPDATE notes SET is_active = 0, dirty = 1, updated_at = ? WHERE id = ? AND user_id = ?', [
                new Date().toISOString(),
                parentNoteId,
                userId
            ]);
            await database.runAsync('UPDATE note_improvements SET is_active = 0, dirty = 1, updated_at = ? WHERE note_id = ? AND user_id = ?', [
                new Date().toISOString(),
                parentNoteId,
                userId
            ]);

            // 2. Set new active
            if (activeChildId) {
                await database.runAsync('UPDATE note_improvements SET is_active = 1, dirty = 1, updated_at = ? WHERE id = ? AND user_id = ?', [
                    new Date().toISOString(),
                    activeChildId,
                    userId
                ]);
            } else {
                await database.runAsync('UPDATE notes SET is_active = 1, dirty = 1, updated_at = ? WHERE id = ? AND user_id = ?', [
                    new Date().toISOString(),
                    parentNoteId,
                    userId
                ]);
            }
        });
    } catch (e) {
        console.error('[DatabaseService] Failed to set active variant (native)', e);
    }
};

export const migrateGuestData = async (fromUserId: string, toUserId: string): Promise<void> => {
    if (!fromUserId || !toUserId || fromUserId === toUserId) return;

    console.log(`[DatabaseService] Migrating data from ${fromUserId} to ${toUserId}`);

    if (Platform.OS === 'web') {
        try {
            const guestNotes = getWebStore(fromUserId);
            if (guestNotes.length === 0) return;

            const targetNotes = getWebStore(toUserId);
            const targetIds = new Set(targetNotes.map(n => n.id));

            const migratedNotes = guestNotes.map(note => ({
                ...note,
                dirty: normalizeStorageScope(note.storage_scope) === 'sync',
                synced: 0,
            }));

            // Avoid duplicates
            const filteredMigrated = migratedNotes.filter(n => !targetIds.has(n.id));
            const merged = [...targetNotes, ...filteredMigrated];

            saveWebStore(toUserId, merged);
            localStorage.removeItem(getStorageKey(fromUserId));
            console.log(`[DatabaseService] Migrated ${filteredMigrated.length} notes (web)`);
        } catch (e) {
            console.error('[DatabaseService] Failed to migrate guest data (web)', e);
        }
        return;
    }

    try {
        const database = await getDb();
        if (!database) return;

        await database.withTransactionAsync(async () => {
            // Update notes
            await database.runAsync(
                "UPDATE notes SET user_id = ?, dirty = 1, synced = 0 WHERE user_id = ? AND (storage_scope IS NULL OR storage_scope = 'sync')",
                [toUserId, fromUserId]
            );
            // Local-only notes just change owner without marking dirty for sync
            await database.runAsync(
                "UPDATE notes SET user_id = ? WHERE user_id = ? AND storage_scope = 'local_only'",
                [toUserId, fromUserId]
            );

            // Update improvements
            await database.runAsync(
                "UPDATE note_improvements SET user_id = ?, dirty = 1, synced = 0 WHERE user_id = ?",
                [toUserId, fromUserId]
            );

            // Update voice recordings
            await database.runAsync(
                "UPDATE voice_recordings SET user_id = ? WHERE user_id = ?",
                [toUserId, fromUserId]
            );
        });
        console.log('[DatabaseService] Guest data migration completed (native)');
    } catch (e) {
        console.error('[DatabaseService] Failed to migrate guest data (native)', e);
    }
};
