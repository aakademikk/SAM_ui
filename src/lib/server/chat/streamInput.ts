/**
 * SAM — one line of stream-json input for a Claude-tier turn's stdin.
 *
 * The CLI's proven contract (`/tmp/btw-probe.py`, 2026-10-03): with
 * `--input-format stream-json`, the CLI reads its prompt from stdin as a
 * single JSON line instead of argv. This is also the shape a mid-turn side
 * message takes (T5) — same line, written again later.
 */
export function streamJsonUserLine(text: string): string {
  return (
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) +
    '\n'
  );
}

/**
 * True when `line` is a complete stream-json `result` event.
 *
 * The real CLI (2.1.x) does not print `type` first on its result line — e.g.
 * `{"duration_api_ms":1063,"stop_reason":"end_turn",…,"type":"result",…}` —
 * so a prefix check (`line.startsWith('{"type":"result"')`) never matches it.
 * This parses the line and checks the parsed object's own top-level `type`,
 * which is immune to key order and also to an `assistant` line whose *text*
 * happens to contain the string `"type":"result"` (that string lives inside
 * a nested `content[].text` value, not at the top level of the parsed
 * object). A non-JSON or non-object line is false, never a thrown error.
 */
export function isResultLine(line: string): boolean {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith('{')) return false;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { type?: unknown }).type === 'result'
    );
  } catch {
    return false;
  }
}
