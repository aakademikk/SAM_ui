#!/usr/bin/env bash
#
# Regenerate the PWA app icons from a live frame of the SAM visualiser.
#
# The icons are not drawings of the visualiser — they are screenshots of the
# real component, taken from /render/icon in headless Chromium. Re-run this
# after any change to the visualiser so the icon and the app stay in step.
#
# Usage:
#   scripts/generate-icons.sh [base-url]
#
# Defaults to http://127.0.0.1:3000. The app must already be running there;
# use the production server, not `next dev` — the dev build paints a dev-tools
# indicator into the corner of the screenshot, and a dev server sharing .next
# with the systemd service will clobber the production build.
#
set -euo pipefail

BASE_URL="${1:-http://127.0.0.1:3000}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/public/icons"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Standard icons show the mesh large; maskable icons pull it in so it survives
# Android's circular/squircle crop, which keeps only the middle ~80%.
STANDARD_ZOOM=1.5
MASKABLE_ZOOM=1.15
RENDER_PX=512

BROWSER=""
for candidate in brave-browser chromium chromium-browser google-chrome; do
  if command -v "$candidate" >/dev/null 2>&1; then BROWSER="$candidate"; break; fi
done
if [ -z "$BROWSER" ]; then
  echo "error: no Chromium-family browser found on PATH" >&2
  exit 1
fi

if ! curl -sf -o /dev/null "$BASE_URL/render/icon"; then
  echo "error: $BASE_URL/render/icon is not responding — is the app running?" >&2
  exit 1
fi

shoot() { # shoot <zoom> <output-path>
  timeout 90 "$BROWSER" \
    --headless --disable-gpu --no-sandbox --hide-scrollbars \
    --force-device-scale-factor=1 \
    --window-size="$RENDER_PX,$RENDER_PX" \
    --virtual-time-budget=2500 \
    --screenshot="$2" \
    "$BASE_URL/render/icon?state=idle&zoom=$1" >/dev/null 2>&1
}

echo "Rendering from $BASE_URL using $BROWSER…"
shoot "$STANDARD_ZOOM" "$TMP/standard.png"
shoot "$MASKABLE_ZOOM" "$TMP/maskable.png"

for f in standard maskable; do
  if [ ! -s "$TMP/$f.png" ]; then
    echo "error: $f render produced no output" >&2
    exit 1
  fi
done

# Downscale 512 → 192 with Lanczos. Rendering 192 directly leaves the mesh
# nodes far too coarse relative to the frame; resampling keeps them fine.
python3 - "$TMP" "$OUT" <<'PY'
import sys
from PIL import Image

tmp, out = sys.argv[1], sys.argv[2]
targets = {
    "standard": ["icon-512.png", "icon-192.png"],
    "maskable": ["icon-512-maskable.png", "icon-192-maskable.png"],
}

for source, (big, small) in targets.items():
    img = Image.open(f"{tmp}/{source}.png").convert("RGB")
    img.save(f"{out}/{big}", "PNG", optimize=True)
    img.resize((192, 192), Image.LANCZOS).save(f"{out}/{small}", "PNG", optimize=True)
    print(f"  {big}  {small}")
PY

echo "Icons written to $OUT"
