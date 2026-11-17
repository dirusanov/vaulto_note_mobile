/** Identify the container before naming decrypted audio, including legacy .m4a files. */
export type AudioExtension = 'wav' | 'm4a' | 'mp3' | 'aac' | 'ogg' | 'flac' | 'webm' | 'amr';

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function audioExtension(payloadBase64: string, originalUri = ''): AudioExtension {
    // Decode only the header: recordings can be many megabytes long.
    const header: number[] = [];
    let bits = 0;
    let available = 0;
    for (const char of payloadBase64.slice(0, 64)) {
        const value = BASE64.indexOf(char);
        if (value < 0) continue;
        bits = (bits << 6) | value;
        available += 6;
        if (available >= 8) {
            available -= 8;
            header.push((bits >>> available) & 255);
        }
    }
    const matches = (offset: number, text: string) =>
        [...text].every((char, index) => header[offset + index] === char.charCodeAt(0));
    if ((matches(0, 'RIFF') || matches(0, 'RF64')) && matches(8, 'WAVE')) return 'wav';
    if (matches(4, 'ftyp')) return 'm4a';
    if (matches(0, 'OggS')) return 'ogg';
    if (matches(0, 'fLaC')) return 'flac';
    if (matches(0, '#!AMR')) return 'amr';
    if ([0x1a, 0x45, 0xdf, 0xa3].every((byte, index) => header[index] === byte)) return 'webm';
    if (header[0] === 0xff && (header[1] & 0xf6) === 0xf0) return 'aac';
    if (matches(0, 'ID3') || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0)) return 'mp3';
    const extension = originalUri.split(/[?#]/)[0].split('.').pop()?.toLowerCase();
    if (extension && ['wav', 'm4a', 'mp3', 'aac', 'ogg', 'flac', 'webm', 'amr'].includes(extension)) {
        return extension as AudioExtension;
    }
    return 'm4a';
}

export const audioMimeType = (payloadBase64: string, originalUri = ''): string => ({
    wav: 'audio/wav', m4a: 'audio/mp4', mp3: 'audio/mpeg', aac: 'audio/aac',
    ogg: 'audio/ogg', flac: 'audio/flac', webm: 'audio/webm', amr: 'audio/amr',
}[audioExtension(payloadBase64, originalUri)]);

/** Keep uploads compatible with the MIME allowlist of existing sync servers. */
export function audioSyncMimeType(payloadBase64: string): string {
    const mime = audioMimeType(payloadBase64);
    return ['audio/wav', 'audio/mp4', 'audio/mpeg', 'audio/aac'].includes(mime)
        ? mime : 'application/octet-stream';
}
