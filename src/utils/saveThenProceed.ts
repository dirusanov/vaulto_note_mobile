/**
 * Saves, then does what the user asked (leave the note, switch the version).
 * When the save fails the action does not run: the editor stays open with the
 * unsaved text and `onFailure` tells the user (UX audit 2026-11-19, P1: the
 * editor used to close with the error only in the console).
 * Resolves to whether the action ran.
 */
export const saveThenProceed = async (
    save: () => Promise<unknown>,
    proceed: () => void | Promise<void>,
    onFailure: (error: unknown) => void,
): Promise<boolean> => {
    try {
        await save();
    } catch (error) {
        onFailure(error);
        return false;
    }
    await proceed();
    return true;
};
