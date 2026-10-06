# Changelog

## [1.0.90] - 2026-10-06

### Added
- Voice requests without a switch: every recording is either dictation (inserted as is) or a request ("make a shopping list…", "name the note…"). Online with an account our server decides; with "Only on this phone", offline or in a protected note the phone model does (Qwen3.5 2B/4B, short phrases only, so long dictation is never delayed). The original note is never rewritten: results go to a separate version.
- Settings → Voice & AI → Models: pick any speech and AI model. The best fit for the phone is marked; a heavier one gets a calm note (and, with "Only on this phone", an offer of Vaulto cloud); models too big for the phone's memory are shown but disabled.
- Offline models download in the background on Android (system download manager): the download keeps going with the app closed, resumes after network drops, shows progress in notifications, and the app picks it up again when reopened.

### Changed
- The "Agent" chip in the recorder is gone.
- First sign-in: when the encryption key reached the Google backup (iCloud Keychain on iOS), there is nothing to write down — a short banner says the notes are end-to-end encrypted and where the key is. Without a cloud backup the 24-word key is shown as before, until saved. The key is always in Settings → Recovery key.

## [1.0.89] - 2026-10-05

### Added
- The encryption key is kept by the phone: Google Block Store on Android (survives a reinstall and moves to a new phone with Google backup; the cloud copy is end-to-end encrypted with the screen lock), iCloud Keychain on iOS. Signing in again opens the notes without typing the key.
- Settings shows where the key is kept ("In your Google backup" or, in warning colour, "Only on this phone"); viewing the key asks for the fingerprint or PIN.

### Fixed
- After signing in again the kept key was found but the notes stayed locked (a restore attempt interrupted by the sign-in reload was counted as done).
- Sign-out dialog explains how encrypted notes are opened again.

Verified on two emulators against production: new account, sign out/in, switching accounts on one phone, one account on two phones (QR), sign out with delete, legacy passphrase account.

## [1.0.88] - 2026-10-04

### Added
- Voice works right after install: guests get 10 free minutes of cloud speech-to-text; when they run out, sign in for more or use the phone model.
- Offline mode, one switch: the best speech and AI models this phone can run are downloaded together; "Only on this phone" keeps voice and AI on the device.
- End-to-end encryption on by default: on sign-in, sync is encrypted with a generated recovery key (24 words + QR), shown once until saved; a new phone unlocks with the key or its QR.
- Offline recordings turn into text automatically when the network is back.

