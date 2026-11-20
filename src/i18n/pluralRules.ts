/**
 * Cardinal plural categories (CLDR) for the app's languages.
 *
 * Hermes on Android ships Intl without PluralRules, so i18next fell back to
 * the `_other` form everywhere ("181 символа", "10 заметки"). This covers
 * exactly the languages in src/i18n/locales; anything else gets "other".
 */
export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

const CATEGORIES: Record<string, PluralCategory[]> = {
    en: ['one', 'other'],
    de: ['one', 'other'],
    es: ['one', 'many', 'other'],
    pt: ['one', 'many', 'other'],
    fr: ['one', 'many', 'other'],
    hi: ['one', 'other'],
    ru: ['one', 'few', 'many', 'other'],
    ar: ['zero', 'one', 'two', 'few', 'many', 'other'],
    zh: ['other'],
    ja: ['other'],
};

const baseLanguage = (locale: string): string => (locale || '').toLowerCase().split(/[-_]/)[0];

export const pluralCategoriesFor = (locale: string): PluralCategory[] => CATEGORIES[baseLanguage(locale)] ?? ['one', 'other'];

export const selectPlural = (locale: string, value: number): PluralCategory => {
    const n = Math.abs(Number(value));
    if (!Number.isFinite(n)) return 'other';
    const isInteger = Number.isInteger(n);
    const i = Math.floor(n);
    switch (baseLanguage(locale)) {
        case 'ru': {
            if (!isInteger) return 'other';
            const m10 = i % 10;
            const m100 = i % 100;
            if (m10 === 1 && m100 !== 11) return 'one';
            if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'few';
            return 'many';
        }
        case 'ar': {
            if (!isInteger) return 'other';
            const m100 = i % 100;
            if (i === 0) return 'zero';
            if (i === 1) return 'one';
            if (i === 2) return 'two';
            if (m100 >= 3 && m100 <= 10) return 'few';
            if (m100 >= 11 && m100 <= 99) return 'many';
            return 'other';
        }
        case 'fr':
            if (i === 0 || i === 1) return 'one';
            return isInteger && i !== 0 && i % 1000000 === 0 ? 'many' : 'other';
        case 'pt':
            if (i === 0 || i === 1) return 'one';
            return isInteger && i !== 0 && i % 1000000 === 0 ? 'many' : 'other';
        case 'es':
            if (n === 1) return 'one';
            return isInteger && i !== 0 && i % 1000000 === 0 ? 'many' : 'other';
        case 'hi':
            return i === 0 || n === 1 ? 'one' : 'other';
        case 'zh':
        case 'ja':
            return 'other';
        default:
            return n === 1 && isInteger ? 'one' : 'other';
    }
};

/** Installs a minimal Intl.PluralRules when the engine has none (Hermes). */
export const installPluralRulesIfMissing = (): void => {
    const intl = (globalThis as { Intl?: Record<string, unknown> }).Intl;
    if (!intl || typeof intl.PluralRules === 'function') return;
    class PluralRules {
        private readonly locale: string;
        private readonly type: string;
        constructor(locales?: string | string[], options?: { type?: string }) {
            const first = Array.isArray(locales) ? locales[0] : locales;
            this.locale = first || 'en';
            this.type = options?.type || 'cardinal';
        }
        select(value: number): PluralCategory {
            return this.type === 'ordinal' ? 'other' : selectPlural(this.locale, value);
        }
        resolvedOptions() {
            return {
                locale: this.locale,
                type: this.type,
                pluralCategories: this.type === 'ordinal' ? ['other'] : pluralCategoriesFor(this.locale),
            };
        }
        static supportedLocalesOf(locales: string | string[]): string[] {
            return Array.isArray(locales) ? locales : [locales];
        }
    }
    intl.PluralRules = PluralRules;
};
