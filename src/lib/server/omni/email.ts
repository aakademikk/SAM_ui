/**
 * SAM — omni email send, relayed through n8n.
 *
 * SAM never holds a mail credential. It posts {to, subject, body} to an n8n
 * webhook and n8n sends — the same relay pattern Fleet_Job_Protocol uses for
 * Slack, and n8n already sends mail for the Parkfords pack, so the credential
 * and transport both exist there.
 *
 * Two gates, both required:
 *
 *  1. **Confirmation names the resolved address, not the spoken name.** The
 *     caller must echo back the exact address it was shown, and the server
 *     re-resolves and compares. So a client cannot blind-confirm, and a stale
 *     confirmation (address changed between preview and send) fails closed.
 *
 *  2. **n8n re-validates the recipient** against the vault contact set. The
 *     webhook is a second gate, not a pass-through — a confused or compromised
 *     caller still cannot mail an arbitrary address.
 *
 * The webhook URL is env-only and never hardcoded. Precedent: the Atwood
 * contact webhook sat literally in `lib/constants.ts` under a comment saying
 * never hardcode URLs, and had to be pulled out. Unset here means 503, not a
 * fetch to `undefined`.
 */

import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { resolveContact, type Contact } from '@/lib/server/contacts';

const WEBHOOK_URL = process.env.SAM_EMAIL_WEBHOOK_URL ?? '';
const TIMEOUT_MS = 10_000;
const MAX_SUBJECT = 200;
const MAX_BODY = 10_000;

/**
 * Audit trail. SAM_Omni_Plan says the daily note, but sam-ui runs with
 * ProtectHome=read-only and the vault is not in ReadWritePaths — so this lands
 * in ~/.sam, which is writable, rather than widening the service's reach to the
 * whole vault for the sake of a log line. Roll up into the daily note offline.
 */
const AUDIT_LOG = path.join(os.homedir(), '.sam', 'omni-sends.jsonl');

export type EmailOutcome =
  | { status: 'unknown'; query: string }
  | { status: 'ambiguous'; query: string; candidates: Contact[] }
  | { status: 'no_address'; query: string; contact: Contact }
  | { status: 'confirm'; contact: Contact; subject: string; body: string }
  | { status: 'stale'; expected: string; actual: string }
  | { status: 'unconfigured' }
  | { status: 'failed'; reason: string }
  | { status: 'sent'; contact: Contact; subject: string };

export interface EmailRequest {
  /** Spoken name, e.g. "mike". Never a raw address — resolution is the point. */
  to: string;
  subject: string;
  body: string;
  /** The exact address the caller was shown. Absent = preview only. */
  confirmAddress?: string;
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

async function audit(entry: Record<string, unknown>): Promise<void> {
  try {
    await fsp.mkdir(path.dirname(AUDIT_LOG), { recursive: true });
    await fsp.appendFile(AUDIT_LOG, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  } catch {
    // An unwritable audit log must not block or fail a send that was authorised.
  }
}

/**
 * Resolve, then either preview for confirmation or send.
 *
 * Never picks between candidates and never invents an address — a contact
 * without an `email:` field returns `no_address` rather than guessing.
 */
export async function sendOmniEmail(req: EmailRequest): Promise<EmailOutcome> {
  const subject = clip(req.subject.trim(), MAX_SUBJECT);
  const body = clip(req.body.trim(), MAX_BODY);

  const match = await resolveContact(req.to);
  if (match.kind === 'none') return { status: 'unknown', query: req.to };
  if (match.kind === 'ambiguous') {
    return { status: 'ambiguous', query: req.to, candidates: match.matches };
  }

  const contact = match.matches[0];
  if (!contact.email) return { status: 'no_address', query: req.to, contact };

  // Phase 1 — nothing to confirm against yet. Show what would happen.
  if (!req.confirmAddress) {
    return { status: 'confirm', contact, subject, body };
  }

  // Phase 2 — the caller must echo the address it was shown. Re-resolved above,
  // so an address changed between preview and send fails closed rather than
  // sending to the new one without asking again.
  if (req.confirmAddress.trim().toLowerCase() !== contact.email.toLowerCase()) {
    await audit({ event: 'stale_confirmation', to: req.to, expected: contact.email, actual: req.confirmAddress });
    return { status: 'stale', expected: contact.email, actual: req.confirmAddress };
  }

  if (!WEBHOOK_URL) return { status: 'unconfigured' };

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: contact.email, name: contact.name, subject, body }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      await audit({ event: 'send_failed', to: contact.email, subject, httpStatus: res.status });
      return { status: 'failed', reason: `Relay returned ${res.status}.` };
    }
  } catch {
    await audit({ event: 'send_failed', to: contact.email, subject, reason: 'unreachable' });
    return { status: 'failed', reason: 'The mail relay is unreachable.' };
  }

  await audit({ event: 'sent', name: contact.name, to: contact.email, source: contact.path, subject });
  return { status: 'sent', contact, subject };
}

export function relayConfigured(): boolean {
  return WEBHOOK_URL.length > 0;
}
