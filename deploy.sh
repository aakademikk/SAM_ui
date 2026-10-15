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
#   - Review guard (2026-10-15): this builds whatever is in the tree, and the
#     hourly auto-checkpoint commits whatever another session left there. On
#     2026-10-14 a one-fix deploy also shipped the unapproved call screener T3
#     toggle. So before any test or build it reads the live SHA from
#     /api/health, lists every commit from there to HEAD plus the uncommitted
#     file count, and stops unless the caller names HEAD with --reviewed.
#     Never build in the live tree outside this script.
#
# Usage:
#   ./deploy.sh --reviewed <HEAD short sha>
#                         review guard, then test, build, restart, wait for health
#                         (exit non-zero on failure). The env var
#                         SAM_DEPLOY_REVIEWED=<sha> does the same as the flag.
#   ./deploy.sh --list    print the commits that would ship (live SHA to HEAD) and
#                         the uncommitted file count, exit 0; needs no flag
#   ./deploy.sh --allow-dirty
#                         with --reviewed: ship despite uncommitted changes
#   ./deploy.sh --phone-fit-only
#                         run only the phone-fit gate (copy build + check), nothing else;
#                         needs no flag
#   ./deploy.sh --force   on health failure, kill whatever holds :3000 by port
#                         (systemd Restart=always brings the service back), retry
#
# Exit codes: 0 = healthy on the new build; 1 = build failed, not healthy, or the
# review guard refused.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${SAM_UI_PORT:-3000}"
# SAM_DEPLOY_HEALTH_URL overrides where the live SHA is read from (the guard test
# points it at a file:// stub).
HEALTH_URL="${SAM_DEPLOY_HEALTH_URL:-http://127.0.0.1:${PORT}/api/health}"

PHONE_FIT_ONLY=0 LIST_ONLY=0 FORCE=0 ALLOW_DIRTY=0
REVIEWED="${SAM_DEPLOY_REVIEWED:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --phone-fit-only) PHONE_FIT_ONLY=1 ;;
    --list) LIST_ONLY=1 ;;
    --force) FORCE=1 ;;
    --allow-dirty) ALLOW_DIRTY=1 ;;
    --reviewed)
      [ $# -ge 2 ] || { echo "!! --reviewed needs a commit sha" >&2; exit 1; }
      REVIEWED="$2"; shift ;;
    --reviewed=*) REVIEWED="${1#--reviewed=}" ;;
    *) echo "!! unknown argument: $1 (see the usage block at the top of deploy.sh)" >&2; exit 1 ;;
  esac
  shift
done

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
# The phone-fit gate (2026-10-10): the phone top bar and the gear Settings panel
# must fit a 360 to 412 px screen, also at 130% text. It builds into a COPY under
# ~/.cache and serves that through the local proof harness, so the live .next is
# never touched and the running server is never left on a deleted build (see the
# ChunkLoadError note at the top). A failing check (exit 1) or a taken harness
# port (exit 2) stops the deploy before the live build step.
phone_fit_gate() {
  local copy="${HOME}/.cache/phone-fit/deploy-copy"
  echo "==> phone-fit check (build in a copy)"
  rm -rf "$copy"
  mkdir -p "$copy"
  rsync -a --exclude=node_modules --exclude=.next --exclude=.git ./ "$copy/"
  ln -s "$PWD/node_modules" "$copy/node_modules"
  local rc=0
  ( cd "$copy" && npm run build >/dev/null ) || rc=$?
  if [ "$rc" -eq 0 ]; then
    node scripts/check-phone-fit.cjs "$copy" || rc=$?
  else
    echo "!! phone-fit copy build failed (exit $rc)" >&2
  fi
  rm -rf "$copy"
  if [ "$rc" -ne 0 ]; then
    echo "!! phone-fit gate failed (exit $rc); deploy stopped before the live build" >&2
    exit "$rc"
  fi
}


