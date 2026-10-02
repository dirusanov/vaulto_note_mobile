import { I18nManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { reloadAppAsync } from 'expo';

const RTL_LANGUAGES = new Set(['ar']);
const RELOAD_GUARD_KEY = 'vaulto_rtl_reload_for';

export const isRtlLanguage = (language: string | undefined | null): boolean =>
    !!language && RTL_LANGUAGES.has(language.split('-')[0]);

/**
 * Lays the UI out right-to-left for Arabic and left-to-right otherwise, no
 * matter what the device language is. React Native only applies a direction
 * change after a reload, so this reloads once; a guard stops a reload loop on
 * a platform that refuses the change.
 */
export const applyLayoutDirection = async (language: string): Promise<void> => {
    const wantRtl = isRtlLanguage(language);
    const wanted = wantRtl ? 'rtl' : 'ltr';
    if (I18nManager.isRTL === wantRtl) {
        await AsyncStorage.removeItem(RELOAD_GUARD_KEY).catch(() => undefined);
        return;
    }
    I18nManager.allowRTL(wantRtl);
    I18nManager.forceRTL(wantRtl);
    const alreadyTried = await AsyncStorage.getItem(RELOAD_GUARD_KEY).catch(() => null);
    if (alreadyTried === wanted) return;
    await AsyncStorage.setItem(RELOAD_GUARD_KEY, wanted).catch(() => undefined);
    await reloadAppAsync('layout direction changed').catch((error) => {
        console.warn('[i18n] Reload for layout direction failed', error);
    });
};

/** Mirrors directional icons (back arrows, chevrons, send) in RTL layouts. */
export const rtlFlip = I18nManager.isRTL ? { transform: [{ scaleX: -1 }] } : undefined;

const RTL_CHAR = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const STRONG_CHAR = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ֐-ࣿऀ-ॿ぀-ヿ一-鿿יִ-﷿ﹰ-﻿]/;

/**
 * Aligns a block of user text by its own first strong letter, so an English
 * note reads left-aligned in the Arabic UI and an Arabic note right-aligned in
 * any other language.
 */
export const textAlignFor = (text: string | undefined | null): { textAlign: 'left' | 'right'; writingDirection: 'ltr' | 'rtl' } => {
    const first = (text || '').match(STRONG_CHAR)?.[0];
    const rtl = first ? RTL_CHAR.test(first) : I18nManager.isRTL;
    // React Native mirrors 'left'/'right' in an RTL layout, so ask for the
    // opposite side to land on the intended one.
    const swapped = I18nManager.isRTL && (I18nManager.getConstants?.().doLeftAndRightSwapInRTL ?? true);
    const side = rtl !== swapped ? 'right' : 'left';
    return { textAlign: side, writingDirection: rtl ? 'rtl' : 'ltr' };
};
