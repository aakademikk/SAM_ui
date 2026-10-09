/**
 * SAM — questions the job closer put to Colin, read from the job store.
 *
 * Questions live in `<store>/<jobId>/closer.json` under `questions`. The web
 * side only reads them. Only the fields Colin's screen needs are returned:
 * never `acceptAction`, `source` or any path. The store is `SAM_JOB_STORE`
 * (default `~/.sam/jobs`), resolved at call time so a test can point it at a
 * fixture.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface QuestionView {
  questionId: string;
  jobId: string;
  kind: string;
  text: string;
  options: string[];
  gated: boolean;
  state: string;
  answeredAt: string | null;
  answeredVia: string | null;
  result: string | null;
}

const JOB_DIR = /^job_[A-Za-z0-9._-]+$/;
const MAX_JOBS = 200;
const MAX_FILE_BYTES = 1_000_000;
const TEXT_CAP = 600;
const RESULT_CAP = 300;
const OPTION_CAP = 40;

function storeRoot(): string {
  return process.env.SAM_JOB_STORE || path.join(os.homedir(), '.sam', 'jobs');
}

function str(value: unknown, cap: number): string | null {
  return typeof value === 'string' ? value.slice(0, cap) : null;
}

function toView(raw: unknown, dirName: string): QuestionView | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const q = raw as Record<string, unknown>;
  const questionId = str(q.id, 64);
  if (!questionId) return null;
  const options = Array.isArray(q.options)
    ? q.options
        .filter((o): o is string => typeof o === 'string')
        .slice(0, 4)
        .map((o) => o.slice(0, OPTION_CAP))
    : [];
  const jobId = typeof q.jobId === 'string' && JOB_DIR.test(q.jobId) ? q.jobId : dirName;
  return {
    questionId,
    jobId,
    kind: str(q.kind, 20) ?? 'open',
    text: str(q.text, TEXT_CAP) ?? '',
    options,
    gated: q.gated !== false,
    state: str(q.state, 20) ?? 'open',
    answeredAt: str(q.answeredAt, 40),
    answeredVia: str(q.answeredVia, 40),
    result: str(q.result, RESULT_CAP),
  };
}

/** Questions across the newest 200 job dirs (or just `jobIds`), newest job first. */
export function readQuestions(jobIds?: string[]): QuestionView[] {
  const root = storeRoot();
  let realRoot: string;
  let names: string[];
  try {
    realRoot = fs.realpathSync(root);
    names = fs.readdirSync(realRoot);
  } catch {
    return [];
  }

  const wanted = jobIds ? new Set(jobIds) : null;
  const dirs: { name: string; mtime: number }[] = [];
  for (const name of names) {
    if (!JOB_DIR.test(name)) continue;
    if (wanted && !wanted.has(name)) continue;
    try {
      dirs.push({ name, mtime: fs.statSync(path.join(realRoot, name)).mtimeMs });
    } catch {
      // vanished or unreadable
    }
  }
  dirs.sort((a, b) => b.mtime - a.mtime || (a.name < b.name ? 1 : -1));

  const out: QuestionView[] = [];
  for (const { name } of dirs.slice(0, MAX_JOBS)) {
    try {
      const dir = fs.realpathSync(path.join(realRoot, name));
      if (path.dirname(dir) !== realRoot) continue; // symlink out of the store
      const file = path.join(dir, 'closer.json');
      if (fs.statSync(file).size > MAX_FILE_BYTES) continue;
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { questions?: unknown };
      if (!Array.isArray(parsed?.questions)) continue;
      for (const raw of parsed.questions) {
        const view = toView(raw, name);
        if (view) out.push(view);
      }
    } catch {
      // missing or malformed closer.json: skipped
    }
  }
  return out;
}
