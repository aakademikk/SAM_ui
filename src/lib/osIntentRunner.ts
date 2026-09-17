/**
 * SAM — executes a matched OS intent against the phone bridge.
 *
 * Sits between the matcher (pure, testable) and the bridge (I/O). Its job is
 * to resolve loose human references — "Mike", "Spotify" — into the concrete
 * identifiers the bridge needs, run the action, and hand back a sentence SAM
 * can say.
 *
 * Every failure path returns handled:false so the agent picks the message up
 * instead. A command the phone could not carry out should fall through to the
 * brain, not dead-end.
 */

'use client';

import {
  callNumber,
  findApps,
  findContacts,
  notify,
  openApp,
  osBridgeAvailable,
  sendSms,
  setTorch,
} from './osBridge';
import { confirmsBeforeActing, intentClass, matchOsIntent, type OsIntent } from './osIntents';
import {
  desktopLock,
  desktopMedia,
  desktopVolume,
  openDesktopApp,
  probeDesktopBridge,
} from './desktopBridge';

export interface OsIntentResult {
  handled: boolean;
  /** What SAM should say and show. Only meaningful when handled. */
  reply?: string;
}

const NOT_HANDLED: OsIntentResult = { handled: false };

/**
 * Is this client a phone?
 *
 * Used only to decide whether a missing phone bridge should fall back to the
 * desktop. It never grants capability — a wrong answer here makes SAM refuse,
 * not act on the wrong machine.
 */
function onPhone(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /android|iphone|ipad|ipod/i.test(navigator.userAgent);
}

/** Looks like a phone number rather than a contact name. */
function isNumber(value: string): boolean {
  return /^[\d\s+()-]{3,}$/.test(value);
}

