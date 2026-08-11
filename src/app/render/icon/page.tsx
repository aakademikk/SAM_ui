/**
 * /render/icon — offscreen render target for icon generation.
 *
 * Not part of the app's navigation. `scripts/generate-icons.sh` points headless
 * Chromium at this route at a square window size and screenshots the result,
 * so the app icon is a genuine frame of the visualiser rather than a drawing
 * of one — and regenerating it after a visualiser change is one command.
 *
 * Query params:
 *   ?state=idle|listening|thinking|speaking|alert   (default: idle)
 *   ?zoom=1.4                                        scales the mesh up so it
 *                                                    fills a small icon better
 */

import { VisualiserWidget } from '@/components/visualiser/VisualiserWidget';
import type { VisualiserState } from '@/hooks/useVisualiserState';

const STATES: VisualiserState[] = ['idle', 'listening', 'thinking', 'speaking', 'alert'];

export default async function IconRenderPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; zoom?: string }>;
}) {
  const params = await searchParams;
  const state = STATES.includes(params.state as VisualiserState)
    ? (params.state as VisualiserState)
    : 'idle';
  const zoom = Number(params.zoom) > 0 ? Number(params.zoom) : 1;

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#010812]">
      <div
        className="absolute inset-0 origin-center"
        style={{ transform: `scale(${zoom})` }}
      >
        <VisualiserWidget state={state} hud={false} />
      </div>
    </div>
  );
}
