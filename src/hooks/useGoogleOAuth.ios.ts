// Email sign-in is available on iOS. Native social sign-in will be added with
// its own iOS configuration and an equivalent privacy-preserving login option.
export const useGoogleOAuth = () => ({
    signInWithGoogle: async () => null,
    loading: false,
    lastError: null,
    clearLastError: () => undefined,
});
