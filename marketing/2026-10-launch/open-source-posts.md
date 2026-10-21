# Open-source launch — editorial copies

Prepared 5 October 2026. Publication status and permalinks belong in analytics.md;
having a copy here does not mean it has been sent. User authorized public GitHub
and Reddit publication, selected license delegated to the agent. HN is manual.

## r/droidappshowcase

Title: Vaulto: open-source Android voice notes with offline transcription and on-device AI

I'm the developer of Vaulto, an Android app for voice notes. I've just made the mobile client's source public under GPLv3.

**App:** Vaulto: Private AI Voice Notes

The basic workflow is to record a thought, turn it into text, then clean it up or extract tasks and reminders. You can also ask questions about saved notes and export them as Markdown. A home-screen widget makes recording quicker.

For the offline option, download the speech and AI models first. Transcription uses Whisper; the local AI uses Qwen. Once downloaded, those models process the input on your phone. Local notes don't require an account.

**Cost:** local transcription and AI are free. Cloud processing and sync are optional; Pro subscriptions add cloud allowances and sync features. No ads.

The trade-off is storage and performance: model downloads can be large, and speed depends on your phone. Cloud processing sends the selected audio or text to a server. Local inference doesn't make every app feature network-free; downloads, guest sessions, sign-in and billing can still contact services.

Google Play: https://play.google.com/store/apps/details?id=com.vaultonotemobile

Source and data-flow explanation: https://github.com/dirusanov/vaulto_note_mobile

The animation is a tour of real screenshots from 1.0.87, not a live recording. The current Play release is 1.0.89.

## r/SideProject — distinct angle, later posting window

Title: I opened the source of my Android voice-notes app, including its local AI and encryption paths

I just made the mobile client for Vaulto public under GPLv3.

It's a voice-notes app for Android. You can record something, turn it into text, pull out tasks and reminders, or ask questions about notes you've already saved.

It has two ways to process content: Whisper and Qwen on the phone, or optional cloud processing. The local option is free and doesn't require an account, but you have to download the models first. They take storage, and a small phone won't run them like a desktop.

I wanted the repository to explain the boundaries clearly. Local inference, encrypted sync and cloud AI are different things. For example, enabling encrypted sync doesn't stop a cloud AI service from receiving the text you ask it to process. The README links to those paths in the code.

The hosted backend isn't included in this release. Pro subscriptions pay for cloud features; opening the client doesn't remove that part of the product.

Source, screenshots and build notes: https://github.com/dirusanov/vaulto_note_mobile

Android app: https://play.google.com/store/apps/details?id=com.vaultonotemobile

If you use voice notes, what usually happens after recording: do you clean them up, extract a to-do list, or leave them as audio?

## Editorial review

- No invented origin story, customer testimonials, usage numbers or outside endorsements.
- No "first", "best", "instant", "100% private", independent-audit or source/binary equivalence claims.
- Source license and public visibility verified separately before publication.
- Offline model downloads, cloud input processing and source/backend scope disclosed.
- Source release does not mean the existing Play binary was rebuilt or relicensed by a new store release.
- The media is explicitly a screenshot montage; no fabricated taps or processing time.
- Different communities get different angles and posting windows; no identical bulk cross-posts.
