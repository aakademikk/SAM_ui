/**
 * POST /api/uploads — receive media and documents for a chat turn.
 *
 * Returns the saved absolute paths; the client puts them on the next chat
 * message and the agent reads them with its own tools. Nothing here talks to
 * the CLI, which is the point: uploads could not regress the chat spawn
 * because they never go near it.
 *
 * Step-up (biometric) auth is required — this writes to disk, so it sits at the
 * same level as POST /api/jobs.
 *
 * Validation is a separate pass *before* any write. A five-file batch whose
 * third file is an unsupported type must leave nothing behind, or a rejected
 * upload still silently consumes disk and shows up in the next listing.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { NextResponse } from 'next/server';

import { failure } from '@/lib/server/respond';
import { requireStepUp } from '@/lib/server/auth/guard';
import { logCommand } from '@/lib/server/auth/auditLog';
import { getUploadLimiter } from '@/lib/server/auth/rateLimit';
import {
  MAX_FILES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  generatedName,
  safeLabel,
  sweepUploads,
  typeAllowed,
  uploadsRoot,
} from '@/lib/server/uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MB = 1024 * 1024;

/**
 * Local date, not UTC. The folder exists for Colin to find things in and he
 * thinks in Europe/London, so a UTC stamp would file an evening upload under
 * tomorrow.
 */
function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export async function POST(request: Request) {
  const stepUp = await requireStepUp(request);
  if (stepUp instanceof Response) return stepUp;

  if (!getUploadLimiter().consume(stepUp.sub)) {
    return failure('Too many uploads. Wait a moment and try again.', 429);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return failure('Expected a multipart form upload.', 400);
  }

  const picked = form
    .getAll('files')
    .filter((v): v is File => typeof v !== 'string' && v.size > 0);

  if (picked.length === 0) return failure('No files in the request.', 400);
  if (picked.length > MAX_FILES) {
    return failure(`Too many files at once (max ${MAX_FILES}).`, 413);
  }

  // Pass one: decide, and write nothing until every file has passed.
  const planned: { label: string; file: File }[] = [];
  let total = 0;
  for (const file of picked) {
    const label = safeLabel(file.name);

    if (file.size > MAX_FILE_BYTES) {
      return failure(`'${label}' is over ${Math.round(MAX_FILE_BYTES / MB)}MB.`, 413);
    }
    if (!typeAllowed(file.type, label)) {
      return failure(`'${label}' is not a supported type.`, 415);
    }

    total += file.size;
    planned.push({ label, file });
  }
  if (total > MAX_TOTAL_BYTES) {
    return failure(`That batch is over ${Math.round(MAX_TOTAL_BYTES / MB)}MB in total.`, 413);
  }

  const dir = path.join(uploadsRoot(), today());
  try {
    // 0700: these are Colin's files and nothing else on the box needs in.
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  } catch {
    return failure('Could not create the upload directory.', 500);
  }

  // Pass two: write.
  const saved: { path: string; name: string; size: number; type: string }[] = [];
  for (const { label, file } of planned) {
    const dest = path.join(dir, generatedName(label, file.type));
    try {
      await fs.writeFile(dest, Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
    } catch {
      return failure(`Could not save '${label}'.`, 500);
    }
    saved.push({
      path: dest,
      name: label,
      size: file.size,
      type: file.type || 'application/octet-stream',
    });
  }

  await logCommand({
    // Not a job, but this is still a disk write by the agent system, so it
    // belongs in the same trail. The id makes two uploads distinguishable.
    jobId: `upload-${Date.now()}`,
    command: `[upload] ${saved.map((f) => f.name).join(', ')} (${Math.round(total / MB)}MB)`,
    device: stepUp.device,
    credentialId: stepUp.sub.slice(0, 12),
    timestamp: new Date().toISOString(),
  });

  // Retention runs after the batch is safely down, and is not awaited: a sweep
  // that fails must never fail an upload, and the response should not wait on
  // housekeeping. sweepUploads swallows its own errors, so this cannot surface
  // as an unhandled rejection later.
  void sweepUploads();

  return NextResponse.json(
    { data: { files: saved } },
    { headers: { 'cache-control': 'no-store' } },
  );
}