function minutesish(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} seconds`;
  if (ms < 3_600_000) {
    const mins = Math.round(ms / 60_000);
    return `${mins} minute${mins === 1 ? '' : 's'}`;
  }
  const hours = ms / 3_600_000;
  return `${hours % 1 === 0 ? hours : hours.toFixed(1)} hours`;
}

/**
 * An action previewed but not yet carried out.
 *
 * The confirmation has to survive between turns: SAM shows the resolved
 * destination, Colin says "yes", and only then does it act. Held in memory
 * only — a reload cancels it, which is the safe direction to fail.
 *
 * One slot, not one per action kind. Two independent pendings could both be
 * live at once, and "yes" would then be ambiguous about what it consented to.
 * `query` is the words Colin actually said ("mike"), kept so the destination
 * can be re-resolved at send time and compared — a contact edited between
 * preview and send must fail closed, not silently redirect.
 */
type Pending =
  | { kind: 'email'; to: string; subject: string; body: string; address: string; name: string }
  | { kind: 'sms'; query: string; number: string; name: string; message: string }
  | { kind: 'call'; query: string; number: string; name: string; place: boolean };

let pending: Pending | null = null;

const YES = /^(?:yes|yep|yeah|yup|send it|send|confirm|ok|okay|do it|go ahead)\b/i;
const NO = /^(?:no|nope|cancel|stop|don'?t|forget it|nevermind|never mind)\b/i;

interface EmailApiResponse {
  data?: {
    status: string;
    contact?: { name: string; email: string };
    candidates?: { name: string; email: string }[];
    subject?: string;
    expected?: string;
    reason?: string;
  };
  error?: string;
}

async function postEmail(body: Record<string, unknown>): Promise<EmailApiResponse['data'] | { status: 'http'; reason: string }> {
  const res = await fetch('/api/omni/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 503) return { status: 'unconfigured' };
  if (!res.ok) return { status: 'http', reason: `Mail route returned ${res.status}.` };
  const json = (await res.json()) as EmailApiResponse;
  return json.data ?? { status: 'http', reason: 'Malformed response.' };
}

/** Phase 1 — resolve and preview. Never sends. */
async function previewEmail(intent: Extract<OsIntent, { kind: 'email' }>): Promise<OsIntentResult> {
  const subject = intent.subject || 'Message from Colin';
  const out = await postEmail({ to: intent.who, subject, body: intent.body });
  if (!out) return NOT_HANDLED;

  switch (out.status) {
    case 'unknown':
      return { handled: true, reply: `No contact called “${intent.who}” with an email address in the vault.` };
    case 'ambiguous': {
      const names = (out.candidates ?? []).map((c) => `${c.name} (${c.email})`).join(', or ');
      // Deliberately does not choose. Picking one here would make the
      // confirmation confirm the action while hiding the wrong recipient.
      return { handled: true, reply: `More than one match for “${intent.who}”: ${names}. Which one?` };
    }
    case 'no_address':
      return { handled: true, reply: `${out.contact?.name} has no email address in the vault.` };
    case 'unconfigured':
      return { handled: true, reply: 'The mail relay is not configured yet, so I cannot send email.' };
    case 'confirm': {
      const c = out.contact!;
      pending = { kind: 'email', to: intent.who, subject, body: intent.body, address: c.email, name: c.name };
      // Reads back the resolved address, not the spoken name — that is what
      // catches a wrong resolution even when there is only one match.
      return {
        handled: true,
        reply: `Email ${c.name} — ${c.email} — saying “${intent.body}”? Say yes to send.`,
      };
    }
    default:
      return { handled: true, reply: out.reason ?? 'Could not prepare that email.' };
  }
}

/**
 * Phase 1 for SMS and calls — resolve and preview. Never sends.
 *
 * The phone's contacts live in ContactsContract, not the vault, so resolution
 * happens here against the bridge rather than server-side the way email's does.
 * The shape is the same: return candidates, never a winner.
 */
async function previewPhoneAction(
  intent: Extract<OsIntent, { kind: 'sms' | 'call' }>,
): Promise<OsIntentResult> {
  let number = intent.who;
  let name = intent.who;

  if (!isNumber(intent.who)) {
    const contacts = await findContacts(intent.who);
    if (contacts.length === 0) {
      return { handled: true, reply: `No contact matching “${intent.who}”.` };
    }
    if (contacts.length > 1) {
      // Deliberately does not choose. Asking "Text Mike?" when there are two
      // Mikes confirms the action while hiding the recipient error — and the
      // recipient error is the one that costs something.
      const names = contacts.map((c) => `${c.name} (${c.number})`).join(', or ');
      return { handled: true, reply: `More than one match for “${intent.who}”: ${names}. Which one?` };
    }
    number = contacts[0].number;
    name = contacts[0].name;
  }

  // Reads back the resolved number, not the spoken name — that is what catches
  // a wrong resolution even when there is only one match.
  if (intent.kind === 'sms') {
    pending = { kind: 'sms', query: intent.who, number, name, message: intent.message };
    return {
      handled: true,
      reply: `Text ${name} — ${number} — saying “${intent.message}”? Say yes to send.`,
    };
  }

  pending = { kind: 'call', query: intent.who, number, name, place: intent.place };
  return { handled: true, reply: `Call ${name} — ${number}? Say yes to place it.` };
}

/**
 * Has the destination moved since it was previewed?
 *
 * Re-resolves the same words and compares. A literal number cannot go stale, so
 * it is skipped. This is a client-side check because the client is the actor
 * here — the PWA holds the bridge token and there is no server in the send
 * path, unlike email. It is not a privilege boundary; it catches the contact
 * genuinely changing between preview and send, which is the real failure.
 */
async function destinationMoved(p: Extract<Pending, { kind: 'sms' | 'call' }>): Promise<string | null> {
  if (isNumber(p.query)) return null;
  const contacts = await findContacts(p.query);
  if (contacts.length !== 1) return contacts.length === 0 ? 'nothing' : 'more than one contact';
  return contacts[0].number === p.number ? null : contacts[0].number;
}

async function sendPendingSms(p: Extract<Pending, { kind: 'sms' }>): Promise<OsIntentResult> {
  const moved = await destinationMoved(p);
  if (moved) {
    return {
      handled: true,
      reply: `Not sent — “${p.query}” now resolves to ${moved}, not ${p.number}. Say it again to re-confirm.`,
    };
  }
  const ok = await sendSms(p.number, p.message);
  return ok
    ? { handled: true, reply: `Sent to ${p.name} — ${p.number}: “${p.message}”.` }
    : { handled: true, reply: `Couldn't send that text — SMS permission may be off.` };
}

