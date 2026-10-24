/**
 * AI limit handling for the voice flows: the session's "AI allowance used up"
 * state and the guess that keeps failed voice requests out of the note.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
function load(file) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: (name) => { throw Error(`Unexpected dependency ${name}`); }, console, Date }, { filename: file });
  return exports;
}

const limit = load('src/utils/aiLimitState.ts');
const { looksLikeVoiceCommand, shouldHintAiForRequest, voiceRequestKind } = load('src/utils/voiceCommand.ts');

test('only the AI code (or a codeless 403 from an AI endpoint) means the AI allowance', () => {
  assert.equal(limit.isLlmLimitReason('llm_tokens_exhausted'), true);
  assert.equal(limit.isLlmLimitReason('transcription_exhausted', true), false);
  assert.equal(limit.isLlmLimitReason('guest_budget_exhausted', true), false);
  assert.equal(limit.isLlmLimitReason(undefined, true), true);
  assert.equal(limit.isLlmLimitReason(undefined, false), false);
});

test('a known AI limit lasts until its reset, a success or a plan change', () => {
  limit.resetAiLimitStateForTests();
  const now = Date.parse('2026-10-23T10:00:00Z');
  assert.equal(limit.isAiLimitKnown(now), false);
  limit.markAiLimitReached('2026-11-01T00:00:00Z', now);
  assert.equal(limit.isAiLimitKnown(now), true);
  assert.equal(limit.isAiLimitKnown(Date.parse('2026-11-01T00:00:01Z')), false);

  limit.markAiLimitReached(null, now);
  assert.equal(limit.isAiLimitKnown(now + 60 * 60 * 1000), true);
  assert.equal(limit.isAiLimitKnown(now + 7 * 60 * 60 * 1000), false, 'unknown reset is checked again later');

  limit.markAiLimitReached(null, Date.now());
  limit.clearAiLimit();
  assert.equal(limit.isAiLimitKnown(), false);

  limit.noteAccountPlan('free');
  limit.markAiLimitReached(null, Date.now());
  limit.noteAccountPlan('free');
  assert.equal(limit.isAiLimitKnown(), true);
  limit.noteAccountPlan('pro');
  assert.equal(limit.isAiLimitKnown(), false);
});

test('the quiet limit notice appears once per session', () => {
  limit.resetAiLimitStateForTests();
  assert.equal(limit.takeAiLimitNotice(), true);
  assert.equal(limit.takeAiLimitNotice(), false);
});

test('usage-limit errors keep the message screens look for, and carry the reason', () => {
  const error = new limit.UsageLimitError('llm_tokens_exhausted');
  assert.equal(error.message, 'Usage limit reached');
  assert.equal(limit.usageLimitReasonOf(error), 'llm_tokens_exhausted');
  assert.equal(limit.usageLimitReasonOf(new Error('x')), undefined);
});

test('short phrases opening with an instruction read as requests', () => {
  assert.equal(looksLikeVoiceCommand('Добавь пункт: купить кофе'), true);
  assert.equal(looksLikeVoiceCommand('А теперь сделай из этого чеклист'), true);
  assert.equal(looksLikeVoiceCommand('Please make a checklist'), true);
  assert.equal(looksLikeVoiceCommand('rename the note to Budget'), true);
  assert.equal(looksLikeVoiceCommand('Назови заметку Отпуск'), true);
});

test('dictation is not mistaken for a request', () => {
  assert.equal(looksLikeVoiceCommand('Купить молоко, хлеб и кофе'), false);
  assert.equal(looksLikeVoiceCommand('Tomorrow I need to call the dentist'), false);
  assert.equal(looksLikeVoiceCommand('Добавь'), false, 'one word is not enough');
  assert.equal(looksLikeVoiceCommand(`Add ${'word '.repeat(30)}`), false, 'long text is dictation');
  assert.equal(looksLikeVoiceCommand(''), false);
});

test('a guest dictating a request gets the AI hint once', () => {
  const guest = { signedIn: false, agentAvailable: false, alreadyHinted: false };
  assert.equal(shouldHintAiForRequest({ ...guest, transcript: 'Сделай чек-лист: молоко, хлеб, яйца' }), true);
  assert.equal(shouldHintAiForRequest({ ...guest, transcript: 'Make a checklist: milk, bread, eggs' }), true);
  assert.equal(shouldHintAiForRequest({ ...guest, transcript: 'Make a checklist', alreadyHinted: true }), false, 'once per session');
  assert.equal(shouldHintAiForRequest({ ...guest, transcript: 'Купить молоко, хлеб и кофе' }), false, 'plain dictation');
  assert.equal(shouldHintAiForRequest({ ...guest, transcript: 'Make a checklist', signedIn: true }), false);
  assert.equal(shouldHintAiForRequest({ ...guest, transcript: 'Make a checklist', agentAvailable: true }), false, 'the on-device agent handles it');
});

test('the sign-in hint names what the request was about', () => {
  assert.equal(voiceRequestKind('Make a checklist: milk, bread, eggs'), 'checklist');
  assert.equal(voiceRequestKind('Добавь пункт: купить кофе'), 'checklist');
  assert.equal(voiceRequestKind('Mark milk as done'), 'checklist');
  assert.equal(voiceRequestKind('Rename this note to Groceries'), 'title');
  assert.equal(voiceRequestKind('Назови заметку Покупки'), 'title');
  assert.equal(voiceRequestKind('Translate this into English'), 'edit');
  assert.equal(voiceRequestKind('Сократи текст'), 'edit');
  assert.equal(voiceRequestKind(''), 'edit');
});
