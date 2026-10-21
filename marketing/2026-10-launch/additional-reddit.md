# Additional Reddit placements — 5 October 2026

User requested three more suitable communities. Every submission must disclose
the developer relationship, local/cloud distinction, model downloads, free local
features and optional paid services. No invented customer stories or metrics.
No repeated submission to the same community after removal.

## Links check

README already includes Google Play twice, website, privacy policy, GitHub Issues,
privacy architecture, build instructions, license, contribution/security docs.
`gh repo view` confirms public visibility and Google Play as repository homepage.
No uncreated Discord/community/download links added.

## Excluded candidates

- [r/privacy rules](https://www.reddit.com/r/privacy/about/rules.json): developer
  promotion forbidden, including open source. Not submitted.
- [r/NoteTaking rules](https://www.reddit.com/r/NoteTaking/about/rules.json): paid
  and freemium apps forbidden. Optional Pro makes Vaulto unsuitable. Not submitted.
- OpenSourceProjects: live UI Restricted / Request to Post, 26 weekly visitors.
- PrivacyToolsIO: live UI Restricted / Request to Post, migration to PrivacyGuides.
- LocalAI: live UI private community, only approved members can view/contribute.
- [PrivacyGuides criteria](https://www.privacyguides.org/en/about/criteria/#developer-self-submissions):
  separate self-submission process, threat model and security white paper required.
  Opening source does not establish evaluation or endorsement. Not submitted.

## r/alphaandbetausers — submitted

Live submission description explicitly recruits early product users for feedback;
[rules JSON](https://www.reddit.com/r/AlphaandBetausers/about/rules.json) contains
no extra community rules. Text only, flair unavailable.

Title: [Android] Vaulto - looking for feedback on offline voice notes

I'm the developer of Vaulto, a voice-notes app for Android. It's already on Google Play, and I'm looking for people to try the local processing flow. This isn't a closed-test signup.

You can record a note, transcribe it, then extract a checklist or reminders. Whisper and Qwen run on the phone after you download the models. Local transcription and AI are free; local notes don't need an account. The downloads take storage, and performance depends on your device.

A useful test would be a short note with two or three things you need to do. Does the transcript make sense? Does the checklist keep the details you need? If it feels slow or confusing, the phone model and the step where it happened would help. Please use a made-up note rather than sharing private content here.

Cloud processing and sync are optional Pro features. Cloud processing sends the selected audio or text to a server. Local inference doesn't disable all other network features.

Android: https://play.google.com/store/apps/details?id=com.vaultonotemobile

Source (GPLv3), screenshots and privacy details: https://github.com/dirusanov/vaulto_note_mobile

Feedback here or in GitHub Issues is welcome. No review, purchase or test-for-test exchange needed.

Permalink: https://www.reddit.com/r/alphaandbetausers/comments/1wyfizr/android_vaulto_looking_for_feedback_on_offline/
Author view: full body, no removal notice, 1 view, own vote, 0 comments at first check.
Independent public availability not yet verified; see analytics journal.

## r/indiehackers — submitted, removed

[Rules](https://www.reddit.com/r/indiehackers/about/rules.json) allow one product
post for critique with Self Promotion flair. Community search for
`author:Random1k17` returned no results before posting. No prior campaign placement
here recorded. Required Self Promotion flair selected and verified before submission.

Title: Vaulto: open-source Android voice notes with free local AI and optional paid cloud

I'm building Vaulto for Android and just opened the mobile client under GPLv3. I'd appreciate feedback on the product's local/cloud split.

The core flow is record a thought, get text, and turn it into tasks or reminders. You can also ask questions about saved notes and export Markdown.

Local transcription uses Whisper; local AI uses Qwen. Both are free after downloading the models, and local notes don't require an account. That keeps inference on the phone, but adds a fairly substantial download and device-dependent processing time.

Optional Pro features cover cloud processing and sync. Cloud processing sends the selected input to a server. Encrypted sync is a separate feature; it doesn't make cloud AI processing end-to-end encrypted. The hosted backend isn't in the client repository.

If you've tried apps with on-device models, what made you keep using one after the initial download? I'm particularly interested in whether the setup effort is worth it for short, everyday voice notes. Specific criticism of the first-use flow would help.

Play: https://play.google.com/store/apps/details?id=com.vaultonotemobile

Source, screenshots and data-flow docs: https://github.com/dirusanov/vaulto_note_mobile

Permalink: https://www.reddit.com/r/indiehackers/comments/1wyflgv/vaulto_opensource_android_voice_notes_with_free/

Immediately after submission, community feed and author permalink said
"Sorry, this post has been removed by the moderators of r/indiehackers."
No specific removal reason or comment was visible on permalink at first check.
Own vote active, 0 comments, views unavailable. Do not repost or treat as reach.
Independent public fetch returned cache miss. Exact submission UTC unavailable.

## Further exclusions after live checks

- indieapps: Request to Post / Restricted, 85 weekly visitors. Not submitted.
- droidapptesters: cached rules JSON was empty, but live form has 8 rules,
  including beta/early-dev only and no posts mainly for installs/traffic. Skipped
  rather than presenting the released app as a beta or masking this campaign's intent.

## r/apps — submitted, filtered

[Rules](https://www.reddit.com/r/apps/about/rules.json) prohibit spam, low-quality
content and creating an account to advertise. Used the existing account, disclosed
developer affiliation, and chose App flair. Live form: 41K weekly visitors.

Title: [Android] Vaulto: voice notes with offline transcription, tasks and reminders

I'm the developer of Vaulto, an Android app for turning a spoken note into something you can use later.

Record an idea, get a transcript, then clean up the text, extract tasks with reminders, or ask questions about notes you've saved. There's a recording widget and Markdown export.

If you want to process notes on your phone, the app uses Whisper for transcription and Qwen for AI. Download the models first; local transcription and AI are free, and local notes don't require an account. The trade-off is storage and processing time, which depend on your phone.

Cloud processing and sync are optional, with paid Pro features. Selected content goes to a server when you use cloud processing. Using local AI doesn't switch off every network feature in the app.

The mobile client is now open source under GPLv3. The README has actual app screenshots, an animated tour, build instructions and details of the local/cloud data flows. The hosted backend is separate.

Google Play: https://play.google.com/store/apps/details?id=com.vaultonotemobile

GitHub: https://github.com/dirusanov/vaulto_note_mobile

If you try it, I'd like to hear which part of the recording-to-task flow works for you and where it gets in the way.

Permalink: https://www.reddit.com/r/apps/comments/1wyfpeu/android_vaulto_voice_notes_with_offline/

Author permalink: "Sorry, this post was removed by Reddit's filters."
Own vote active, 0 comments. No specific reason visible. No repeat submission.
Independent public fetch returned cache miss.

## Follow-up ~21:11 Moscow / ~18:11 UTC

- AutoModerator's notification for indiehackers explicitly says the account has
  fewer than 10 comment karma **in r/indiehackers**. This confirms a community-specific
  participation threshold for that post; it does not establish the cause for apps
  or droidappshowcase. Notification URL: https://www.reddit.com/notifications/a/ann_ejr839
- alphaandbetausers permalink remains full with no removal notice, now 12 views,
  own vote active and 0 comments. Independent public visibility still unverified.
- WhisperAi was considered but not submitted: live form only 4 weekly visitors.
- README navigation now also surfaces Feedback / Website. Replaced the stale
  "current source 1.0.89" claim with stable screenshot provenance wording because
  concurrent app work released source 1.0.90. No claim of public Play 1.0.90 made.
  README-only commit b450c93 pushed; unauthenticated raw README contains new links.