async function placePendingCall(p: Extract<Pending, { kind: 'call' }>): Promise<OsIntentResult> {
  const moved = await destinationMoved(p);
  if (moved) {
    return {
      handled: true,
      reply: `Not placed — “${p.query}” now resolves to ${moved}, not ${p.number}. Say it again to re-confirm.`,
    };
  }
  const res = await callNumber(p.number, p.place);
  if (!res.ok) return { handled: true, reply: `Couldn't start the call.` };
  // Says what actually happened. If CALL_PHONE was refused the dialler is
  // merely open, and claiming otherwise would be a lie Colin acts on.
  return {
    handled: true,
    reply: res.placed ? `Calling ${p.name} — ${p.number}.` : `Dialler open for ${p.name} — ${p.number}.`,
  };
}

async function sendPendingEmail(p: Extract<Pending, { kind: 'email' }>): Promise<OsIntentResult> {
  const out = await postEmail({
    to: p.to,
    subject: p.subject,
    body: p.body,
    confirmAddress: p.address,
  });
  if (!out) return NOT_HANDLED;

  switch (out.status) {
    case 'sent':
      return { handled: true, reply: `Sent to ${p.name} — ${p.address}.` };
    case 'stale':
      return {
        handled: true,
        reply: `Not sent — ${p.name}'s address changed to ${out.expected} since I asked. Say it again to re-confirm.`,
      };
    case 'unconfigured':
      return { handled: true, reply: 'The mail relay is not configured yet, so I cannot send email.' };
    default:
      return { handled: true, reply: out.reason ?? 'The send failed.' };
  }
}

/** Phase 2 — carry out the pending action, or cancel it. */
async function resolvePending(message: string): Promise<OsIntentResult> {
  const p = pending;
  if (!p) return NOT_HANDLED;

  if (NO.test(message.trim())) {
    pending = null;
    return { handled: true, reply: 'Cancelled — nothing sent.' };
  }
  if (!YES.test(message.trim())) {
    // Anything that is not a clear yes or no cancels and falls through to the
    // agent. An ambiguous reply must never be read as consent to send.
    pending = null;
    return NOT_HANDLED;
  }

  // Cleared before acting, not after: a throw mid-send must not leave a live
  // confirmation that the next "yes" could fire a second time.
  pending = null;

  switch (p.kind) {
    case 'email':
      return sendPendingEmail(p);
    case 'sms':
      return sendPendingSms(p);
    case 'call':
      return placePendingCall(p);
  }
}

async function run(intent: OsIntent): Promise<OsIntentResult> {
  switch (intent.kind) {
    case 'email':
      return previewEmail(intent);

    case 'volume': {
      const res = await desktopVolume(intent.level);
      if (!res?.ok) return NOT_HANDLED;
      return { handled: true, reply: intent.level === 0 ? 'Muted.' : `Volume ${intent.level}%.` };
    }

    case 'media': {
      const res = await desktopMedia(intent.action);
      if (!res?.ok) return NOT_HANDLED;
      const said =
        intent.action === 'play-pause' ? 'Toggled playback.'
        : intent.action === 'next' ? 'Next track.'
        : intent.action === 'previous' ? 'Previous track.'
        : 'Stopped.';
      return { handled: true, reply: said };
    }

    case 'lock': {
      const res = await desktopLock();
      if (!res?.ok) return NOT_HANDLED;
      return { handled: true, reply: 'Locking the screen.' };
    }

    case 'open': {
      // Device-class: the phone bridge owns this when we are on the phone,
      // the desktop bridge when we are not.
      if (!osBridgeAvailable()) {
        const res = await openDesktopApp(intent.app);
        if (!res) return NOT_HANDLED;
        if (res.ambiguous?.length) {
          return { handled: true, reply: `Which one — ${res.ambiguous.join(', ')}?` };
        }
        return res.ok
          ? { handled: true, reply: `Opening ${res.app}.` }
          : { handled: true, reply: res.reason ?? `Could not open “${intent.app}”.` };
      }

      const apps = await findApps(intent.app);
      if (apps.length === 0) return { handled: true, reply: `No app called “${intent.app}”.` };
      const app = apps[0];
      const ok = await openApp(app.pkg);
      return ok
        ? { handled: true, reply: `Opening ${app.label}.` }
        : { handled: true, reply: `Couldn't open ${app.label}.` };
    }

    case 'call':
    case 'sms': {
      // `confirmsBeforeActing` has declared these gated since the intent
      // taxonomy was written; until now only email honoured it. "dial <number>"
      // is the one call form it exempts — see the note on that function.
      if (confirmsBeforeActing(intent)) return previewPhoneAction(intent);

      // Only `dial <number>` gets here. Asserting the kind rather than trusting
      // the predicate is deliberate: if `confirmsBeforeActing` ever changed, an
      // unconfirmed *sms* reaching this branch would silently dial its
      // recipient instead of texting them. Fail closed to the agent instead.
      if (intent.kind !== 'call') return NOT_HANDLED;

      const res = await callNumber(intent.who, false);
      return res.ok
        ? { handled: true, reply: `Dialler open for ${intent.who}.` }
        : { handled: true, reply: `Couldn't start the call.` };
    }

    case 'torch': {
      const ok = await setTorch(intent.on);
      return ok
        ? { handled: true, reply: `Torch ${intent.on ? 'on' : 'off'}.` }
        : { handled: true, reply: `Couldn't reach the torch.` };
    }

    case 'timer': {
      const ok = await notify('Timer', `${minutesish(intent.ms)} is up.`, Date.now() + intent.ms);
      return ok
        ? { handled: true, reply: `Timer set for ${minutesish(intent.ms)}.` }
        : { handled: true, reply: `Couldn't set that timer.` };
    }

    case 'reminder': {
      const ok = await notify('Reminder', intent.text, Date.now() + intent.ms);
      return ok
        ? { handled: true, reply: `I'll remind you to ${intent.text} in ${minutesish(intent.ms)}.` }
        : { handled: true, reply: `Couldn't set that reminder.` };
    }

    default:
      return NOT_HANDLED;
  }
}

