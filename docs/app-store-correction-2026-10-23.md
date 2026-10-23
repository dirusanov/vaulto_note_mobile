# App Review 2.5.4 correction — 23 October 2026

Apple rejected version 1.0.95 (95) under Guideline 2.5.4 on 23 October.
Submission: `fd95a50c-b3be-4acf-b7c4-601469a4dff5`. The reviewer devices were
iPhone 17 Pro Max and iPad Air 11-inch (M3). Apple could not locate a feature
requiring the declared `UIBackgroundModes: audio` capability. The owner supplied
the full review message; no other rejection reason was listed in it.

## Cause and correction

The installed expo-audio plugin defaults `enableBackgroundPlayback` to true,
which adds `audio` to UIBackgroundModes during native generation. The application
only sets `allowsRecording` and `playsInSilentMode`: it never enables
`shouldPlayInBackground` or `allowsBackgroundRecording`. Both runtime settings
default to false in the installed iOS module. The native capability was therefore
unused, rather than evidence of a supported persistent audio feature.

Version 1.0.100 (100) explicitly disables both background plugin options and
removes the unused audio mode from the tracked native Info.plist. Introspected
Expo config also contains no audio background mode. Foreground recording and
playback code is unchanged. No physical-device background demonstration is
claimed or submitted. Apple offered removal as the resolution when persistent
audio is not a feature.

This minimal correction starts from the actual submitted iOS source commit
1515f64, preserving its cloud AI consent, email sign-in, encryption and free iOS
purchase exclusions. It deliberately excludes subsequent unrelated Android,
drawing and UI work. The new version number skips numbers already reserved by
those parallel release branches. No Android build or publication is performed.

## Validation and resubmission

Validation completed:

- `npm test` passed (typecheck and the full project unit suite).
- Tracked, introspected and signed-IPA Info.plist contain no background audio
  mode; the microphone purpose remains. Version declarations and embedded Expo
  config are 1.0.100 / 100. Strict signature verification passed.
- Native Release simulator smoke passed: current review-account sign-in,
  recording, pause, resume, save, application relaunch, reopen, play and pause.
  The latest recording persisted as a nonempty file and database row. No fake
  microphone or AI hooks were added to the product.
- A real production cloud summary passed in the corrected simulator build:
  consent cancellation, consent allowance, separate result version, switch back
  to the preserved original, and permission revocation in Settings.

The simulator harness needed paced credential input, handling of the system
password prompt, waiting for microphone readiness, unique note titles and correct
recording-row selection. These were harness changes outside the repository; no
application runtime correction was needed. Simulator QA is not a claim of testing
the signed device IPA on physical hardware. The signed device IPA was inspected
independently.

Signed IPA: 28,088,518 bytes; SHA-256
`87a92df04097384e12d0d17b26cfe0dad394839e747d71b33d2c590a86123e93`.
Apple processed build `344247fd-c3eb-456c-97ae-85c3f9871776` as `VALID`.
The existing standard-cryptography / no-France documentation exemption was
preserved; this is not a claim that the app has no encryption.

The existing App Store version record was updated to **1.0.100**, build **100**
was selected, and private review notes explain the capability removal and how to
record and play foreground audio. Existing reviewer credentials and recovery
instructions were verified without adding them to Git.

The rejected item was marked resolved and the same submission
`fd95a50c-b3be-4acf-b7c4-601469a4dff5` was resubmitted at
**2026-10-23 07:55:01.444 UTC (10:55 Moscow)**. Independent API reads at
07:55:05 UTC confirmed version **1.0.100**, selected build **100**, version and
submission state **WAITING_FOR_REVIEW**, and release type **AFTER_APPROVAL**.
The app is awaiting Apple's decision and is not yet public in the App Store.

Evidence: [QA results and screenshots](qa/2026-10-23/ios/), including the signed
artifact inspection, passing native test logs, persisted audio check and public
submission snapshot. Earlier dated release reports remain historical records.

References:
- [expo-audio plugin settings](https://docs.expo.dev/versions/latest/sdk/audio/#configurable-properties)
- [Review guideline 2.5.4](https://developer.apple.com/app-store/review/guidelines/#software-requirements)
