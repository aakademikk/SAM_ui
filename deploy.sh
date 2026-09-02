#!/usr/bin/env bash
# deploy.sh — the ONLY sanctioned way to build and restart sam-ui.
#
# Why this wrapper exists (SAM_ui_Dashboard.md → Gotchas):
#   - The running next-server holds the old build's client-reference manifest in
#     memory. Rebuilding .next deletes the old chunk files, so a live server
#     without a restart emits HTML pointing at deleted chunks → the generic
#     "Application error" page (ChunkLoadError) that reads exactly like a code
#     bug and isn't one. Build + restart must be one atomic step.
#   - Never run `next dev` in SAM_ui while sam-ui.service is up: the shared .next
#     gets clobbered and the build fails with a misleading module-not-found error.
#   - Kill by port, never by process name: `pkill -f next-server` matches nothing
#     because the process name carries no port.
#
# Usage:
#   ./deploy.sh           build, restart, wait for health (exit non-zero on failure)
#   ./deploy.sh --force   on health failure, kill whatever holds :3000 by port
#                         (systemd Restart=always brings the service back), retry
#
# Exit codes: 0 = healthy on the new build; 1 = build failed or not healthy.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${SAM_UI_PORT:-3000}"
HEALTH_URL="http://127.0.0.1:${PORT}/api/health"

wait_healthy() {
  for i in $(seq 1 45); do
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
      echo "healthy after ${i}s"
      return 0
    fi
    sleep 1
  done
  return 1
}

echo "==> build"
npm run build

echo "==> restart sam-ui.service"
systemctl --user restart sam-ui

echo "==> wait for health on :${PORT}"
if wait_healthy; then
  echo "==> done — sam-ui serving the new build"
  exit 0
fi

echo "!! sam-ui not healthy on :${PORT} within 45s" >&2
if [ "${1:-}" = "--force" ]; then
  echo "!! killing whatever holds :${PORT} by port; Restart=always recovers the service" >&2
  fuser -k "${PORT}/tcp" 2>/dev/null || true
  sleep 3
  if wait_healthy; then
    echo "==> recovered — sam-ui serving the new build"
    exit 0
  fi
fi

echo "!! service state:" >&2
systemctl --user --no-pager status sam-ui >&2 || true
echo "!! listeners on :${PORT}:" >&2
ss -ltnp "sport = :${PORT}" >&2 || true
exit 1
