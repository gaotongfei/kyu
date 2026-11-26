import { and, desc, eq, sql } from 'drizzle-orm';
import 'server-only';
import { getDb } from '../../db';
import { resumes } from '../../db/schema';
import {
  ResumeError,
  validId,
  validVersion,
  validateInput,
  type Resume,
  type ResumeInput,
} from './model';

function document(row: typeof resumes.$inferSelect): Resume {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

export async function listResumes() {
  return getDb()
    .select({ id: resumes.id, name: resumes.name, version: resumes.version })
    .from(resumes)
    .orderBy(desc(resumes.updatedAt), resumes.id);
}

export async function getResume(id: string) {
  validId(id);
  const [row] = await getDb().select().from(resumes).where(eq(resumes.id, id));
  if (!row) {
    throw new ResumeError('This resume no longer exists.');
  }
  return document(row);
}

export async function createResume(input: ResumeInput) {
  const [row] = await getDb().insert(resumes).values(validateInput(input)).returning();
  return document(row);
}

export async function saveResume(id: string, version: number, input: ResumeInput) {
  validId(id);
  validVersion(version);
  const [row] = await getDb()
    .update(resumes)
    .set({
      ...validateInput(input),
      version: sql`${resumes.version} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(resumes.id, id), eq(resumes.version, version)))
    .returning();
  if (!row) {
    throw new ResumeError(
      'This resume changed in another tab or was deleted. Your edits are still here. Export your local Markdown before reloading.',
      true
    );
  }
  return document(row);
}

export async function deleteResume(id: string, version: number) {
  validId(id);
  validVersion(version);
  const rows = await getDb()
    .delete(resumes)
    .where(and(eq(resumes.id, id), eq(resumes.version, version)))
    .returning({ id: resumes.id });
  if (!rows.length) {
    throw new ResumeError(
      'This resume changed in another tab. It has not been deleted. Reload before trying again.',
      true
    );
  }
}
