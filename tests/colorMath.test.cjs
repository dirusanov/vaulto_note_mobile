const test = require('node:test');
const assert = require('node:assert/strict');
const { hexToHsv, hsvToHex, normalizeHex, pushRecentColor } = require('../.test-build/drawing/drawing/colorMath');

test('hex and HSV convert both ways', () => {
    for (const hex of ['#FF0000', '#00FF00', '#0000FF', '#1D1D1F', '#FDD835', '#8E24AA', '#FFFFFF', '#000000', '#7F7F7F']) {
        assert.equal(hsvToHex(hexToHsv(hex)), hex);
    }
    assert.deepEqual(hexToHsv('#FF0000'), { h: 0, s: 1, v: 1 });
    assert.equal(hsvToHex({ h: 120, s: 1, v: 1 }), '#00FF00');
    assert.equal(hsvToHex({ h: 360, s: 1, v: 1 }), '#FF0000');
});

test('hex input is normalised and garbage rejected', () => {
    assert.equal(normalizeHex('abc'), '#AABBCC');
    assert.equal(normalizeHex(' #e53935 '), '#E53935');
    assert.equal(normalizeHex('#12345'), null);
    assert.equal(normalizeHex('red'), null);
});

test('recent colours: newest first, no duplicates, capped', () => {
    let recent = [];
    for (const c of ['#111111', '#222222', '#111111', '#333333']) recent = pushRecentColor(recent, c, 3);
    assert.deepEqual(recent, ['#333333', '#111111', '#222222']);
    assert.deepEqual(pushRecentColor(recent, 'nope', 3), recent);
});
