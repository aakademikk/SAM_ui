/**
 * SAM — question state reader and GET /api/questions.
 * Fixture job store under a temp dir (SAM_JOB_STORE); never ~/.sam/jobs.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { before, test } from 'node:test';
import { tempDir } from '@/lib/server/testing/tempDir';

const tmp = tempDir('questions-');
const home = path.join(tmp, 'home');
const store = path.join(tmp, 'jobs');
const outside = path.join(tmp, 'outside');

let questions: typeof import('./questions.js');
let route: typeof import('../../../app/api/questions/route.js');

function writeJob(name: string, body: string) {
  fs.mkdirSync(path.join(store, name), { recursive: true });
  fs.writeFileSync(path.join(store, name, 'closer.json'), body);
}

const record = {
  id: 'q_aaaa1111',
  kind: 'yesno',
  text: 'Deploy it?',
  options: ['Accept', 'Decline'],
  source: 'hidden-source-marker',
  gated: true,
  acceptAction: 'relaunch hidden-action-marker',
  state: 'open',
  createdAt: '2026-10-09T00:00:00Z',
  answeredAt: null,
  answeredVia: null,
  result: null,
};

before(async () => {
  fs.mkdirSync(home, { recursive: true });
  process.env.HOME = home;
  process.env.SAM_JOB_STORE = store;
  writeJob('job_good_1', JSON.stringify({ questions: [{ ...record, text: 'x'.repeat(5000), result: 'y'.repeat(500) }] }));
  writeJob('job_nojobid_2', JSON.stringify({ questions: [{ ...record, id: 'q_bbbb2222' }, 'junk', { nope: 1 }] }));
  writeJob('job_bad_3', '{not json');
  writeJob('not_a_job', JSON.stringify({ questions: [{ ...record, id: 'q_cccc3333' }] }));
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'closer.json'), JSON.stringify({ questions: [{ ...record, id: 'q_outside' }] }));
  fs.symlinkSync(outside, path.join(store, 'job_link_4'));
  questions = await import('./questions.js');
  route = await import('../../../app/api/questions/route.js');
});

test('reader returns only the safe fields, capped, mapping id to questionId', () => {
  const all = questions.readQuestions();
  const good = all.find((q) => q.questionId === 'q_aaaa1111');
  assert.ok(good);
  assert.equal(good.jobId, 'job_good_1');
  assert.equal(good.text.length, 4000); // a decision question runs to a few hundred characters: read whole
  assert.equal(good.result?.length, 300);
  assert.deepEqual(Object.keys(good).sort(), [
    'answeredAt', 'answeredVia', 'gated', 'jobId', 'kind', 'options', 'questionId', 'result', 'state', 'text',
  ]);
  const json = JSON.stringify(all);
  assert.equal(json.includes('acceptAction'), false);
  assert.equal(json.includes('hidden-'), false);
  assert.equal(json.includes(tmp), false);
});

test('a question with six choices keeps all six options, and a seventh is dropped', () => {
  writeJob('job_choices_5', JSON.stringify({ questions: [{ ...record, id: 'q_dddd4444', kind: 'choice',
    options: ['a) one', 'b) two', 'c) three', 'd) four', 'e) five', 'f) six', 'g) seven'] }] }));
  try {
    const q = questions.readQuestions(['job_choices_5']).find((x) => x.questionId === 'q_dddd4444');
    assert.deepEqual(q?.options, ['a) one', 'b) two', 'c) three', 'd) four', 'e) five', 'f) six']);
  } finally {
    fs.rmSync(path.join(store, 'job_choices_5'), { recursive: true, force: true }); // the other tests count the store
  }
});

test('a question with no jobId on disk gets the directory name', () => {
  const q = questions.readQuestions().find((x) => x.questionId === 'q_bbbb2222');
  assert.equal(q?.jobId, 'job_nojobid_2');
});

test('malformed closer.json, non-job dir and symlink outside the store are skipped', () => {
  const ids = questions.readQuestions().map((q) => q.questionId).sort();
  assert.deepEqual(ids, ['q_aaaa1111', 'q_bbbb2222']);
});

test('jobIds filter narrows the scan', () => {
  assert.deepEqual(questions.readQuestions(['job_good_1']).map((q) => q.questionId), ['q_aaaa1111']);
});

test('a missing store gives an empty list', () => {
  const saved = process.env.SAM_JOB_STORE;
  process.env.SAM_JOB_STORE = path.join(tmp, 'nope');
  assert.deepEqual(questions.readQuestions(), []);
  process.env.SAM_JOB_STORE = saved;
});

test('GET /api/questions is 401 with no cookie', async () => {
  const res = await route.GET(new Request('http://localhost/api/questions'));
  assert.equal(res.status, 401);
});
