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
  [05_notes]="05_organized_1080x1920"
  [06_editor]="06_editor_1080x1920"
)

mkdir -p png
render() { # html w h dsf out
  local html="$1" w="$2" h="$3" dsf="$4" out="$5"
  google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
    --force-device-scale-factor="$dsf" --window-size="$w,$h" \
    --virtual-time-budget=3000 \
    --screenshot="png/_raw.png" "file://$PWD/html/$html" >/dev/null 2>&1
  magick "png/_raw.png" -background '#F5F7FA' -flatten -alpha remove -alpha off \
    -resize "${w}x${h}!" -strip -quality 96 "$out"
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

rm -rf png
echo DONE
