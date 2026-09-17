/**
 * SAM — confirmation-gate tests for the OS intent runner.
 *
 * These exist because the gap they cover was live for a month: `confirmsBeforeActing`
 * declared SMS and calls gated from the day the taxonomy was written, and the runner
 * only ever honoured it for email — so "text Mike" resolved `contacts[0]` and sent,
 * silently, to whichever Mike the phonebook returned first.
 *
 * The seam is `fetch`. Every bridge call goes through POST /api/os with an `op`, so a
 * stubbed fetch exercises the real runner, the real matcher and the real bridge client
 * end to end, with only the network faked. Asserting on the *op log* is the point: the
 * test that matters is not what SAM said, it is whether an `sms` op left the building.
 *
 * Run: npx tsx --test src/lib/osIntentRunner.test.ts
 *
 * Not wired to an `npm test` script: `tsx` is not a project dependency, and this
 * box's npm (9.2.0, against Node 22) reports "up to date" without installing it —
 * so declaring it would put a dependency in the manifest that is not on disk.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { tryOsIntent } from './osIntentRunner';

/* ------------------------------------------------------------------ harness */

interface BridgeCall {
  op: string;
  args: Record<string, unknown>;
}

let calls: BridgeCall[] = [];
let contacts: { name: string; number: string }[] = [];
let emailReplies: Record<string, unknown>[] = [];

/**
 * Ops that leave the device. `call` and `sms` reach a third party; `dial` only
 * opens the dialler, but it is tracked too — a set that watched `call` alone
 * would report "nothing happened" while the dialler was opening.
 */
const OUTBOUND = new Set(['sms', 'call', 'dial']);

function outbound(): BridgeCall[] {
  return calls.filter((c) => OUTBOUND.has(c.op));
}

function stubFetch() {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === 'string' ? url : url.toString();
    const body = JSON.parse(String(init?.body ?? '{}'));

    if (href === '/api/omni/email') {
      const reply = emailReplies.shift() ?? { status: 'http', reason: 'no stub queued' };
      calls.push({ op: 'email', args: body });
      return new Response(JSON.stringify({ data: reply }), { status: 200 });
    }

    const { op, ...args } = body as { op: string } & Record<string, unknown>;
    calls.push({ op, args });

    let data: unknown;
    switch (op) {
      case 'apps':
        data = { apps: [] };
        break;
      case 'contacts':
        data = { contacts };
        break;
      case 'sms':
        data = { sent: true, parts: 1 };
        break;
      case 'call':
        data = { ok: true, placed: true };
        break;
      case 'dial':
        // The dialler opened pre-filled; nothing was placed.
        data = { ok: true, placed: false };
        break;
      default:
        data = { ok: true };
    }
    return new Response(JSON.stringify({ data }), { status: 200 });
  }) as typeof fetch;
}

/** The runner refuses phone actions unless it believes it is on a phone. */
function pretendPhone() {
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'Mozilla/5.0 (Linux; Android 15; SM-A165F)' },
    configurable: true,
    writable: true,
  });
}

beforeEach(async () => {
  stubFetch();
  pretendPhone();
  calls = [];
  contacts = [];
  emailReplies = [];
  // Clear any confirmation left pending by a previous test. Safe when there is
  // none: "no" matches no intent and falls through.
  await tryOsIntent('no');
  calls = [];
});

/* -------------------------------------------------------------------- tests */

