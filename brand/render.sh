#!/usr/bin/env bash
# Renders the README and GitHub images in brand/src to exact-size PNGs in brand/out.
# Usage: brand/render.sh [name ...]   (no args = render everything)
# Product shots frame static copies of the setup center (brand/src/ui) that use its real stylesheet.
set -euo pipefail

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
DIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$DIR/out"

# name:width:height:scale (README images at 2x for sharp text; the social preview at GitHub's 1280x640)
TARGETS=(
  "banner-1400x560:1400:560:2"
  "social-1280x640:1280:640:1"
  "how-it-works:1400:460:2"
  "setup-center:1400:900:2"
  "telegram-login:1400:900:2"
  "discord-ready:1400:900:2"
)

for t in "${TARGETS[@]}"; do
  IFS=: read -r name w h scale <<<"$t"
  if [[ $# -gt 0 && ! " $* " == *" $name "* ]]; then continue; fi
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    --force-device-scale-factor="$scale" --window-size="$w,$h" \
    --virtual-time-budget=5000 \
    --screenshot="$DIR/out/$name.png" "file://$DIR/src/$name.html" >/dev/null 2>&1
  echo "rendered out/$name.png ($w x $h @${scale}x)"
done
