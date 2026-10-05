# README media

The hero is an original vector illustration in `header.svg`; `header.png` is its portable raster version. Both contain product copy and an abstract waveform, not a simulated app screen.

`social-preview.png` is a 1200 × 630 cover for the repository's GitHub social preview. Upload it in repository settings when publishing; merely committing the file does not configure the preview.

`data-flow.svg` is a code-native vector diagram, documenting the distinction between local inference, cloud input processing, and encrypted sync. Its text alternative is in the root README and privacy guide.

`app-tour.gif` is a looping screenshot tour, with an MP4 counterpart in `app-tour.mp4`. It shows four separate screens: voice capture, offline setup, extracted tasks, and questions to notes. Crossfades connect screenshots; no user taps, transcription progress, or latency have been fabricated. It is **not a recording of one continuous user interaction**. The on-screen label and root README make that distinction explicit.

App screenshots come from `store/google-play/_src/raw/en/`, captured on an Android emulator running release 1.0.87. They contain fictional demo notes and real on-device AI output. The current source is 1.0.89, whose settings UI has since changed. See the [store-media provenance](../../store/google-play/README.md). Future live demonstrations should record the current release and include device/model details.

The screen is resized as a whole and placed into a static presentation card. Text inside the app screen is not rewritten. The existing Google Play banners in the root README follow the same provenance.

Regenerate locally with ImageMagick and FFmpeg installed:

```bash
python3 scripts/render-readme-media.py
```

The renderer uses Arial on macOS or DejaVu Sans on Linux. Set `README_MEDIA_FONT` to a TrueType font file on other systems.

`tour-storyboard.png` and `tour-preview.png` are static review artifacts. They allow visual inspection of every slide even if animation is disabled. Captions in the root README provide a text alternative to the GIF; no essential instructions exist only in motion.