### Changed
- Settings: "Voice & AI" replaces the AI Model card, its switches and model lists; Cloud Sync shows its protection and the recovery key; export/import are list rows; calmer account footer.
- A transcribed recording shows only its text in the note (the audio stays in the note's recordings).

### Fixed
- Importing the recovery key's QR from an image (never worked); the unlock sheet no longer closes when the gallery opens.
- Signing out with notes kept and into another account no longer moves the first account's notes into it.
- Out of cloud minutes with the phone model downloaded: transcribed on the phone.
- Model downloads: no duplicate or corrupted downloads, the model in use stays until the new one is ready, early cancel works.

Verified on two emulators syncing one encrypted account (create, edit, delete both ways; unlock by QR; server stores only ciphertext).

## [1.0.87] - 2026-10-02

### Fixed
- On-device transcripts no longer contain Whisper sound captions such as "[Birds chirping]" (brackets inside speech are kept).
- Unencrypted recorder leftovers (interrupted recordings, meeting joins, shared audio) older than a day are deleted from the cache on start.

Verified on a release (R8) build: widget record/write/ask and Share to Vaulto from a cold start; meeting chip lock, pause across a part switch, joining parts and cancel without leftovers.

## [1.0.86] - 2026-10-02

### Fixed
- Meeting mode: cancel or pause during a part switch stopped the microphone correctly; a failure to continue, a last part that fails to stop, a failed join or an interruption now keeps the parts already recorded instead of losing the meeting; the Meeting chip locks once parts exist.
- After using the widget's record button, a theme change could open the recorder again.
- Trash: restoring brings back AI versions (e.g. meeting notes) and every recording; a double tap no longer creates two copies; "sign out and erase" also erases the trash and its recordings; a guest's trash moves to the account on sign-in; empty drafts no longer land in the trash.
- Share to Vaulto: large audio files are copied in the background (no freeze); reopening the app from Recents no longer imports the same share twice.
- Reminders from protected notes show a generic title on the lock screen.

## [1.0.85] - 2026-10-02

### Added
- **Share to Vaulto** (Android): text and links shared from any app become a new note (the subject, if any, is the title); audio files are transcribed and kept as a playable card.
- **Quick Settings tile** "Vaulto: record" and a **home-screen widget** (record / write / ask), light and dark, localized.
- **Trash**: deleted notes stay 30 days and can be restored with their recordings (Settings → Notes → Trash); delete for good or empty the trash. The undo bar now says "Moved to trash".
- **Tags**: #hashtags in the text become tags, with a filter row above the list; tags are highlighted in cards. They live in the note text, so they are encrypted and synced with it.
- **Meeting mode**: a "Meeting" chip in the recorder records up to 60 minutes in parts, transcribes each part, then writes a "Meeting · <date>" version with summary, key points, decisions, an action checklist and open questions. A "Meeting Notes" preset is in the AI menu for any note.
- **Task reminders**: a bell next to each dated task in "Find tasks" sets a notification at its time (9:00 when only a date is known); tapping it opens the note. Works offline.
- **Weekly summary** (Settings → Notes): a Sunday 18:00 notification opens the notes chat with a summary of the last 7 days.
- **Export / import**: export every note as Markdown files in a ZIP (protected notes are never exported in plain text); import .md/.txt files, a ZIP, or a Google Keep Takeout (checklists kept, labels become tags).

### Fixed
- Untitled notes always show their text in the card (single-line notes could show an empty card or a bold made-up title).
- Editor toasts are translated; error toasts show an error icon.
- An offline session could switch Agent Mode off for good.

## [1.0.84] - 2026-10-02

### Changed
- **Works offline with downloaded models**: without internet, recordings are transcribed by the on-device Whisper model and text editing, the notes chat and "Find tasks" run on the on-device AI, even when the cloud is the chosen provider. The cloud agent is skipped offline and the transcript is inserted as is. Protected notes still follow only the explicit choice.
- **Voice in the note**: the recording card is added under its transcript, not only when there is no text.
- **Note cards**: voice-only notes show a mic, a wave and the length instead of a "Voice note" placeholder; untitled notes show their text instead of a cut title repeated by the preview.
- The 4B on-device model is recommended from 8 GB of RAM (2B below).

### Fixed
- Recording offline with cloud transcription made the voice note appear only after a request timed out (up to 90 s); it now appears at once with "No internet: the recording is saved".
- New voice notes showed 0:00 as their length; lengths lost when a note was saved as markdown are restored from the stored recordings.
- The audio card's first tap switched the note to edit mode instead of playing.
- The app could be killed for memory on 6 GB phones when speech and AI models were both loaded; they are now never in memory together, and the speech model is freed after a quiet minute.
- The on-device grammar check almost always answered "No errors"; it now returns corrections for review.

## [1.0.83] - 2026-10-02

### Added
- **Tablet layouts**: the notes grid has 3 columns on tablets and 4 in wide landscape; the editor, settings, notes chat, paywall and sign-in screens keep a readable centred column; bottom sheets and the recorder bar stay phone-width.

### Fixed
- Layout survives rotation: sizes are read live instead of once at start (Android 16 ignores the portrait lock on large screens, so tablets rotate).

## [1.0.82] - 2026-10-02

### Added
- Google button on the sign-up screen (new Google users accept the terms on the legal screen); the official multicolour Google logo.

### Changed
- Settings: sync and encryption rows use the same weight as the AI rows; the encryption row reads "End-to-end encryption"; Agent Mode explains why it is off (on-device AI, or not signed in); guests no longer see the sync card (the account card offers sign-in).
- Sign-up subtitle says what you get ("30 minutes of transcription free"); consent reads "I accept…" with Russian links in the right case (also on the legal acceptance screen).

### Fixed
- Primary buttons had dark text on blue in the dark theme ("Sign in or create account").
- Compare versions: a removed word and its replacement no longer run together.
- The version close button is a 48dp target; the prompt builder hint sits under the field it explains.

## [1.0.81] - 2026-10-02

### Added
- **Dark theme**: System / Light / Dark in Settings, applied instantly without a restart (the open screen stays put). Editor, audio card, status bar and navigation follow; iOS now follows the system appearance.
- **Undo for deletes**: deleting from the list needs no confirmation; notes leave at once and an "Undo" bar stays for 5 seconds before anything is erased.
- **Haptics** on record start/stop, selecting notes, delete, copy, sending a question, adding tasks, plan and theme choice.
- **Animations**: cards sink slightly under the finger; the list animates when notes are added, removed or filtered.
- **Arabic right-to-left**: the whole layout mirrors (one quick reload on switching); directional icons flip; note text aligns by its own script in cards and in the editor.
- **Offline note** on the list: "Offline. Changes are saved and will sync later."

### Changed
- **Paywall**: selectable plans with the yearly one preselected, monthly equivalent price, one "Continue" button; the hidden Custom AI is no longer listed as a benefit.
- **Recorder toggles**: "To text" / "Agent" with a check mark and filled state instead of "Transcribe ON / AI Agent OFF".
- **Errors**: no internet, timeouts and 502/503 read as plain sentences in the app language (was "java.net.UnknownHostException…"); the notes chat suggests on-device AI when offline.

### Fixed
- Large system fonts (checked at 1.3× and 1.8×): recorder toggles no longer run off screen, theme options wrap, chat empty state stays centred.
- Recordings sheet: translated actions ("Add", "AI", "View" were English), dates in the app language, larger targets, actions wrap under the duration.
- Audio card showed a ">" character instead of a play icon before the first tap.
- Remaining English alerts (sharing, model download/delete, prompts, AI sign-in) are translated.
- Unlock banner wording; selection checkmark no longer covers the card title.

## [1.0.80] - 2026-10-02

### Fixed
- **Data loss after "Keep on this phone" sign-out**: account notes that cannot be decrypted without the account were shown to the guest as empty "Voice note" cards (when they had audio); deleting one synced and deleted the real note on the next sign-in. Undecryptable notes are now marked `locked`, hidden from the list, search and notes chat, and never pushed. A banner ("Account notes kept on this phone: N") explains them and offers Sign in.
- Guest Settings showed the previous account's encryption controls in the cloud-sync card.
- Selection mode header buttons are 48dp.
- Unlock banner says "secret phrase" like the unlock dialog (ru, fr said "password").
- Untitled notes: the auto title is the whole first sentence when it is short (up to 6 words), otherwise its first words with "…" — no more "Ship v2 is". Card titles get two lines.
- "Find tasks" also picks up planned work with a deadline or an owner ("v2 ships on Thursday").
- Versions: the Original chip uses a document icon (the lock read as "encrypted"); the version name is not repeated as its title; row actions are one equal-width 48dp column.
- Russian notes-chat example is gender-neutral.
- Settings: a long email stays on one line (ellipsis in the middle); the account email is no longer written to the log on every render.

### Changed
- **First-launch empty list**: a short welcome (voice to text, AI tidy-up, private by default) instead of a single line.

## [1.0.79] - 2026-10-02

### Changed
- **Custom AI hidden** (CUSTOM_AI_ENABLED=false): on-device AI covers the private/offline case, so AI is "Vaulto AI" or "On this phone" in one row. A stored Custom AI (or legacy self-hosted) choice falls back to Vaulto AI; the code stays for a one-line return.
- **Search bar**: an account avatar (initial, or a person icon for guests) replaces the gear, as in Keep/Gmail — the gear read as "search settings".
- **Editor mic button**: a small sparkle badge shows the agent is on, instead of curved 8 px "HOLD: NO AGENT" text (the long-press hint is kept for screen readers).
- **Home dock**: the tiny "Hold to switch" caption under the mic is gone.

### Fixed
- Note dates follow the app language (were in the device language: "Sep 30" on a Russian UI).
- Model sizes use the locale's decimal mark ("2,7 ГБ").
- AI preset descriptions readable (were near-invisible grey) and allowed two lines; the sheet's Cancel is 48dp.
- The "AI is working" pill had a grey box behind it on Android (shadow through a translucent fill).
- Settings: legal links wrap instead of running into the screen edges.
- Russian: chat title "Вопросы по заметкам".

## [1.0.78] - 2026-10-02

### Changed
- **On-device models screen redesigned**: one card per kind ("Speech to text" — Whisper, "AI on this phone" — Qwen3.5) with a clear status (Ready · works offline / Downloading · N% / Not downloaded); each model is a full-width row with its size, what it is good for, a "Recommended" tag picked for this phone, an "On phone" mark, and a 48dp download or delete button. Downloads show a progress bar with "X of Y · N%" and Cancel. Text is 13–16 px instead of 8–10 px, and every label is translated. Models that do not fit the phone say why. Whisper Large is hidden (Turbo is as accurate at a fifth of the size).
- **Speech model dialog** uses the same language: radio rows with size and description, "On phone" for downloaded models, "Use this model" instead of re-downloading, and it starts on the best model that fits the phone.

### Fixed
- **Agent Mode turned itself off**: choosing Custom AI or on-device AI stored "agent off", so it stayed off after switching back to Vaulto AI. Unavailability is now shown, not stored; the stored value is reset once to the default (on).
- A cancelled or failed model download no longer leaves the unfinished model selected; the previous working model is restored.

## [1.0.77] - 2026-10-01

### Fixed
- **Google sign-in failed** ("unauthorized_client"): the app requested the server auth code for one OAuth client of the Google Cloud project while the auth server exchanges codes as another. The app now uses the client the server exchanges with. The server also stopped logging the client secret and one-time codes.

## [1.0.76] - 2026-10-01

### Changed
- **R8 code shrinking and obfuscation** in release builds, plus resource shrinking (Google Play flagged 2% obfuscation). The arm64 APK went from 230 MB to 115 MB. A minified release build was checked on the emulator: sign-in, E2EE unlock, sync, cloud AI, Whisper download and live dictation, voice recording and the editor.
- **On-device model memory**: the LLM weights are released after 90 s without a request, not only when the app goes to the background.

### Fixed
- **Live dictation could not be undone**: the text before dictating is now recorded, so Undo takes the dictated words back out.
- **Whisper "hearing" subtitles in silence**: typical hallucinations ("Продолжение следует…", "Субтитры сделал …", "Thanks for watching", "[Music]") are dropped from on-device transcripts and dictation.
- **Inline audio player**: drawn play/pause icons instead of ">" and "||" text.

## [1.0.75] - 2026-10-01

### Added
- **Fully offline AI ("Local" provider)**: Whisper for voice plus an on-device language model for AI edits, the notes chat and Find tasks — nothing leaves the phone and everything works without internet. Models are Qwen3.5 (0.8B ~530 MB, 2B ~1.3 GB, 4B ~2.7 GB, replacing Phi-2/TinyLlama/Gemma 2/Mistral 7B); the default follows the phone's memory (4B from ~6 GB). Context grows to 4096 tokens, rewrites get an output budget sized to the note, tasks use schema-constrained JSON, and the model is told to keep the note's language and never add details. Tested offline on a 6 GB emulator: 2B answers in ~4–6 s, 4B in ~15 s with cloud-like quality.
- **Private AI for protected notes**: with on-device AI, protected notes can use AI features and the notes chat, since their text stays on the phone.
- Downloading a model asks first, shows its size and warns on mobile data; AI features explain when the model is not downloaded yet.

### Fixed
- **Signed out after a lost token refresh**: refresh tokens rotate on use; when a phone lost the rotation response it kept the old token and was signed out at the next refresh (seen in production). The server now recovers when the token issued in its place was never used, and the app routes every refresh through one shared, de-duplicated path that keeps a session someone else just refreshed.
- **Notes chat**: free source slots are filled with recent notes, so answers can use notes that share no word with the question (a grocery list for "what should I buy?").
- **Touch targets**: sign-in screen, passphrase dialog, AI provider and model buttons, unlock banner — at least 44–48dp.

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
- **Free on-device transcription, offered where it helps**: a guest recording (cloud transcription needs an account) offers to download the speech model instead of only asking to sign in; the usage-limit dialog for transcription minutes offers "Transcribe free on this phone"; everyone else is asked once, after their third cloud-transcribed recording. The model dialog now explains transcription and dictation.
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
