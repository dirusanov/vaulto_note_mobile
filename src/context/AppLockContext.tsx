import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import {
    AppLockTimeout,
    getAppLockAutoLockTimeout,
    getHideAppSwitcherContent,
    setAppLockAutoLockTimeout,
    setHideAppSwitcherContent,
} from '../utils/storage';
import {
    changeAppLockPin,
    configureAppLockPin,
    getAppLockPinLength,
    hasAppLockPinConfigured,
    isAppLockBiometricAvailable,
    isAppLockBiometricEnabled,
    resetAppLockPin,
    setAppLockBiometricEnabled,
    unlockAppWithBiometrics,
    verifyAppLockPin,
} from '../security/appLock';
import { AudioService } from '../services/AudioService';

type AppLockStatus = 'loading' | 'not_configured' | 'locked' | 'unlocked';

interface AppLockContextType {
    status: AppLockStatus;
    isAvailable: boolean;
    isConfigured: boolean;
    isUnlocked: boolean;
    pinLength: number;
    biometricAvailable: boolean;
    biometricEnabled: boolean;
    autoLockTimeout: AppLockTimeout;
    hideAppSwitcherContent: boolean;
    shouldObscureApp: boolean;
    setupPin: (pin: string) => Promise<void>;
    unlock: (pin: string) => Promise<void>;
    unlockWithBiometrics: () => Promise<void>;
    lock: () => void;
    changePin: (currentPin: string, newPin: string) => Promise<void>;
    disable: () => Promise<void>;
    setBiometricEnabled: (enabled: boolean) => Promise<void>;
    setAutoLockTimeout: (timeout: AppLockTimeout) => Promise<void>;
    setHideInAppSwitcher: (enabled: boolean) => Promise<void>;
}

const AppLockContext = createContext<AppLockContextType | undefined>(undefined);

const timeoutToMs = (timeout: AppLockTimeout): number => {
    if (timeout === 'immediate') return 0;
    if (timeout === '30s') return 30_000;
    if (timeout === '1m') return 60_000;
    if (timeout === '5m') return 5 * 60_000;
    return 15 * 60_000;
};

