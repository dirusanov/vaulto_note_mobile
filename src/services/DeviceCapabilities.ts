import { NativeModules } from 'react-native';

/**
 * Physical device limits that decide which on-device models may be offered.
 * A 4 GB model on a 4 GB phone does not fail gracefully - the OS kills the app -
 * so the picker has to know the numbers before a multi-gigabyte download starts.
 */

export interface DeviceCapabilities {
    /** Total physical RAM, or 0 when the platform did not report it. */
    totalMemoryBytes: number;
    cpuCount: number;
    isLowRamDevice: boolean;
}

type DeviceCapabilitiesModuleShape = {
    getCapabilities: () => Promise<DeviceCapabilities>;
};

/** llama.cpp/whisper.cpp need room for the weights plus context and KV cache. */
const MEMORY_RATIO = 1.5;

const UNKNOWN: DeviceCapabilities = {
    totalMemoryBytes: 0,
    cpuCount: 4,
    isLowRamDevice: false,
};

let cached: DeviceCapabilities | null = null;

const resolveModule = (): DeviceCapabilitiesModuleShape | null => {
    const nativeModule = (NativeModules as Record<string, unknown>).DeviceCapabilities;
    if (
        nativeModule &&
        typeof (nativeModule as DeviceCapabilitiesModuleShape).getCapabilities === 'function'
    ) {
        return nativeModule as DeviceCapabilitiesModuleShape;
    }
    return null;
};

export const getDeviceCapabilities = async (): Promise<DeviceCapabilities> => {
    if (cached) return cached;

    const nativeModule = resolveModule();
    if (!nativeModule) {
        cached = UNKNOWN;
        return cached;
    }

    try {
        const capabilities = await nativeModule.getCapabilities();
        cached = {
            totalMemoryBytes: Number(capabilities?.totalMemoryBytes) || 0,
            cpuCount: Number(capabilities?.cpuCount) || UNKNOWN.cpuCount,
            isLowRamDevice: Boolean(capabilities?.isLowRamDevice),
        };
    } catch {
        cached = UNKNOWN;
    }

    return cached;
};

/**
 * Whether the device has enough RAM for a model of this size. Unknown memory
 * counts as "yes": a missing measurement must not block a capable device.
 */
export const canDeviceRunModel = async (sizeBytes: number): Promise<boolean> => {
    const { totalMemoryBytes } = await getDeviceCapabilities();
    if (!totalMemoryBytes) return true;
    return totalMemoryBytes >= sizeBytes * MEMORY_RATIO;
};

export const describeDeviceMemory = async (): Promise<string> => {
    const { totalMemoryBytes } = await getDeviceCapabilities();
    if (!totalMemoryBytes) return 'unknown';
    return `${(totalMemoryBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

/** Leaves cores for the UI and the audio thread instead of pinning every core. */
export const getInferenceThreadCount = async (): Promise<number> => {
    const { cpuCount } = await getDeviceCapabilities();
    return Math.max(2, Math.min(6, cpuCount - 2));
};
