import { planAfterSignIn, takeAuthReturn } from '../utils/authReturn';

/**
 * After a successful sign-in: back to the screen that asked for it (e.g. Ask
 * your notes, with its draft), or the caller's usual destination.
 */
export const finishSignIn = (navigation: any, fallback: () => void): void => {
    const names: string[] = (navigation?.getState?.()?.routes ?? []).map((route: { name: string }) => route.name);
    const plan = planAfterSignIn(takeAuthReturn(), names);
    if (plan.kind === 'default') {
        fallback();
    } else if (plan.kind === 'back') {
        // React Navigation 6: navigating to a screen already in the stack pops back to it.
        navigation.navigate(plan.screen);
    } else {
        navigation.reset({ index: plan.routes.length - 1, routes: plan.routes });
    }
};
