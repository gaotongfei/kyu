import { and, eq } from 'drizzle-orm';
import 'server-only';
import { getDb } from '../db';
import { collectionJobs } from '../db/schema';
import { AiError, type PreparedJob } from './model';

export function validateJobIdentity(source: unknown, sourceJobId: unknown): void {
  for (const [value, limit] of [
    [source, 512],
    [sourceJobId, 2_048],
  ] as const) {
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.length > limit ||
      !value.isWellFormed() ||
      Array.from(value).some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
      )
    ) {
      throw new AiError('Choose a job from Discover.');
    }
  }
}

export async function getPreparationJob(source: string, sourceJobId: string): Promise<PreparedJob> {
  validateJobIdentity(source, sourceJobId);
  const [row] = await getDb()
    .select({
      payload: collectionJobs.payload,
      active: collectionJobs.active,
      lastObservedAt: collectionJobs.lastObservedAt,
    })
    .from(collectionJobs)
    .where(and(eq(collectionJobs.source, source), eq(collectionJobs.sourceJobId, sourceJobId)))
    .limit(1);
  if (!row) {
    throw new AiError('This job is no longer in the catalog. Choose another job from Discover.');
  }
  return {
    source,
    sourceJobId,
    title: row.payload.title,
    company: row.payload.company,
    descriptionText: row.payload.descriptionText,
    descriptionComplete: row.payload.descriptionComplete,
    active: row.active,
    lastObservedAt: row.lastObservedAt.toISOString(),
  };
}
