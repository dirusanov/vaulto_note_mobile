const test = require('node:test');
const assert = require('node:assert/strict');
const {
    ActiveClock,
    resolveRecordedMs,
    msToStoredSeconds,
    recorderBackAction,
    DISCARD_CONFIRM_AFTER_SECONDS,
} = require('../.test-build/recorderAudio/recordingClock.js');
const { accessibleSeekStepSeconds, accessibleSeekTarget, formatClock } = require('../.test-build/recorderAudio/audioSeek.js');

test('5 s speech, 30 s pause, 5 s speech is stored as 0:10', () => {
    const clock = new ActiveClock();
    clock.start(0);
    clock.pause(5_000);
    assert.equal(clock.elapsedMs(35_000), 5_000, 'paused time does not run');
    clock.resume(35_000);
    const tracked = clock.elapsedMs(40_000);
    assert.equal(tracked, 10_000);
    // No native value: the pause-aware clock decides.
    assert.equal(msToStoredSeconds(resolveRecordedMs(null, tracked)), 10);
    // Native count (which skips pauses) is preferred when present.
    assert.equal(msToStoredSeconds(resolveRecordedMs(10_200, tracked)), 10);
    // A native value that counted the pause is not trusted.
    assert.equal(msToStoredSeconds(resolveRecordedMs(40_000, tracked)), 10);
    assert.equal(formatClock(msToStoredSeconds(resolveRecordedMs(null, tracked))), '0:10');
});

test('pause and resume are idempotent; stop while paused keeps the count', () => {
    const clock = new ActiveClock();
    clock.start(1_000);
    clock.pause(4_000);
    clock.pause(9_000);
    assert.equal(clock.elapsedMs(20_000), 3_000);
    clock.resume(20_000);
    clock.resume(25_000);
    assert.equal(clock.elapsedMs(26_000), 9_000);
    clock.reset();
    assert.equal(clock.elapsedMs(30_000), 0);
});

test('stored seconds are never negative or NaN', () => {
    assert.equal(msToStoredSeconds(NaN), 0);
    assert.equal(msToStoredSeconds(-5), 0);
    assert.equal(resolveRecordedMs(undefined, NaN), 0);
});

test('system Back drops only a short take; longer or segmented recordings ask', () => {
    const base = { isRecording: true, isStopping: false, durationSeconds: 0, meetingSegments: 0 };
    assert.equal(recorderBackAction(base), 'close');
    assert.equal(recorderBackAction({ ...base, durationSeconds: DISCARD_CONFIRM_AFTER_SECONDS - 1 }), 'close');
    assert.equal(recorderBackAction({ ...base, durationSeconds: DISCARD_CONFIRM_AFTER_SECONDS }), 'ask');
    assert.equal(recorderBackAction({ ...base, durationSeconds: 20 }), 'ask', '20 s recording (paused or not)');
    assert.equal(recorderBackAction({ ...base, durationSeconds: 1, meetingSegments: 1 }), 'ask', 'after the first meeting segment');
    assert.equal(recorderBackAction({ ...base, isRecording: false, meetingSegments: 2 }), 'ask');
    assert.equal(recorderBackAction({ ...base, isStopping: true, durationSeconds: 60 }), 'ignore');
    assert.equal(recorderBackAction({ ...base, isRecording: false }), 'close', 'not started yet');
});

test('screen-reader seek steps 10 s on long recordings and 5 % on short ones, clamped', () => {
    assert.equal(accessibleSeekStepSeconds(300), 10);
    assert.equal(accessibleSeekStepSeconds(60), 3);
    assert.equal(accessibleSeekStepSeconds(10), 1);
    assert.equal(accessibleSeekStepSeconds(0), 0);
    assert.equal(accessibleSeekTarget(83, 300, 1), 93);
    assert.equal(accessibleSeekTarget(5, 300, -1), 0);
    assert.equal(accessibleSeekTarget(295, 300, 1), 300);
    assert.equal(accessibleSeekTarget(0, 0, 1), 0);
    assert.equal(formatClock(83), '1:23');
    assert.equal(formatClock(300), '5:00');
});
