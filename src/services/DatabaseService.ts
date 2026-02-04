import { Platform } from 'react-native';
import * as SQLite from 'expo-sqlite';
import { Note, NoteImprovement, VoiceRecording } from '../api/notes';
import { decrypt } from '../crypto/encryption';

const STORAGE_KEY = 'vaulto_notes_local_store';
const IMPROVEMENTS_STORAGE_KEY = 'vaulto_note_improvements_store';

// Web Store Implementation
const getWebStore = (): Note[] => {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        // Migration check only when loading? Or explicit init?
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

// Improvements store is deprecated, but we keep helper to migrate
const getWebImprovementsStore_DEPRECATED = (): any[] => {
    try {
        const stored = localStorage.getItem(IMPROVEMENTS_STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch (e) {
        return [];
    }
};

const clearWebImprovementsStore = () => {
    localStorage.removeItem(IMPROVEMENTS_STORAGE_KEY);
};

// Native Store Implementation
let db: SQLite.SQLiteDatabase | null = null;

const createTables = async (database: SQLite.SQLiteDatabase) => {
    await database.execAsync(`
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
            deleted INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 0
        );
    `);

    await database.execAsync(`
        CREATE TABLE IF NOT EXISTS note_improvements (
            id TEXT PRIMARY KEY,
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
            is_active INTEGER DEFAULT 0,
            version INTEGER DEFAULT 0,
            server_updated_at TEXT,
            FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE
        );
    `);

    await database.execAsync('CREATE INDEX IF NOT EXISTS idx_note_improvements_note_id ON note_improvements(note_id);');

    await database.execAsync(`
        CREATE TABLE IF NOT EXISTS voice_recordings (
            id TEXT PRIMARY KEY,
            note_id TEXT NOT NULL,
            file_path TEXT NOT NULL,
            duration REAL,
            transcription TEXT,
            created_at TEXT,
            iso_code TEXT,
            FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE
        );
    `);
    await database.execAsync('CREATE INDEX IF NOT EXISTS idx_voice_recordings_note_id ON voice_recordings(note_id);');
};

const getDb = async () => {
    if (Platform.OS === 'web') return null;
    if (!db) {
        db = await SQLite.openDatabaseAsync('vaulto.db');
        await db.execAsync('PRAGMA foreign_keys = ON;');
        await createTables(db);

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
        try {
            await db.execAsync('ALTER TABLE notes ADD COLUMN is_active INTEGER DEFAULT 0;');
        } catch (e) {
            // Ignore
        }
    }
    return db;
};

export const initDatabase = async (): Promise<void> => {
    if (Platform.OS === 'web') {
        console.log('[DatabaseService] Web detected, using localStorage');

        // MIGRATION for Web
        const improvements = getWebImprovementsStore_DEPRECATED();
        if (improvements.length > 0) {
            console.log('[DatabaseService] Migrating web improvements to notes...');
            const notes = getWebStore();
            for (const imp of improvements) {
                // Check if already migrated?
                if (notes.some(n => n.id === imp.id)) continue;

                const childNote: Note = {
                    ...imp,
                    parent_id: imp.note_id || imp.noteId,
                    improvements: [], // Children don't have children in this model yet
                };
                notes.push(childNote);
            }
            saveWebStore(notes);
            clearWebImprovementsStore();
            console.log('[DatabaseService] Web migration complete.');
        }
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
            parent_id: note.parent_id ?? null,
            // active_child_id removed from API
            label: note.label ?? null,
            option_id: note.option_id ?? null,
        } as Note;
        if (index >= 0) {
            notes[index] = {
                ...notes[index],
                ...normalizedNote,
                improvements: normalizedNote.improvements ?? notes[index].improvements ?? [], // Should we recurse? simple replace for now.
            };
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
        const isActive = note.is_active ? 1 : 0;

        await database.runAsync(
            `INSERT INTO notes (
                id, encrypted_title, encrypted_content, created_at, updated_at, 
                audio_file_path, audio_duration, encrypted_transcription, has_audio, synced, dirty, deleted, is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                encrypted_title=excluded.encrypted_title,
                encrypted_content=excluded.encrypted_content,
                updated_at=excluded.updated_at,
                audio_file_path=excluded.audio_file_path,
                audio_duration=excluded.audio_duration,
                encrypted_transcription=excluded.encrypted_transcription,
                has_audio=excluded.has_audio,
                synced=excluded.synced,
                dirty=excluded.dirty,
                deleted=excluded.deleted,
                is_active=excluded.is_active
            `,
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
                isDeleted,
                isActive
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
        // Delete note and its children
        const toDeleteIds = new Set<string>();
        toDeleteIds.add(id);

        // Find children
        notes.forEach(n => {
            if (n.parent_id === id) {
                toDeleteIds.add(n.id);
            }
        });

        notes = notes.filter(n => !toDeleteIds.has(n.id));
        saveWebStore(notes);
        // Improvements store is gone
        console.log(`[DatabaseService] Note deleted from web store: ${id}`);
        return;
    }

    try {
        const database = await getDb();
        if (!database) return;
        await database.runAsync('DELETE FROM notes WHERE id = ?', [id]);
        await database.runAsync('DELETE FROM note_improvements WHERE note_id = ?', [id]);
        await database.runAsync('DELETE FROM voice_recordings WHERE note_id = ?', [id]);
        console.log(`[DatabaseService] Note deleted from native DB: ${id}`);
    } catch (e) {
        console.error('[DatabaseService] Failed to delete from native DB', e);
    }
};

export const getVoiceRecordingsLocal = async (noteId: string): Promise<VoiceRecording[]> => {
    if (Platform.OS === 'web') return []; // Not supported on web for now or stored in Note
    try {
        const database = await getDb();
        if (!database) return [];
        const rows = await database.getAllAsync<VoiceRecording>('SELECT * FROM voice_recordings WHERE note_id = ? ORDER BY created_at DESC', [noteId]);
        return rows;
    } catch (e) {
        console.error('[DatabaseService] Failed to get voice recordings', e);
        return [];
    }
};

export const saveVoiceRecordingLocal = async (recording: VoiceRecording): Promise<void> => {
    if (Platform.OS === 'web') return;
    try {
        const database = await getDb();
        if (!database) return;
        await database.runAsync(
            `INSERT INTO voice_recordings (id, note_id, file_path, duration, transcription, created_at, iso_code)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
             file_path=excluded.file_path,
             duration=excluded.duration,
             transcription=excluded.transcription,
             iso_code=excluded.iso_code
            `,
            [
                recording.id,
                recording.note_id,
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

export const deleteVoiceRecordingLocal = async (id: string): Promise<void> => {
    if (Platform.OS === 'web') return;
    try {
        const database = await getDb();
        if (!database) return;
        await database.runAsync('DELETE FROM voice_recordings WHERE id = ?', [id]);
    } catch (e) {
        console.error('[DatabaseService] Failed to delete voice recording', e);
    }
};

export const getNotesLocal = async (): Promise<Note[]> => {
    if (Platform.OS === 'web') {
        const allNotes = getWebStore();
        // Separate parents and children
        const parents = allNotes.filter(n => !n.parent_id);
        const children = allNotes.filter(n => n.parent_id);

        // Group children
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

        // Sort
        return processedNotes.sort((a, b) => {
            const dateA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
            const dateB = b.updated_at ? new Date(b.updated_at).getTime() : 0;
            return dateB - dateA;
        });
    }

    try {
        const database = await getDb();
        if (!database) return [];
        const rawNotes = await database.getAllAsync<any>('SELECT * FROM notes ORDER BY updated_at DESC');
        const rawImprovements = await database.getAllAsync<any>('SELECT * FROM note_improvements');
        // We could fetch all voice recordings and map them, but that might be heavy.
        // For list view, we might not need them all. But 'getNotesLocal' implies full objects?
        // Usually list views don't show full recordings list. 
        // Let's lazy load or just load for now since dataset is small for single user.
        const allVoice = await database.getAllAsync<VoiceRecording>('SELECT * FROM voice_recordings');

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
            if (!noteId) {
                console.warn('[DatabaseService] Improvement missing note_id, skipping');
                continue;
            }
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
            // Sort voice files by date desc
            voiceFiles.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

            return {
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
                improvements: noteImprovements,
                voice_files: voiceFiles,
            };
        } catch (e) {
            console.error(`[DatabaseService] Failed to decrypt note ${n.id}`, e);
            return null;
        }
    }));
    // Filter out failed notes (nulls)
    const validNotes = notes.filter((n): n is Note => n !== null);

    // Sort by updated_at desc (in case DB sort wasn't enough or for web)
    return validNotes.sort((a, b) => {
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
        (note.transcription && note.transcription.toLowerCase().includes(lowerQuery)) ||
        (note.improvements && note.improvements.some(imp => imp.content?.toLowerCase().includes(lowerQuery)))
    );
};

export const getNoteById = async (id: string): Promise<Note | null> => {
    if (Platform.OS === 'web') {
        const allNotes = await getNotesLocal();
        return allNotes.find(n => n.id === id) || null;
    }

    try {
        const database = await getDb();
        if (!database) return null;
        const rawNote = await database.getFirstAsync<any>('SELECT * FROM notes WHERE id = ?', [id]);
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
        await database.runAsync('DELETE FROM note_improvements;');
        await database.runAsync('DELETE FROM voice_recordings;');
        await database.runAsync('DELETE FROM notes;');
        console.log('[DatabaseService] Native DB wiped');
    } catch (e) {
        console.error('[DatabaseService] Failed to wipe native DB', e);
        throw e;
    }
};

export const saveImprovementLocal = async (improvement: NoteImprovement): Promise<void> => {
    if (Platform.OS === 'web') {
        const notes = getWebStore();
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
            is_active: false, // Default for web store
        };

        // We need to merge if exists
        if (index >= 0) {
            notes[index] = { ...notes[index], ...childNote };
        } else {
            notes.push(childNote);
        }
        saveWebStore(notes);
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
                id, note_id, encrypted_content, encrypted_title, content_nonce, label, option_id,
                created_at, updated_at, synced, dirty, deleted, version, server_updated_at, is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                note_id=excluded.note_id,
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
        console.log(`[DatabaseService] Improvement saved to native DB: ${improvement.id} (dirty=${isDirty}, deleted=${isDeleted})`);
    } catch (e) {
        console.error('[DatabaseService] Failed to save improvement to native DB', e);
    }
};

export const deleteImprovementLocal = async (id: string): Promise<void> => {
    if (Platform.OS === 'web') {
        return deleteNoteLocal(id);
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

export const getAllImprovementsLocal = async (): Promise<NoteImprovement[]> => {
    if (Platform.OS === 'web') {
        const allNotes = getWebStore();
        return allNotes.filter(n => n.parent_id) as any[]; // Cast back to NoteImprovement[]
    }
    try {
        const database = await getDb();
        if (!database) return [];
        const raw = await database.getAllAsync<any>('SELECT * FROM note_improvements');
        const map = await processImprovements(raw, true);
        return Array.from(map.values()).flat();
    } catch (e) {
        console.error('[DatabaseService] Failed to fetch improvements', e);
        return [];
    }
};

/**
 * Set the active variant for a note (web implementation).
 * Ensures only one note (parent or child) is marked as active at a time.
 * @param parentNoteId - The parent note ID
 * @param activeChildId - The child note ID to mark as active, or null for parent/original
 */
export const setActiveVariant = async (parentNoteId: string, activeChildId: string | null): Promise<void> => {
    if (Platform.OS === 'web') {
        const notes = getWebStore();

        // Find parent and children
        const parentIndex = notes.findIndex(n => n.id === parentNoteId);
        if (parentIndex === -1) {
            console.warn(`[DatabaseService] Parent note ${parentNoteId} not found`);
            return;
        }

        if (activeChildId === null) {
            // Set parent as active, all children as inactive
            notes[parentIndex].is_active = true;
            notes.forEach((n, i) => {
                if (n.parent_id === parentNoteId) {
                    notes[i].is_active = false;
                }
            });
            console.log(`[DatabaseService] Set parent ${parentNoteId} as active (web)`);
        } else {
            // Set specific child as active, parent and other children as inactive
            notes[parentIndex].is_active = false;
            notes.forEach((n, i) => {
                if (n.parent_id === parentNoteId) {
                    notes[i].is_active = (n.id === activeChildId);
                }
            });
            console.log(`[DatabaseService] Set child ${activeChildId} as active for parent ${parentNoteId} (web)`);
        }

        saveWebStore(notes);
        return;
    }

    try {
        const database = await getDb();
        if (!database) return;

        // Transaction to update flags
        await database.withTransactionAsync(async () => {
            // 1. Reset all for this note family
            // Reset parent
            await database.runAsync('UPDATE notes SET is_active = 0, dirty = 1, updated_at = ? WHERE id = ?', [
                new Date().toISOString(),
                parentNoteId
            ]);
            // Reset children
            await database.runAsync('UPDATE note_improvements SET is_active = 0, dirty = 1, updated_at = ? WHERE note_id = ?', [
                new Date().toISOString(),
                parentNoteId
            ]);

            // 2. Set new active
            if (activeChildId) {
                await database.runAsync('UPDATE note_improvements SET is_active = 1, dirty = 1, updated_at = ? WHERE id = ?', [
                    new Date().toISOString(),
                    activeChildId
                ]);
                console.log(`[DatabaseService] Set child ${activeChildId} as active (native)`);
            } else {
                await database.runAsync('UPDATE notes SET is_active = 1, dirty = 1, updated_at = ? WHERE id = ?', [
                    new Date().toISOString(),
                    parentNoteId
                ]);
                console.log(`[DatabaseService] Set parent ${parentNoteId} as active (native)`);
            }
        });
    } catch (e) {
        console.error('[DatabaseService] Failed to set active variant (native)', e);
    }
};
