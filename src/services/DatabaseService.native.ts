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

        // 1. Create/Update 'notes' table
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
                pending_delete INTEGER DEFAULT 0,
                parent_id TEXT,
                is_active INTEGER DEFAULT 0,
                label TEXT,
                option_id TEXT,
                FOREIGN KEY (parent_id) REFERENCES notes(id) ON DELETE CASCADE
            );
        `);

        // Check columns
        await ensureColumnExists(database, 'notes', 'parent_id', 'TEXT');
        await ensureColumnExists(database, 'notes', 'is_active', 'INTEGER DEFAULT 0');
        await ensureColumnExists(database, 'notes', 'label', 'TEXT');
        await ensureColumnExists(database, 'notes', 'option_id', 'TEXT');

        // ... (existing ensures)
        const addedDirty = await ensureColumnExists(database, 'notes', 'dirty', 'INTEGER DEFAULT 0');
        await ensureColumnExists(database, 'notes', 'audio_file_path', 'TEXT');
        await ensureColumnExists(database, 'notes', 'audio_duration', 'INTEGER');
        await ensureColumnExists(database, 'notes', 'encrypted_transcription', 'TEXT');
        await ensureColumnExists(database, 'notes', 'has_audio', 'INTEGER DEFAULT 0');
        await ensureColumnExists(database, 'notes', 'deleted', 'INTEGER DEFAULT 0');
        await ensureColumnExists(database, 'notes', 'version', 'INTEGER DEFAULT 0');
        await ensureColumnExists(database, 'notes', 'server_updated_at', 'TEXT');
        await ensureColumnExists(database, 'notes', 'content_nonce', 'TEXT');
        await ensureColumnExists(database, 'notes', 'content_nonce', 'TEXT');
        await ensureColumnExists(database, 'notes', 'pending_delete', 'INTEGER DEFAULT 0');
        await ensureColumnExists(database, 'notes', 'encrypted_conversation_summary', 'TEXT');

        // MIGRATION: Move note_improvements to notes
        // Check if note_improvements table exists
        const checkTable = await database.getAllAsync<any>("SELECT name FROM sqlite_master WHERE type='table' AND name='note_improvements';");
        if (checkTable.length > 0) {
            console.log('[DatabaseService] Migrating note_improvements to notes...');
            const improvements = await database.getAllAsync<any>('SELECT * FROM note_improvements');
            for (const imp of improvements) {
                // Insert as child note
                await database.runAsync(
                    `INSERT INTO notes (
                        id, parent_id, encrypted_content, encrypted_title, content_nonce, label, option_id,
                        created_at, updated_at, synced, dirty, deleted, version, server_updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        parent_id=excluded.parent_id,
                        encrypted_content=excluded.encrypted_content,
                        encrypted_title=excluded.encrypted_title,
                        content_nonce=excluded.content_nonce,
                        label=excluded.label,
                        option_id=excluded.option_id,
                        updated_at=excluded.updated_at,
                        synced=excluded.synced,
                        dirty=excluded.dirty,
                        deleted=excluded.deleted,
                        version=excluded.version,
                        server_updated_at=excluded.server_updated_at`,
                    [
                        imp.id,
                        imp.note_id, // parent_id
                        imp.encrypted_content,
                        imp.encrypted_title,
                        imp.content_nonce,
                        imp.label,
                        imp.option_id,
                        imp.created_at,
                        imp.updated_at,
                        imp.synced,
                        imp.dirty,
                        imp.deleted,
                        imp.version,
                        imp.server_updated_at
                    ]
                );
            }
            // Drop old table
            await database.execAsync('DROP TABLE note_improvements;');
            console.log('[DatabaseService] Migration complete: note_improvements dropped.');
        }

        if (addedDirty) {
            await database.execAsync('UPDATE notes SET dirty = 1 WHERE synced = 0 OR pending_delete = 1;');
        }
        console.log('[DatabaseService] Database initialized');
    } catch (error) {
        console.error('[DatabaseService] Failed to initialize database', error);
        throw error;
    }
};

/**
 * Set the active variant for a note.
 * Ensures only one note (parent or child) is marked as active at a time.
 * @param parentNoteId - The parent note ID
 * @param activeChildId - The child note ID to mark as active, or null for parent/original
 */
export const setActiveVariant = async (parentNoteId: string, activeChildId: string | null): Promise<void> => {
    try {
        console.log('[DatabaseService] setActiveVariant called:', { parentNoteId, activeChildId });
        const database = await getDb();
        if (!database) return;

        // Use transaction to ensure atomicity
        await database.execAsync('BEGIN TRANSACTION;');

        try {
            const now = new Date().toISOString();
            const previousActiveChild = await database.getFirstAsync<{ id: string }>(
                'SELECT id FROM notes WHERE parent_id = ? AND is_active = 1 LIMIT 1;',
                [parentNoteId]
            );
            const previousActiveChildId = previousActiveChild?.id ?? null;

            if (activeChildId === null) {
                // Set parent as active, mark dirty so sync knows about the preference
                await database.runAsync(
                    'UPDATE notes SET is_active = 1, dirty = 1, synced = 0, updated_at = ? WHERE id = ?;',
                    [now, parentNoteId]
                );

                if (previousActiveChildId) {
                    await database.runAsync(
                        'UPDATE notes SET is_active = 0, dirty = 1, synced = 0, updated_at = ? WHERE id = ?;',
                        [now, previousActiveChildId]
                    );
                } else {
                    // Ensure all children are inactive even if none was previously active
                    await database.runAsync(
                        `UPDATE notes 
                         SET is_active = 0, dirty = 1, synced = 0, updated_at = ? 
                         WHERE parent_id = ?;`,
                        [now, parentNoteId]
                    );
                }
                console.log(`[DatabaseService] Set parent ${parentNoteId} as active`);
            } else {
                // Set parent inactive when a child is chosen
                await database.runAsync(
                    'UPDATE notes SET is_active = 0, dirty = 1, synced = 0, updated_at = ? WHERE id = ?;',
                    [now, parentNoteId]
                );

                // Activate the selected child
                await database.runAsync(
                    'UPDATE notes SET is_active = 1, dirty = 1, synced = 0, updated_at = ? WHERE id = ?;',
                    [now, activeChildId]
                );

                // Deactivate previous child if different
                if (previousActiveChildId && previousActiveChildId !== activeChildId) {
                    await database.runAsync(
                        'UPDATE notes SET is_active = 0, dirty = 1, synced = 0, updated_at = ? WHERE id = ?;',
                        [now, previousActiveChildId]
                    );
                } else if (!previousActiveChildId) {
                    // Make sure all other children are inactive if none tracked before
                    await database.runAsync(
                        'UPDATE notes SET is_active = 0, dirty = 1, synced = 0, updated_at = ? WHERE parent_id = ? AND id != ?;',
                        [now, parentNoteId, activeChildId]
                    );
                }

                console.log(`[DatabaseService] Set child ${activeChildId} as active for parent ${parentNoteId}`);
            }

            await database.execAsync('COMMIT;');
            console.log('[DatabaseService] Transaction committed successfully');
        } catch (error) {
            await database.execAsync('ROLLBACK;');
            console.error('[DatabaseService] Transaction rolled back due to error:', error);
            throw error;
        }
    } catch (error) {
        console.error('[DatabaseService] Failed to set active variant', error);
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
            `INSERT INTO notes (
                id, encrypted_title, encrypted_content, created_at, updated_at,
                audio_file_path, audio_duration, encrypted_transcription, has_audio,
                synced, dirty, deleted, version, server_updated_at, content_nonce, pending_delete,

                parent_id, is_active, label, option_id, encrypted_conversation_summary
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                version=excluded.version,
                server_updated_at=excluded.server_updated_at,
                content_nonce=excluded.content_nonce,
                pending_delete=excluded.pending_delete,
                parent_id=excluded.parent_id,
                is_active=excluded.is_active,
                label=excluded.label,
                option_id=excluded.option_id,
                encrypted_conversation_summary=excluded.encrypted_conversation_summary;`,
            [
                note.id,
                note.encrypted_title ?? null,
                note.encrypted_content,
                note.created_at ?? note.updated_at ?? new Date().toISOString(),
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
                note.parent_id ?? null,
                note.is_active ? 1 : 0,
                note.label ?? null,
                note.option_id ?? null,
                note.encrypted_conversation_summary ?? null,
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

        // Delete children (improvements)
        await database.runAsync('DELETE FROM notes WHERE parent_id = ?;', [id]);
        // Delete parent
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
                is_active: row.is_active === 1, // Preserve is_active
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

        // Get all notes (parents and children)
        const rows = await database.getAllAsync<any>('SELECT * FROM notes;');
        console.log(`[DatabaseService] Fetched ${rows.length} total rows from notes table`);

        const parents = rows.filter((r: any) => !r.parent_id);
        const children = rows.filter((r: any) => r.parent_id);

        console.log(`[DatabaseService] Found ${parents.length} parents and ${children.length} children`);

        // Group children by parent_id
        const childrenMap = new Map<string, any[]>();
        children.forEach((c: any) => {
            const list = childrenMap.get(c.parent_id) ?? [];
            list.push(c);
            childrenMap.set(c.parent_id, list);
        });

        const notes: Note[] = [];
        for (const row of parents) {
            try {
                const title = row.encrypted_title
                    ? await decrypt(row.encrypted_title)
                    : '';
                let content = await decrypt(row.encrypted_content);
                const transcription = row.encrypted_transcription
                    ? await decrypt(row.encrypted_transcription)
                    : undefined;

                const conversation_summary = row.encrypted_conversation_summary
                    ? await decrypt(row.encrypted_conversation_summary)
                    : undefined;

                // Process children
                const childRows = childrenMap.get(row.id) ?? [];
                // Sort children by updated_at desc
                childRows.sort((a, b) => {
                    return (new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
                });

                if (childRows.length > 0) {
                    console.log(`[DatabaseService] Note ${row.id} has ${childRows.length} raw children`);
                }

                const childNotes: Note[] = [];
                for (const cRow of childRows) {
                    // Skip deleted improvements
                    if (cRow.deleted === 1) {
                        continue;
                    }

                    // Decrypt child content
                    const childContent = await decrypt(cRow.encrypted_content);
                    const childConversationSummary = cRow.encrypted_conversation_summary
                        ? await decrypt(cRow.encrypted_conversation_summary)
                        : undefined;

                    childNotes.push({
                        id: cRow.id,
                        encrypted_title: cRow.encrypted_title,
                        encrypted_content: cRow.encrypted_content,
                        title: cRow.encrypted_title ? await decrypt(cRow.encrypted_title) : undefined,
                        content: childContent,
                        created_at: cRow.created_at,
                        updated_at: cRow.updated_at,
                        parent_id: cRow.parent_id,
                        label: cRow.label,
                        option_id: cRow.option_id,
                        synced: cRow.synced ?? 1,
                        dirty: cRow.dirty === 1,
                        deleted: cRow.deleted === 1,
                        version: cRow.version ?? 0,
                        is_active: cRow.is_active === 1,
                        encrypted_conversation_summary: cRow.encrypted_conversation_summary,
                        conversation_summary: childConversationSummary,
                    });
                }

                if (childRows.length > 0) {
                    console.log(`[DatabaseService] Note ${row.id} attached ${childNotes.length} active (non-deleted) children`);
                }

                // Logic to display selected child content in main list -> Removed to prevent data loss of original content
                // Content selection will be handled in the UI (NoteCard/NotesList)


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
                    is_active: row.is_active === 1,
                    parent_id: row.parent_id,
                    improvements: childNotes,
                    encrypted_conversation_summary: row.encrypted_conversation_summary,
                    conversation_summary,
                });
            } catch (e) {
                console.error(`[DatabaseService] Failed to decrypt note ${row.id}`, e);
            }
        }
        // sort by updated_at desc
        notes.sort((a, b) => {
            const da = a.updated_at ? new Date(a.updated_at).getTime() : 0;
            const db = b.updated_at ? new Date(b.updated_at).getTime() : 0;
            return db - da;
        });

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

export const getNoteById = async (id: string): Promise<Note | null> => {
    try {
        const database = await getDb();
        if (!database) return null;

        // Try to find as a parent note first
        let row = await database.getFirstAsync<any>('SELECT * FROM notes WHERE id = ?', [id]);
        if (!row) return null;

        // If it's a child note (improvement), we might need its content decrypted differently?
        // Actually the logic for decryption is shared.
        // We'll reuse the logic from getNotesLocal but scoped to one item.

        const parentId = row.parent_id;
        let children: any[] = [];
        if (!parentId) {
            // It's a parent, fetch its children
            children = await database.getAllAsync<any>('SELECT * FROM notes WHERE parent_id = ?', [row.id]);
        }

        const title = row.encrypted_title ? await decrypt(row.encrypted_title) : '';
        const content = await decrypt(row.encrypted_content);
        const transcription = row.encrypted_transcription ? await decrypt(row.encrypted_transcription) : undefined;
        const conversation_summary = row.encrypted_conversation_summary ? await decrypt(row.encrypted_conversation_summary) : undefined;

        // Process children
        const childNotes: Note[] = [];
        if (children.length > 0) {
            // Sort children by updated_at desc
            children.sort((a, b) => {
                return (new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
            });

            for (const cRow of children) {
                if (cRow.deleted === 1) continue;
                const childContent = await decrypt(cRow.encrypted_content);
                const childConversationSummary = cRow.encrypted_conversation_summary ? await decrypt(cRow.encrypted_conversation_summary) : undefined;
                childNotes.push({
                    id: cRow.id,
                    encrypted_title: cRow.encrypted_title,
                    encrypted_content: cRow.encrypted_content,
                    title: cRow.encrypted_title ? await decrypt(cRow.encrypted_title) : undefined,
                    content: childContent,
                    created_at: cRow.created_at,
                    updated_at: cRow.updated_at,
                    parent_id: cRow.parent_id,
                    label: cRow.label,
                    option_id: cRow.option_id,
                    synced: cRow.synced ?? 1,
                    dirty: cRow.dirty === 1,
                    deleted: cRow.deleted === 1,
                    version: cRow.version ?? 0,
                    is_active: cRow.is_active === 1,
                    encrypted_conversation_summary: cRow.encrypted_conversation_summary,
                    conversation_summary: childConversationSummary,
                });
            }
        }

        const note: Note = {
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
            is_active: row.is_active === 1,
            parent_id: row.parent_id,
            improvements: childNotes,
            encrypted_conversation_summary: row.encrypted_conversation_summary,
            conversation_summary,
        };
        return note;
    } catch (e) {
        console.error('[DatabaseService] Failed to get note by id', e);
        return null;
    }
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

export const saveImprovementLocal = async (improvement: NoteImprovement & { is_active?: boolean }, useDbActiveState = false): Promise<void> => {
    // Adapter for backward compatibility or direct usage, simply calls saveNoteLocal with parent_id mapping
    // We need to ensure we don't accidentally overwrite is_active with false if it's undefined
    let isActive = improvement.is_active;

    if (useDbActiveState || isActive === undefined) {
        try {
            const database = await getDb();
            if (database) {
                const existing = await database.getFirstAsync<{ is_active: number }>('SELECT is_active FROM notes WHERE id = ?;', [improvement.id]);
                if (existing) {
                    isActive = existing.is_active === 1;
                }
            }
        } catch (e) {
            console.warn('[DatabaseService] Failed to fetch existing is_active state for improvement', e);
        }
    }

    // Construct a Note object from Improvement
    const childNote: Note = {
        id: improvement.id,
        parent_id: improvement.note_id,
        encrypted_content: improvement.encrypted_content,
        encrypted_title: improvement.encrypted_title ?? undefined,
        content_nonce: improvement.content_nonce,
        label: improvement.label,
        option_id: improvement.option_id,
        created_at: improvement.created_at,
        updated_at: improvement.updated_at,
        synced: improvement.synced,
        dirty: improvement.dirty,
        deleted: improvement.deleted,
        version: improvement.version,
        server_updated_at: improvement.server_updated_at,
        is_active: isActive ?? false,
    };

    await saveNoteLocal(childNote);
};

export const deleteImprovementLocal = async (id: string): Promise<void> => {
    await deleteNoteLocal(id);
};

export const getAllImprovementsLocal = async (): Promise<NoteImprovement[]> => {
    // This might be used by SyncService. We need to fetch all notes where parent_id IS NOT NULL
    try {
        const database = await getDb();
        if (!database) return [];
        const rows = await database.getAllAsync<any>('SELECT * FROM notes WHERE parent_id IS NOT NULL;');

        // Map to NoteImprovement interface
        const improvements: NoteImprovement[] = [];
        for (const row of rows) {
            const content = await decrypt(row.encrypted_content);
            improvements.push({
                id: row.id,
                note_id: row.parent_id,
                encrypted_content: row.encrypted_content,
                encrypted_title: row.encrypted_title,
                content_nonce: row.content_nonce,
                label: row.label,
                option_id: row.option_id,
                created_at: row.created_at,
                updated_at: row.updated_at,
                synced: row.synced,
                dirty: row.dirty === 1,
                deleted: row.deleted === 1,
                version: row.version,
                server_updated_at: row.server_updated_at,
                is_active: row.is_active === 1, // Preserve is_active flag for sync
                content
            });
        }
        return improvements;

    } catch (error) {
        console.error('[DatabaseService] Failed to load improvements', error);
        throw error;
    }
};
