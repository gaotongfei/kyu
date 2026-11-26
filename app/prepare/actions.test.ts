/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('../../assistance/jobs', () => ({ getPreparationJob: jest.fn() }));
jest.mock('../../assistance/providers', () => ({ generateDraftPair: jest.fn() }));
jest.mock('../../assistance/settings', () => ({ resolveGenerationConnection: jest.fn() }));
jest.mock('../../assistance/origin', () => ({ requestOrigin: jest.fn() }));
jest.mock('../resumes/storage', () => ({ getResume: jest.fn() }));

import { getPreparationJob } from '../../assistance/jobs';
import { AiError } from '../../assistance/model';
import { requestOrigin } from '../../assistance/origin';
import { generateDraftPair } from '../../assistance/providers';
import { resolveGenerationConnection } from '../../assistance/settings';
import { getResume } from '../resumes/storage';
import { generateApplicationDrafts } from './actions';

const id = '11111111-1111-4111-8111-111111111111';
const request = {
  source: 'ashby:fixture',
  sourceJobId: 'fixture-1',
  resumeId: id,
  resumeVersion: 2,
  connection: { provider: 'openai' as const, model: 'gpt-5.4-mini' },
};
const drafts = {
  resumeMarkdown: '# Tailored candidate\n',
  coverLetterMarkdown: 'Dear fixture team,\n',
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getPreparationJob).mockResolvedValue({
    source: request.source,
    sourceJobId: request.sourceJobId,
    title: 'Fixture Engineer',
    company: 'Fixture company',
    descriptionText: 'Use TypeScript.',
    descriptionComplete: true,
    active: true,
    lastObservedAt: '2026-11-26T12:00:00Z',
  });
  jest.mocked(getResume).mockResolvedValue({
    id,
    name: 'Original',
    contentMarkdown: '# Candidate\r\nTypeScript experience.',
    themeKey: 'classic',
    version: 2,
    createdAt: '2026-11-26T12:00:00Z',
    updatedAt: '2026-11-26T12:00:00Z',
  });
  jest
    .mocked(resolveGenerationConnection)
    .mockResolvedValue({ ...request.connection, token: 'never-return-this-secret' });
  jest.mocked(generateDraftPair).mockResolvedValue(drafts);
  jest.mocked(requestOrigin).mockResolvedValue('http://localhost:3000');
});

test('one explicit generation uses persisted source and returns drafts without tokens or writes', async () => {
  const result = await generateApplicationDrafts(request);
  expect(result).toMatchObject({
    ok: true,
    value: {
      drafts,
      sourceResumeId: id,
      sourceResumeVersion: 2,
      provider: 'openai',
      model: 'gpt-5.4-mini',
    },
  });
  expect(resolveGenerationConnection).toHaveBeenCalledWith(request.connection);
  expect(generateDraftPair).toHaveBeenCalledTimes(1);
  expect(generateDraftPair).toHaveBeenCalledWith(
    expect.objectContaining({ token: 'never-return-this-secret' }),
    {
      resumeMarkdown: '# Candidate\r\nTypeScript experience.',
      job: {
        title: 'Fixture Engineer',
        company: 'Fixture company',
        descriptionText: 'Use TypeScript.',
      },
    }
  );
  expect(JSON.stringify(result)).not.toContain('never-return-this-secret');
});

test('stale source version fails before any provider or refresh request', async () => {
  const result = await generateApplicationDrafts({ ...request, resumeVersion: 1 });
  expect(result).toMatchObject({
    ok: false,
    error: expect.stringContaining('changed in another tab'),
  });
  expect(resolveGenerationConnection).not.toHaveBeenCalled();
  expect(generateDraftPair).not.toHaveBeenCalled();
});

test('missing description and oversized resumes fail before resolving credentials', async () => {
  jest.mocked(getPreparationJob).mockResolvedValueOnce({
    source: request.source,
    sourceJobId: request.sourceJobId,
    title: 'Fixture',
    company: 'Fixture',
    descriptionText: null,
    descriptionComplete: false,
    active: true,
    lastObservedAt: '2026-11-26T12:00:00Z',
  });
  expect(await generateApplicationDrafts(request)).toMatchObject({
    ok: false,
    error: expect.stringContaining('Job description'),
  });
  jest.mocked(getResume).mockResolvedValueOnce({
    id,
    name: 'Original',
    contentMarkdown: 'x'.repeat(20_001),
    themeKey: 'classic',
    version: 2,
    createdAt: '',
    updatedAt: '',
  });
  expect(await generateApplicationDrafts(request)).toMatchObject({
    ok: false,
    error: expect.stringContaining('20,000'),
  });
  expect(resolveGenerationConnection).not.toHaveBeenCalled();
  expect(generateDraftPair).not.toHaveBeenCalled();
});

test('remote requests cannot reuse a saved local ChatGPT connection', async () => {
  jest.mocked(requestOrigin).mockResolvedValue('https://private-server.example');
  expect(
    await generateApplicationDrafts({
      ...request,
      connection: { provider: 'chatgpt', model: 'fixture-model' },
    })
  ).toMatchObject({ ok: false, error: expect.stringContaining('same-computer') });
  expect(resolveGenerationConnection).not.toHaveBeenCalled();
  expect(generateDraftPair).not.toHaveBeenCalled();
});

test('changed selection errors never fall back to another provider', async () => {
  jest
    .mocked(resolveGenerationConnection)
    .mockRejectedValue(new AiError('AI selection changed. Reload before generating.'));
  expect(await generateApplicationDrafts(request)).toMatchObject({
    ok: false,
    error: expect.stringContaining('selection changed'),
  });
  expect(generateDraftPair).not.toHaveBeenCalled();
});

test('unexpected storage failures do not expose SQL, source, or credentials', async () => {
  jest
    .mocked(getResume)
    .mockRejectedValue(new Error('SQL password=never-expose private resume text'));
  const result = await generateApplicationDrafts(request);
  expect(result.ok).toBe(false);
  expect(JSON.stringify(result)).not.toMatch(/never-expose|private resume text|SQL/);
  expect(generateDraftPair).not.toHaveBeenCalled();
});
