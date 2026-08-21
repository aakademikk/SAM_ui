/**
 * SAM — local OS intent matching.
 *
 * "Open Spotify" should not need a round trip to a language model. This is the
 * same split Siri uses: a small set of device commands resolved on the phone,
 * everything else handed to the brain. It keeps the common cases instant, and
 * keeps them working when the agent is slow or the tier is expensive.
 *
 * Matching is deliberately conservative. Anything that is not clearly a device
 * command returns null and goes to the agent — a false positive here means a
 * question gets silently swallowed and answered by dialling someone.
 */

export type OsIntent =
  | { kind: 'open'; app: string }
  | { kind: 'call'; who: string; place: boolean }
  | { kind: 'sms'; who: string; message: string }
  | { kind: 'email'; who: string; subject: string; body: string }
  | { kind: 'torch'; on: boolean }
  | { kind: 'volume'; level: number }
  | { kind: 'media'; action: 'play-pause' | 'next' | 'previous' | 'stop' }
  | { kind: 'lock' }
  | { kind: 'timer'; ms: number; label: string }
  | { kind: 'reminder'; ms: number; text: string };

/**
 * Where an intent can actually run.
 *
 *   server  — SAM_ui's own API. Works from any authenticated client.
 *   phone   — the Android OS bridge. Loopback on the phone, so phone-only.
 *   desktop — the desktop bridge, reached through the server, which sits on the
 *             same machine as it. The *server* is the actor, so these are not
 *             restricted to a browser running on the PC.
 *   device  — either bridge can serve it; whichever is present wins.
 *
 * The runner uses this to decide whether a missing bridge means "fall through
 * to the agent" or "this simply is not a thing this device can do". Without it
 * email would be silently dropped on the desktop, where there is no bridge at
 * all — see SAM_Omni_Plan, "The honest split".
 */
export type IntentClass = 'server' | 'phone' | 'desktop' | 'device';

export function intentClass(intent: OsIntent): IntentClass {
  switch (intent.kind) {
    case 'email':
      return 'server';
    // Only the phone has a SIM, a torch, or a dialler.
    case 'sms':
    case 'call':
    case 'torch':
      return 'phone';
    // Only the desktop has a session to lock, a sink to set, or a player.
    case 'volume':
    case 'media':
    case 'lock':
      return 'desktop';
    // Both ends can do these — whichever device is listening handles it.
    default:
      return 'device';
  }
}

/**
 * Whether the action must be confirmed before it happens.
 *
 * True for anything that reaches a third party and cannot be taken back.
 * Deliberately false for local, reversible actions — a confirmation on
 * "flashlight on" trains you to press yes without reading, which is how the
 * confirmations that matter stop working.
 */
export function confirmsBeforeActing(intent: OsIntent): boolean {
  return intent.kind === 'email' || intent.kind === 'sms' || intent.kind === 'call';
}

/* ========================================================================== */
/* Duration parsing                                                           */
/* ========================================================================== */

const UNIT_MS: Record<string, number> = {
  second: 1000,
  seconds: 1000,
  sec: 1000,
  secs: 1000,
  minute: 60_000,
  minutes: 60_000,
  min: 60_000,
  mins: 60_000,
  hour: 3_600_000,
  hours: 3_600_000,
  hr: 3_600_000,
  hrs: 3_600_000,
};

const WORD_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40,
  forty_five: 45, fifty: 50, sixty: 60, half: 0.5,
};

/**
 * Parses "10 minutes", "an hour", "1 hour 30 mins", "90 seconds".
 * Returns 0 when nothing duration-shaped is found.
 */
export function parseDuration(text: string): number {
  const cleaned = text.toLowerCase().replace(/\band\b/g, ' ').trim();
  const pattern = /(\d+(?:\.\d+)?|[a-z]+)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b/g;

  let total = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(cleaned)) !== null) {
    const rawCount = match[1];
    const unit = UNIT_MS[match[2]];
    if (!unit) continue;

    const count = /^\d/.test(rawCount)
      ? Number(rawCount)
      : WORD_NUMBERS[rawCount] ?? NaN;
    if (!Number.isFinite(count)) continue;

    total += count * unit;
  }
  return Math.round(total);
}

/* ========================================================================== */
/* Intent matching                                                            */
/* ========================================================================== */

/** Strip the politeness people put round spoken commands. */
function normalise(input: string): string {
  return input
    .trim()
    .replace(/[.!?]+$/, '')
    .replace(/^(?:hey\s+)?sam[,\s]+/i, '')
    .replace(/^(?:please|could you|can you|would you)\s+/i, '')
    .trim();
}

