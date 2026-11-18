// EAS injects the selected build profile's env before this hook runs.
if (process.env.EAS_BUILD_PLATFORM === 'ios') {
    const key = process.env.EXPO_PUBLIC_REVENUECAT_APPLE_KEY || '';
    if (!/^appl_[A-Za-z0-9]+$/.test(key) || /placeholder|your/i.test(key)) {
        throw new Error('Set a real EXPO_PUBLIC_REVENUECAT_APPLE_KEY before building iOS.');
    }
    const app = require('../app.json');
    if (app.expo.ios.bundleIdentifier !== 'com.vaultonotemobile') {
        throw new Error('The iOS Bundle ID must match Vaulto in App Store Connect and RevenueCat.');
    }
    console.log('iOS billing configuration checked.');
}
