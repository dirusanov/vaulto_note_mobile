import { StyleSheet } from 'react-native';
import { ColorScheme, getColorScheme } from './colors';

/**
 * Drop-in for `StyleSheet.create` whose values depend on the theme. The factory
 * runs once per color scheme; reading `styles.x` returns the sheet for the
 * scheme that is active at that moment.
 */
export function createStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
    factory: () => T & StyleSheet.NamedStyles<any>,
): T {
    const sheets: Partial<Record<ColorScheme, T>> = {};
    const resolve = (): T => {
        const scheme = getColorScheme();
        return sheets[scheme] ?? (sheets[scheme] = StyleSheet.create(factory()));
    };
    return new Proxy({} as T, {
        get: (_target, key) => (resolve() as any)[key],
        has: (_target, key) => key in (resolve() as object),
        ownKeys: () => Reflect.ownKeys(resolve() as object),
        getOwnPropertyDescriptor: (_target, key) => {
            const descriptor = Reflect.getOwnPropertyDescriptor(resolve() as object, key);
            return descriptor ? { ...descriptor, configurable: true } : undefined;
        },
    });
}
