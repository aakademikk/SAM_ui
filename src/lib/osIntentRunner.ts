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
import { matchOsIntent, type OsIntent } from './osIntents';

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

async function run(intent: OsIntent): Promise<OsIntentResult> {
  switch (intent.kind) {
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
  const intent = matchOsIntent(message);
  if (!intent) return NOT_HANDLED;

  // Matching is cheap and runs anywhere; executing needs the Android app. On
  // the desktop this is where device commands fall through to the agent.
  if (!osBridgeAvailable()) {
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
