const test = require('node:test');
const assert = require('node:assert/strict');
const { selectPlural, installPluralRulesIfMissing } = require('../.test-build/pluralRules/pluralRules.js');

test('Russian cardinal forms', () => {
  const cases = { 1: 'one', 21: 'one', 181: 'one', 11: 'many', 2: 'few', 4: 'few', 22: 'few', 12: 'many', 14: 'many', 5: 'many', 10: 'many', 0: 'many', 100: 'many', 111: 'many', 1.5: 'other' };
  for (const [n, cat] of Object.entries(cases)) assert.equal(selectPlural('ru', Number(n)), cat, `ru ${n}`);
});

test('other languages', () => {
  assert.equal(selectPlural('en', 1), 'one');
  assert.equal(selectPlural('en', 2), 'other');
  assert.equal(selectPlural('fr', 0), 'one');
  assert.equal(selectPlural('pt-BR', 1), 'one');
  assert.equal(selectPlural('ar', 0), 'zero');
  assert.equal(selectPlural('ar', 2), 'two');
  assert.equal(selectPlural('ar', 105), 'few');
  assert.equal(selectPlural('ar', 11), 'many');
  assert.equal(selectPlural('ja', 1), 'other');
  assert.equal(selectPlural('hi', 0), 'one');
});

test('matches the engine where Intl.PluralRules exists', () => {
  for (const lng of ['en', 'ru', 'de', 'es', 'fr', 'pt', 'hi', 'ar', 'zh', 'ja']) {
    const real = new Intl.PluralRules(lng);
    for (let n = 0; n <= 230; n++) assert.equal(selectPlural(lng, n), real.select(n), `${lng} ${n}`);
  }
});

test('installs only when missing, and i18next-style use works', () => {
  const saved = Intl.PluralRules;
  try {
    delete Intl.PluralRules;
    installPluralRulesIfMissing();
    const pr = new Intl.PluralRules('ru');
    assert.equal(pr.select(181), 'one');
    assert.deepEqual(pr.resolvedOptions().pluralCategories, ['one', 'few', 'many', 'other']);
  } finally {
    Intl.PluralRules = saved;
  }
});