export const AppLockProvider = ({ children }: { children: React.ReactNode }) => {
    const isAvailable = Platform.OS !== 'web';
    const [status, setStatus] = useState<AppLockStatus>('loading');
    const [biometricAvailable, setBiometricAvailable] = useState(false);
    const [biometricEnabled, setBiometricEnabledState] = useState(false);
    const [autoLockTimeout, setAutoLockTimeoutState] = useState<AppLockTimeout>('30s');
    const [hideAppSwitcherContent, setHideAppSwitcherContentState] = useState(true);
    const [shouldObscureApp, setShouldObscureApp] = useState(false);
    const lockTimerRef = useRef<NodeJS.Timeout | null>(null);

    const clearLockTimer = useCallback(() => {
        if (lockTimerRef.current) {
            clearTimeout(lockTimerRef.current);
            lockTimerRef.current = null;
        }
    }, []);

    const lock = useCallback(() => {
        // Best-effort memory cleanup for sensitive temporary assets on lock.
        void AudioService.cleanupTempFiles();
        setStatus((prev) => (prev === 'not_configured' ? prev : 'locked'));
    }, []);

    const setupPin = useCallback(async (pin: string) => {
        await configureAppLockPin(pin);
        setBiometricEnabledState(false);
        setStatus('unlocked');
    }, []);

    const unlock = useCallback(async (pin: string) => {
        await verifyAppLockPin(pin);
        setStatus('unlocked');
    }, []);

    const unlockWithBio = useCallback(async () => {
        await unlockAppWithBiometrics();
        setStatus('unlocked');
    }, []);

    const setBiometricEnabled = useCallback(async (enabled: boolean) => {
        await setAppLockBiometricEnabled(enabled);
        setBiometricEnabledState(enabled);
    }, []);

    const changePin = useCallback(async (currentPin: string, newPin: string) => {
        await changeAppLockPin(currentPin, newPin);
        setStatus('unlocked');
    }, []);

    const disable = useCallback(async () => {
        clearLockTimer();
        await resetAppLockPin();
        setBiometricEnabledState(false);
        setStatus('not_configured');
    }, [clearLockTimer]);

    const setAutoLockTimeout = useCallback(async (timeout: AppLockTimeout) => {
        setAutoLockTimeoutState(timeout);
        await setAppLockAutoLockTimeout(timeout);
    }, []);

    const setHideInAppSwitcher = useCallback(async (enabled: boolean) => {
        setHideAppSwitcherContentState(enabled);
        await setHideAppSwitcherContent(enabled);
    }, []);

    useEffect(() => {
        let mounted = true;

        const hydrate = async () => {
            const [configured, timeout, hidePreview, biometricFlag] = await Promise.all([
                hasAppLockPinConfigured(),
                getAppLockAutoLockTimeout(),
                getHideAppSwitcherContent(),
                isAppLockBiometricEnabled(),
            ]);
            if (!mounted) return;

            setAutoLockTimeoutState(timeout);
            setHideAppSwitcherContentState(hidePreview);
            setBiometricAvailable(isAppLockBiometricAvailable());
            setBiometricEnabledState(biometricFlag);
            setStatus(configured ? 'locked' : 'not_configured');
        };

        void hydrate();
        return () => {
            mounted = false;
        };
    }, []);

    const onAppStateChange = useCallback((nextState: AppStateStatus) => {
        if (nextState === 'active') {
            setShouldObscureApp(false);
            clearLockTimer();
            return;
        }

        if (hideAppSwitcherContent) {
            setShouldObscureApp(true);
        }
        if (nextState === 'background' || nextState === 'inactive') {
            void AudioService.cleanupTempFiles();
        }

        if (status !== 'unlocked') {
            return;
        }

        if (nextState === 'background') {
            lock();
            return;
        }

        const timeoutMs = timeoutToMs(autoLockTimeout);
        if (timeoutMs === 0) {
            lock();
            return;
        }

        clearLockTimer();
        lockTimerRef.current = setTimeout(() => {
            lock();
        }, timeoutMs);
    }, [autoLockTimeout, clearLockTimer, hideAppSwitcherContent, lock, status]);

    useEffect(() => {
        const sub = AppState.addEventListener('change', onAppStateChange);
        return () => {
            sub.remove();
            clearLockTimer();
        };
    }, [clearLockTimer, onAppStateChange]);

    const value = useMemo<AppLockContextType>(() => ({
        status,
        isAvailable,
        isConfigured: status !== 'not_configured' && status !== 'loading',
        isUnlocked: status === 'unlocked',
        pinLength: getAppLockPinLength(),
        biometricAvailable,
        biometricEnabled,
        autoLockTimeout,
        hideAppSwitcherContent,
        shouldObscureApp,
        setupPin,
        unlock,
        unlockWithBiometrics: unlockWithBio,
        lock,
        changePin,
        disable,
        setBiometricEnabled,
        setAutoLockTimeout,
        setHideInAppSwitcher,
    }), [
        autoLockTimeout,
        biometricAvailable,
        biometricEnabled,
        changePin,
        disable,
        hideAppSwitcherContent,
        isAvailable,
        lock,
        setAutoLockTimeout,
        setBiometricEnabled,
        setHideInAppSwitcher,
        setupPin,
        shouldObscureApp,
        status,
        unlock,
        unlockWithBio,
    ]);

    return (
        <AppLockContext.Provider value={value}>
            {children}
        </AppLockContext.Provider>
    );
};

export const useAppLock = () => {
    const context = useContext(AppLockContext);
    if (!context) {
        throw new Error('useAppLock must be used inside AppLockProvider');
    }
    return context;
};
