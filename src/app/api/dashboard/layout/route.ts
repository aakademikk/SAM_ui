import type { WidgetKind, WidgetLayoutItem, WidgetSize } from '@/types/dashboard';
import { envelope, failure, readJson } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';

export const dynamic = 'force-dynamic';

/**
 * Layout persistence.
 *
 * Single-tenant, in-process for now. Swap `store` for a row in the users table
 * keyed by session — the wire contract does not change.
 */
const store = globalThis as unknown as {
  __samLayout?: { layout: WidgetLayoutItem[]; savedAt: string };
};

const VALID_IDS: WidgetKind[] = [
  'ai-insights',
  'agent-fleet',
  'vault-memory',
  'command-terminal',
  'active-projects',
  'system-health',
  'finance-balance',
  'daily-tasks',
];
const VALID_SIZES: WidgetSize[] = ['sm', 'md-wide', 'md-tall', 'lg'];

function sanitize(raw: unknown): WidgetLayoutItem[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length > VALID_IDS.length) return null;

  const seen = new Set<string>();
  const layout: WidgetLayoutItem[] = [];

  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) return null;
    const item = entry as Record<string, unknown>;

    if (!VALID_IDS.includes(item.id as WidgetKind)) return null;
    if (!VALID_SIZES.includes(item.size as WidgetSize)) return null;
    if (seen.has(item.id as string)) return null;

    seen.add(item.id as string);
    layout.push({
      id: item.id as WidgetKind,
      size: item.size as WidgetSize,
      visible: item.visible !== false,
    });
  }

  return layout;
}

export async function GET() {
  const startedAt = Date.now();
  const estate = getEstate();
  return envelope(
    store.__samLayout ?? { layout: null, savedAt: null },
    'sam.preferences.layout',
    startedAt,
    estate.tick,
  );
}

export async function PATCH(request: Request) {
  const startedAt = Date.now();
  const body = await readJson(request);
  const layout = sanitize(body.layout);

  if (!layout) {
    return failure('Layout payload rejected: unknown widget id, invalid size, or duplicate entry.', 422);
  }

  const savedAt = new Date().toISOString();
  store.__samLayout = { layout, savedAt };

  const estate = getEstate();
  return envelope({ savedAt, count: layout.length }, 'sam.preferences.layout', startedAt, estate.tick);
}
