/**
 * The "content date" of a note: when its title, text, transcript or audio last
 * changed. `updated_at` also moves for pins, AI-version switches, protection and
 * re-encryption (sync ordering needs that), so the list sorts and dates notes by
 * `content_updated_at` instead, falling back to `updated_at` for rows written
 * before the field existed.
 *
 * Pure (no app imports) so tests can load it.
 */

export interface ContentDated {
    content_updated_at?: string | null;
    updated_at?: string | null;
    created_at?: string | null;
}

export interface ContentFields {
    title?: string | null;
    content?: string | null;
    transcription?: string | null;
    has_audio?: boolean | null;
    audio_file_path?: string | null;
}

/** ISO timestamp the list sorts and dates a note by. */
export const contentDateOf = (note: ContentDated): string =>
    note.content_updated_at || note.updated_at || note.created_at || '';

const toMs = (value: string): number => {
    const ms = value ? new Date(value).getTime() : 0;
    return Number.isFinite(ms) ? ms : 0;
};

/** Content date as epoch milliseconds (0 when unknown). */
export const contentTimeOf = (note: ContentDated): number => toMs(contentDateOf(note));

/** Newest content first. */
export const compareByContentDateDesc = (a: ContentDated, b: ContentDated): number =>
    contentTimeOf(b) - contentTimeOf(a);

const same = (a?: string | null, b?: string | null) => (a || '') === (b || '');

/** True when what the user sees as the note's content differs. */
export const hasContentChanged = (prev: ContentFields, next: ContentFields): boolean =>
    !same(prev.title, next.title)
    || !same(prev.content, next.content)
    || !same(prev.transcription, next.transcription)
    || !!prev.has_audio !== !!next.has_audio
    || !same(prev.audio_file_path, next.audio_file_path);

/**
 * Content date for a local write: `now` when the content changed, otherwise the
 * previous content date (so pin, version switch, privacy or scope changes keep it).
 */
export const nextContentUpdatedAt = (
    prev: ContentFields & ContentDated,
    next: ContentFields,
    now: string,
): string => (hasContentChanged(prev, next) ? now : (contentDateOf(prev) || now));

const isUsableTimestamp = (value?: string | null): value is string => {
    if (!value) return false;
    const ms = new Date(value).getTime();
    // Before 2000 means a broken clock; the server applies the same floor.
    return Number.isFinite(ms) && ms >= Date.UTC(2000, 0, 1);
};

/**
 * Content date for a note pulled from the server. A server that knows the field
 * sends it; an older one does not, and then the local value is kept unless the
 * pulled text differs from the local copy (another device edited it).
 */
export const incomingContentUpdatedAt = (params: {
    serverContentUpdatedAt?: string | null;
    serverUpdatedAt: string;
    existing?: (ContentFields & ContentDated) | null;
    incoming: ContentFields;
}): string => {
    const { serverContentUpdatedAt, serverUpdatedAt, existing, incoming } = params;
    if (isUsableTimestamp(serverContentUpdatedAt)) return serverContentUpdatedAt;
    if (!existing) return serverUpdatedAt;
    return nextContentUpdatedAt(existing, incoming, serverUpdatedAt);
};
