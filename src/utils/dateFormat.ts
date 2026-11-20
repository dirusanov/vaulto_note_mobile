/**
 * Dates in the app's language, not the device's: a Russian screen on an
 * English phone says "1 декабря", not "12/1/2026". Pure, so tests can load it.
 */
export const formatAppDate = (
    value: string | number | Date | null | undefined,
    language: string | undefined,
    now: Date = new Date(),
): string => {
    if (value === null || value === undefined || value === '') return '';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' };
    // The year only when it is not this one.
    if (date.getFullYear() !== now.getFullYear()) options.year = 'numeric';
    try {
        return date.toLocaleDateString(language || undefined, options);
    } catch {
        return date.toLocaleDateString(undefined, options);
    }
};
