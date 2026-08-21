import { envelope, failure } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { requireSession } from '@/lib/server/auth/guard';
import { listContacts, resolveContact } from '@/lib/server/contacts';

export const dynamic = 'force-dynamic';

/**
 * GET /api/vault/contacts        — the whole address book
 * GET /api/vault/contacts?q=mike — candidates for a spoken name
 *
 * Session-gated: this returns real email addresses for real people, so it is
 * not public even on the tailnet.
 *
 * A `q` lookup returns every candidate with `kind: 'ambiguous'` rather than
 * picking one. Callers must stop and ask — see SAM_Omni_Plan §2.
 */
export async function GET(request: Request) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;

  const startedAt = Date.now();
  const estate = getEstate();
  const q = new URL(request.url).searchParams.get('q');

  try {
    if (q === null) {
      const contacts = await listContacts();
      return envelope({ contacts }, 'sam.vault.contacts', startedAt, estate.tick);
    }
    const match = await resolveContact(q);
    return envelope(match, 'sam.vault.contacts.resolve', startedAt, estate.tick);
  } catch {
    return failure('Could not read the vault address book.', 500);
  }
}
