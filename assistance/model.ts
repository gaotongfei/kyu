export const aiProviders = ['openai', 'openrouter', 'chatgpt'] as const;
export type AiProvider = (typeof aiProviders)[number];
export type ApiKeyProvider = Exclude<AiProvider, 'chatgpt'>;
export type AiModel = { id: string; name: string };
type AiConnection = {
  connected: boolean;
  model: string | null;
  models: AiModel[];
  accountLabel?: string;
};
export type AiSettings = {
  encryptionConfigured: boolean;
  activeProvider: AiProvider | null;
  connections: Record<AiProvider, AiConnection>;
  signIn: { pending: boolean; error: string | null };
};
export type SelectedConnection = { provider: AiProvider; model: string };
export type ResolvedConnection = SelectedConnection & { token: string };
export type DraftInput = {
  resumeMarkdown: string;
  job: { title: string; company: string; descriptionText: string };
};
export type DraftPair = { resumeMarkdown: string; coverLetterMarkdown: string };
export type PreparedJob = {
  source: string;
  sourceJobId: string;
  title: string;
  company: string;
  descriptionText: string | null;
  descriptionComplete: boolean;
  active: boolean;
  lastObservedAt: string;
};
export type DraftResult = {
  drafts: DraftPair;
  resumeName: string;
  sourceResumeId: string;
  sourceResumeVersion: number;
  provider: AiProvider;
  model: string;
};
export type AiResult<T> = { ok: true; value: T } | { ok: false; error: string };

export const providerNames: Record<AiProvider, string> = {
  openai: 'OpenAI API',
  openrouter: 'OpenRouter',
  chatgpt: 'ChatGPT subscription',
};

export class AiError extends Error {}

export function isProvider(value: unknown): value is AiProvider {
  return value === 'openai' || value === 'openrouter' || value === 'chatgpt';
}

export function validModel(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,199}$/.test(value)) {
    throw new AiError('Choose a valid model from this connection.');
  }
}

function validText(value: unknown, label: string, limit: number): asserts value is string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > limit ||
    !value.isWellFormed() ||
    value.includes('\u0000')
  ) {
    throw new AiError(
      `${label} must contain valid text between 1 and ${limit.toLocaleString('en')} characters.`
    );
  }
}

export function validateDraftInput(input: DraftInput): void {
  if (!input || !input.job) {
    throw new AiError('Choose a saved resume and a collected job.');
  }
  validText(input.resumeMarkdown, 'Resume', 20_000);
  validText(input.job.descriptionText, 'Job description', 20_000);
  validText(input.job.title, 'Job title', 1_000);
  validText(input.job.company, 'Employer', 1_000);
}

export function parseDraftPair(value: unknown): DraftPair {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AiError('The provider returned an invalid draft. No resume was changed.');
  }
  const object = value as Record<string, unknown>;
  if (
    Object.keys(object).length !== 2 ||
    !Object.hasOwn(object, 'resumeMarkdown') ||
    !Object.hasOwn(object, 'coverLetterMarkdown')
  ) {
    throw new AiError('The provider returned an incomplete draft. No resume was changed.');
  }
  validText(object.resumeMarkdown, 'Generated resume', 20_000);
  validText(object.coverLetterMarkdown, 'Generated cover letter', 12_000);
  return { resumeMarkdown: object.resumeMarkdown, coverLetterMarkdown: object.coverLetterMarkdown };
}

export function isLocalOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      url.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}
