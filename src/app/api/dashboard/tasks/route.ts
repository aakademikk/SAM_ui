import type { TaskPriority } from '@/types/dashboard';
import { envelope, failure, readJson } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';

export const dynamic = 'force-dynamic';

const PRIORITIES: TaskPriority[] = ['p0', 'p1', 'p2', 'p3'];

export async function GET() {
  const startedAt = Date.now();
  const estate = getEstate();
  return envelope(estate.getTasks(), 'sam.planner.tasks', startedAt, estate.tick);
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const body = await readJson(request);
  const title = typeof body.title === 'string' ? body.title.trim() : '';

  if (!title) return failure('A task title is required.', 400);
  if (title.length > 200) return failure('Task title exceeds 200 characters.', 413);

  const estate = getEstate();
  const data = estate.addTask({
    title,
    priority: PRIORITIES.includes(body.priority as TaskPriority)
      ? (body.priority as TaskPriority)
      : 'p2',
    tag: typeof body.tag === 'string' ? body.tag.slice(0, 32) : 'general',
    dueAt: typeof body.dueAt === 'string' ? body.dueAt : null,
  });

  return envelope(data, 'sam.planner.tasks', startedAt, estate.tick);
}

export async function PATCH(request: Request) {
  const startedAt = Date.now();
  const body = await readJson(request);
  const id = typeof body.id === 'string' ? body.id : null;

  if (!id) return failure('A task id is required.', 400);

  const estate = getEstate();
  const data = estate.updateTask(id, {
    ...(typeof body.done === 'boolean' ? { done: body.done } : {}),
    ...(typeof body.title === 'string' ? { title: body.title.slice(0, 200) } : {}),
    ...(PRIORITIES.includes(body.priority as TaskPriority)
      ? { priority: body.priority as TaskPriority }
      : {}),
    ...(typeof body.tag === 'string' ? { tag: body.tag.slice(0, 32) } : {}),
    ...('dueAt' in body ? { dueAt: typeof body.dueAt === 'string' ? body.dueAt : null } : {}),
  });

  return envelope(data, 'sam.planner.tasks', startedAt, estate.tick);
}

export async function DELETE(request: Request) {
  const startedAt = Date.now();
  const body = await readJson(request);
  const id = typeof body.id === 'string' ? body.id : null;

  if (!id) return failure('A task id is required.', 400);

  const estate = getEstate();
  return envelope(estate.deleteTask(id), 'sam.planner.tasks', startedAt, estate.tick);
}
