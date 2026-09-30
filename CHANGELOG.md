# Changelog

## [1.0.74] - 2026-09-30

### Fixed
- **Voice transcription**: Uploads failed with "Unsupported FormDataPart implementation" because SDK 57's `expo/fetch` cannot send React Native `{ uri }` file parts; audio is now sent as an `expo-file-system` `File` (Vaulto AI and custom OpenAI-compatible endpoints).
- **Recording inside a note**: A plain tap on the in-note mic opened a recorder that never started; it now records immediately (tap and long-press only choose the mode).
- **AI agent**: A voice note turned into a checklist no longer keeps the raw dictation above the list; titles in a different script than the note (e.g. a Russian title on an English note) are dropped in favour of one derived from the content.
- **AI improvements**: Variant titles come from the first line/heading instead of gluing heading and list items together; blank lines from model Markdown no longer become empty paragraphs.
- **Raw mode**: "Raw Markdown" shows and edits Markdown instead of editor HTML; "Copy Markdown" copies real Markdown; Markdown links round-trip.
- **Checklists**: Ticking a checkbox while reading no longer switches the note into edit mode.
- **E2EE startup**: The notes list re-reads local data once the master key is restored, so notes no longer disappear after a reload; expected "E2EE locked" is not logged as an error.
- **Microphone permission**: The recorder panel waits for the permission answer and explains a denial.
- **Custom AI**: Opening the Custom AI tab no longer switches the provider until a connection test succeeds.
- **Paywall**: Shows a message and a retry button when plans cannot be loaded.
- **Android release build**: `hermesCommand` pointed at `react-native/sdks/hermesc`, which React Native 0.86 no longer ships; release builds now use the `hermes-compiler` package.

### Added
- **Note versions**: Chips name the step that produced a version ("Summarize", "Make Professional → Summarize") instead of repeating the first words of the text; duplicates are numbered.
- **Improve from Original or this version**: With a version open, the AI sheet asks which text to improve; the result is always saved as a new version, so an existing version is never overwritten.
- **All versions sheet**: A list of every version with its step, title, time and preview, plus "Use as main text" (the old original is kept as "Previous original"), "Copy to new note" and delete.
- **Compare with Original**: Word-level diff of the open version against the original.
- **Swipe between versions** while reading a note.
- **Ask your notes**: A chat that answers questions from your notes with numbered sources that open the note. Retrieval runs on the device over decrypted notes; only the best-matching excerpts go to the AI, and local-only notes stay out unless AI is allowed for them. Opened from the new ✨ dock button or "Ask AI" under a search.
- **Find tasks**: The note menu extracts action items with dates resolved against today ("on Friday" → Fri, Oct 2), adds the chosen ones as a checklist (skipping ones already there) or opens each in the system calendar editor to set a reminder (`expo-calendar`, no calendar permission needed).
- **Transcribe on device**: A Settings switch downloads a Whisper model once and then transcribes recordings (plain and Agent Mode) on the phone, offline, without the audio leaving it; real-time dictation in the editor toolbar is enabled. The all-local AI provider stays off.
- **Protected notes** (replace "local-only"): a protected note never leaves the device unencrypted. AI features, Find tasks, the notes chat, Agent Mode and cloud voice transcription are off for it; voice is transcribed on the phone (the app offers to download the speech model). It syncs only end-to-end encrypted — on by default, waiting for E2EE on accounts without it — and sync can be turned off with a warning that the note then exists only on this phone. The flag syncs across devices, and the server rejects any protected-note text that is not end-to-end ciphertext. Share/export stay off; existing local-only notes become protected with sync off. Without an account nothing syncs.
- **Home screen layout**: The bottom bar keeps three actions (✨ Ask, record, new note) with room between them; search is a bar at the top with Settings beside it, always visible (it used to appear only by scrolling a list of six or more notes). A search without results says so instead of "Tap the microphone to record".
- **Faster, smarter search**: The list searches the already-decrypted notes in memory instead of decrypting every note from the database on each keystroke; it matches plain text rather than HTML markup (no hits on tags, `&` works), every word in any order, inflected forms and ё/е, including versions. A background sync no longer resets an active search.
- **Touch targets**: Editor header buttons, sheet close buttons, version chips and actions, recorder controls, search bar buttons and the chat are at least 48dp (chips 40dp plus slop).

### Changed
- **Versions row**: "Original" stays pinned at the left; deleting a version is instant with Undo instead of a confirmation dialog.
- **One title per note**: Switching versions no longer changes the note title in the header or in the list.
- **Privacy**: A version's synced `label` now holds only the step name, never a title derived from the (end-to-end encrypted) note text or a custom prompt's name. Existing labels are rewritten once on the device at startup (and on the server by migration `20260930_01_sanitize_labels`), and the server rejects anything else.
- **Localization**: Remaining hardcoded strings (balances, AI presets, agent status, recorder chips, editor placeholder) are translated in all ten locales.
- **Accessibility**: Icon-only buttons have screen-reader labels.
- **Note cards**: Previews keep line breaks and checklist state; untitled notes use their first line as the title.

## [1.0.72] - 2026-09-11

### Added
- **Offline real-time dictation**: Local Whisper gains the turbo model, a streaming dictation wrapper, a download modal with progress, and a dictate button in the editor toolbar — speech-to-text works fully on-device.
- **Editor toolbar**: H1/H3 headings exposed; text styles moved ahead of headings so they stay reachable on narrow screens.

### Fixed
- **Lossless markdown round-trips**: Emphasis follows CommonMark flanking rules, so `user_id`, `my_file.txt` and `2 * 3 * 4` are no longer mangled into italics; empty runs (`**`, `~~`, `==`) are literal text; `- []` no longer throws on open; nested lists keep their indentation in both directions; `&amp;lt;` is not double-decoded.
- **AI improvements rendering**: AI-authored titles and variant chips no longer show raw markdown; the suggestion preview renders headings, lists, checkboxes, quotes, code and links; previously stored titles are conservatively healed.
- **Editor reliability**: The editor no longer binds to stale onChange/onFocus callbacks; active-formatting state reaches the screen only when it changes.
- **Editor typography**: Headings, blockquotes, code, links, rules and images are styled from the chosen base font size instead of the WebView defaults; toolbar and floating mic clear the Android navigation bar.
- **E2EE recovery**: Mobile recovery flow is crash-safe.
- **Localization**: All ten locales cover every key (aux.* namespace, reset-recovery keys, 29 previously missing keys); remaining hardcoded strings wired to i18n; note dates follow the app language; version row reads app.json.

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