describe('SMS — the gap this closes', () => {
  it('does not send on a single match; it reads the number back first', async () => {
    contacts = [{ name: 'Mike Beattie', number: '07700 900123' }];

    const res = await tryOsIntent('text mike saying on my way');

    assert.equal(res.handled, true);
    assert.match(res.reply!, /Mike Beattie/);
    assert.match(res.reply!, /07700 900123/, 'must read back the resolved number, not just the name');
    assert.deepEqual(outbound(), [], 'nothing may be sent before a yes');
  });

  it('sends only after yes, to the number it read back', async () => {
    contacts = [{ name: 'Mike Beattie', number: '07700 900123' }];
    await tryOsIntent('text mike saying on my way');

    const res = await tryOsIntent('yes');

    assert.equal(res.handled, true);
    assert.deepEqual(outbound().map((c) => c.op), ['sms']);
    assert.equal(outbound()[0].args.number, '07700 900123');
    assert.equal(outbound()[0].args.body, 'on my way');
  });

  it('refuses to choose between two Mikes, and sends nothing', async () => {
    contacts = [
      { name: 'Mike Beattie', number: '07700 900123' },
      { name: 'Mike Ross', number: '07700 900456' },
    ];

    const res = await tryOsIntent('text mike saying on my way');

    assert.equal(res.handled, true);
    assert.match(res.reply!, /More than one match/);
    assert.match(res.reply!, /07700 900123/);
    assert.match(res.reply!, /07700 900456/);
    assert.deepEqual(outbound(), [], 'an ambiguous name must never send');
  });

  it('a yes after an ambiguous prompt sends nothing — there was no pending action', async () => {
    contacts = [
      { name: 'Mike Beattie', number: '07700 900123' },
      { name: 'Mike Ross', number: '07700 900456' },
    ];
    await tryOsIntent('text mike saying on my way');

    await tryOsIntent('yes');

    assert.deepEqual(outbound(), [], 'yes must not resolve an ambiguity it was never given');
  });

  it('no cancels', async () => {
    contacts = [{ name: 'Mike Beattie', number: '07700 900123' }];
    await tryOsIntent('text mike saying on my way');

    const res = await tryOsIntent('no');

    assert.match(res.reply!, /Cancelled/);
    assert.deepEqual(outbound(), []);
  });

  it('an unclear reply cancels rather than being read as consent', async () => {
    contacts = [{ name: 'Mike Beattie', number: '07700 900123' }];
    await tryOsIntent('text mike saying on my way');

    const res = await tryOsIntent('what was the weather like');

    assert.equal(res.handled, false, 'falls through to the agent');
    assert.deepEqual(outbound(), []);

    // And the pending action is gone, not lurking for the next stray "yes".
    await tryOsIntent('yes');
    assert.deepEqual(outbound(), []);
  });

  it('fails closed when the contact moved between preview and send', async () => {
    contacts = [{ name: 'Mike Beattie', number: '07700 900123' }];
    await tryOsIntent('text mike saying on my way');

    contacts = [{ name: 'Mike Beattie', number: '07700 999999' }];
    const res = await tryOsIntent('yes');

    assert.match(res.reply!, /Not sent/);
    assert.match(res.reply!, /07700 999999/);
    assert.match(res.reply!, /07700 900123/);
    assert.deepEqual(outbound(), [], 'a moved destination must not be silently substituted');
  });

  it('says so when nothing matches, and sends nothing', async () => {
    contacts = [];

    const res = await tryOsIntent('text nigel saying hello');

    assert.match(res.reply!, /No contact matching/);
    assert.deepEqual(outbound(), []);
  });
});

describe('calls', () => {
  it('previews before placing, then places on yes', async () => {
    contacts = [{ name: 'Mike Beattie', number: '07700 900123' }];

    const preview = await tryOsIntent('call mike');
    assert.match(preview.reply!, /07700 900123/);
    assert.deepEqual(outbound(), [], 'no call before a yes');

    const res = await tryOsIntent('yes');
    assert.deepEqual(outbound().map((c) => c.op), ['call']);
    assert.equal(outbound()[0].args.number, '07700 900123');
    assert.match(res.reply!, /Calling Mike Beattie/);
  });

  it('dial <number> is not gated — it only opens the dialler', async () => {
    const res = await tryOsIntent('dial 07700 900123');

    assert.deepEqual(outbound().map((c) => c.op), ['dial'], 'dial, never call');
    assert.equal(outbound()[0].args.number, '07700 900123');
    assert.match(res.reply!, /Dialler open/);
  });
});

describe('email — the path that already worked, still works', () => {
  it('previews the resolved address, then sends on yes', async () => {
    emailReplies = [
      { status: 'confirm', contact: { name: 'Mike Beattie', email: 'mike@example.com' } },
      { status: 'sent' },
    ];

    const preview = await tryOsIntent('email mike saying running late');
    assert.match(preview.reply!, /mike@example\.com/);
    assert.equal(calls.filter((c) => c.op === 'email').length, 1, 'preview must not send');

    const res = await tryOsIntent('yes');
    assert.match(res.reply!, /Sent to Mike Beattie/);

    const send = calls.filter((c) => c.op === 'email')[1];
    assert.equal(send.args.confirmAddress, 'mike@example.com', 'phase 2 echoes the address back');
  });

  it('does not choose between two matches', async () => {
    emailReplies = [
      {
        status: 'ambiguous',
        candidates: [
          { name: 'Mike Beattie', email: 'mike@example.com' },
          { name: 'Mike Ross', email: 'mross@example.com' },
        ],
      },
    ];

    const res = await tryOsIntent('email mike saying running late');
    assert.match(res.reply!, /More than one match/);
    assert.equal(calls.filter((c) => c.op === 'email').length, 1);
  });
});

describe('one pending slot', () => {
  it('a new command supersedes a pending confirmation instead of stacking', async () => {
    contacts = [{ name: 'Mike Beattie', number: '07700 900123' }];
    await tryOsIntent('text mike saying on my way');

    // A different command arrives before the yes.
    const res = await tryOsIntent('call mike');
    assert.match(res.reply!, /Call Mike Beattie/);
    assert.deepEqual(outbound(), [], 'still nothing sent');

    // The yes now applies to the call, not the abandoned text.
    await tryOsIntent('yes');
    assert.deepEqual(outbound().map((c) => c.op), ['call'], 'the abandoned SMS must not fire');
  });
});
