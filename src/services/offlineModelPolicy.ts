import type { DeviceCapabilities } from './DeviceCapabilities';

// RAM is a capacity check, not a speed benchmark. Keep automatic downloads
// modest when the device is unknown or has little room for the app and OS.
export const recommendSpeechModel = ({ totalMemoryBytes, isLowRamDevice }: DeviceCapabilities): 'tiny' | 'base' | 'turbo' => {
    if (isLowRamDevice || (totalMemoryBytes > 0 && totalMemoryBytes < 2.4e9)) return 'tiny';
    if (!totalMemoryBytes || totalMemoryBytes < 3.6e9) return 'base';
    return 'turbo';
};

/** Small devices still get offline speech; a language model is an explicit opt-in. */
export const recommendOfflineAI = ({ totalMemoryBytes, isLowRamDevice }: DeviceCapabilities): boolean =>
    !isLowRamDevice && totalMemoryBytes >= 3.2e9;

/** Leave room for Android and the editor before loading even the smallest LLM. */
export const hasLocalAIMemoryBudget = ({ totalMemoryBytes, isLowRamDevice }: DeviceCapabilities, modelBytes = 0): boolean =>
    !isLowRamDevice && (!totalMemoryBytes || totalMemoryBytes >= Math.max(2.4e9, modelBytes * 1.5 + 1.3e9));
