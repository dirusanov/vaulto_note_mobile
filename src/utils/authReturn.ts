/**
 * Where a sign-in started, so finishing it returns there instead of the
 * library, together with the unsent question typed on that screen. Kept in
 * memory only: a draft question is not worth writing to disk.
 * Pure (no React Native imports), so tests can load it.
 */

/** NoteEdit: an AI action in a note asked for the sign-in and resumes there. */
export type AuthReturnTarget = 'AskNotes' | 'NoteEdit';

let pendingTarget: AuthReturnTarget | null = null;
let pendingDraft = '';

/** Called right before opening the sign-in screen. */
export const rememberAuthReturn = (target: AuthReturnTarget, draft = ''): void => {
    pendingTarget = target;
    pendingDraft = draft;
};

/** The user came back without signing in: nothing to return to any more. */
export const clearAuthReturn = (): void => {
    pendingTarget = null;
    pendingDraft = '';
};

/** Read once when the sign-in completes. */
export const takeAuthReturn = (): AuthReturnTarget | null => {
    const target = pendingTarget;
    pendingTarget = null;
    return target;
};

/** Read once by the screen that is opened again after sign-in. */
export const takeAuthReturnDraft = (): string => {
    const draft = pendingDraft;
    pendingDraft = '';
    return draft;
};

export type AfterSignIn =
    /** No remembered screen: the caller keeps its usual destination (the library). */
    | { kind: 'default' }
    /** The screen is still in the stack, with its state: go back to it. */
    | { kind: 'back'; screen: AuthReturnTarget }
    /** The stack was replaced meanwhile (e.g. terms acceptance): rebuild it. */
    | { kind: 'reset'; routes: Array<{ name: string }> };

export const planAfterSignIn = (
    target: AuthReturnTarget | null,
    stackRouteNames: string[],
): AfterSignIn => {
    if (!target) return { kind: 'default' };
    if (stackRouteNames.includes(target)) return { kind: 'back', screen: target };
    // A note cannot be rebuilt without knowing which one: the library then.
    if (target === 'NoteEdit') return { kind: 'default' };
    return { kind: 'reset', routes: [{ name: 'NotesList' }, { name: target }] };
};