# Review guard: see the header. Prints what would ship; returns 0 only when the
# caller has named HEAD and the tree is clean (or --allow-dirty).
review_guard() {
  local body live head_short head_full dirty rev_full
  head_short=$(git rev-parse --short HEAD)
  head_full=$(git rev-parse HEAD)
  if ! body=$(curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null); then
    echo "!! review guard: cannot read the live build from ${HEALTH_URL}; refusing to deploy blind" >&2
    return 1
  fi
  live=$(printf '%s' "$body" | grep -oE '"gitSHA":"[0-9a-f]+"' | head -1 | cut -d'"' -f4)
  if [ -z "$live" ] || ! live=$(git rev-parse --verify --quiet "${live}^{commit}"); then
    echo "!! review guard: /api/health gave no usable gitSHA (or it is not in this repo); refusing to deploy blind" >&2
    return 1
  fi
  echo "==> live build $(git rev-parse --short "$live"), HEAD ${head_short}; commits that would ship:"
  git log --format='    %h  %ad  %s' --date=format:'%Y-%m-%d %H:%M' "${live}..HEAD"
  echo "    ($(git rev-list --count "${live}..HEAD") commit(s))"
  dirty=$(git status --porcelain | wc -l)
  echo "    uncommitted files: ${dirty}"
  [ "$LIST_ONLY" -eq 1 ] && return 0

  rev_full=""
  if [ -n "$REVIEWED" ] && [ "${#REVIEWED}" -ge 7 ]; then
    rev_full=$(git rev-parse --verify --quiet "${REVIEWED}^{commit}" || true)
  fi
  if [ -z "$rev_full" ] || [ "$rev_full" != "$head_full" ]; then
    echo "!! review guard: nothing named, or not HEAD (${head_short}). Review the list above, then re-run:" >&2
    echo "     ./deploy.sh --reviewed ${head_short}" >&2
    return 1
  fi
  if [ "$dirty" -gt 0 ] && [ "$ALLOW_DIRTY" -ne 1 ]; then
    echo "!! review guard: ${dirty} uncommitted file(s) would be built. Commit or stash them, or add --allow-dirty:" >&2
    git status --porcelain | sed 's/^/     /' >&2
    echo "     ./deploy.sh --reviewed ${head_short} --allow-dirty" >&2
    return 1
  fi
  return 0
}

if [ "$PHONE_FIT_ONLY" -eq 1 ]; then
  phone_fit_gate
  echo "==> phone-fit gate passed"
  exit 0
fi

if [ "$LIST_ONLY" -eq 1 ]; then
  review_guard
  exit $?
fi

review_guard || exit 1

echo "==> test"
npm test

phone_fit_gate

echo "==> build"
npm run build

echo "==> restart sam-ui.service"
systemctl --user restart sam-ui

# App pages must go out no-store, or an installed PWA restores a stale build
# from its HTTP cache (2026-10-14). Runs on the live server, after health.
page_cache_gate() {
  echo "==> page-cache check"
  if ! node scripts/check-page-cache.cjs "http://127.0.0.1:${PORT}"; then
    echo "!! page-cache check failed: the new build is live but pages are cacheable" >&2
    exit 1
  fi
}

echo "==> wait for health on :${PORT}"
if wait_healthy; then
  page_cache_gate
  echo "==> done — sam-ui serving the new build"
  exit 0
fi

echo "!! sam-ui not healthy on :${PORT} within 45s" >&2
if [ "$FORCE" -eq 1 ]; then
  echo "!! killing whatever holds :${PORT} by port; Restart=always recovers the service" >&2
  fuser -k "${PORT}/tcp" 2>/dev/null || true
  sleep 3
  if wait_healthy; then
    page_cache_gate
    echo "==> recovered — sam-ui serving the new build"
    exit 0
  fi
fi

echo "!! service state:" >&2
systemctl --user --no-pager status sam-ui >&2 || true
echo "!! listeners on :${PORT}:" >&2
ss -ltnp "sport = :${PORT}" >&2 || true
exit 1
