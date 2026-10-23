import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class FollowupTaskError extends Error {
  status: number;
  constructor(message: string, status = 409) { super(message); this.status = status; }
}

type Entry = { version: 1; fingerprint: string; taskId?: string; startedAt: string };

// Persist intent before the non-idempotent POST. An uncertain response must never
// result in an automatic second create, including after a process restart.
export async function createJournaledTask<T extends { id: string }>(input: {
  key: string;
  lockKey?: string;
  payload: unknown;
  directory?: string;
  check: () => Promise<void>;
  create: () => Promise<T>;
  verify: (id: string) => Promise<T>;
}) {
  const directory = input.directory || '/app/data/rm-followup-tasks';
  await mkdir(directory, { recursive: true });
  const key = createHash('sha256').update(input.key).digest('hex');
  const fingerprint = createHash('sha256').update(JSON.stringify(input.payload)).digest('hex');
  const lockKey = createHash('sha256').update(input.lockKey || input.key).digest('hex');
  const file = path.join(directory, `${key}.json`), lock = path.join(directory, `${lockKey}.lock`);
  try { await mkdir(lock); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new FollowupTaskError('Task creation is busy or interrupted. Review HubSpot before retrying.', 409);
    throw error;
  }
  async function save(entry: Entry) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(entry), { mode: 0o600 });
    await rename(temporary, file);
  }
  try {
    let entry: Entry | undefined;
    try {
      entry = JSON.parse(await readFile(file, 'utf8')) as Entry;
      if (entry.version !== 1 || typeof entry.fingerprint !== 'string' || typeof entry.startedAt !== 'string' || (entry.taskId !== undefined && !/^\d+$/.test(entry.taskId))) throw new Error('Invalid task journal');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (entry) {
      if (!entry.taskId) throw new FollowupTaskError('A previous task create could not be confirmed. Review the meeting in HubSpot; another task was not created.');
      if (entry.fingerprint !== fingerprint) throw new FollowupTaskError(`This meeting already has dashboard task ${entry.taskId}. Update that task in HubSpot.`);
      return { task: await input.verify(entry.taskId), reused: true };
    }
    await input.check();
    entry = { version: 1, fingerprint, startedAt: new Date().toISOString() };
    await save(entry);
    const task = await input.create();
    if (!/^\d+$/.test(task.id)) throw new FollowupTaskError('HubSpot did not return a task ID. Review the meeting before retrying.', 502);
    entry.taskId = task.id;
    await save(entry);
    return { task: await input.verify(task.id), reused: false };
  } finally {
    await rmdir(lock);
  }
}
