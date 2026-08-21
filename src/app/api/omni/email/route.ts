import { envelope, failure, readJson } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { requireSession } from '@/lib/server/auth/guard';
import { logCommand } from '@/lib/server/auth/auditLog';
import { sendOmniEmail } from '@/lib/server/omni/email';

export const dynamic = 'force-dynamic';

/**
 * POST /api/omni/email — send mail to a vault contact, via the n8n relay.
 *
 * Two-phase by design:
 *
 *   { to, subject, body }                     -> status: "confirm", with the
 *                                                resolved contact and address
 *   { to, subject, body, confirmAddress }     -> status: "sent"
 *
 * The caller must echo back the exact address it was shown. That is what makes
 * the confirmation meaningful: it confirms the *recipient*, not just the
 * action. `ambiguous` returns every candidate and sends nothing.
 *
 * Session-gated rather than step-up gated. Step-up guards the fleet because a
 * General has bash reach; this can only mail an address already written in the
 * vault, and the explicit confirm is the designed gate. Revisit if the relay
 * ever accepts arbitrary recipients.
 */
export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;

  const startedAt = Date.now();
  const estate = getEstate();
  const body = await readJson(request);

  const to = typeof body.to === 'string' ? body.to.trim() : '';
  const subject = typeof body.subject === 'string' ? body.subject : '';
  const text = typeof body.body === 'string' ? body.body : '';
  const confirmAddress = typeof body.confirmAddress === 'string' ? body.confirmAddress : undefined;

  if (!to) return failure('No recipient given.', 400);
  if (!text.trim()) return failure('No message body given.', 400);

  const outcome = await sendOmniEmail({ to, subject, body: text, confirmAddress });

  if (outcome.status === 'unconfigured') {
    // Same shape as the Atwood contact route: refuse loudly rather than POST to
    // an undefined URL. SAM_EMAIL_WEBHOOK_URL is env-only, never in source.
    return failure('Mail relay is not configured (SAM_EMAIL_WEBHOOK_URL unset).', 503);
  }

  if (outcome.status === 'sent') {
    // Same audit trail as a fleet dispatch: which device authorised an
    // outbound action, and to whom. There is no jobId — nothing was spawned.
    await logCommand({
      jobId: '-',
      command: `[omni:email] ${outcome.contact.name} <${outcome.contact.email}> — ${outcome.subject}`,
      device: session.device,
      credentialId: session.sub.slice(0, 12),
      timestamp: new Date().toISOString(),
    });
  }

  return envelope(outcome, `sam.omni.email.${outcome.status}`, startedAt, estate.tick);
}
