export type Section = { id: string; titleMarkdown: string; contentMarkdown: string };
export type Resume = {
  id: string;
  name: string;
  sections: Section[];
  themeKey: 'classic';
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type ResumeSummary = Pick<Resume, 'id' | 'name' | 'version'>;
export type ResumeInput = Pick<Resume, 'name' | 'sections' | 'themeKey'>;
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
    throw new ResumeError('Invalid document or section ID.');
  }
}

export function validVersion(version: unknown): asserts version is number {
  if (!Number.isSafeInteger(version) || (version as number) < 1) {
    throw new ResumeError('Invalid document version.');
  }
}

export function validateInput(input: ResumeInput): ResumeInput {
  if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120) {
    throw new ResumeError('Use a resume name between 1 and 120 characters.');
  }
  if (
    input.themeKey !== 'classic' ||
    !Array.isArray(input.sections) ||
    input.sections.length > 100
  ) {
    throw new ResumeError('Use the Classic theme and at most 100 sections.');
  }
  const ids = new Set<string>();
  let size = 0;
  for (const section of input.sections) {
    if (!section || typeof section !== 'object') throw new ResumeError('Invalid section.');
    validId(section.id);
    if (ids.has(section.id)) throw new ResumeError('Section IDs must be unique.');
    ids.add(section.id);
    if (
      typeof section.titleMarkdown !== 'string' ||
      /[\r\n]/.test(section.titleMarkdown) ||
      section.titleMarkdown.length > 500 ||
      typeof section.contentMarkdown !== 'string'
    ) {
      throw new ResumeError('Each section needs a single-line title and Markdown content.');
    }
    size += section.titleMarkdown.length + section.contentMarkdown.length;
  }
  if (size > 500_000) throw new ResumeError('A resume can contain at most 500,000 characters.');
  return {
    name: input.name.trim(),
    themeKey: 'classic',
    sections: input.sections.map(({ id, titleMarkdown, contentMarkdown }) => ({
      id,
      titleMarkdown,
      contentMarkdown,
    })),
  };
}
