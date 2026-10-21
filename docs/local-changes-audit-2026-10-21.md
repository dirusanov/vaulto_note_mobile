# Review of local mobile changes — 21 October 2026

The original `master` working directory contained 29 modified tracked files and
146 new files. The changes were useful work, not build output. Source fixes,
project memory, QA evidence and historical mobile launch records are preserved.
This audit does not make the historical campaign measurements current, send new
messages, publish a store update, deploy the backend or change the App Store
1.0.95 submission.

## Ready fixes retained in master

Commit `813a4a3` retains explicit phone-only processing even when a downloaded
model is missing, automatic downloaded-model fallback after a transport failure,
clearer local/cloud status, and model/removal dialogs usable on compact screens
with large text. These changes overlap fixes already stored in
`release/ios-1.0.95`; keeping them in master prevents their loss in later Android
work. The branches have not been merged by this audit.

It also retains the later voice-note fixes: renaming the note from any version,
avoiding duplicate raw-plus-formatted dictation, showing the items to remove in
confirmation, and preserving checked task state for questions to notes. The
[21 October native QA record](qa-voice-agent-2026-10-21.md) retains both verified
fixes and the remaining limitations. These later changes are not claimed to be
part of the already submitted iOS binary.

`npm test` passed on the original complete working tree and on an isolated copy
of the exact staged ready changes. The second check verifies the commit without
the unrelated trial feature. This run included TypeScript and all configured
unit suites. `git diff --check` passed. No new native app smoke run was performed
for this Git housekeeping task; the dated native QA evidence remains historical.
[Test output](qa/2026-10-21/local-change-audit/npm-test-stable.log).

## Pro trial preserved separately, not ready to ship

The draft is preserved in branch `wip/mobile-pro-trial-2026-10-21`, based on the
ready master changes. It includes profile/API types, trial activation and
paywall/limit/list UI plus its translations. The original bytes are retained;
this audit does not implement or claim completion of the feature.

The current public gateway OpenAPI schema has no `/billing/pro-trial/start`
endpoint. Matching gateway changes, a migration and rules tests exist locally
in the separate backend repository and are outside this mobile-only commit task.
The draft also promises minute rollover, although the matching server changes
are not deployed. Guest trial advertising needs to follow actual server
availability; trial activation, expiry, repeat requests, account switching and
rollover need integration checks. The long-recording copy promises completion
“in a minute” without a corresponding device/recording benchmark and needs review.
The feature must not be enabled in a release merely because its draft is saved.
The initial free iOS release has its own platform-specific subscription adapter;
a future merge must preserve its purchase/trial exclusions deliberately.

## Records preserved

The new `docs/` and `marketing/2026-10-launch/` files contain feedback, dated
public/author-view checks, prepared publication material, synthetic QA screenshots
and demo assets. Their measured values and caveats are archived unchanged.
They describe Vaulto Note, not Cards, so no Cards analytics database update is
required. New JSON files parse successfully; text files were scanned for selected
private-key, provider-token, bearer/JWT, password and signed-URL signatures.
OCR checks of all 48 new PNG images found no selected secret signatures, visible
email addresses or runs of 12 English recovery-dictionary words. The original
synthetic screenshots are retained. These bounded checks are not a proof that every possible sensitive datum is absent.
