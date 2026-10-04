/**
 * SAM — a chat stream that closes `unauthorized` (session expired or revoked
 * mid-turn) must not read as a finished answer (ux-fixes review finding).
 *
 * The stream route already closes with `{"status":"unauthorized"}` (see its
 * route test). What was wrong sat client-side: the chat page's finalise only
 * knew exited/killed/lost, so `unauthorized` fell through to the clean-finish
 * path — partial text stored as `done`, spoken aloud, no word that Colin had
 * been signed out. These tests run the real SSE parser (streamJob) over the
 * real wire text and then the close handling the chat page and the dashboard
 * widget share.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import type { ChatBlock } from '@/types/chat';
import { closeKind, cutOffNotice, SIGNED_OUT_NOTICE } from './chatClose.js';
import { streamJob, type JobEvent } from './jobsService.js';

async function eventsFor(wire: string): Promise<JobEvent[]> {
  const g = globalThis as Record<string, unknown>;
  const realFetch = g.fetch;
  const hadWindow = 'window' in g;
  g.window = { location: { origin: 'http://localhost' } };
  g.fetch = async () => new Response(wire, { status: 200 });
  const events: JobEvent[] = [];
  try {
    await new Promise<void>((resolve) => {
      streamJob('job1', (e) => {
        events.push(e);
        if (e.type === 'closed') resolve();
      });
    });
  } finally {
    g.fetch = realFetch;
    if (!hadWindow) delete g.window;
  }
  return events;
}

const PARTIAL =
  'id: 1\nevent: output\ndata: {"type":"assistant","message":{"content":[{"type":"text","text":"Half an ans"}]}}\n\n';

test('an unauthorized close reaches the chat as its own status, not a clean exit', async () => {
  const events = await eventsFor(`${PARTIAL}event: closed\ndata: {"status":"unauthorized"}\n\n`);
  const closed = events.find((e) => e.type === 'closed');
  assert.ok(closed && closed.type === 'closed');
  assert.equal(closed.status, 'unauthorized');
  // The server sends no exit code for it; the client must not carry `undefined`
  // into the "exited with code …" wording.
  assert.equal(closed.exitCode, null);
});

test('an unauthorized close says the reply was cut off by sign-out, and is never spoken', () => {
  const notice = cutOffNotice('unauthorized', false);
  assert.deepEqual(notice, { kind: 'error', text: SIGNED_OUT_NOTICE });
  assert.match(SIGNED_OUT_NOTICE, /signed out/i);
  assert.match(SIGNED_OUT_NOTICE, /cut off/i);
  const k = closeKind('unauthorized', false);
  assert.equal(k.signedOut, true);
  // The notice stands in for "exited with code unknown".
  assert.equal(k.suppressExitError, true);
  // Callers append the notice and skip auto-speak whenever there is one.
  const blocks: ChatBlock[] = [{ kind: 'text', text: 'Half an ans' }, notice!];
  assert.equal(blocks[blocks.length - 1].kind, 'error');
});

test('a normal exit has no cut-off notice; lost, killed and stopped keep their own wording', () => {
  assert.equal(cutOffNotice('exited', false), null);
  assert.match((cutOffNotice('lost', false) as { text: string }).text, /Lost connection/);
  assert.match((cutOffNotice('killed', false) as { text: string }).text, /interrupted/);
  // A kill we asked for is a stop, not an interruption.
  assert.equal(cutOffNotice('killed', true), null);
  assert.equal(closeKind('killed', true).selfStopped, true);
});

test('both chat surfaces route their close through chatClose', () => {
  // The pages are React and cannot be mounted in this suite (no jsdom), so pin
  // the wiring itself: a finalise that stops using cutOffNotice would again
  // file a signed-out close as a finished answer.
  const root = path.resolve(__dirname, '../../src');
  for (const file of ['app/(app)/chat/page.tsx', 'components/dashboard/fleet/DashboardChatWidget.tsx']) {
    const source = fs.readFileSync(path.join(root, file), 'utf-8');
    assert.match(source, /cutOffNotice\(status/, `${file} must build its close notice with cutOffNotice`);
    assert.match(source, /type CloseStatus/, `${file} must accept the unauthorized status`);
  }
});
