'use server';

import { ResumeError, type Result, type ResumeInput } from './model';
import * as storage from './storage';

async function attempt<T>(operation: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof ResumeError
          ? error.message
          : 'PostgreSQL is unavailable. Your edits have not been discarded. Check the connection and retry.',
      conflict: error instanceof ResumeError && error.conflict,
    };
  }
}

export async function loadLibrary() {
  return attempt(storage.listResumes);
}
export async function loadDocument(id: string) {
  return attempt(() => storage.getResume(id));
}
export async function createDocument(input: ResumeInput) {
  return attempt(() => storage.createResume(input));
}
export async function saveDocument(id: string, version: number, input: ResumeInput) {
  return attempt(() => storage.saveResume(id, version, input));
}
export async function deleteDocument(id: string, version: number) {
  return attempt(() => storage.deleteResume(id, version));
}
