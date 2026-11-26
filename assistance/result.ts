import 'server-only';
import { ResumeError } from '../app/resumes/model';
import { AiError, type AiResult } from './model';

export async function aiAttempt<T>(operation: () => Promise<T>): Promise<AiResult<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof AiError || error instanceof ResumeError
          ? error.message
          : 'The request could not be completed. Check storage and AI settings, then retry. Existing resumes have not been changed.',
    };
  }
}
