export type Resume = {
  id: string;
  name: string;
  contentMarkdown: string;
  themeKey: 'classic';
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type ResumeSummary = Pick<Resume, 'id' | 'name' | 'version'>;
export type ResumeInput = Pick<Resume, 'name' | 'contentMarkdown' | 'themeKey'>;
export type Result<T> = { ok: true; value: T } | { ok: false; error: string; conflict?: boolean };

export class ResumeError extends Error {
  constructor(
    message: string,
    public conflict = false
  ) {
    super(message);
  }
}

export function validId(id: unknown): asserts id is string {
  if (
    typeof id !== 'string' ||
    !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)
  ) {
    throw new ResumeError('Invalid document ID.');
  }
}

export function validVersion(version: unknown): asserts version is number {
  if (!Number.isSafeInteger(version) || (version as number) < 1) {
    throw new ResumeError('Invalid document version.');
  }
}

export function validMarkdown(source: unknown): asserts source is string {
  if (typeof source !== 'string' || source.length > 500_000) {
    throw new ResumeError('Markdown must be text containing at most 500,000 characters.');
  }
  if (!source.isWellFormed()) {
    throw new ResumeError('Markdown must contain valid Unicode text.');
  }
  if (source.includes('\u0000')) {
    throw new ResumeError('Markdown cannot contain null characters.');
  }
}

export function validateInput(input: ResumeInput): ResumeInput {
  if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120) {
    throw new ResumeError('Use a resume name between 1 and 120 characters.');
  }
  if (input.themeKey !== 'classic') {
    throw new ResumeError('Use the Classic theme.');
  }
  validMarkdown(input.contentMarkdown);
  return { name: input.name.trim(), contentMarkdown: input.contentMarkdown, themeKey: 'classic' };
}
