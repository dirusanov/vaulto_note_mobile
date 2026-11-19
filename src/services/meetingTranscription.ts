import type { TranscriptionResult } from './TranscriptionService';

/** Timing of one meeting part, in that part's own clock (see phraseTiming.joinPartSegments). */
export interface MeetingPartTiming {
    segments?: TranscriptionResult['segments'];
    segmentsSource?: TranscriptionResult['segmentsSource'];
    durationSeconds?: number;
}

export type MeetingTranscriptionResult = TranscriptionResult & { parts?: MeetingPartTiming[] };

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
): Promise<MeetingTranscriptionResult> {
    if (!paths.length) return { success: false, text: '', error: 'Recording segments unavailable' };
    for (const uri of paths) {
        if (!(await deps.exists(uri))) return { success: false, text: '', error: 'Recording segment unavailable' };
    }
    const parts: string[] = [];
    const timing: MeetingPartTiming[] = [];
    for (let index = 0; index < paths.length; index += 1) {
        deps.onPart(index + 1, paths.length);
        let plaintext: string | undefined;
        try {
            const source = encrypted ? (plaintext = await deps.decrypt(paths[index], `transcription_${recordingId}_${index}`)) : paths[index];
            const result = await deps.transcribe(source, `${recordingId}:part:${index}`);
            if (!result.success) return { success: false, text: '', error: result.error || 'Recording segment transcription failed' };
            // A successfully recognised silent segment is complete. Continue to
            // later speech instead of retrying the whole meeting indefinitely.
            if (result.text.trim()) parts.push(result.text.trim());
            timing.push({ segments: result.segments, segmentsSource: result.segmentsSource, durationSeconds: result.durationSeconds });
        } catch (error) {
            return { success: false, text: '', error: error instanceof Error ? error.message : 'Meeting transcription failed' };
        } finally {
            if (plaintext) await deps.remove(plaintext).catch(() => undefined);
        }
    }
    return { success: true, text: parts.join('\n\n'), parts: timing };
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
