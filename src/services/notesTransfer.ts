import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import JSZip from 'jszip';
import type { Note } from '../api/notes';
import { richContentToMarkdown } from '../utils/richContent';
import { stripStoredTitleMarkdown } from '../utils/markdownUtils';
import {
    ImportedNote,
    noteToMarkdownFile,
    parseKeepNote,
    parseTextNote,
    safeFileName,
} from '../utils/noteTransferFormat';

const MAX_IMPORT = 1000;

export interface ExportResult {
    exported: number;
    /** Protected notes are never written out in plain text. */
    skippedProtected: number;
}

/**
 * All readable notes as Markdown files in one ZIP, handed to the share sheet
 * (Files, Drive, mail...). Each note uses its active version. Recordings stay
 * in the app: they are encrypted on this phone.
 */
export const exportNotesAsZip = async (notes: Note[]): Promise<ExportResult> => {
    const zip = new JSZip();
    const used = new Set<string>();
    let exported = 0;
    let skippedProtected = 0;
    for (const note of notes) {
        if (note.deleted || note.locked) continue;
        if (note.is_protected) {
            skippedProtected += 1;
            continue;
        }
        const active = note.improvements?.find((improvement) => improvement.is_active);
        const title = stripStoredTitleMarkdown(note.title || '').trim();
        const markdown = richContentToMarkdown(active?.content || note.content || '').trim();
        if (!title && !markdown) continue;
        const name = safeFileName(title || markdown.split('\n')[0].replace(/^[#>*\-\s[\]x]+/, ''), used);
        zip.file(name, noteToMarkdownFile(title, markdown, note.created_at));
        exported += 1;
    }
    if (exported === 0) return { exported, skippedProtected };

    const base64 = await zip.generateAsync({ type: 'base64', compression: 'DEFLATE' });
    const stamp = new Date().toISOString().slice(0, 10);
    const uri = `${FileSystem.cacheDirectory}Vaulto-notes-${stamp}.zip`;
    await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
    try {
        await Sharing.shareAsync(uri, { mimeType: 'application/zip', dialogTitle: 'Vaulto', UTI: 'public.zip-archive' });
    } finally {
        // The share sheet has its own copy by now.
        setTimeout(() => { void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined); }, 60_000);
    }
    return { exported, skippedProtected };
};

const parseEntry = (name: string, text: string): ImportedNote | null => {
    if (/\.json$/i.test(name)) return parseKeepNote(text);
    if (/\.(md|markdown|txt)$/i.test(name)) return parseTextNote(text, name.split('/').pop() || name);
    return null;
};

/**
 * Lets the user pick files (.md, .txt, .zip, Google Keep Takeout .json or a
 * Takeout .zip) and returns the notes found. Nothing is created here.
 */
export const pickNotesToImport = async (): Promise<ImportedNote[] | null> => {
    const picked = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
        type: ['text/*', 'application/zip', 'application/json', 'application/octet-stream', 'text/markdown'],
    });
    if (picked.canceled) return null;

    const notes: ImportedNote[] = [];
    for (const asset of picked.assets) {
        const name = asset.name || asset.uri;
        try {
            if (/\.zip$/i.test(name) || asset.mimeType === 'application/zip') {
                const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
                const zip = await JSZip.loadAsync(base64, { base64: true });
                for (const entry of Object.values(zip.files)) {
                    if (entry.dir || notes.length >= MAX_IMPORT) continue;
                    // Takeout ships HTML twins of every Keep note; the JSON is enough.
                    if (/\.(json|md|markdown|txt)$/i.test(entry.name)) {
                        const note = parseEntry(entry.name, await entry.async('string'));
                        if (note) notes.push(note);
                    }
                }
            } else {
                const note = parseEntry(name, await FileSystem.readAsStringAsync(asset.uri));
                if (note) notes.push(note);
            }
        } catch (error) {
            console.warn('[NotesTransfer] Could not read', name, error);
        }
        if (notes.length >= MAX_IMPORT) break;
    }
    return notes.slice(0, MAX_IMPORT);
};
