/**
 * The vault wikilink graph that drives the intro visualiser.
 *
 * Produced by scripts/build_vault_graph.py (daily, via the sam-vault-graph
 * systemd timer) — this file is the contract between that script and the
 * client, so any field change has to land in both.
 */

export interface VaultGraphNode {
  /** Vault-relative path, e.g. "02 - Atwood Systems/10_Clients/10_Clients.md". */
  id: string;
  /** Filename without the .md — what a label would show. */
  label: string;
  /** Top-level folder, or "(root)" for notes at the vault root. */
  folder: string;
  /** Number of resolved wikilinks touching this note, in either direction. */
  degree: number;
  /** Distance band: 0 = core nucleus, 3 = rim. Derived from the laid-out radius. */
  ring: 0 | 1 | 2 | 3;
  /** Precomputed layout position, normalised to roughly [-1, 1]. */
  x: number;
  y: number;
  /** Epoch ms of the note's last write. */
  lastModified: number;
}

/** Undirected edge as a pair of indices into `nodes`. */
export type VaultGraphEdge = [number, number];

export interface VaultGraph {
  /** Epoch ms the graph was built. */
  generatedAt: number;
  /** Absolute vault path it was built from. */
  vault: string;
  /** Index into `nodes` of the most-connected note — the one at dead centre. */
  hub: number;
  counts: {
    notes: number;
    edges: number;
    /** [[links]] pointing at notes that don't exist. Not rendered; diagnostics. */
    unresolvedLinks: number;
  };
  /** Note count per top-level folder, already sorted descending. */
  folders: Record<string, number>;
  nodes: VaultGraphNode[];
  edges: VaultGraphEdge[];
}
