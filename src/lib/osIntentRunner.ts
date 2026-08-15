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
import { intentClass, matchOsIntent, type OsIntent } from './osIntents';

export interface OsIntentResult {
  handled: boolean;
  /** What SAM should say and show. Only meaningful when handled. */
  reply?: string;
}

const NOT_HANDLED: OsIntentResult = { handled: false };

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
 * An email previewed but not yet sent.
 *
 * The confirmation has to survive between turns: SAM shows the resolved
 * address, Colin says "yes", and only then does it send. Held in memory only —
 * a reload cancels the send, which is the safe direction to fail.
 */
let pendingEmail:
  | { to: string; subject: string; body: string; address: string; name: string }
  | null = null;

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
      pendingEmail = { to: intent.who, subject, body: intent.body, address: c.email, name: c.name };
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

/** Phase 2 — the pending send, or its cancellation. */
async function resolvePendingEmail(message: string): Promise<OsIntentResult> {
  const pending = pendingEmail;
  if (!pending) return NOT_HANDLED;

  if (NO.test(message.trim())) {
    pendingEmail = null;
    return { handled: true, reply: 'Cancelled — nothing sent.' };
  }
  if (!YES.test(message.trim())) {
    // Anything that is not a clear yes or no cancels and falls through to the
    // agent. An ambiguous reply must never be read as consent to send.
    pendingEmail = null;
    return NOT_HANDLED;
  }

  const out = await postEmail({
    to: pending.to,
    subject: pending.subject,
    body: pending.body,
    confirmAddress: pending.address,
  });
  pendingEmail = null;
  if (!out) return NOT_HANDLED;

  switch (out.status) {
    case 'sent':
      return { handled: true, reply: `Sent to ${pending.name} — ${pending.address}.` };
    case 'stale':
      return {
        handled: true,
        reply: `Not sent — ${pending.name}'s address changed to ${out.expected} since I asked. Say it again to re-confirm.`,
      };
    case 'unconfigured':
      return { handled: true, reply: 'The mail relay is not configured yet, so I cannot send email.' };
    default:
      return { handled: true, reply: out.reason ?? 'The send failed.' };
  }
}

async function run(intent: OsIntent): Promise<OsIntentResult> {
  switch (intent.kind) {
    case 'email':
      return previewEmail(intent);

    case 'open': {
      const apps = await findApps(intent.app);
      if (apps.length === 0) return { handled: true, reply: `No app called “${intent.app}”.` };
      const app = apps[0];
      const ok = await openApp(app.pkg);
      return ok
        ? { handled: true, reply: `Opening ${app.label}.` }
        : { handled: true, reply: `Couldn't open ${app.label}.` };
    }

    case 'call': {
      let number = intent.who;
      let name = intent.who;

      if (!isNumber(intent.who)) {
        const contacts = await findContacts(intent.who);
        if (contacts.length === 0) {
          return { handled: true, reply: `No contact matching “${intent.who}”.` };
        }
        number = contacts[0].number;
        name = contacts[0].name;
      }

      const res = await callNumber(number, intent.place);
      if (!res.ok) return { handled: true, reply: `Couldn't start the call.` };
      // Says what actually happened. If CALL_PHONE was refused the dialler is
      // merely open, and claiming otherwise would be a lie Colin acts on.
      return {
        handled: true,
        reply: res.placed ? `Calling ${name}.` : `Dialler open for ${name}.`,
      };
    }

    case 'sms': {
      let number = intent.who;
      let name = intent.who;

      if (!isNumber(intent.who)) {
        const contacts = await findContacts(intent.who);
        if (contacts.length === 0) {
          return { handled: true, reply: `No contact matching “${intent.who}”.` };
        }
        number = contacts[0].number;
        name = contacts[0].name;
      }

      const ok = await sendSms(number, intent.message);
      return ok
        ? { handled: true, reply: `Texted ${name}: “${intent.message}”.` }
        : { handled: true, reply: `Couldn't send that text — SMS permission may be off.` };
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
  if (pendingEmail) {
    try {
      const settled = await resolvePendingEmail(message);
      if (settled.handled) return settled;
    } catch {
      pendingEmail = null;
      return NOT_HANDLED;
    }
  }

  const intent = matchOsIntent(message);
  if (!intent) return NOT_HANDLED;

  // Server-class intents are SAM_ui's own API — they work from the desktop and
  // the phone alike, and must not be gated on a phone bridge that will never
  // exist on a PC. Device-class intents still fall through to the agent when
  // their bridge is absent.
  if (intentClass(intent) !== 'server' && !osBridgeAvailable()) {
    // One probe: availability is unknown until something has been tried.
    const apps = await findApps('');
    if (!osBridgeAvailable() && apps.length === 0) return NOT_HANDLED;
  }

  try {
    return await run(intent);
  } catch {
    return NOT_HANDLED;
  }
}
