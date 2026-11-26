import { aiSettingsHref, preparationHref } from './links';
import {
  AiError,
  isLocalOrigin,
  isProvider,
  parseDraftPair,
  validModel,
  validateDraftInput,
} from './model';

const input = {
  resumeMarkdown: '# Candidate\r\nExisting experience.\n',
  job: { title: 'Engineer', company: 'Fixture', descriptionText: 'Build accessible interfaces.' },
};

test('requires factual nonempty bounded Unicode inputs without reconstructing source', () => {
  expect(() => validateDraftInput(input)).not.toThrow();
  expect(input.resumeMarkdown).toContain('\r\n');
  for (const resumeMarkdown of ['', '  ', 'x'.repeat(20_001), '\u0000', '\ud800']) {
    expect(() => validateDraftInput({ ...input, resumeMarkdown })).toThrow(AiError);
  }
  expect(() =>
    validateDraftInput({ ...input, job: { ...input.job, descriptionText: '' } })
  ).toThrow('Job description');
  expect(() =>
    validateDraftInput({ ...input, job: { ...input.job, title: 'x'.repeat(1_001) } })
  ).toThrow('Job title');
});

test('accepts only a complete pair of bounded plain Markdown strings', () => {
  const drafts = { resumeMarkdown: '# Candidate\n', coverLetterMarkdown: 'Dear team,\n' };
  expect(parseDraftPair(drafts)).toEqual(drafts);
  for (const value of [
    null,
    [],
    '',
    {},
    { ...drafts, tool: 'run' },
    { resumeMarkdown: 'Resume' },
    { ...drafts, coverLetterMarkdown: '' },
    { ...drafts, resumeMarkdown: 'x'.repeat(20_001) },
    { ...drafts, coverLetterMarkdown: 'x'.repeat(12_001) },
  ]) {
    expect(() => parseDraftPair(value)).toThrow(AiError);
  }
});

test('allows provider model slugs but no arbitrary provider or unsafe model values', () => {
  expect(isProvider('openrouter')).toBe(true);
  expect(isProvider('https://attacker.test')).toBe(false);
  for (const value of ['gpt-5.4-mini', 'openai/gpt-5.4-mini', 'author/model:free']) {
    expect(() => validModel(value)).not.toThrow();
  }
  for (const value of ['', 'model\nkey', 'model name', 'x'.repeat(201), null]) {
    expect(() => validModel(value)).toThrow(AiError);
  }
});

test.each(['http://127.0.0.1:3000', 'http://localhost:3017', 'http://[::1]:3000'])(
  'recognizes supported local origin %s',
  (origin) => {
    expect(isLocalOrigin(origin)).toBe(true);
  }
);

test.each([
  'https://kyu.example',
  'http://192.168.1.2:3000',
  'http://localhost.attacker.test',
  'https://127.0.0.1:3000',
  'http://user@localhost:3000',
  'http://localhost/path',
  'http://localhost?x=1',
  'garbage',
])('does not claim ChatGPT-plan support for %s', (origin) => {
  expect(isLocalOrigin(origin)).toBe(false);
});

test('links preserve composite provenance and encode job identifiers as query values', () => {
  const url = new URL(preparationHref('ashby:fixture', 'a/b?c&d'), 'http://localhost');
  expect(url.pathname).toBe('/prepare');
  expect(url.searchParams.get('source')).toBe('ashby:fixture');
  expect(url.searchParams.get('job')).toBe('a/b?c&d');
  expect(aiSettingsHref()).toBe('/settings/ai');
  expect(aiSettingsHref('fixture', 'id')).toContain('source=fixture&job=id');
});
