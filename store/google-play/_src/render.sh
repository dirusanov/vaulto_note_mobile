#!/usr/bin/env bash
# Renders html/*.html -> the final store PNGs in ../en and ../ru, opaque and at
# exact sizes. Run `python3 build.py` first to (re)generate html/.
set -e
cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"

# html basename (without lang prefix / .html)  ->  final store filename
declare -A NAME=(
  [feature]="feature-graphic_1024x500"
  [01_record]="01_voice-to-text_1080x1920"
  [02_privacy]="02_privacy_1080x1920"
  [03_ai]="03_ai-tools_1080x1920"
  [04_settings]="04_encrypted-sync_1080x1920"
  [05_search]="05_organized_1080x1920"
  [06_editor]="06_editor_1080x1920"
)

# Per-invocation scratch dir: two concurrent runs sharing one _raw.png clobber each
# other and the loser dies on a missing file.
PNG=$(mktemp -d "${TMPDIR:-/tmp}/vaulto-play.XXXXXX")
trap 'rm -rf "$PNG"' EXIT

# Headless Chrome does not hand back a viewport of exactly --window-size: it comes
# back taller, and the surplus is painted with the html background. Resizing that
# capture to WxH used to squash the artwork vertically (17% on the feature graphic)
# and leave a flat band along the bottom edge. So: render deliberately taller, then
# crop the exact top-left W*dsf x H*dsf region — the design box — and downsample it.
render() { # html w h dsf out
  local html="$1" w="$2" h="$3" dsf="$4" out="$5"
  local rw=$((w * dsf)) rh=$((h * dsf))
  google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
    --force-device-scale-factor="$dsf" --window-size="$w,$((h + 260))" \
    --virtual-time-budget=3000 \
    --screenshot="$PNG/_raw.png" "file://$PWD/html/$html" >/dev/null 2>&1

  local got; got=$(magick identify -format '%w %h' "$PNG/_raw.png")
  if [ "${got% *}" -lt "$rw" ] || [ "${got#* }" -lt "$rh" ]; then
    echo "  !! $html: capture ${got// /x} smaller than required ${rw}x${rh}" >&2
    exit 1
  fi

  magick "$PNG/_raw.png" -background '#F5F7FA' -flatten -alpha remove -alpha off \
    -crop "${rw}x${rh}+0+0" +repage \
    -filter Lanczos -resize "${w}x${h}" \
    -strip -define png:color-type=2 -quality 96 "$out"
}

place() { # html w h dsf
  local f="$1" w="$2" h="$3" dsf="$4"
  local b lang key dir
  b=$(basename "$f" .html)          # e.g. en_01_record  /  ru_feature
  lang=${b%%_*}                     # en | ru
  key=${b#*_}                       # 01_record | feature
  dir="$ROOT/$lang"
  mkdir -p "$dir"
  render "$b.html" "$w" "$h" "$dsf" "$dir/${NAME[$key]}.png"
  echo "  $lang/${NAME[$key]}.png"
}

for f in html/*_feature.html; do place "$f" 1024 500 4; done
for f in html/*_0*.html;      do place "$f" 1080 1920 3; done

# ---- store icon: 512x512, fully opaque, 24-bit RGB ----
# Same artwork as the launcher icon (assets/icon.png) so the tile in Play matches
# the shortcut on the home screen; no rounding or shadow, Play applies its own mask.
# -type TrueColor is load-bearing: the source is black-on-transparent, so ImageMagick
# would otherwise emit a greyscale PNG (colour-type 0) and Play rejects those.
magick "$ROOT/../../assets/icon.png" -colorspace sRGB -resize 512x512 \
  -background white -alpha remove -alpha off \
  -type TrueColor -strip -define png:color-type=2 -quality 96 \
  "$ROOT/icon_512x512.png"
echo "  icon_512x512.png"


echo DONE
