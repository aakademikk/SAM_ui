#!/usr/bin/env python3
"""Build the vault wikilink graph that feeds SAM's intro visualiser.

Scans the Obsidian vault, resolves [[wikilinks]] into an undirected graph, and
lays it out as concentric rings by hop-distance from the most-connected note —
ring 0 is the hub, and the ring radius curve is deliberately non-linear so the
bulk of the graph packs into a tight central "nucleus" while the sparse outer
rings reach the screen edge. That shape is the whole point: the client draws
energy flowing outward from the centre along the edges that span rings.

The layout is precomputed here, once a day, rather than force-solved in the
browser — the graph only changes when the vault does, so paying for a solver on
every boot would be wasted work on the phone.

Output is compact JSON, written to ~/.sam/vault-graph.json by default:

    {
      "generatedAt": 1755, "vault": "...", "hub": 12,
      "counts": {"notes": 70, "edges": 269, "unresolvedLinks": 9},
      "folders": {"02 - Atwood Systems": 38, ...},
      "nodes": [{"id","label","folder","degree","ring","x","y","lastModified"}],
      "edges": [[0, 1], ...]
    }

Coordinates are normalised to roughly [-1, 1]; the client applies aspect.

Usage:
    build_vault_graph.py                       # -> ~/.sam/vault-graph.json
    build_vault_graph.py --out src/data/vault-graph.json --pretty
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import re
import sys
import time
from collections import defaultdict

VAULT = os.environ.get("SAM_VAULT_PATH", "/home/col/ai-memory-vault")

# Mirrors IGNORED_DIRS in src/lib/server/vaultMetrics.ts — keep the two in step,
# or the visualiser and the telemetry widget will disagree on the note count.
IGNORED_DIRS = {".obsidian", ".git", ".trash", "node_modules"}

# Radius curve over degree rank. >1 squeezes the best-connected notes into a
# tight central nucleus; at 1.0 they spread evenly and the nucleus disappears.
CORE_POW = 1.45
# Innermost radius for anything that is not the hub itself.
CORE_MIN = 0.075
# Angle solver. Radius is fixed, so these only ever move a note around its own
# track; tuned by eye on this vault (~72 notes, ~280 edges).
SOLVE_STEPS = 220
REPULSION = 0.0016
REPULSION_CAP = 0.9      # stops two coincident notes flinging each other away
ATTRACTION = 0.030
MAX_STEP = 0.18          # radians per pass, before cooling
SEED = 42

LINK_RE = re.compile(r"\[\[([^\]]+)\]\]")
# ```fenced``` blocks and `inline code` — links inside them are examples, not
# real edges (the vault's own docs quote [[wikilinks]] when explaining them).
CODE_RE = re.compile(r"```.*?```|`[^`\n]*`", re.DOTALL)


# ---------------------------------------------------------------- scan notes

def scan_notes(vault: str) -> dict[str, dict]:
    """rel path -> {label, folder, lastModified}."""
    notes: dict[str, dict] = {}
    for root, dirs, files in os.walk(vault):
        dirs[:] = [d for d in dirs if d not in IGNORED_DIRS and not d.startswith(".")]
        for name in files:
            if not name.endswith(".md"):
                continue
            full = os.path.join(root, name)
            rel = os.path.relpath(full, vault)
            parts = rel.split(os.sep)
            try:
                mtime = int(os.stat(full).st_mtime * 1000)
            except OSError:
                # Vanished between walk and stat — skip rather than half-record.
                continue
            notes[rel] = {
                "label": name[:-3],
                "folder": parts[0] if len(parts) > 1 else "(root)",
                "lastModified": mtime,
            }
    return notes


# ------------------------------------------------------------ resolve links

def make_resolver(notes: dict[str, dict]):
    basename_index: dict[str, list[str]] = defaultdict(list)
    for rel, meta in notes.items():
        basename_index[meta["label"]].append(rel)

    def resolve(target: str) -> str | None:
        t = target.split("|")[0].split("#")[0].strip().lstrip("./").rstrip("/")
        if t.endswith(".md"):
            t = t[:-3]
        if not t:
            return None
        if t + ".md" in notes:
            return t + ".md"
        cands = basename_index.get(t, [])
        if len(cands) == 1:
            return cands[0]
        if len(cands) > 1:
            # Ambiguous basename — Obsidian would disambiguate by proximity;
            # we drop it rather than invent an edge that may not be meant.
            return None
        suffix = os.sep + t + ".md"
        for rel in notes:
            if rel.endswith(suffix):
                return rel
        return None

    return resolve


def build_edges(vault: str, notes: dict[str, dict]):
    resolve = make_resolver(notes)
    edges: set[tuple[str, str]] = set()
    unresolved = 0
    for rel in notes:
        try:
            with open(os.path.join(vault, rel), encoding="utf-8", errors="replace") as fh:
                text = fh.read()
        except OSError:
            continue
        text = CODE_RE.sub(" ", text)
        for raw in LINK_RE.findall(text):
            target = resolve(raw)
            if target is None:
                unresolved += 1
                continue
            if target == rel:
                continue
            edges.add(tuple(sorted((rel, target))))
    return edges, unresolved


# ----------------------------------------------------------- radial layout

def layout(
    nodes: list[str],
    adj: dict[str, set[str]],
    edge_list: list[tuple[str, str]],
) -> tuple[dict[str, tuple[float, float]], dict[str, int], int]:
    """Place notes by how connected they are: hubs in the core, motes at the rim.

    An earlier version ranked radius by BFS hop-distance from the hub. That
    fails on this vault — ~280 edges over ~72 notes means almost everything sits
    1-2 hops out, so hop-distance barely discriminates and the "nucleus" came
    out as a diffuse scatter with edges chording across the middle. Degree
    ranges 0..27 and does discriminate, so radius is driven by degree rank.

    Radius is then held fixed and only the angle is solved (see below). The
    result: a dense core of hubs, a sparse rim, and the long edges between them
    running radially — which is what makes an outward pulse legible.
    """
    rng = random.Random(SEED)
    if not nodes:
        return {}, {}, 0

    order = sorted(nodes, key=lambda n: (-len(adj[n]), n))
    hub_idx = nodes.index(order[0])
    count = len(order)

    # Target radius by rank percentile. CORE_POW > 1 squeezes the top-ranked
    # notes into the middle; at 1.0 they would spread evenly to the rim.
    def target_radius(rank: int) -> float:
        if count <= 1 or rank == 0:
            return 0.0
        # Floor above zero: without it the next few ranks land at radius ~0.002
        # and stack directly on the hub, so the nucleus renders as one blob
        # rather than a cluster of distinct notes.
        t = (rank / (count - 1)) ** CORE_POW
        return CORE_MIN + (1.0 - CORE_MIN) * t

    target = {n: target_radius(i) for i, n in enumerate(order)}

    # ---- angle solved on a fixed radius ------------------------------------
    # Radius is a hard constraint (it encodes degree rank); only the angle is
    # free. So this is a force sim on a set of concentric tracks: linked notes
    # slide toward each other, every pair pushes apart, and each node is
    # re-projected onto its own track every step.
    #
    # Angles start evenly spread by golden angle. A previous attempt seeded each
    # node at the mean bearing of its placed neighbours instead, and the whole
    # graph avalanched into one quadrant — with no counter-force, "sit near your
    # neighbours" has a single trivial solution where everything is adjacent.
    GOLDEN = math.pi * (3 - math.sqrt(5))
    theta = {n: (i * GOLDEN) % (2 * math.pi) for i, n in enumerate(order)}

    def xy(n: str) -> tuple[float, float]:
        r = target[n]
        return (r * math.cos(theta[n]), r * math.sin(theta[n]))

    for step in range(SOLVE_STEPS):
        # Cool down so early passes untangle broadly and later ones settle.
        cool = 1.0 - 0.7 * (step / SOLVE_STEPS)
        force = {n: [0.0, 0.0] for n in order}

        for i in range(count):
            a = order[i]
            ax, ay = xy(a)
            for j in range(i + 1, count):
                b = order[j]
                bx, by = xy(b)
                dx, dy = ax - bx, ay - by
                d2 = dx * dx + dy * dy
                if d2 < 1e-8:
                    dx, dy = rng.uniform(-1, 1), rng.uniform(-1, 1)
                    d2 = dx * dx + dy * dy
                f = min(REPULSION / d2, REPULSION_CAP)
                d = math.sqrt(d2)
                force[a][0] += dx / d * f
                force[a][1] += dy / d * f
                force[b][0] -= dx / d * f
                force[b][1] -= dy / d * f

        for a, b in edge_list:
            ax, ay = xy(a)
            bx, by = xy(b)
            dx, dy = bx - ax, by - ay
            d = math.hypot(dx, dy)
            if d < 1e-6:
                continue
            # Divided by degree so a 27-link hub is not dragged around by each
            # of its neighbours in turn — hubs should anchor, leaves should move.
            fa = ATTRACTION * d / max(len(adj[a]), 1)
            fb = ATTRACTION * d / max(len(adj[b]), 1)
            force[a][0] += dx / d * fa
            force[a][1] += dy / d * fa
            force[b][0] -= dx / d * fb
            force[b][1] -= dy / d * fb

        for n in order:
            r = target[n]
            if r < 1e-4:
                continue  # the hub sits at dead centre; it has no angle to move
            # Only the tangential component can act — radial force is absorbed
            # by the track. Arc length over radius converts it to an angle.
            tx, ty = -math.sin(theta[n]), math.cos(theta[n])
            ft = force[n][0] * tx + force[n][1] * ty
            dtheta = max(-MAX_STEP, min(MAX_STEP, ft / max(r, 0.12))) * cool
            theta[n] = (theta[n] + dtheta) % (2 * math.pi)

    pos: dict[str, tuple[float, float]] = {}
    for n in order:
        r = target[n] * (1 + rng.uniform(-0.035, 0.035))
        pos[n] = (r * math.cos(theta[n]), r * math.sin(theta[n]))

    # ---- bands, for the client to pick "outward" edges ---------------------
    # Reported as `ring` so the payload shape is unchanged: 0 = core, 3 = rim.
    ring: dict[str, int] = {}
    for n in order:
        r = math.hypot(*pos[n])
        ring[n] = 0 if r < 0.22 else 1 if r < 0.5 else 2 if r < 0.8 else 3

    return pos, ring, hub_idx


# ------------------------------------------------------------------- main

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=os.path.expanduser("~/.sam/vault-graph.json"))
    ap.add_argument("--vault", default=VAULT)
    ap.add_argument("--pretty", action="store_true", help="indent the JSON (for the committed snapshot)")
    args = ap.parse_args()

    if not os.path.isdir(args.vault):
        print(f"vault not found: {args.vault}", file=sys.stderr)
        return 1

    notes = scan_notes(args.vault)
    if not notes:
        print(f"no notes found under {args.vault}", file=sys.stderr)
        return 1

    edges, unresolved = build_edges(args.vault, notes)

    node_ids = sorted(notes)
    adj: dict[str, set[str]] = {n: set() for n in node_ids}
    for a, b in edges:
        adj[a].add(b)
        adj[b].add(a)

    pos, ring, hub_idx = layout(node_ids, adj, sorted(edges))
    index_of = {n: i for i, n in enumerate(node_ids)}

    folders: dict[str, int] = defaultdict(int)
    for n in node_ids:
        folders[notes[n]["folder"]] += 1

    payload = {
        "generatedAt": int(time.time() * 1000),
        "vault": args.vault,
        "hub": hub_idx,
        "counts": {"notes": len(node_ids), "edges": len(edges), "unresolvedLinks": unresolved},
        "folders": dict(sorted(folders.items(), key=lambda kv: -kv[1])),
        "nodes": [
            {
                "id": n,
                "label": notes[n]["label"],
                "folder": notes[n]["folder"],
                "degree": len(adj[n]),
                "ring": ring[n],
                "x": round(pos[n][0], 4),
                "y": round(pos[n][1], 4),
                "lastModified": notes[n]["lastModified"],
            }
            for n in node_ids
        ],
        "edges": sorted([index_of[a], index_of[b]] for a, b in edges),
    }

    out = os.path.expanduser(args.out)
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    # Write-then-rename so a reader never catches a half-written file.
    tmp = out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        if args.pretty:
            json.dump(payload, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        else:
            json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, out)

    ring_hist = defaultdict(int)
    for n in node_ids:
        ring_hist[ring[n]] += 1
    size_kb = os.path.getsize(out) / 1024
    print(
        f"notes={len(node_ids)} edges={len(edges)} unresolved={unresolved} "
        f"hub={node_ids[hub_idx]!r} rings={dict(sorted(ring_hist.items()))} "
        f"{size_kb:.1f}kB -> {out}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
