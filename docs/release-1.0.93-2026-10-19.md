# Release 1.0.93 (93): 19 October 2026

Scope: note and audio durability, encrypted recording captions, version navigation,
Markdown export and conservative offline defaults. Pre-existing Pro/trial/paywall
changes in the main worktree are excluded. No backend changes are required.

## Repeated validation

- Full `npm test` passed in the main workspace and a clean release worktree after
  `npm ci`; includes SQLite/crypto, recovery, account isolation, concurrent retry
  persistence, task scheduling evidence, routing and version naming.
- Additional review fixed preservation of plain dictation mode after interruption,
  retained encrypted meeting parts for retries, rejection of incomplete meeting
  transcripts, cleanup of temporary decrypted parts and cancellation when a
  recording was deleted while ASR ran.
- Real Qwen3.5 0.8B on Android API 36: `Buy milk.` yields one task without a date/time
  after source validation, and no one-tap reminder based on an invented deadline.
  [Native screenshot](qa/2026-10-19/local-task-deadline-guard.png).
- Dates are accepted conservatively from recognizable source expressions. ISO,
  numeric day/month/year, supported relative days/weekdays and explicit HH:MM
  times are covered. Unsupported expressions remain undated. This does not prove
  correct semantic assignment of every deadline or resolve all model hallucinations.
- Historical native evidence: [QA report](qa-notes-voice-2026-10-19.md).

## Remaining coverage limits

Small local model summaries can introduce factual errors; generated versions remain
reviewable and separate from the original. Cloud AI after account sign-in, physical
handset speed/thermals, Google backup restoration and real Play purchases are not
newly verified by this release. Meeting partial-failure recovery is checked with
production worker code and controlled native-boundary failures, not a real hour-long
microphone recording.

## Distribution

Production, 100% rollout, authorized in the ongoing conversation. Version 1.0.92 was
still in Google review when this release preparation started. Signed bundle validation,
release-build Android smoke tests, Git push and Play review submission will be recorded
below after they complete. Google approval is required before store availability.
