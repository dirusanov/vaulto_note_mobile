// Simple event emitter for auth-related events across the app
type AuthEventListener = () => void;

class AuthEventEmitter {
    private listeners: AuthEventListener[] = [];

    public subscribe(listener: AuthEventListener): () => void {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    public emit() {
        this.listeners.forEach(listener => {
            try {
                listener();
            } catch (e) {
                console.error('[AuthEventEmitter] Listener error:', e);
            }
        });
    }
}

// Singleton for 401 unauthorized events
export const onUnauthorized = new AuthEventEmitter();
