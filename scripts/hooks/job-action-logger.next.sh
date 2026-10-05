#!/usr/bin/env bash
# PostToolUse: append one `action` event per tool call to a job's own
# events.jsonl — but ONLY inside a job's own worker run (staged, ux-fixes T6).
#
# Spec: must-do 5; check 4. Gated on SAM_JOB_EVENTS or SAM_JOB_DIR being set
# in the process environment — neither is ever set in Colin's interactive
# sessions, so outside a job's own worker run this must be a no-op, not
# merely harmless. That gate is the very first thing this script does.
#
# Follows the same stdin-JSON-via-jq shape every other PostToolUse hook in
# this directory already uses (see mirror-error-ledger.sh). Never writes the
# raw command text (tool_input.command) or any other raw argument — only the
# Bash call's own `description` field (the one-liner every Bash call already
# carries), or a derived one-liner for Edit/Write/Read/Glob/Grep, capped at
# 120 characters. This is the fix for the first draft Colin was NOT shown:
# SAM, 2026-10-03, corrected the design to write descriptions, never
# commands, before this ever ran against a real job.
#
# This is a staged `.next` copy (per the spec's constraint on `sam-dispatch`/
# `sam-job`/this hook — §4): it has no effect until Colin copies it to
# `job-action-logger.sh` in this same directory AND pastes the snippet in
# `job-action-logger.settings-snippet.json` into both seats'
# `hooks.PostToolUse`. See that file for the install note.
set -uo pipefail

# No-op, outright, whenever neither job env var is set — this is the whole
# gate, checked before touching stdin so an interactive session's tool calls
# are never even parsed.
[ -z "${SAM_JOB_EVENTS:-}${SAM_JOB_DIR:-}" ] && exit 0

payload="$(cat)"
tool="$(printf '%s' "$payload" | jq -r '.tool_name // ""')"

description=""
case "$tool" in
  Bash)
    # The worker's own one-line description — never tool_input.command.
    description="$(printf '%s' "$payload" | jq -r '.tool_input.description // ""')"
    ;;
  Edit|Write)
    file="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // ""')"
    if [ "$tool" = "Edit" ]; then
      description="Edited $file"
    else
      description="Wrote $file"
    fi
    ;;
  Read)
    file="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // ""')"
    description="Read $file"
    ;;
  Glob|Grep)
    description="Searched files"
    ;;
  *)
    description="$tool"
    ;;
esac

# Cap at 120 characters (spec: must-do 5, check 4).
description="${description:0:120}"

events_file="${SAM_JOB_EVENTS:-$SAM_JOB_DIR/events.jsonl}"
at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Built via jq -nc (compact — one line, required for JSONL) so the
# description is safely JSON-escaped (quotes, newlines, a stray file path
# with spaces) rather than hand-interpolated.
line="$(jq -nc --arg at "$at" --arg description "$description" \
  '{type:"action", at:$at, description:$description}')"

printf '%s\n' "$line" >> "$events_file"
exit 0
