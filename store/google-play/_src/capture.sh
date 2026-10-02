#!/usr/bin/env bash
# Grabs one raw capture from the running emulator into raw/<lang>/<key>.png
# (1080x2400, the real screen including status bar and gesture handle).
#
#   bash capture.sh <en|ru> <key> [airplane]
#
# Before the shot it sets the clock to 12:00 and puts SystemUI into demo mode
# (full battery, Wi-Fi, no notification icons). With "airplane" it leaves demo
# mode instead and uses the REAL status bar, because this SystemUI does not draw
# the airplane icon in demo mode; turn airplane mode on yourself first
# (adb shell cmd connectivity airplane-mode enable) and expect the emulator's
# "serial console" notification icon next to the clock (see README).
set -e
cd "$(dirname "$0")"
LANG_DIR="$1"; KEY="$2"; MODE="$3"
[ -n "$LANG_DIR" ] && [ -n "$KEY" ] || { echo "usage: capture.sh <en|ru> <key> [airplane]" >&2; exit 1; }

ADB="${ADB:-adb}"
command -v "$ADB" >/dev/null || ADB="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}/platform-tools/adb"

demo() { "$ADB" shell am broadcast -a com.android.systemui.demo -e command "$@" >/dev/null; }

# The clock is real when demo mode is off, so set it too (needs `adb root`,
# fine on a google_apis emulator image; auto time must be off).
"$ADB" shell settings put global auto_time 0 >/dev/null 2>&1 || true
"$ADB" shell date "$(date +%m%d)1200$(date +%Y).00" >/dev/null 2>&1 || true

if [ "$MODE" = airplane ]; then
  demo exit
else
  "$ADB" shell settings put global sysui_demo_allowed 1
  demo enter
  demo clock -e hhmm 1200
  demo battery -e level 100 -e plugged false -e powersave false
  demo notifications -e visible false
  demo network -e airplane hide -e wifi show -e level 4 -e fully true -e mobile hide
fi
sleep 1

mkdir -p "raw/$LANG_DIR"
"$ADB" exec-out screencap -p > "raw/$LANG_DIR/$KEY.png"
magick identify -format "raw/$LANG_DIR/$KEY.png %wx%h\n" "raw/$LANG_DIR/$KEY.png"
