import NetInfo from '@react-native-community/netinfo';

/**
 * True only when the device definitely has no internet. "Unknown" (null)
 * counts as online, so a slow probe never forces the offline path.
 */
export const isDeviceOffline = async (): Promise<boolean> => {
    try {
        const state = await NetInfo.fetch();
        return state.isConnected === false || state.isInternetReachable === false;
    } catch {
        return false;
    }
};
