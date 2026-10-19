import type { TranscriptionResult } from './TranscriptionService';

interface MeetingDependencies {
    exists: (uri: string) => Promise<boolean>;
    decrypt: (uri: string, prefix: string) => Promise<string>;
    remove: (uri: string) => Promise<void>;
    transcribe: (uri: string, key: string) => Promise<TranscriptionResult>;
    onPart: (part: number, total: number) => void;
}

/** Never acknowledge a partial meeting as a complete transcript. */
export async function transcribeMeetingParts(
    paths: string[], recordingId: string, encrypted: boolean, deps: MeetingDependencies,
): Promise<TranscriptionResult> {
    if (!paths.length) return { success: false, text: '', error: 'Recording segments unavailable' };
    for (const uri of paths) {
        if (!(await deps.exists(uri))) return { success: false, text: '', error: 'Recording segment unavailable' };
    }
    const parts: string[] = [];
    for (let index = 0; index < paths.length; index += 1) {
        deps.onPart(index + 1, paths.length);
        let plaintext: string | undefined;
        try {
            const source = encrypted ? (plaintext = await deps.decrypt(paths[index], `transcription_${recordingId}_${index}`)) : paths[index];
            const result = await deps.transcribe(source, `${recordingId}:part:${index}`);
            if (!result.success || !result.text.trim()) return { success: false, text: '', error: result.error || 'Recording segment returned no text' };
            parts.push(result.text.trim());
        } catch (error) {
            return { success: false, text: '', error: error instanceof Error ? error.message : 'Meeting transcription failed' };
        } finally {
            if (plaintext) await deps.remove(plaintext).catch(() => undefined);
        }
    }
    return { success: true, text: parts.join('\n\n') };
}

/** Keep raw parts until all encrypted copies exist; clean up a failed attempt. */
export async function persistMeetingParts(
    paths: string[], save: (uri: string) => Promise<string>, remove: (uri: string) => Promise<void>,
): Promise<string[]> {
    const saved: string[] = [];
    try {
        for (const path of paths) saved.push(await save(path));
        return saved;
    } catch (error) {
        for (const path of saved) await remove(path).catch(() => undefined);
        throw error;
    }
}
