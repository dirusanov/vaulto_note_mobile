import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Which version each version was made from (version id -> source id), kept on
 * this device. Ids only, no note text. The synced step label already names the
 * chain for presets ("Summarize → Email"); this record makes the source exact
 * when two versions share a name and covers voice-agent results, whose label
 * is a single step. Other devices fall back to reading the label.
 */
const KEY = 'version_sources_v1';
/** Oldest entries go first once the record grows past this. */
const MAX_ENTRIES = 2000;

let cache: Record<string, string> | null = null;
let loading: Promise<Record<string, string>> | null = null;

export const loadVersionSources = (): Promise<Record<string, string>> => {
    if (cache) return Promise.resolve(cache);
    if (!loading) {
        loading = AsyncStorage.getItem(KEY)
            .then((raw) => {
                const parsed = raw ? JSON.parse(raw) : {};
                cache = parsed && typeof parsed === 'object' ? parsed : {};
                return cache as Record<string, string>;
            })
            .catch(() => {
                cache = {};
                return cache;
            });
    }
    return loading;
};

export const recordVersionSource = async (versionId: string, sourceId: string): Promise<void> => {
    if (!versionId || !sourceId || versionId === sourceId) return;
    const current = { ...(await loadVersionSources()) };
    delete current[versionId];
    current[versionId] = sourceId;
    const keys = Object.keys(current);
    if (keys.length > MAX_ENTRIES) {
        keys.slice(0, keys.length - MAX_ENTRIES).forEach((key) => { delete current[key]; });
    }
    cache = current;
    try {
        await AsyncStorage.setItem(KEY, JSON.stringify(current));
    } catch {
        // The label still names the chain; only the exact source is lost.
    }
};
