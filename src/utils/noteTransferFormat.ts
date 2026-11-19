/**
 * Pure conversions for export/import (no app imports, so tests can load it).
 */

export interface ImportedNote {
    title: string;
    content: string;
}

const MAX_TITLE = 100;

/** A file name that works on every OS, unique within `used`. */
export const safeFileName = (title: string, used: Set<string>, fallback = 'note'): string => {
    const base = (title || '')
        .replace(/[\\/:*?"<>|#\u0000-\u001f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60)
        .replace(/[. ]+$/, '') || fallback;
    let name = `${base}.md`;
    let counter = 2;
    while (used.has(name.toLowerCase())) {
        name = `${base} (${counter}).md`;
        counter += 1;
    }
    used.add(name.toLowerCase());
    return name;
};

/** One Markdown file per note: the title as a heading, then the text. */
export const noteToMarkdownFile = (title: string, markdown: string, createdAt?: string): string => {
    const parts: string[] = [];
    if (title.trim()) parts.push(`# ${title.trim()}`);
    if (createdAt) parts.push(`<!-- created: ${createdAt} -->`);
    if (markdown.trim()) parts.push(markdown.trim());
    return `${parts.join('\n\n')}\n`;
};

/** A Markdown/text file back into a note: a leading "# heading" becomes the title. */
export const parseTextNote = (text: string, fileName: string): ImportedNote | null => {
    const clean = (text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/<!-- created: [^>]*-->\n*/g, '');
    const lines = clean.split('\n');
    const first = lines.findIndex((line) => line.trim());
    if (first === -1) return null;
    const heading = lines[first].match(/^#\s+(.+)$/);
    if (heading) {
        const body = lines.slice(first + 1).join('\n').trim();
        return { title: heading[1].trim().slice(0, MAX_TITLE), content: body };
    }
    const isMarkdownName = /\.(md|markdown)$/i.test(fileName);
    const fromName = fileName.replace(/\.[^.]+$/, '').trim();
    return {
        // A named .md file keeps its name as the title; plain text stays untitled.
        title: isMarkdownName && !/^(untitled|note)\b/i.test(fromName) ? fromName.slice(0, MAX_TITLE) : '',
        content: clean.trim(),
    };
};

interface KeepNote {
    title?: string;
    textContent?: string;
    listContent?: Array<{ text?: string; isChecked?: boolean }>;
    labels?: Array<{ name?: string }>;
    isTrashed?: boolean;
}

const toTag = (label: string) => `#${label.trim().replace(/\s+/g, '_')}`;

/** A Google Keep Takeout JSON note (labels become #tags). Null when not a Keep note. */
export const parseKeepNote = (json: string): ImportedNote | null => {
    let data: KeepNote;
    try {
        data = JSON.parse(json);
    } catch {
        return null;
    }
    if (!data || typeof data !== 'object' || (!('textContent' in data) && !('listContent' in data))) return null;
    if (data.isTrashed) return null;
    const body = Array.isArray(data.listContent)
        ? data.listContent
            .filter((item) => item?.text?.trim())
            .map((item) => `- [${item.isChecked ? 'x' : ' '}] ${item.text!.trim()}`)
            .join('\n')
        : (data.textContent || '').trim();
    const tags = (data.labels || []).map((label) => label?.name || '').filter(Boolean).map(toTag);
    const content = [body, tags.join(' ')].filter(Boolean).join('\n\n');
    const title = (data.title || '').trim().slice(0, MAX_TITLE);
    return title || content ? { title, content } : null;
};

/** The fields of a note that decide whether and how it is exported. */
export interface ExportCandidate {
    deleted?: boolean;
    pending_delete?: boolean;
    locked?: boolean;
    is_protected?: boolean;
    has_audio?: boolean;
    improvements?: Array<{ deleted?: boolean }> | null;
}

/** What the ZIP will hold, told to the user before anything is shared. */
export interface ExportSummary {
    /** Notes written out: the version shown in the app, as Markdown text. */
    exportable: number;
    /** Protected notes never leave the device unencrypted. */
    skippedProtected: number;
    /** Not decrypted on this device yet (no key): nothing readable to write. */
    skippedLocked: number;
    /** Exported notes whose recordings stay in the app. */
    withAudio: number;
    /** Exported notes that have other versions (original or AI), which stay in the app. */
    withOtherVersions: number;
}

/**
 * Counts what an export will contain. `hasText` says whether a readable note
 * has a title or text to write (an empty one is left out silently).
 */
export const summarizeExport = <T extends ExportCandidate>(
    notes: T[],
    hasText: (note: T) => boolean,
): ExportSummary => {
    const summary: ExportSummary = { exportable: 0, skippedProtected: 0, skippedLocked: 0, withAudio: 0, withOtherVersions: 0 };
    for (const note of notes) {
        if (note.deleted || note.pending_delete) continue;
        if (note.is_protected) {
            summary.skippedProtected += 1;
            continue;
        }
        if (note.locked) {
            summary.skippedLocked += 1;
            continue;
        }
        if (!hasText(note)) continue;
        summary.exportable += 1;
        if (note.has_audio) summary.withAudio += 1;
        if ((note.improvements || []).some((version) => !version.deleted)) summary.withOtherVersions += 1;
    }
    return summary;
};