/**
 * Try to handle a message on-device. Returns handled:false for anything that
 * is not a device command, or when there is no phone bridge to talk to — the
 * caller then sends it to the agent exactly as before.
 */
export async function tryOsIntent(message: string): Promise<OsIntentResult> {
  // A pending confirmation outranks matching: "yes" is not an intent, and must
  // not be re-parsed as one.
  if (pending) {
    try {
      const settled = await resolvePending(message);
      if (settled.handled) return settled;
    } catch {
      pending = null;
      return NOT_HANDLED;
    }
  }

  const intent = matchOsIntent(message);
  if (!intent) return NOT_HANDLED;

  // Route by class. Getting this wrong is how an intent gets silently dropped:
  // gating email on a phone bridge would kill it on the desktop, and gating a
  // desktop action on the same bridge would kill it everywhere.
  const cls = intentClass(intent);

  if (cls === 'phone' || cls === 'device') {
    if (!osBridgeAvailable()) {
      // One probe: availability is unknown until something has been tried.
      await findApps('');
    }
  }

  // A device-class action said *on a phone* must never quietly act on the PC.
  // Before the SAM app is installed there is no phone bridge, so "open
  // calculator" on the phone was reaching the desktop and opening it there —
  // and "open torch" was coming back "no app called torch" from the desktop's
  // app list. Holding a phone and being answered by the desk is worse than
  // being told no.
  if ((cls === 'phone' || cls === 'device') && !osBridgeAvailable() && onPhone()) {
    // The bridge probe just failed. The app is usually installed but its
    // service is not running (it starts when the app is opened, and does not
    // survive a reboot or a force-stop yet). Tell the truth and give the fix,
    // rather than claiming the app is missing — that is how "open torch"
    // ended up insisting the phone was app-less while the service was up.
    return {
      handled: true,
      reply: 'The SAM app is not reachable right now — open it once to start the phone controls, then try again.',
    };
  }

  // A phone-only action on the desktop is refused honestly rather than silently
  // handed to the agent, which would answer as though it had done something.
  if (cls === 'phone' && !osBridgeAvailable()) {
    return { handled: true, reply: 'That is a phone action — say it on your phone.' };
  }

  if (cls === 'desktop') {
    // Probed once; the client caches the answer, so this costs a round trip
    // only the first time a desktop command is used.
    const up = await probeDesktopBridge();
    if (!up) return NOT_HANDLED;
  }

  try {
    return await run(intent);
  } catch {
    return NOT_HANDLED;
  }
}
