import { base64 } from '@scure/base';
import * as FileSystem from 'expo-file-system/legacy';
import { NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18next from 'i18next';

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
    /** Shown in the system download notification, e.g. "Qwen3.5 2B". */
    label?: string;
}

/** What a caller keeps to cancel a running download. */
export interface ModelDownloadHandle {
    cancelAsync: () => Promise<unknown>;
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

type NativeModelDownload = {
    enqueue(url: string, fileName: string, title: string, description: string): Promise<string>;
    query(id: string): Promise<{ status: string; downloaded?: number; total?: number; path?: string | null; reason?: number }>;
    remove(id: string): Promise<boolean>;
    moveFile(fromPath: string, toPath: string): Promise<boolean>;
};

/**
 * Android hands the transfer to the system DownloadManager: it keeps going with the
 * app closed, resumes after network drops and shows progress in the notification
 * shade. Running jobs are remembered per target file, so reopening the app picks
 * the same transfer up instead of starting over.
 */
const systemDownloader: NativeModelDownload | undefined =
    Platform.OS === 'android' ? (NativeModules.ModelDownload as NativeModelDownload | undefined) : undefined;

const JOBS_KEY = 'vaulto_model_download_jobs_v1';
type Jobs = Record<string, { id: string; url: string }>;

const readJobs = async (): Promise<Jobs> => {
    try {
        return JSON.parse((await AsyncStorage.getItem(JOBS_KEY)) || '{}') as Jobs;
    } catch {
        return {};
    }
};

const writeJob = async (fileUri: string, job: { id: string; url: string } | null): Promise<void> => {
    const jobs = await readJobs();
    if (job) jobs[fileUri] = job;
    else delete jobs[fileUri];
    await AsyncStorage.setItem(JOBS_KEY, JSON.stringify(jobs)).catch(() => undefined);
};

/** A system download for this file is still alive (it already holds its disk space). */
export const hasPendingModelDownload = async (fileUri: string): Promise<boolean> => {
    if (!systemDownloader) return false;
    const job = (await readJobs())[fileUri];
    if (!job) return false;
    const state = await systemDownloader.query(job.id).catch(() => null);
    return !!state && state.status !== 'missing' && state.status !== 'failed';
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const downloadWithSystemManager = async (
    downloader: NativeModelDownload,
    spec: ModelFileSpec,
    fileUri: string,
    onProgress?: ModelDownloadProgress,
    onTaskCreated?: (task: ModelDownloadHandle) => void,
): Promise<void> => {
    const known = (await readJobs())[fileUri];
    let id: string | null = null;
    if (known && known.url === spec.url) {
        const state = await downloader.query(known.id).catch(() => null);
        if (state && state.status !== 'missing' && state.status !== 'failed') id = known.id;
        else await downloader.remove(known.id).catch(() => undefined);
    }
    if (!id) {
        await assertEnoughFreeSpace(spec.sizeBytes);
        const fileName = `${fileUri.split('/').pop() || 'model.bin'}.download`;
        id = await downloader.enqueue(
            spec.url,
            fileName,
            i18next.t('localModels.notificationTitle', { defaultValue: 'Vaulto · offline mode' }),
            spec.label || '',
        );
        await writeJob(fileUri, { id, url: spec.url });
    }

    const jobId = id;
    let cancelled = false;
    onTaskCreated?.({
        cancelAsync: async () => {
            cancelled = true;
            await downloader.remove(jobId).catch(() => undefined);
        },
    });

    let finishedPath: string | null = null;
    try {
        while (!finishedPath) {
            if (cancelled) throw new Error(DOWNLOAD_CANCELLED);
            const state = await downloader.query(jobId);
            if (state.status === 'missing') {
                // Removed from the system list (cancelled there, or by us).
                throw new Error(DOWNLOAD_CANCELLED);
            }
            const total = state.total && state.total > 0 ? state.total : spec.sizeBytes;
            const loaded = state.downloaded ?? 0;
            onProgress?.(total > 0 ? loaded / total : 0, loaded, total);
            if (state.status === 'failed') {
                throw new Error(`The download failed (code ${state.reason ?? 0}). Check the connection and try again.`);
            }
            if (state.status === 'successful' && state.path) {
                finishedPath = state.path;
                break;
            }
            await sleep(700);
        }
        await verifyDownloadedFile(`file://${finishedPath}`, spec);
        await FileSystem.deleteAsync(fileUri, { idempotent: true });
        await downloader.moveFile(finishedPath, fileUri);
    } catch (error) {
        await downloader.remove(jobId).catch(() => undefined);
        throw error;
    } finally {
        await writeJob(fileUri, null);
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
    onTaskCreated?: (task: ModelDownloadHandle) => void,
): Promise<void> => {
    if (systemDownloader) {
        await downloadWithSystemManager(systemDownloader, spec, fileUri, onProgress, onTaskCreated);
        return;
    }
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
