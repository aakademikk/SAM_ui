/**
 * SAM — vaultGraphBuild.test: the nightly vault graph build is bounded.
 * Audit C-01: the angle solver ran every pair of notes for 220 passes (10 min
 * CPU at 2,930 notes, ~17 hours at 10x). Only the top FORCE_TOP notes by
 * degree take part in the pair-force pass now; the rest sit on their ring by
 * golden angle. Writes only inside a temp dir it removes itself.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const SCRIPT = path.resolve(process.cwd(), 'scripts/build_vault_graph.py');
const py = spawnSync('python3', ['--version'], { encoding: 'utf-8' });
const hasPython = !py.error && py.status === 0;

const NOTES = 900;

test(
  'vault graph build: one node per note, force pass capped at 400 nodes',
  { skip: hasPython ? false : 'python3 is not installed; cannot run scripts/build_vault_graph.py' },
  () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-graph-build-'));
    try {
      const vault = path.join(tmp, 'vault');
      fs.mkdirSync(vault);
      // Deterministic LCG so a failure is reproducible.
      let seed = 12345;
      const rnd = (n: number) => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed % n;
      };
      for (let i = 0; i < NOTES; i++) {
        const links = Array.from({ length: 4 }, () => `[[note-${rnd(NOTES)}]]`).join(' ');
        fs.writeFileSync(path.join(vault, `note-${i}.md`), `# note ${i}\n${links}\n`);
      }

      const out = path.join(tmp, 'g.json');
      const res = spawnSync('python3', [SCRIPT, '--vault', vault, '--out', out, '--stats'], {
        encoding: 'utf-8',
        timeout: 60_000,
      });
      assert.equal(res.status, 0, `build failed: ${res.stderr}`);

      const graph = JSON.parse(fs.readFileSync(out, 'utf-8')) as { nodes: unknown[]; counts: { notes: number } };
      assert.equal(graph.nodes.length, NOTES);
      assert.equal(graph.counts.notes, NOTES);

      const m = /force_nodes=(\d+) total=(\d+)/.exec(res.stderr);
      assert.ok(m, `no stats line in stderr: ${res.stderr}`);
      assert.ok(Number(m[1]) <= 400, `force pass had ${m[1]} nodes`);
      assert.equal(Number(m[2]), NOTES);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  },
);