export function matchOsIntent(input: string): OsIntent | null {
  const text = normalise(input);
  if (!text) return null;
  const lower = text.toLowerCase();

  /* ---- Torch ----------------------------------------------------------- */
  // Both orders: "torch on" and "turn on the torch".
  const torchWord = '(?:torch|flashlight|flash light)';
  let m =
    lower.match(new RegExp(`^(?:turn\\s+)?(?:the\\s+)?${torchWord}\\s+(on|off)$`)) ??
    lower.match(new RegExp(`^turn\\s+(on|off)\\s+(?:the\\s+)?${torchWord}$`));
  if (m) return { kind: 'torch', on: m[1] === 'on' };
  // "open torch" — people launch the torch like an app. Must precede the
  // generic open matcher, or it reads as an app named torch and comes back
  // "No app called torch".
  m = lower.match(new RegExp(`^(?:open|launch|start)\\s+(?:the\\s+)?${torchWord}$`));
  if (m) return { kind: 'torch', on: true };

  /* ---- Timers ---------------------------------------------------------- */
  m = lower.match(/^(?:set\s+(?:a\s+)?)?timer\s+(?:for\s+)?(.+)$/);
  if (m) {
    const ms = parseDuration(m[1]);
    if (ms > 0) return { kind: 'timer', ms, label: m[1].trim() };
    return null; // "timer" with no parseable duration — let the agent ask.
  }

  /* ---- Reminders ------------------------------------------------------- */
  // "remind me in 10 minutes to call mum"
  m = text.match(/^remind me\s+in\s+(.+?)\s+to\s+(.+)$/i);
  if (m) {
    const ms = parseDuration(m[1]);
    if (ms > 0) return { kind: 'reminder', ms, text: m[2].trim() };
  }
  // "remind me to call mum in 10 minutes"
  m = text.match(/^remind me\s+to\s+(.+?)\s+in\s+(.+)$/i);
  if (m) {
    const ms = parseDuration(m[2]);
    if (ms > 0) return { kind: 'reminder', ms, text: m[1].trim() };
  }

  /* ---- Volume ---------------------------------------------------------- */
  m = lower.match(/^(?:set\s+)?volume\s+(?:to\s+)?(\d{1,3})\s*%?$/);
  if (m) {
    const level = Number(m[1]);
    // Clamped rather than rejected — "volume 300" means loud, not a mistake.
    return { kind: 'volume', level: Math.max(0, Math.min(100, level)) };
  }
  if (/^(?:mute|volume\s+(?:off|mute))$/.test(lower)) return { kind: 'volume', level: 0 };

  /* ---- Media ----------------------------------------------------------- */
  if (/^(?:pause|pause\s+(?:the\s+)?music|play|resume|play\s+(?:the\s+)?music)$/.test(lower)) {
    return { kind: 'media', action: 'play-pause' };
  }
  if (/^(?:next|skip)(?:\s+(?:track|song))?$/.test(lower)) return { kind: 'media', action: 'next' };
  if (/^(?:previous|back|last)(?:\s+(?:track|song))$/.test(lower)) {
    return { kind: 'media', action: 'previous' };
  }

  /* ---- Lock ------------------------------------------------------------ */
  // "lock" alone is too easy to say by accident mid-sentence; require the noun.
  if (/^lock\s+(?:the\s+|my\s+)?(?:screen|session|pc|computer|desktop|machine)$/.test(lower)) {
    return { kind: 'lock' };
  }

  /* ---- Email ----------------------------------------------------------- */
  // Before SMS: "email X saying ..." and "text X saying ..." share a shape, and
  // "send an email to X" would otherwise be eaten by nothing at all.
  // Optional "about <subject>": "email mike about the invoice saying it's ready".
  m = text.match(
    // The colon form binds tight to the name — people write "Brad: quote", not
    // "Brad : quote" — so it cannot share the leading \s+ that the word forms
    // need.
    /^(?:send\s+(?:an?\s+)?email\s+to|email)\s+(.+?)(?:\s+about\s+(.+?))?(?:\s+(?:saying|that says)|\s*:)\s+(.+)$/i,
  );
  if (m) {
    const who = m[1].trim();
    // "email someone" is not a name. "me" *is* resolvable — Colin's own note
    // carries it as an alias — and the separator this pattern requires already
    // rules out the vague "email me the report" form.
    if (/^(?:someone|somebody|him|her|them)$/i.test(who)) return null;
    return {
      kind: 'email',
      who,
      subject: (m[2] ?? '').trim(),
      body: m[3].trim(),
    };
  }

  /* ---- Messaging ------------------------------------------------------- */
  // Must come before "call", since "text X saying call me" contains "call".
  m = text.match(/^(?:text|message|sms|send a text to)\s+(.+?)\s+(?:saying|that says|:)\s+(.+)$/i);
  if (m) return { kind: 'sms', who: m[1].trim(), message: m[2].trim() };

  /* ---- Calling --------------------------------------------------------- */
  // "dial" is explicitly the open-the-dialler form; "call" places it.
  m = text.match(/^dial\s+([\d\s+()-]{3,})$/i);
  if (m) return { kind: 'call', who: m[1].trim(), place: false };

  m = text.match(/^(?:call|ring|phone)\s+(.+)$/i);
  if (m) {
    const who = m[1].trim();
    // "call it a day", "call off the meeting" are not phone calls.
    if (/^(?:it|off|out|in sick|the police)\b/i.test(who)) return null;
    return { kind: 'call', who, place: true };
  }

  /* ---- Launching apps -------------------------------------------------- */
  // Note the article is NOT consumed here. People say "open Spotify", not
  // "open the Spotify" — so a leading article is the signal that this is
  // something physical ("open the door") rather than an app, and the guard
  // below needs to still be able to see it.
  m = text.match(/^(?:open|launch|start)\s+(.+?)(?:\s+app)?$/i);
  if (m) {
    const app = m[1].trim();
    // "open the door", "start a timer" — not app launches.
    if (/^(?:a|an|the)\b/i.test(app)) return null;
    if (app.length < 2) return null;
    return { kind: 'open', app };
  }

  return null;
}
