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

Source/config validation passed: native and introspected Info.plist contain no
background audio mode, microphone purpose remains, all version declarations are
1.0.100 / 100. Full automated checks, native audio smoke, final signed IPA checks,
Apple upload and resubmission will be recorded after completion.

References:
- [expo-audio plugin settings](https://docs.expo.dev/versions/latest/sdk/audio/#configurable-properties)
- [Review guideline 2.5.4](https://developer.apple.com/app-store/review/guidelines/#software-requirements)
