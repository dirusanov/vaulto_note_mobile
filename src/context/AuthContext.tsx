import React, { createContext, useState, useEffect, ReactNode } from 'react';
import { storage } from '../utils/storage';
import { authApi } from '../api/auth';

interface AuthContextType {
    token: string | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    signIn: (token: string) => Promise<void>;
    signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType>({
    token: null,
    isAuthenticated: false,
    isLoading: true,
    signIn: async () => { },
    signOut: async () => { },
});

interface AuthProviderProps {
    children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
    const [token, setToken] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const loadToken = async () => {
            console.log('[AuthContext] Loading token from storage...');
            const storedToken = await storage.getToken();
            if (storedToken) {
                console.log('[AuthContext] Token found:', storedToken.substring(0, 20) + '...');
                setToken(storedToken);
            } else {
                console.log('[AuthContext] No token found in storage');
            }
            setIsLoading(false);
        };
        loadToken();
    }, []);

    const signIn = async (newToken: string) => {
        console.log('[AuthContext] Signing in, saving token...');
        await storage.setToken(newToken);
        setToken(newToken);
        console.log('[AuthContext] Token saved successfully');
    };

    const signOut = async () => {
        console.log('[AuthContext] Signing out, removing token...');
        await storage.removeToken();
        setToken(null);
        console.log('[AuthContext] Token removed');
    };

    return (
        <AuthContext.Provider
            value={{
                token,
                isAuthenticated: !!token,
                isLoading,
                signIn,
                signOut,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
};
