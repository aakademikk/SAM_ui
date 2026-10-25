# SAM_ui SSE secondary hazards: report

Branch fix/sse-hazards, worktree /home/col/SAM_ui-sse-wt, base bf0efc6. Fix commit 4e05265. Not merged, pushed or deployed.

## Note on the brief
The write-up says the guard is `hasText()`. In HEAD the guard is already `!textStreamedThisRound` (per round, added after 2026-08-21). The hazard is the same: any text streamed this round, including mid-turn narration, discards `result`.

## Fail before (current code, new tests added only)
Suite: tests 861, pass 856, fail 2, skipped 3.

not ok 275 - hazard 1: mid-turn narration streamed, final text lost, the longer result is kept
  AssertionError: the full answer in result must not be discarded
not ok 276 - hazard 2: finish() flushes a last line that has no trailing newline

Passing on the old code as controls:
ok 273 - single-shot: a result with no streamed text becomes the answer (2026-08-21 freeze)
ok 274 - a result already streamed in full is not duplicated

## Pass after
ok 273, ok 274, ok 275, ok 276.
tsc --noEmit -p . : TSC_OK

## Suite numbers
| | tests | pass | fail | skipped |
|---|---|---|---|---|
| baseline (bf0efc6) | 857 | 854 | 0 | 3 |
| before fix, with new tests | 861 | 856 | 2 | 3 |
| after fix | 861 | 858 | 0 | 3 |

The "failed to connect to the docker API" lines in the output come from existing tests and appear in baseline too.

## Diff summary
- src/lib/agentStream.ts: new private resultAddsText(): result is appended when nothing streamed this round (single-shot, unchanged), or when it is longer than the last text block and not contained in it. finish() now parses a non-empty buffer (a last line with no newline) before closing out.
- src/lib/agentStream.test.ts: four new tests.

VERDICT: both hazards fixed test-first on fix/sse-hazards, suite 861 tests with 0 failures and tsc clean; ready for Colin's merge and deploy gate.
