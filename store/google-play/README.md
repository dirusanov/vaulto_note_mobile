# Vaulto Note — Google Play store graphics

Marketing banners for the Google Play listing. Each screenshot is a **faithful
reproduction of a real app screen** — real components (NoteCard, floating dock,
VoiceRecorder bar, UnlockSyncModal, AI Improve sheet, Settings), the real Material
icons the app uses, the real theme colors, and the **real app logo** (extracted
from `assets/icon.png`, pure black). Opaque background, no transparency.

Two full sets — `en/` (global listing) and `ru/`.

> Note: nothing here claims on-device / offline / local models — only shipped
> features (voice transcription, AI text tools, end-to-end encrypted cloud sync).

## Screenshot order = conversion funnel

Upload the phone screenshots **in this numbered order**. Most users only see the
first 1–3, so the sequence is a funnel: hook → trust → value → proof → breadth → depth.

| # | File | Real screen | Role |
|---|------|-------------|------|
| — | `feature-graphic_1024x500.png` | Notes list | Top-of-page brand + promise |
| 1 | `01_voice-to-text_1080x1920.png` | Recording bar | **Hook** — the magic core action |
| 2 | `02_privacy_1080x1920.png` | Unlock encrypted notes | **Trust** — the differentiator |
| 3 | `03_ai-tools_1080x1920.png` | Improve Text with AI | **Value** — polish your writing |
| 4 | `04_encrypted-sync_1080x1920.png` | Settings (Sync + Security) | **Proof** — encrypted sync across devices |
| 5 | `05_organized_1080x1920.png` | Notes list + dock | **Breadth** — everything in one place |
| 6 | `06_editor_1080x1920.png` | Note editor + toolbar | **Depth** — a real, capable editor |

Play requires 2–8 phone screenshots. The store icon (`icon_512x512.png`, 512×512,
opaque) is generated from `assets/icon.png` and lives in this folder, ready to upload.

## Headlines

| # | EN | RU |
|---|----|----|
| 1 | Speak. It's text. | Говорите. Текст готов. |
| 2 | Your notes. Yours alone. | Ваши заметки. Только ваши. |
| 3 | Clean it up with AI. | Улучшите текст одним тапом. |
| 4 | Everywhere. Still encrypted. | Везде. Всё зашифровано. |
| 5 | Everything in one place. | Всё — в одном месте. |
| 6 | Write without noise. | Пишите без лишнего. |

## How it's built

HTML rendered by headless Chrome, then supersampled down (banners 3×, feature 4×)
for crisp edges; flattened onto the canvas colour so output is fully opaque.
Everything derives from the real app source:

- Screens (`_src/screens.py`) mirror `src/screens/*` and `src/components/*`.
- Tokens + logo + icon helper (`_src/common.py`) use `src/theme/colors.ts` values,
  the real `logo_black.png`, and exact Material Icon SVGs in `_src/icons.json`.
- Copy for every banner + all screen strings (EN/RU) is in `_src/build.py`.

### Regenerate

```bash
cd _src
python3 build.py     # writes html/*.html
bash render.sh       # renders straight into ../en/ and ../ru/ at exact sizes, opaque

# store icon (only if assets/icon.png changed):
magick ../../assets/icon.png -resize 512x512 -background white -alpha remove \
  -alpha off -strip -quality 96 icon_512x512.png
```

`render.sh` maps each banner key to its final store filename (e.g. `record` →
`01_voice-to-text_1080x1920.png`, `settings` → `04_encrypted-sync_1080x1920.png`),
writes the flattened PNGs directly into `en/` and `ru/`, and cleans up its `png/`
scratch dir. It always overwrites the full set, so both languages stay in sync — no
manual renaming. Delete `_src/html/` afterwards if you don't need the intermediate HTML.

Requires `google-chrome` and ImageMagick (`magick`). Fonts (Inter) are bundled in
`_src/fonts/`. Reorder screenshots via the `BANNERS` lists; change wording via
`SL` / `BANNERS` / `FG`; change a screen via `screens.py`. If you rename a banner
key or reorder the funnel, update the `NAME` map in `render.sh` to match.
