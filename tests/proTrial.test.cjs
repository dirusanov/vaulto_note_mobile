const test = require('node:test');
const assert = require('node:assert/strict');
const { getProTrialState, proTrialDaysLeft } = require('../.test-build/proTrial/proTrial.js');

const NOW = Date.parse('2026-10-24T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

test('a signed-in free account sees the offer with the server length and minutes', () => {
    const state = getProTrialState(
        { plan: 'free', pro_trial_available: true, pro_trial_days: 7, pro_trial_minutes: 60 },
        { signedIn: true, isPro: false, now: NOW },
    );
    assert.equal(state.available, true);
    assert.equal(state.active, false);
    assert.equal(state.days, 7);
    assert.equal(state.minutes, 60);
});

test('no offer for guests, Pro users or servers that do not send the field', () => {
    const profile = { plan: 'free', pro_trial_available: true };
    assert.equal(getProTrialState(profile, { signedIn: false, isPro: false }).available, false);
    assert.equal(getProTrialState(profile, { signedIn: true, isPro: true }).available, false);
    assert.equal(getProTrialState({ plan: 'free' }, { signedIn: true, isPro: false }).available, false);
    assert.equal(getProTrialState(null, { signedIn: true, isPro: false }).available, false);
});

test('a running trial counts whole days left, rounded up', () => {
    const profile = {
        plan: 'pro',
        is_pro: true,
        is_pro_trial: true,
        subscription_expires_at: new Date(NOW + 6 * DAY + 3600 * 1000).toISOString(),
    };
    const state = getProTrialState(profile, { signedIn: true, isPro: true, now: NOW });
    assert.equal(state.active, true);
    assert.equal(state.available, false);
    assert.equal(state.daysLeft, 7);
    assert.equal(state.endsAt.toISOString(), profile.subscription_expires_at);

    const lastDay = getProTrialState(
        { ...profile, subscription_expires_at: new Date(NOW + 2 * 3600 * 1000).toISOString() },
        { signedIn: true, isPro: true, now: NOW },
    );
    assert.equal(lastDay.daysLeft, 1);
});

test('a paid subscription is not a trial', () => {
    const state = getProTrialState(
        { plan: 'pro', is_pro_trial: false, subscription_expires_at: new Date(NOW + 30 * DAY).toISOString() },
        { signedIn: true, isPro: true, now: NOW },
    );
    assert.equal(state.active, false);
    assert.equal(state.daysLeft, 0);
    assert.equal(state.endsAt, null);
});

test('days left is zero after the end and for a missing date', () => {
    assert.equal(proTrialDaysLeft(new Date(NOW - 1000), NOW), 0);
    assert.equal(proTrialDaysLeft(null, NOW), 0);
    const noDate = getProTrialState({ plan: 'pro', is_pro_trial: true }, { signedIn: true, isPro: true, now: NOW });
    assert.equal(noDate.active, true);
    assert.equal(noDate.daysLeft, 1);
    assert.equal(noDate.endsAt, null);
});

test('bad server values fall back to the defaults', () => {
    const state = getProTrialState(
        { pro_trial_available: true, pro_trial_days: 0, pro_trial_minutes: 'x' },
        { signedIn: true, isPro: false },
    );
    assert.equal(state.days, 7);
    assert.equal(state.minutes, 60);
});
