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

Production, 100% rollout, authorized in the ongoing conversation. The old publishing tab initially showed 1.0.92 under review; after refreshing the
Production page it was confirmed active. Google approval is required before the
new version becomes available in the store.


## Signed bundle and release-build validation

- Source commit: `35f25b50b2cbc568f79c088c4c21bc3666f02b75` (`chore: release 1.0.93`).
- EAS local production build: successful; native versionCode 93, versionName 1.0.93.
- AAB bytes: **132849351**; SHA-256: `7944b18ca70775d6d53b4df74844503237470a4fc4bc7f25ecb217c10b76b308`.
- Upload certificate SHA-256: `BF:6B:4E:CB:B0:51:DA:CA:97:06:00:7F:C5:25:FE:3D:F4:69:95:F1:BF:51:15:EE:B7:23:A1:7E:4E:AC:32:00` (matches Play upload key).
- APK set generated from this AAB for emulator-5562, re-signed only for emulator
  installation with the standard project debug key. The AAB itself keeps its
  upload signature. Installed as an upgrade without clearing test data.
- Release app starts without Metro or dev Tools; native package flags do not
  include DEBUGGABLE. Existing notes remain readable. [Version screen](qa/2026-10-19/release-93-version.png).
- New text draft with Unicode title/checklists survives force-stop from the
  editor and a cold launch. Markdown export opens the native share sheet.
- Actual Russian audio imported while Wi-Fi/mobile data were disabled, without
  a local model, is saved. Force-stop → network on → cold launch → open note:
  actual cloud ASR yields 149 characters. Reopening again leaves the same body,
  with no duplicate insertion. [Result](qa/2026-10-19/release-93-offline-online.png).
- [Native release results](qa/2026-10-19/release-93-results.json).
- Play accepted the AAB and reported ready to release, no errors and **zero
  newly unsupported devices**. Review page rollout is **100%**; release notes
  present for en-US and ru-RU.

Submission state will be appended after sending changes for review.


## Production submission confirmed

**19 October 2026, 07:15 UTC**: Google Play Publishing overview shows
**“Изменения на проверке” / “Изменения находятся на рассмотрении”** for
**93 (1.0.93), Production, full rollout (100%)**. The preliminary common-problems
check finished; no blocking issues were displayed. Managed publishing is off,
so Google will publish automatically after approval. Store availability of
1.0.93 has not yet been confirmed; 1.0.92 was active before this submission.

Release notes are saved for en-US and ru-RU. Source and signed-build QA commits
were pushed to `origin/master` before submission (`35f25b5`, `f6404fc`).
[Console receipt](qa/2026-10-19/play-93-submission.json) records the observed state.


## Live publication verified: 20 October 2026

Fresh Chrome checks at **2026-10-20T11:58:18.815092+00:00** confirm Production is active with latest
release **93 (1.0.93)** in **178 countries/regions**. Publishing overview shows
the last publication on **19 October 2026**, with no pending review section.
The public US/en store listing is available and shows **Updated on Oct 19, 2026**
and the release-93 saving/retry/version/export/model-selection release notes.
The public listing does not display a version number in the captured page; the
version is confirmed by the signed-in Production page.

[Fresh Console and public-store evidence](qa/2026-10-20/play-93-live-check.json).

This confirms availability of the submitted release-93 bundle only. Later local
network-routing, model-picker/accessibility and privacy-guard fixes documented
in the three 19 October follow-up QA reports remain uncommitted and are not
in this published bundle. No new binary was uploaded during this status check.
