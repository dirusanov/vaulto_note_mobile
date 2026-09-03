import { base64 } from '@scure/base';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * Shared download pipeline for the on-device Whisper and LLM weights.
 *
 * Both models are multi-gigabyte files fetched from a public host, so a download
 * is only trusted once it passes three checks: the request answered with 200,
 * the file is not truncated, and it starts with the signature of the expected
 * format. Without them an error page (a few dozen bytes of JSON) lands on disk
 * as `<model>.bin` and the native loader aborts the process on the next run.
 */

export type ModelDownloadProgress = (progress: number, loaded: number, total: number) => void;

export interface ModelFileSpec {
    url: string;
    /** Size of the published file. Drives the free-space check and truncation detection. */
    sizeBytes: number;
    /** ASCII signatures the finished file is allowed to start with. */
    magic: string[];
}

/** Whisper `ggml-*.bin` weights store the magic as a little-endian uint32, hence both spellings. */
export const GGML_MAGIC = ['ggml', 'lmgg'];
export const GGUF_MAGIC = ['GGUF'];

/** Downloads need room for the file itself plus a little slack for the temp copy. */
const FREE_SPACE_HEADROOM = 1.08;
/** Anything noticeably smaller than the published size is a truncated or bogus download. */
const MIN_ACCEPTED_RATIO = 0.9;

export const DOWNLOAD_CANCELLED = 'Download cancelled';

export const formatBytes = (bytes: number): string => {
    if (bytes >= 1024 * 1024 * 1024) {
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }
    return `${Math.round(bytes / (1024 * 1024))} MB`;
};

export const getFreeDiskSpace = async (): Promise<number> => {
    try {
        return await FileSystem.getFreeDiskStorageAsync();
    } catch {
        // Unknown free space must not block a download the device may well fit.
        return Number.POSITIVE_INFINITY;
    }
};

export const hasRoomForModel = async (sizeBytes: number): Promise<boolean> => {
    const free = await getFreeDiskSpace();
    return free >= Math.round(sizeBytes * FREE_SPACE_HEADROOM);
};

const assertEnoughFreeSpace = async (sizeBytes: number): Promise<void> => {
    const free = await getFreeDiskSpace();
    const required = Math.round(sizeBytes * FREE_SPACE_HEADROOM);
    if (free < required) {
        throw new Error(
            `Not enough free space: the model needs ${formatBytes(required)} and only ${formatBytes(free)} is available.`
        );
    }
};

/**
 * First bytes of the file as ASCII, or `null` when they cannot be read — a read
 * failure must not reject an otherwise healthy download, the size check still applies.
 */
const readMagic = async (fileUri: string): Promise<string | null> => {
    try {
        const encoded = await FileSystem.readAsStringAsync(fileUri, {
            encoding: FileSystem.EncodingType.Base64,
            position: 0,
            length: 4,
        });
        const bytes = base64.decode(encoded.trim());
        return Array.from(bytes.slice(0, 4))
            .map((byte) => String.fromCharCode(byte))
            .join('');
    } catch {
        return null;
    }
};

const verifyDownloadedFile = async (fileUri: string, spec: ModelFileSpec): Promise<void> => {
    const info = await FileSystem.getInfoAsync(fileUri);
    const size = info.exists ? info.size ?? 0 : 0;

    if (size < Math.round(spec.sizeBytes * MIN_ACCEPTED_RATIO)) {
        throw new Error(
            `The download is incomplete (${formatBytes(size)} of ${formatBytes(spec.sizeBytes)}). Check the connection and try again.`
        );
    }

    const magic = await readMagic(fileUri);
    if (magic !== null && !spec.magic.includes(magic)) {
        throw new Error('The downloaded file is not a valid model. The host most likely returned an error page.');
    }
};

/**
 * Fetches a model into `fileUri`. The existing file at that path is replaced only
 * after the new one is verified, so a failed re-download never leaves the user
 * without a working model.
 */
export const downloadModelFile = async (
    spec: ModelFileSpec,
    fileUri: string,
    onProgress?: ModelDownloadProgress,
    onTaskCreated?: (task: FileSystem.DownloadResumable) => void,
): Promise<void> => {
    await assertEnoughFreeSpace(spec.sizeBytes);

    const tempUri = `${fileUri}.download`;
    await FileSystem.deleteAsync(tempUri, { idempotent: true });

    const task = FileSystem.createDownloadResumable(
        spec.url,
        tempUri,
        {},
        ({ totalBytesExpectedToWrite, totalBytesWritten }) => {
            if (!onProgress) return;
            const total = totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : spec.sizeBytes;
            onProgress(total > 0 ? totalBytesWritten / total : 0, totalBytesWritten, total);
        },
    );
    onTaskCreated?.(task);

    try {
        const result = await task.downloadAsync();

        if (!result?.uri) {
            throw new Error(DOWNLOAD_CANCELLED);
        }

        if (result.status !== 200) {
            throw new Error(`The model host answered with HTTP ${result.status}. The model is unavailable right now.`);
        }

        await verifyDownloadedFile(tempUri, spec);

        await FileSystem.deleteAsync(fileUri, { idempotent: true });
        await FileSystem.moveAsync({ from: tempUri, to: fileUri });
    } catch (error) {
        await FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => undefined);
        throw error;
    }
};

/**
 * Serialises access to a native context: llama.cpp and whisper.cpp both crash
 * when two jobs enter the same context concurrently.
 */
export const createMutex = () => {
    let tail: Promise<unknown> = Promise.resolve();

    return <T,>(job: () => Promise<T>): Promise<T> => {
        const run = tail.then(job, job);
        tail = run.catch(() => undefined);
        return run;
    };
};
