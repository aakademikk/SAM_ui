/**
 * SAM — bust asset paths.
 *
 * The six approved, compressed WebP busts (built by the design source's own
 * `assets/busts/make-web.py`) live under `public/busts/`. This is the one
 * typed map from a General (or SAM) to its public path, at the two sizes the
 * mockup ships: 256 px for the scene/cards/Fleet rows, 512 px for zoom/the
 * phone sheet. Zeus (SAM) has no 512 px render — Won't-do: no new bust
 * artwork, so there is nothing to fall back to.
 */

import type { GeneralId } from '@/types/floor';

export interface BustPaths {
  small: string;
  large?: string;
}

export const BUST_PATHS: Record<GeneralId | 'sam', BustPaths> = {
  sam: { small: '/busts/zeus-256.webp' },
  hermes: { small: '/busts/hermes-256.webp', large: '/busts/hermes-512.webp' },
  hephaestus: { small: '/busts/hephaestus-256.webp', large: '/busts/hephaestus-512.webp' },
  calliope: { small: '/busts/calliope-256.webp', large: '/busts/calliope-512.webp' },
  cerberus: { small: '/busts/cerberus-256.webp', large: '/busts/cerberus-512.webp' },
  prometheus: { small: '/busts/prometheus-256.webp', large: '/busts/prometheus-512.webp' },
};
