import React, { createContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { storage } from '../utils/storage';
import { authApi, UserProfile } from '../api/auth';
import { syncService } from '../services/SyncService';
import { getDeviceId, getPlatformName } from '../utils/deviceIdentity';
import { onUnauthorized } from '../utils/authEvents';

interface AuthContextType {
    token: string | null;
    userId: string | null;
    user: UserProfile | null;
    isAuthenticated: boolean;
    isGuest: boolean;
    isLoading: boolean;
    signIn: (accessToken: string, refreshToken: string) => Promise<void>;
    signOut: () => Promise<void>;
    refreshProfile: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType>({
    token: null,
    userId: null,
    user: null,
    isAuthenticated: false,
    isGuest: false,
    isLoading: true,
    signIn: async () => { },
    signOut: async () => { },
    refreshProfile: async () => { },
});

interface AuthProviderProps {
    children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
    const [token, setToken] = useState<string | null>(null);
    const [, setRefreshToken] = useState<string | null>(null);
    const [userId, setUserId] = useState<string | null>(null);
    const [user, setUser] = useState<UserProfile | null>(null);
    const [isGuest, setIsGuest] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isRecreatingSession, setIsRecreatingSession] = useState(false);

    const createGuestSession = useCallback(async () => {
        if (isRecreatingSession) {
            console.log('[AuthContext] Already recreating session, skipping...');
            return;
        }
        setIsRecreatingSession(true);
        try {
            const deviceId = await getDeviceId();
            const platform = getPlatformName();
            console.log('[AuthContext] Creating guest session with deviceId:', deviceId);

            const guestData = await authApi.anonymousAuth(deviceId, platform);
            console.log('[AuthContext] Guest session created:', guestData.user_id);

            await storage.setToken(guestData.access_token);
            await storage.setUserId(guestData.user_id);

            // Build a UserProfile-like object from GuestProfile
            const guestUser: UserProfile = {
                id: guestData.user_id,
                email: '',
                full_name: null,
                is_verified: guestData.is_verified,
                status: 'active',
                provider: 'anonymous',
                trial_total_credits: 0,
                trial_used_credits: 0,
                trial_expires_at: undefined,
            };

            await storage.setUserProfile(guestUser);

            setToken(guestData.access_token);
            setUserId(guestData.user_id);
            setIsGuest(true);

            setUser(guestUser);
        } catch (err) {
            console.error('[AuthContext] Failed to create guest session', err);
            // App will still work locally, just without trial tracking
        } finally {
            setIsRecreatingSession(false);
        }
    }, [isRecreatingSession]);

    // Subscribe to 401 unauthorized events
    useEffect(() => {
        const unsubscribe = onUnauthorized.subscribe(() => {
            console.log('[AuthContext] Received unauthorized event, recreating guest session...');
            setToken(null);
            setUserId(null);
            setUser(null);
            setIsGuest(false);
            syncService.setAuthenticated(false);
            createGuestSession();
        });
        return unsubscribe;
    }, [createGuestSession]);

    useEffect(() => {
        const loadSession = async () => {
            console.log('[AuthContext] Loading session...');
            const storedToken = await storage.getToken();
            const storedRefreshToken = await storage.getRefreshToken();
            const storedUserId = await storage.getUserId();
            const storedProfile = await storage.getUserProfile();

            if (storedToken && storedProfile) {
                console.log('[AuthContext] cached profile found, loading immediately...');
                setToken(storedToken);
                if (storedRefreshToken) {
                    setRefreshToken(storedRefreshToken);
                }
                setUserId(storedProfile.id);
                setUser(storedProfile);
                setIsGuest(!storedProfile.is_verified && storedProfile.provider === 'anonymous');

                // IMPORTANT: Unblock UI immediately
                setIsLoading(false);

                // Refresh in background
                try {
                    console.log('[AuthContext] Refreshing profile in background...');
                    const profile = await authApi.getProfile();
                    setUserId(profile.id);
                    setUser(profile);
                    setIsGuest(!profile.is_verified && profile.provider === 'anonymous');
                    await storage.setUserId(profile.id);
                    await storage.setUserProfile(profile);
                    await syncService.setCurrentUser(profile.id, storedUserId);
                    console.log('[AuthContext] Profile refreshed:', profile.id);
                } catch (err: any) {
                    if (err?.response?.status === 401) {
                        console.log('[AuthContext] Background refresh unauthorized (401) - session likely expired');
                    } else {
                        console.error('[AuthContext] Background profile refresh failed', err);
                    }
                    // If refresh fails (e.g. offline), we are still good with cached data
                }
            } else if (storedToken) {
                // Fallback for migration or cleared cache
                console.log('[AuthContext] Token found but no profile, loading from network...');
                setToken(storedToken);
                if (storedRefreshToken) {
                    setRefreshToken(storedRefreshToken);
                }
                try {
                    const profile = await authApi.getProfile();
                    setUserId(profile.id);
                    setUser(profile);
                    setIsGuest(!profile.is_verified && profile.provider === 'anonymous');
                    await storage.setUserId(profile.id);
                    await storage.setUserProfile(profile);
                    await syncService.setCurrentUser(profile.id, storedUserId);
                    console.log('[AuthContext] Profile loaded:', profile.id, 'isGuest:', !profile.is_verified);
                } catch (err) {
                    console.error('[AuthContext] Failed to load profile, creating guest session', err);
                    await createGuestSession();
                }
                setIsLoading(false);
            } else {
                console.log('[AuthContext] No token, creating guest session');
                await createGuestSession();
                setIsLoading(false);
            }
        };
        loadSession();
    }, []);

    const signIn = async (newAccessToken: string, newRefreshToken: string) => {
        console.log('[AuthContext] Signing in with verified account...');
        await storage.setToken(newAccessToken);
        await storage.setRefreshToken(newRefreshToken);
        setToken(newAccessToken);
        setRefreshToken(newRefreshToken);
        setIsGuest(false);

        try {
            const profile = await authApi.getProfile();
            const previousUserId = await storage.getUserId();
            await storage.setUserId(profile.id);
            await storage.setUserProfile(profile);
            setUserId(profile.id);
            setUser(profile);
            await syncService.setCurrentUser(profile.id, previousUserId);
            if (previousUserId && previousUserId !== profile.id) {
                console.log('[AuthContext] Switched user from guest to verified');
            }
        } catch (err) {
            console.error('[AuthContext] Failed to fetch profile after sign-in', err);
            await signOut();
            throw err;
        }
    };

    const signOut = async () => {
        console.log('[AuthContext] Signing out, reverting to guest...');
        await storage.removeToken();
        await storage.removeRefreshToken();
        await storage.removeUserId();
        await storage.removeUserProfile();
        setToken(null);
        setRefreshToken(null);
        setUserId(null);
        setUser(null);
        setIsGuest(false);
        await syncService.setCurrentUser(null);

        // Re-create guest session
        await createGuestSession();
        setIsLoading(false);
    };

    const refreshProfile = async () => {
        if (!token) return;
        try {
            const profile = await authApi.getProfile();
            setUser(profile);
            await storage.setUserProfile(profile);
            setIsGuest(!profile.is_verified && profile.provider === 'anonymous');
        } catch (err) {
            console.error('[AuthContext] Failed to refresh profile', err);
        }
    };

    return (
        <AuthContext.Provider
            value={{
                token,
                userId,
                user,
                isAuthenticated: !!token && !isGuest,
                isGuest,
                isLoading,
                signIn,
                signOut,
                refreshProfile,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
};
