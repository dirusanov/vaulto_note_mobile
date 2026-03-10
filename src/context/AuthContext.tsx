import React, { createContext, useState, useEffect, ReactNode, useCallback, useRef } from 'react';
import { clearSyncLockBannerDismissed, storage } from '../utils/storage';
import { authApi, UserProfile } from '../api/auth';
import { syncService } from '../services/SyncService';
import { getAllImprovementsLocal, getNotesLocal, wipeLocalDatabase } from '../services/DatabaseService';
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
    signOut: (options?: { wipeLocal?: boolean; keepLocalNotes?: boolean }) => Promise<void>;
    refreshProfile: () => Promise<UserProfile | null>;
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
    refreshProfile: async () => null,
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
    const isRecreatingSessionRef = useRef(false);

    const createGuestSession = useCallback(async (options?: { preserveLocalUserId?: boolean }) => {
        if (isRecreatingSessionRef.current) {
            console.log('[AuthContext] Already recreating session, skipping...');
            return;
        }
        isRecreatingSessionRef.current = true;
        try {
            const preserveLocalUserId = options?.preserveLocalUserId ?? false;
            const existingLocalUserId = await storage.getUserId();
            const shouldPreserveLocalUserId = preserveLocalUserId && !!existingLocalUserId;
            const deviceId = await getDeviceId();
            const platform = getPlatformName();
            console.log('[AuthContext] Creating guest session with deviceId:', deviceId);

            const guestData = await authApi.anonymousAuth(deviceId, platform);
            console.log('[AuthContext] Guest session created:', guestData.user_id);

            await storage.setToken(guestData.access_token);
            if (!shouldPreserveLocalUserId) {
                await storage.setUserId(guestData.user_id);
            }

            // Build a UserProfile-like object from GuestProfile
            const legacyGuestData = guestData as unknown as {
                transcription_max_seconds?: number;
                transcription_used_seconds?: number;
            };
            const guestTotalSeconds =
                guestData.transcription_total_seconds
                ?? legacyGuestData.transcription_max_seconds
                ?? 1800;
            const guestTotalUsed =
                guestData.transcription_total_used_seconds
                ?? legacyGuestData.transcription_used_seconds
                ?? 0;
            const guestUser: UserProfile = {
                id: guestData.user_id,
                email: '',
                full_name: null,
                is_verified: guestData.is_verified,
                status: 'active',
                provider: 'anonymous',
                transcription_total_seconds: guestTotalSeconds,
                transcription_total_used_seconds: guestTotalUsed,
                transcription_remaining_seconds: guestData.transcription_remaining_seconds ?? guestTotalSeconds,
                has_llm_access: guestData.has_llm_access ?? true,
            };

            await storage.setUserProfile(guestUser);

            setIsGuest(true);
            setUser(guestUser);
            if (!shouldPreserveLocalUserId) {
                setUserId(guestData.user_id);
            }
            setToken(guestData.access_token);
        } catch (err) {
            console.error('[AuthContext] Failed to create guest session', err);
            // App will still work locally, just without trial tracking
        } finally {
            isRecreatingSessionRef.current = false;
        }
    }, []);

    // Subscribe to 401 unauthorized events
    useEffect(() => {
        const unsubscribe = onUnauthorized.subscribe(() => {
            const handleUnauthorized = async () => {
                console.log('[AuthContext] Received unauthorized event, recreating guest session...');
                const previousUserId = await storage.getUserId();
                setUserId(previousUserId ?? null);
                setToken(null);
                setUser(null);
                setIsGuest(false);
                syncService.setAuthenticated(false);
                await createGuestSession({ preserveLocalUserId: true });
            };
            void handleUnauthorized();
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
            const keepLocalNotes = await storage.getKeepLocalNotes();

            if (storedToken && storedProfile) {
                console.log('[AuthContext] cached profile found, loading immediately...');
                setToken(storedToken);
                if (storedRefreshToken) {
                    setRefreshToken(storedRefreshToken);
                }
                const preserveLocalUserId = keepLocalNotes && storedProfile.provider === 'anonymous' && !!storedUserId;
                setUserId(preserveLocalUserId ? storedUserId : storedProfile.id);
                setUser(storedProfile);
                setIsGuest(!storedProfile.is_verified && storedProfile.provider === 'anonymous');

                // IMPORTANT: Unblock UI immediately
                setIsLoading(false);

                // Refresh in background
                try {
                    console.log('[AuthContext] Refreshing profile in background...');
                    const profile = await authApi.getProfile();
                    setUser(profile);
                    setIsGuest(!profile.is_verified && profile.provider === 'anonymous');
                    const preserveOnRefresh = keepLocalNotes && profile.provider === 'anonymous' && !!storedUserId;
                    if (preserveOnRefresh) {
                        setUserId(storedUserId);
                    } else {
                        setUserId(profile.id);
                        await storage.setUserId(profile.id);
                    }
                    await storage.setUserProfile(profile);
                    await syncService.setCurrentUser(preserveOnRefresh ? storedUserId : profile.id, storedUserId);
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
                } catch (err: any) {
                    const status = err?.response?.status;
                    if (status === 401) {
                        console.error('[AuthContext] Profile unauthorized, creating guest session', err);
                        if (keepLocalNotes && storedUserId) {
                            setUserId(storedUserId);
                        } else {
                            setUserId(null);
                        }
                        await createGuestSession({ preserveLocalUserId: keepLocalNotes });
                    } else {
                        console.error('[AuthContext] Failed to load profile (keeping existing token state)', err);
                        if (storedUserId) {
                            setUserId(storedUserId);
                            await syncService.setCurrentUser(storedUserId, storedUserId);
                        } else {
                            setUserId(null);
                        }
                        setIsGuest(false);
                    }
                }
                setIsLoading(false);
            } else {
                console.log('[AuthContext] No token, creating guest session');
                if (keepLocalNotes && storedUserId) {
                    setUserId(storedUserId);
                } else {
                    setUserId(null);
                }
                await createGuestSession({ preserveLocalUserId: keepLocalNotes });
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
            const profile = await authApi.getProfile(newAccessToken);
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
            await signOut({ wipeLocal: false });
            throw err;
        }
    };

    const signOut = async (options?: { wipeLocal?: boolean; keepLocalNotes?: boolean }) => {
        const keepLocalNotes = options?.keepLocalNotes ?? false;
        const shouldWipeLocal = !keepLocalNotes && (options?.wipeLocal ?? true);
        const previousUserId = userId;
        console.log('[AuthContext] Signing out, reverting to guest...');
        if (previousUserId) {
            await storage.removeStoredMasterKey(previousUserId);
            await clearSyncLockBannerDismissed(previousUserId);
        }
        await storage.removeToken();
        await storage.removeRefreshToken();
        if (!keepLocalNotes) {
            await storage.removeUserId();
        }
        await storage.removeUserProfile();
        setToken(null);
        setRefreshToken(null);
        if (!keepLocalNotes) {
            setUserId(null);
        }
        setUser(null);
        setIsGuest(false);
        await storage.setKeepLocalNotes(keepLocalNotes);
        await syncService.setCurrentUser(null);

        if (shouldWipeLocal) {
            try {
                await wipeLocalDatabase();
                if (previousUserId) {
                    const [remainingNotes, remainingImprovements] = await Promise.all([
                        getNotesLocal(previousUserId),
                        getAllImprovementsLocal(previousUserId),
                    ]);
                    if (remainingNotes.length > 0 || remainingImprovements.length > 0) {
                        console.error(
                            '[AuthContext][WIPE FAILED] Local DB still has data after sign out',
                            {
                                userId: previousUserId,
                                notesCount: remainingNotes.length,
                                improvementsCount: remainingImprovements.length,
                                noteIds: remainingNotes.slice(0, 50).map(n => n.id),
                                improvementIds: remainingImprovements.slice(0, 50).map(i => i.id),
                            }
                        );
                    }
                }
            } catch (err) {
                console.error('[AuthContext] Failed to wipe local DB on sign out', err);
            }
        }

        // Re-create guest session
        await createGuestSession({ preserveLocalUserId: keepLocalNotes });
        setIsLoading(false);
    };

    const refreshInFlight = useRef<Promise<UserProfile | null> | null>(null);

    const refreshProfile = useCallback(async () => {
        if (!token) return null;
        if (refreshInFlight.current) return refreshInFlight.current;

        refreshInFlight.current = (async () => {
            try {
                const profile = await authApi.getProfile();
                setUser(profile);
                await storage.setUserProfile(profile);
                setIsGuest(!profile.is_verified && profile.provider === 'anonymous');
                return profile;
            } catch (err) {
                console.error('[AuthContext] Failed to refresh profile', err);
                return null;
            } finally {
                refreshInFlight.current = null;
            }
        })();

        return refreshInFlight.current;
    }, [token]);

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
