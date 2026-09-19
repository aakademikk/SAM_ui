#!/usr/bin/env bash
# Compile and run the upload guard tests.
#
# This box's node is not built with TypeScript support (ERR_NO_TYPESCRIPT), so
# the test is compiled through the project's own tsc first. Compiling rather
# than hand-copying the logic to JS matters: a mirror written by the same hand
# as the code agrees with the code, and proves nothing about what ships.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

npx tsc scripts/test-uploads.ts \
  --outDir "$OUT" \
  --rootDir . \
  --module commonjs \
  --target es2022 \
  --moduleResolution node \
  --esModuleInterop \
  --skipLibCheck \
  --strict

node "$OUT/scripts/test-uploads.js"
