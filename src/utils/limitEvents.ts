type LimitEventListener = () => void;

class LimitEventEmitter {
    private listeners: LimitEventListener[] = [];

    public subscribe(listener: LimitEventListener): () => void {
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
                console.error('[LimitEventEmitter] Listener error:', e);
            }
        });
    }
}

// Singleton for 403 limit reached events
export const onLimitReached = new LimitEventEmitter();
