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
#   ./deploy.sh           test, build, restart, wait for health (exit non-zero on failure)
#   ./deploy.sh --force   on health failure, kill whatever holds :3000 by port
#                         (systemd Restart=always brings the service back), retry
#
# Exit codes: 0 = healthy on the new build; 1 = build failed or not healthy.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${SAM_UI_PORT:-3000}"
HEALTH_URL="http://127.0.0.1:${PORT}/api/health"

# /api/health reports a rolled-up status of ok | degraded | fail across the job
# store, disk, memory and voice-line (see src/app/api/health/route.ts).
# Until 2026-09-20 this function only checked that the endpoint answered at all,
# which no running process can fail — a build that left chat completely dead
# still printed "healthy" and exited 0.
#
#   ok        pass
#   degraded  pass, but say so — voice-line down or disk tight is not a reason
#             to block a deploy that fixed something else
#   fail      block — the job store is unreadable, disk is gone, or memory is
#             at the cgroup ceiling
wait_healthy() {
  local body status
  for i in $(seq 1 45); do
    if body=$(curl -fsS "$HEALTH_URL" 2>/dev/null); then
      # Pull .data.status out of the SAM envelope without needing jq.
      status=$(printf '%s' "$body" | grep -oE '"status":"(ok|degraded|fail)"' | head -1 | cut -d'"' -f4)
      case "$status" in
        ok)
          echo "healthy after ${i}s"
          return 0
          ;;
        degraded)
          echo "healthy after ${i}s — DEGRADED:"
          printf '%s' "$body" | grep -oE '"[a-z]+":\{"status":"(degraded|fail)","detail":"[^"]*"' \
            | sed 's/^/    /' || true
          return 0
          ;;
        fail)
          echo "!! /api/health reports FAIL:" >&2
          printf '%s' "$body" | grep -oE '"[a-z]+":\{"status":"fail","detail":"[^"]*"' \
            | sed 's/^/    /' >&2 || true
          return 1
          ;;
        *)
          # Endpoint answered but carries no status field — an older build still
          # being served, or a partial response. Keep waiting rather than
          # accepting it.
          ;;
      esac
    fi
    sleep 1
  done
  return 1
}

# The full suite runs BEFORE the build, on purpose, and a failure aborts the
# deploy (set -e above). Ten of these tests are box-only: they spawn the real
# scripts under ~/.local/bin and ~/.sam and drive systemd-run --user units,
# so CI cannot run them honestly and reports them skipped. That makes this
# the gate for them. Added 2026-10-02, after CI had sat red for a day on
# those ten and nothing else ran them at all.
echo "==> test"
npm test

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
