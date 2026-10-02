# Vaulto Note — Google Play store graphics

Marketing banners for the Google Play listing. Every phone screen is a **real
screenshot of the shipped app** (release build 1.0.87 on an Android 16 Pixel-class
emulator, 1080×2400) — nothing in the screen is redrawn or mocked up. The
screenshot sits in an **Android handset** frame (412×915 dp viewport, centre
punch-hole) under a headline and subhead, with the **real app logo** (extracted
from `assets/icon.png`). Opaque background, no transparency. Never an iPhone frame.

Two full sets — `en/` (global listing) and `ru/`. Each set uses its own demo notes
written in that language and the app UI switched to that language.

Everything shown is shipped behaviour, and the copy claims only what is true:
on-device speech recognition (Whisper) and on-device AI (Qwen) work offline after a
one-time model download; notes are stored encrypted on the phone; cloud sync is
optional and can be end-to-end encrypted; protected notes never leave the phone
unencrypted.

## Screenshot order = conversion funnel

Upload the phone screenshots **in this numbered order**. Most users only see the
first 1–3, so the sequence is a funnel: hook → differentiator → value → proof → trust → breadth.

| # | File | Real screen | Role |
|---|------|-------------|------|
| — | `feature-graphic_1024x500.png` | Notes list | Top-of-page brand + promise: private AI voice notes · works offline · encrypted |
| 1 | `01_voice-to-text_1080x1920.png` | Recorder bar over the notes list | **Hook** — the core action |
| 2 | `02_works-offline_1080x1920.png` | Settings → on-device models, both "Ready · works offline", airplane mode on | **Differentiator** — offline voice + AI |
| 3 | `03_ask-your-notes_1080x1920.png` | Ask your notes: answers with numbered sources (on-device AI) | **Value** — your notes answer back |
| 4 | `04_tasks-reminders_1080x1920.png` | Find tasks sheet: dated tasks, reminder bells, calendar | **Value** — voice → to-dos |
| 5 | `05_meeting-notes_1080x1920.png` | Meeting Notes version of a transcript (Original / Meeting Notes) | **Proof** — real AI output |
| 6 | `06_private_1080x1920.png` | "Protect this note?" dialog | **Trust** — privacy |
| 7 | `07_organized_1080x1920.png` | Notes list in the dark theme, #tags row | **Breadth** — everything in one place |
| 8 | `08_capture-anywhere_1080x1920.png` | Home screen with the Vaulto widget | **Breadth** — capture from anywhere |

Play requires 2–8 phone screenshots; this is the full 8. The store icon
(`icon_512x512.png`) is built by `render.sh` from the launcher icon
(`assets/icon.png`) so the tile in Play matches the shortcut on the home screen:
512×512, fully opaque, no rounding or shadow (Play applies its own mask), and
**24-bit truecolour**. That last part is load-bearing — the source is
black-on-transparent, so without `-type TrueColor` ImageMagick emits a greyscale PNG
(colour-type 0) and Play rejects it.

Nothing in the build consumes this folder: every file here is uploaded to the Play
Console by hand. Play does **not** take the store icon from the AAB — the icon inside
the bundle is the launcher icon, the 512×512 tile is a separate listing field.

## Headlines

| # | EN | RU |
|---|----|----|
| — | Private AI voice notes. | Голос в текст. Приватный ИИ. |
| 1 | Speak. It's text. | Говорите. Текст готов. |
| 2 | Works in airplane mode. | Работает в авиарежиме. |
| 3 | Ask your notes. | Спросите свои заметки. |
| 4 | Tasks from your voice. | Задачи из голоса. |
| 5 | Meetings, summed up. | Встречи — в итогах. |
| 6 | Your notes. Yours alone. | Ваши заметки. Только ваши. |
| 7 | Everything in one place. | Всё нужное в одном месте. |
| 8 | Capture from anywhere. | Записывайте откуда угодно. |

Subheads and eyebrows for both languages live in `_src/build.py` (`BANNERS`, `FG`).

## How it's built

```
_src/raw/<lang>/<key>.png   real emulator captures, 1080x2400   (capture.sh)
_src/build.py               copy + frame -> _src/html/*.html
_src/render.sh              headless Chrome + ImageMagick -> en/, ru/, icon_512x512.png
```

HTML rendered by headless Chrome, then supersampled down (banners 3×, feature 4×)
for crisp edges; flattened onto the canvas colour so output is fully opaque.

Chrome does **not** hand back a viewport of exactly `--window-size` — it comes back
taller, with the surplus painted in the html background colour. Resizing that
capture straight to W×H squashed the artwork vertically (17% on the feature
graphic) and left a flat dead band along the bottom edge. So `render.sh` renders
deliberately taller, then crops the exact top-left `W*dsf × H*dsf` design box and
downsamples that. Don't "simplify" it back to a plain `-resize W×H!`.

### Regenerate (from the existing raw captures)

```bash
cd _src
python3 build.py     # writes html/*.html
bash render.sh       # renders ../en/, ../ru/ and ../icon_512x512.png, exact sizes, opaque
```

`render.sh` maps each banner key to its final store filename (e.g. `01_record` →
`01_voice-to-text_1080x1920.png`) in `store_name()`, deletes the old PNGs in `en/`
and `ru/` and writes the full set again, so both languages stay in sync. It runs on
the stock macOS bash 3.2; it finds Chrome on `PATH` or in `/Applications` (override
with `CHROME=...`) and needs ImageMagick 7 (`magick`). Fonts (Inter) are bundled in
`_src/fonts/`. Reorder or reword via `BANNERS` / `FG` in `build.py`; if you add,
rename or reorder a banner key, update `store_name()` in `render.sh` to match.

### Re-shooting the raw captures

The captures were taken on the `vaulto_test` AVD (Pixel-class, 1080×2400, 420 dpi,
Android 16 google_apis), release build installed, **guest mode** (no account), the
on-device models downloaded (Whisper Base/Turbo, Qwen3.5 4B) and AI set to
**On this phone** in Settings → Advanced AI Settings. All AI output in the shots
(transcripts, Ask-your-notes answers, tasks, meeting notes) was produced live by the
on-device models.

- Demo notes are created through the real share intake:
  `adb shell am start -a android.intent.action.SEND -t text/plain -n com.vaultonotemobile/.MainActivity --es android.intent.extra.TEXT "…" --es android.intent.extra.SUBJECT "Title"`
  (set the device clock first with `adb root` + `adb shell date MMDDhhmmYYYY.ss`
  so the cards get believable dates). The voice note is a `say`-generated audio
  file shared to the app from the Files app, transcribed on the phone.
- The recorder waveform needs audio input: start the emulator with
  `-allow-host-audio` and feed it through a loopback device (e.g. BlackHole).
- `bash _src/capture.sh <en|ru> <key>` sets 12:00 / full battery / Wi-Fi demo mode
  and saves `raw/<lang>/<key>.png`. For `02_offline` use `capture.sh <lang>
  02_offline airplane` with airplane mode really on: SystemUI on this image does not
  draw the airplane icon in demo mode, so that shot uses the real status bar. The
  emulator's own "serial console" notification icon (a debug artefact that does not
  exist on real phones) was painted out next to the clock in those two captures;
  nothing else in any capture is edited.
- The language is switched in Settings → App Language; the dark-theme shot (07) uses
  Settings → Theme → Dark.
