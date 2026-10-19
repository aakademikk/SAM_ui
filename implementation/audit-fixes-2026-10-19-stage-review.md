# Stage review: closer message/blocked fixes (2026-10-19)

Files reviewed: `~/.sam/closer/closer_blocked.py.stage-20261019`, `~/.sam/closer/closer_message.py.stage-20261019`
against live `closer_blocked.py` (mtime 2026-10-15) and `closer_message.py` (mtime 2026-10-11).

## Live vs stage base
Both live files predate the stage (stage cut 2026-10-19 01:01/01:02) and the diffs contain only the staged
change, so live has not moved on. `needs_message` is byte-identical between live and stage.

## Fail-first
`bash ~/.sam/tests/test-closer-t28-honest.sh` on live files: `13 passed, 26 failed` (fails first, as expected).

## closer_message.py diff
Adds `_job_name`, `_kind`; `_title` returns "Job FAILED/BLOCKED/UNKNOWN: <name>" for non-PASS; adds a
"Planned:" context line and "Needs SAM: ..." ending for non-PASS with no needs.
Probed with empty record, None verdict, non-dict meta, non-str verdict, None closerCtx: no crash.
PASS keeps "Job closed: ...". Non-PASS never says "Nothing needs you.". No finding.

## closer_blocked.py diff
Adds `BLOCKED_START_RE`, `UNBLOCK_LINE_RE`, `BULLET_RE`, `_plain`, `_block_at`; `parse_token` now walks the tail
with `_block_at`. Probes: the template line (`BLOCKED: <reason>; unblock: <what>`, and the `<reason>` multi-line form)
returns None; one-line form, long form with `Unblock:`/bullets, and bold form parse correctly; no crash.

### Finding 1 (BLOCKING): loose start match turns a PASS job into a blocked job
`BLOCKED_START_RE` accepts any line starting with `BLOCKED:` plus any text, with no unblock line required
(`_block_at` returns `(reason, "")`). Old code required `; unblock:`. `detect()` runs `parse_token` regardless
of exit code or verdict, and `plan()` then sets verdict `UNKNOWN: blocked: ...` and asks Colin.
Reproduced on the stage module:
- `All done.\nBLOCKED: none\n` -> `('none', '')`
- `- BLOCKED: nothing, all clear\n` -> `('nothing, all clear', '')`
A job that passes and ends with a "BLOCKED: none" status line would be reported as blocked and message Colin.
Suggested fix: require at least one `Unblock:`/bullet line (or non-empty unblock text) for the long form, or skip when
the verdict is PASS and exit is 0. Needs a Colin decision.

Non-blocking: none noted.

## Verdict
NOT CLEAN: 1 blocking issue. Nothing installed; live files untouched, no `.bak` made.
BLOCKED: stage review found 1 issues; unblock: Colin decides
