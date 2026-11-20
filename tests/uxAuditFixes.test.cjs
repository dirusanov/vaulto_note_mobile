// Regression tests for the 2026-11-19 UX audit fixes that have pure logic:
// sign-in return to "Ask", paywall fine-print contrast, recovery/export/paywall copy.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const authReturn = require('../.test-build/uxAudit/utils/authReturn.js');
const theme = require('../.test-build/uxAudit/theme/colors.js');

test('sign-in from Ask returns to Ask with the question draft', () => {
    authReturn.rememberAuthReturn('AskNotes', 'What did I plan?');
    const target = authReturn.takeAuthReturn();
    assert.deepStrictEqual(
        authReturn.planAfterSignIn(target, ['NotesList', 'AskNotes', 'SignIn']),
        { kind: 'back', screen: 'AskNotes' },
    );
    assert.strictEqual(authReturn.takeAuthReturnDraft(), 'What did I plan?');
    // Read once.
    assert.strictEqual(authReturn.takeAuthReturn(), null);
    assert.strictEqual(authReturn.takeAuthReturnDraft(), '');
});

test('stack replaced meanwhile (terms acceptance): rebuild library + Ask', () => {
    assert.deepStrictEqual(
        authReturn.planAfterSignIn('AskNotes', ['LegalAcceptance']),
        { kind: 'reset', routes: [{ name: 'NotesList' }, { name: 'AskNotes' }] },
    );
});

test('sign-in asked by an AI action in a note returns to that note, or the library', () => {
    assert.deepStrictEqual(
        authReturn.planAfterSignIn('NoteEdit', ['NotesList', 'NoteEdit', 'SignIn']),
        { kind: 'back', screen: 'NoteEdit' },
    );
    // Which note is unknown once the stack was replaced: never an empty editor.
    assert.deepStrictEqual(authReturn.planAfterSignIn('NoteEdit', ['LegalAcceptance']), { kind: 'default' });
});

test('no remembered screen, or the user backed out: usual destination', () => {
    assert.deepStrictEqual(authReturn.planAfterSignIn(null, ['NotesList', 'SignIn']), { kind: 'default' });
    authReturn.rememberAuthReturn('AskNotes', 'q');
    authReturn.clearAuthReturn();
    assert.strictEqual(authReturn.takeAuthReturn(), null);
    assert.strictEqual(authReturn.takeAuthReturnDraft(), '');
});

const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
};
// An rgba() wash over an opaque background, as drawn.
const over = (bg, rgba) => {
    const [r, g, b, a] = rgba.match(/[\d.]+/g).map(Number);
    return `#${[r, g, b].map((c, i) => Math.round(parseInt(bg.slice(1 + i * 2, 3 + i * 2), 16) * (1 - a) + c * a)
        .toString(16).padStart(2, '0')).join('')}`;
};

test('paywall fine print (terms, dates) is at least 4.5:1 in both themes', () => {
    for (const scheme of ['light', 'dark']) {
        theme.setColorScheme(scheme);
        const c = theme.colors;
        for (const bg of [c.background, c.surface, over(c.background, c.primaryLight)]) {
            const ratio = contrast(c.textFinePrint, bg);
            assert.ok(ratio >= 4.5, `${scheme}: textFinePrint on ${bg} is ${ratio.toFixed(2)}:1`);
        }
    }
    theme.setColorScheme('light');
});

test('paywall styles no longer draw terms or dates with faint tokens', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/screens/PaywallScreen.tsx'), 'utf8');
    for (const style of ['termsText', 'trialNoticeText', 'includedLabel', 'legalLink']) {
        const block = src.slice(src.indexOf(`    ${style}: {`), src.indexOf('},', src.indexOf(`    ${style}: {`)));
        assert.match(block, /colors\.textFinePrint/, style);
    }
});

const LOCALES = ['en', 'ru', 'es', 'fr', 'de', 'zh', 'ja', 'pt', 'ar', 'hi'];
const locales = Object.fromEntries(LOCALES.map((lang) => [
    lang,
    JSON.parse(fs.readFileSync(path.join(__dirname, `../src/i18n/locales/${lang}.json`), 'utf8')),
]));
const get = (obj, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

const AUDIT_KEYS = [
    'settings.recovery.requestedIcloud', 'settings.recovery.requestedGoogle', 'settings.recovery.onDeviceOnly',
    'settings.recovery.explainRequested', 'settings.recovery.backupTip',
    'settings.sync.keyRequestedIcloud', 'settings.sync.keyRequestedGoogle',
    'notes.tagNoResults', 'notes.tagEmpty', 'notes.tagSearchAll', 'notes.tagShowAll',
    'data.exportSummaryCount', 'data.exportSummaryExcluded', 'data.exportSkippedProtectedCount',
    'data.exportSkippedLockedCount', 'data.exportNothingReadable',
    'paywall.ctaTrialThen', 'paywall.ctaSubscribe', 'paywall.ctaSubscribeOffer',
    'paywall.planYearlyPro', 'paywall.planMonthlyPro', 'paywall.purchaseWelcomeTitle', 'paywall.purchaseDoneTitle',
    'paywall.purchaseActivated', 'paywall.purchaseSyncing', 'paywall.purchaseFailed',
    'paywall.restoredTitle', 'paywall.restoreDoneTitle', 'paywall.restoredActive', 'paywall.restoredSyncing',
    'paywall.restoreNoActive', 'paywall.restoreFailed',
    'aux.verificationSentTo', 'aux.verificationCheckFailed', 'settings.ui.saveRecoveryFirst',
];

test('every audit-fix string exists in every locale, with the same placeholders', () => {
    for (const key of AUDIT_KEYS) {
        const placeholders = (s) => (s.match(/\{\{\w+\}\}/g) || []).sort().join();
        const en = get(locales.en, key);
        assert.strictEqual(typeof en, 'string', `en ${key}`);
        for (const lang of LOCALES) {
            const value = get(locales[lang], key);
            assert.strictEqual(typeof value, 'string', `${lang} ${key}`);
            assert.strictEqual(placeholders(value), placeholders(en), `${lang} ${key} placeholders`);
        }
    }
});

test('recovery-key copy no longer promises that a new phone opens the notes by itself', () => {
    for (const lang of LOCALES) {
        const recovery = get(locales[lang], 'settings.recovery');
        for (const gone of ['inGoogle', 'inIcloud', 'explainBackup', 'enableBackupTip', 'bannerGoogle', 'bannerIcloud']) {
            assert.strictEqual(recovery[gone], undefined, `${lang} settings.recovery.${gone}`);
        }
        assert.strictEqual(get(locales[lang], 'settings.sync.keyInGoogle'), undefined, lang);
        assert.strictEqual(get(locales[lang], 'settings.sync.keyInIcloud'), undefined, lang);
    }
    const en = locales.en.settings;
    assert.doesNotMatch(JSON.stringify([en.recovery, en.sync]), /by themselves|automatically/i);
    // Sign-out: a device backup is a possibility, not a promise.
    assert.doesNotMatch(en.ui.saveRecoveryFirst, /the key is restored/);
});
