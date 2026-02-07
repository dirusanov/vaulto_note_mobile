import { Platform } from 'react-native';
import * as SQLite from 'expo-sqlite';
import { Note, NoteImprovement, VoiceRecording } from '../api/notes';
import { decrypt, encrypt, isDeviceCiphertext, isMasterCiphertext } from '../crypto/encryption';

const STORAGE_KEY_PREFIX = 'vaulto_notes_local_store_';

// Web Store Implementation
const getWebStore = (userId: string): Note[] => {
    try {
        const stored = localStorage.getItem(STORAGE_KEY_PREFIX + userId);
        return stored ? JSON.parse(stored) : [];
    } catch (e) {
        console.error('[DatabaseService] Failed to load from localStorage', e);
        return [];
    }
};

const saveWebStore = (userId: string, notes: Note[]) => {
    try {
        localStorage.setItem(STORAGE_KEY_PREFIX + userId, JSON.stringify(notes));
    } catch (e) {
        console.error('[DatabaseService] Failed to save to localStorage', e);
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
            is_pinned INTEGER DEFAULT 0
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

/**
 * Assigns all NULL user_id records to the given userId.
 * Should be called once upon login/registration/app start if we want to claim "guest" notes.
 */
export const migrateLegacyNotesToUser = async (userId: string): Promise<void> => {
    if (Platform.OS === 'web') return; // Web handles this via store key migration logic if needed
    try {
        const database = await getDb();
        if (!database) return;

        // We only migrate notes that have NO user_id (NULL).
        // This effectively "claims" the device's previous guest notes for this user.
        await database.runAsync('UPDATE notes SET user_id = ? WHERE user_id IS NULL', [userId]);
        await database.runAsync('UPDATE note_improvements SET user_id = ? WHERE user_id IS NULL', [userId]);
        await database.runAsync('UPDATE voice_recordings SET user_id = ? WHERE user_id IS NULL', [userId]);
        console.log(`[DatabaseService] Migrated legacy notes to user ${userId}`);
    } catch (e) {
        console.error('[DatabaseService] Failed to migrate legacy notes', e);
    }
};

export const migrateLegacyEncryption = async (userId: string, target: 'device' | 'master' = 'device'): Promise<void> => {
    if (!userId) return;

    const shouldReencrypt = (ciphertext: string | null | undefined) => {
        if (!ciphertext) return false;
        if (target === 'master') {
            return !isMasterCiphertext(ciphertext);
        }
        return !isDeviceCiphertext(ciphertext);
    };

    if (Platform.OS === 'web') {
        const notes = getWebStore(userId);
        let mutated = false;
        const now = new Date().toISOString();
        let processed = 0;
        const YIELD_EVERY = 25;

        for (const note of notes) {
            let changed = false;

            if (shouldReencrypt(note.encrypted_content)) {
                try {
                    const content = await decrypt(note.encrypted_content);
                    note.encrypted_content = await encrypt(content);
                    changed = true;
                } catch (e) {
                    console.warn('[DatabaseService] Skipping content migration (web)', e);
                }
            }

            if (shouldReencrypt(note.encrypted_title)) {
                try {
                    const title = await decrypt(note.encrypted_title);
                    note.encrypted_title = await encrypt(title);
                    changed = true;
                } catch (e) {
                    console.warn('[DatabaseService] Skipping title migration (web)', e);
                }
            }

            if (shouldReencrypt(note.encrypted_transcription)) {
                try {
                    const transcription = await decrypt(note.encrypted_transcription);
                    note.encrypted_transcription = await encrypt(transcription);
                    changed = true;
                } catch (e) {
                    console.warn('[DatabaseService] Skipping transcription migration (web)', e);
                }
            }

            if (changed) {
                note.dirty = true;
                note.synced = 0;
                note.updated_at = now;
                mutated = true;
            }
            processed += 1;
            if (processed % YIELD_EVERY === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        if (mutated) {
            saveWebStore(userId, notes);
            console.log(`[DatabaseService] Encryption migrated (web -> ${target})`);
        }
        return;
    }

    try {
        const database = await getDb();
        if (!database) return;
        const now = new Date().toISOString();

        const rows = await database.getAllAsync<any>(
            'SELECT id, encrypted_title, encrypted_content, encrypted_transcription FROM notes WHERE user_id = ?',
            [userId]
        );

        let processed = 0;
        const YIELD_EVERY = 25;
        for (const row of rows) {
            let updated = false;
            let encryptedContent = row.encrypted_content;
            let encryptedTitle = row.encrypted_title;
            let encryptedTranscription = row.encrypted_transcription;

            if (shouldReencrypt(encryptedContent)) {
                try {
                    const content = await decrypt(encryptedContent);
                    encryptedContent = await encrypt(content);
                    updated = true;
                } catch (e) {
                    console.warn('[DatabaseService] Skipping content migration', e);
                }
            }

            if (shouldReencrypt(encryptedTitle)) {
                try {
                    const title = await decrypt(encryptedTitle);
                    encryptedTitle = await encrypt(title);
                    updated = true;
                } catch (e) {
                    console.warn('[DatabaseService] Skipping title migration', e);
                }
            }

            if (shouldReencrypt(encryptedTranscription)) {
                try {
                    const transcription = await decrypt(encryptedTranscription);
                    encryptedTranscription = await encrypt(transcription);
                    updated = true;
                } catch (e) {
                    console.warn('[DatabaseService] Skipping transcription migration', e);
                }
            }

            if (updated) {
                await database.runAsync(
                    `UPDATE notes SET encrypted_title = ?, encrypted_content = ?, encrypted_transcription = ?, dirty = 1, synced = 0, updated_at = ? WHERE id = ?`,
                    [encryptedTitle ?? null, encryptedContent, encryptedTranscription ?? null, now, row.id]
                );
            }
            processed += 1;
            if (processed % YIELD_EVERY === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        const improvements = await database.getAllAsync<any>(
            'SELECT id, encrypted_title, encrypted_content FROM note_improvements WHERE user_id = ?',
            [userId]
        );

        processed = 0;
        for (const imp of improvements) {
            let updated = false;
            let encryptedContent = imp.encrypted_content;
            let encryptedTitle = imp.encrypted_title;

            if (shouldReencrypt(encryptedContent)) {
                try {
                    const content = await decrypt(encryptedContent);
                    encryptedContent = await encrypt(content);
                    updated = true;
                } catch (e) {
                    console.warn('[DatabaseService] Skipping improvement content migration', e);
                }
            }

            if (shouldReencrypt(encryptedTitle)) {
                try {
                    const title = await decrypt(encryptedTitle);
                    encryptedTitle = await encrypt(title);
                    updated = true;
                } catch (e) {
                    console.warn('[DatabaseService] Skipping improvement title migration', e);
                }
            }

            if (updated) {
                await database.runAsync(
                    `UPDATE note_improvements SET encrypted_title = ?, encrypted_content = ?, dirty = 1, synced = 0, updated_at = ? WHERE id = ?`,
                    [encryptedTitle ?? null, encryptedContent, now, imp.id]
                );
            }
            processed += 1;
            if (processed % YIELD_EVERY === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        console.log(`[DatabaseService] Encryption migrated (native -> ${target})`);
    } catch (e) {
        console.error('[DatabaseService] Failed to migrate legacy encryption', e);
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
        const notes = getWebStore(userId);
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
            parent_id: note.parent_id ?? null,
            is_pinned: note.is_pinned ?? false,
            label: note.label ?? null,
            option_id: note.option_id ?? null,
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

        const isDirty = note.dirty ? 1 : 0;
        const isDeleted = note.deleted || note.pending_delete ? 1 : 0;
        const isActive = note.is_active ? 1 : 0;

        await database.runAsync(
            `INSERT INTO notes (
                id, user_id, encrypted_title, encrypted_content, created_at, updated_at, 
                audio_file_path, audio_duration, encrypted_transcription, has_audio, is_pinned, synced, dirty, deleted, is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                is_active=excluded.is_active
            `,
            [
                note.id,
                userId,
                note.encrypted_title || '',
                note.encrypted_content,
                note.created_at || new Date().toISOString(),
                note.updated_at || new Date().toISOString(),
                note.audio_file_path || null,
                note.audio_duration || 0,
                note.encrypted_transcription || null,
                note.has_audio ? 1 : 0,
                note.is_pinned ? 1 : 0,
                note.synced ?? 1,
                isDirty,
                isDeleted,
                isActive
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
        // Verify ownership (optional but good practice) - primarily we delete by ID, 
        // but ensuring we only delete if it belongs to user is safer.
        await database.runAsync('DELETE FROM notes WHERE id = ? AND user_id = ?', [id, userId]);
        // Cascading deletes usually handle children, but we enforce:
        await database.runAsync('DELETE FROM note_improvements WHERE note_id = ?', [id]);
        await database.runAsync('DELETE FROM voice_recordings WHERE note_id = ?', [id]);
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
                recording.transcription || null,
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
        await database.runAsync('DELETE FROM voice_recordings WHERE id = ? AND user_id = ?', [id, userId]);
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
            dirty: true,
            synced: 0,
        }));
        saveWebStore(userId, updated);
        console.log(`[DatabaseService] Marked all notes dirty in web store for user ${userId}`);
        return;
    }

    try {
        const database = await getDb();
        if (!database) return;
        await database.runAsync('UPDATE notes SET dirty = 1, synced = 0 WHERE user_id = ?', [userId]);
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

        const decryptedNotes = await Promise.all(allNotes.map(async (n) => {
            try {
                const title = n.encrypted_title ? await decrypt(n.encrypted_title) : '';
                const content = await decrypt(n.encrypted_content);
                const transcription = n.encrypted_transcription ? await decrypt(n.encrypted_transcription) : undefined;

                return {
                    ...n,
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
        const children = validNotes.filter(n => n.parent_id);
        const childrenMap = new Map<string, Note[]>();
        children.forEach(c => {
            const pid = c.parent_id!;
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

            const content = await decrypt(imp.encrypted_content);
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
            const hasEncryptedTitle = n.encrypted_title !== undefined && n.encrypted_title !== null;
            const titlePromise = hasEncryptedTitle ? decrypt(n.encrypted_title) : Promise.resolve('');
            const contentPromise = decrypt(n.encrypted_content);
            const transcriptionPromise = n.encrypted_transcription ? decrypt(n.encrypted_transcription) : Promise.resolve(undefined);

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
    const allNotes = await getNotesLocal(userId);
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
        // Warning: This wipes ALL users data in this browser context if we iterate keys
        // or we need specific user wipe? "Wipe ALL" is safer for "logout all" semantics,
        // but for "Wipe Data" button it's fine.
        localStorage.clear();
        return;
    }
};

export const seedDemoData = async (userId: string): Promise<void> => {
    try {
        console.log('[DatabaseService] Seeding demo data for user', userId);
        const now = new Date().toISOString();

        // 1. Shopping List (Checklist style if we had it, but for now text with emojis)
        const shoppingNoteId = 'demo-shopping-list';
        const shoppingTitle = await encrypt('Weekly Groceries 🛒');
        const shoppingContent = await encrypt(
            "- [ ] Organic Milk 🥛\n- [ ] Free-range Eggs 🥚\n- [ ] Sourdough Bread 🥖\n- [ ] Avocados 🥑\n- [ ] Coffee Beans ☕\n- [ ] Dark Chocolate 🍫\n- [ ] Greek Yogurt"
        );

        await saveNoteLocal(userId, {
            id: shoppingNoteId,
            encrypted_title: shoppingTitle,
            encrypted_content: shoppingContent,
            created_at: now,
            updated_at: now,
            has_audio: false,
            is_pinned: true,
            synced: 0,
            dirty: true,
            deleted: false,
            version: 1,
            server_updated_at: now,
            label: 'Personal',
            is_active: false
        });

        // 2. Project Ideas (List)
        const ideasNoteId = 'demo-ideas-list';
        const ideasTitle = await encrypt('Startup Ideas 💡');
        const ideasContent = await encrypt(
            "1. AI-powered Personal Trainer\n   - Uses camera to correct form\n   - Generates workout plans\n\n2. Smart Recipe Manager\n   - Scans fridge contents\n   - Suggests recipes based on expiration dates\n\n3. Local Event Aggregator\n   - Pulls from various social media\n   - Personalized recommendations"
        );

        await saveNoteLocal(userId, {
            id: ideasNoteId,
            encrypted_title: ideasTitle,
            encrypted_content: ideasContent,
            created_at: new Date(Date.now() - 100000).toISOString(), // Slightly older
            updated_at: new Date(Date.now() - 100000).toISOString(),
            has_audio: false,
            is_pinned: false,
            synced: 0,
            dirty: true,
            deleted: false,
            version: 1,
            server_updated_at: new Date(Date.now() - 100000).toISOString(),
            label: 'Work',
            is_active: false
        });

        // 3. Meeting Notes (Text)
        const meetingNoteId = 'demo-meeting-notes';
        const meetingTitle = await encrypt('Product Sync 📅');
        const meetingContent = await encrypt(
            "Attendees: Alex, Sarah, Mike\nDate: Oct 24, 2024\n\n## Key Updates\n- Mobile app performance improved by 30% 🚀\n- Dark mode implementation is complete.\n- User feedback on the new navigation is positive.\n\n## Action Items\n- Sarah: Finalize design for the settings page.\n- Mike: Investigate the sync conflict issue.\n- Alex: Prepare release notes for v2.1."
        );

        await saveNoteLocal(userId, {
            id: meetingNoteId,
            encrypted_title: meetingTitle,
            encrypted_content: meetingContent,
            created_at: new Date(Date.now() - 200000).toISOString(),
            updated_at: new Date(Date.now() - 200000).toISOString(),
            has_audio: false,
            is_pinned: false,
            synced: 0,
            dirty: true,
            deleted: false,
            version: 1,
            server_updated_at: new Date(Date.now() - 200000).toISOString(),
            label: 'Work',
            is_active: true
        });

        // 4. Voice Note Mockup
        const voiceNoteId = 'demo-voice-note';
        const voiceTitle = await encrypt('Design Brainstorm 🎙️');
        const voiceContent = await encrypt(
            "Thought about the new gesture system. We should probably use a swipe-to-archive interaction similar to email apps. It feels more natural on mobile. Also, need to consider haptic feedback for long presses."
        );
        const voiceTranscription = await encrypt(
            "Thought about the new gesture system. We should probably use a swipe-to-archive interaction similar to email apps. It feels more natural on mobile. Also, need to consider haptic feedback for long presses."
        );

        await saveNoteLocal(userId, {
            id: voiceNoteId,
            encrypted_title: voiceTitle,
            encrypted_content: voiceContent,
            encrypted_transcription: voiceTranscription,
            created_at: new Date(Date.now() - 50000).toISOString(),
            updated_at: new Date(Date.now() - 50000).toISOString(),
            has_audio: true,
            audio_duration: 45, // 45 seconds
            audio_file_path: 'mock/path/to/audio.m4a', // Won't play but UI should show player
            is_pinned: false,
            synced: 0,
            dirty: true,
            deleted: false,
            version: 1,
            server_updated_at: new Date(Date.now() - 50000).toISOString(),
            label: 'Ideas',
            is_active: false
        });


        console.log('[DatabaseService] Demo data seeded successfully');
    } catch (e) {
        console.error('[DatabaseService] Failed to seed demo data', e);
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
