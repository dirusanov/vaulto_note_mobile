# Changelog

## [1.0.71] - 2026-07-22

### Fixed
- **Safe account-wide encryption transitions**: E2EE enable, disable, recovery and destructive reset now use server-authoritative transition and vault generations so stale devices cannot overwrite or resurrect data.
- **Second-device recovery**: Locked devices keep new notes local, clearly request the passphrase, and isolate notes retained after a remote reset until the user chooses local-only, standard sync or E2EE recovery.
- **Encrypted audio migration**: Audio downloads and uploads are fenced together with note data during encryption transitions.

## [1.0.70] - 2026-07-21

### Fixed
- **Multi-device encryption sync**: Account encryption transitions are reconciled before applying sync responses, concurrent setup is handled safely, offline edits survive version conflicts, and voice recordings migrate with the active encryption generation.

## [1.0.69] - 2026-07-21

### Fixed
- **Localization Coverage**: Completed translations for Spanish, French, German, Portuguese, Chinese, Japanese, Arabic and Hindi — each was missing 137 strings (mainly the entire sign-in/sign-up/password-reset flow, plus assorted error dialogs and voice-recording notices) and silently falling back to English for that content.

## [1.0.68] - 2026-07-20

### Fixed
- **Forgot-Passphrase Encryption Reset**: The "Forgot passphrase? Reset encryption" flow no longer requires unlocking the device first. It now purges the account server-side (notes, key bundle, synced audio), flips the account to plaintext mode, and wipes the local device — all without needing the lost passphrase.

## [1.0.66] - 2026-07-04

### Added
- **Voice Note Sync**: Transcriptions and audio recordings now sync across devices. Audio uploads to S3-compatible storage via presigned URLs; on end-to-end encrypted accounts both the transcription and the audio blob are encrypted client-side with the master key before leaving the device.
- **Audio Sync State**: New local sync state (`audio_synced` / `audio_remote` / `audio_sha256`) drives idempotent retries and automatic re-upload after encryption mode or key changes; legacy local-only recordings are uploaded instead of being overwritten.

### Fixed
- **Editor Caret Visibility**: The caret now stays visible above the keyboard and the docked toolbar while typing (injected caret-visibility runtime + correct keyboard insets in visual mode on both platforms).

## [1.0.65] - 2026-06-28

### Changed
- **Version Bump**: Updated app versions and build numbers across all release targets.

## [1.1.0] - 2026-05-13

### Changed
- **Unified Release Update**: Synchronized versions across the entire Vaulto ecosystem (Cards, Notes, Auth, and Sync services).
- **Google Sign-In Configuration**: Fixed misconfigured Google Client IDs and synchronized `google-services.json` across products.

## [1.0.63] - 2026-05-08

### Added
- **Full Localization**: Completed the internationalization for all core screens including Authentication, Security, and Subscriptions in English and Russian.

## [1.0.62] - 2026-04-08

### Fixed
- **Android Autolinking Cache Recovery**: Clear stale generated Android build/autolinking artifacts after moving the project directory.
- **Profile & Usage Refresh**: Load authenticated profile data and current-period usage from the gateway usage endpoints.
- **Note Editor Navigation Safety**: Prevent route param updates from firing against an already-unmounted note editor screen.

## [1.0.57] - 2026-04-08

### Added
- **Note Protection**: Added protection for the original note variant in Agent Mode to prevent overwrites from voice commands.

### Changed
- **Version Bump**: Updated app versions and build numbers across all release targets.

## [1.0.51] - 2026-04-01

### Changed
- **Annual Plan Savings**: Added savings percentage calculation and display for the yearly paywall plan.

### Fixed
- **Visual Editor Checklist Persistence**: Fixed checklist notes not persisting reliably after edits in the visual editor.

## [1.0.50] - 2026-03-27

### Added
- **Inline Voice Players**: Voice recordings can now be inserted directly into note content as embedded audio blocks in both visual and raw editing flows.

### Fixed
- **Done Button Editing UX**: Tapping the top-right checkmark now properly ends editing by removing focus, hiding the keyboard, and clearing the cursor state.
- **Audio Embed Cleanup**: Deleting a voice recording now removes its embedded references from note variants and local editor history.

## [1.0.49] - 2026-03-25

### Changed
- **Version Bump**: Updated app versions and build numbers for the release build.

## [1.0.48] - 2026-03-24

### Changed
- **Version Bump**: Synchronized app versions and build numbers across all release targets.

## [1.0.44] - 2026-03-15

### Changed
- **Version Bump**: Updated app versions and build numbers across all platforms.

## [1.0.43] - 2026-03-14

### Fixed
- **Home Screen Taps After Resume**: Improved tap handling after app background/restore so dock and other buttons respond immediately.

## [1.0.42] - 2026-03-14

### Changed
- **Version Bump**: Updated app versions and build numbers across all platforms for the next release.

## [1.0.41] - 2026-03-14

### Fixed
- **Editor Input Stability**: Prevented recent text from being rolled back during autosave/state sync, which could dismiss the keyboard, drop the first character after a newline, or close the keyboard after a short pause.

## [1.0.35] - 2026-03-04

### Changed
- **Version Bump**: Updated project versions and build numbers across all platforms.

## [1.0.34] - 2026-02-24

### Added
- **First-Install Demo Notes**: Restored the two starter demo cards on fresh installs with one-time seeding and duplicate protection.

### Changed
- **Custom AI Error UX**: Added a universal provider error in editor flows with an `Open Settings` action button.
- **Agent Mode Gate Copy**: Enforced clear Vaulto-only messaging when trying to enable Agent Mode with Custom AI.

### Fixed
- **Sync Lock Row**: Prevented `Off` status + toggle from appearing alongside `Unlock`; locked state now shows only `Locked` + `Unlock`.
- **Provider-Neutral Errors**: Removed `OpenAI` wording from missing-key errors for Custom AI provider flows.

## [1.0.33] - 2026-02-23

### Fixed
- **Sync Settings UX**: Fixed a bug where a switch was shown instead of the "Unlock" button when the sync vault was locked but sync was disabled.


All notable changes to this project will be documented in this file.

## [1.0.32] - 2026-02-23

### Fixed
- **Checklist Enter Behavior**: Fixed a bug where pressing Enter on checkbox items could create a phantom empty line.
- **Checklist Input Stability**: Removed duplicate-word side effects around Enter handling in checkbox rows.
- **Keyboard UX in Checklist**: Kept the keyboard open when creating the next checkbox item.

## [1.0.30] - 2026-02-21

### Added
- **Premium Delete Confirmation Dialog**: A redesigned, vibrant deletion prompt with smooth animations (`Animated.spring`), larger icons, and a modern top-accent aesthetic.
- **Unified Deletion UI**: Replaced native `Alert.alert` calls for recording deletions with the custom premium dialog for a consistent user experience.

### Changed
- **Toast Position**: Moved the toast notification higher (`bottom: 180`) to ensure it's not obscured by the keyboard or other UI elements.
- **showToast Utility**: Added support for custom durations in the `showToast` helper function.

### Fixed
- **Grammar Check Typo**: Corrected "Prefect! No grammar error founds" to "Perfect! No grammar errors found".
- **Code Integrity**: Resolved several syntax and scope issues in `NoteEditScreen.tsx`.
