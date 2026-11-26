import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import {
  createResume,
  deleteResume,
  getResume,
  listResumes,
  saveResume,
} from '../app/resumes/storage';

if (process.env.RESUME_TEST_DATABASE !== 'isolated') {
  throw new Error('Run only against an isolated database with RESUME_TEST_DATABASE=isolated.');
}
const ids: string[] = [];
const input = {
  name: 'Integration resume',
  themeKey: 'classic' as const,
  contentMarkdown:
    '# José\r\n\r\n## **Experience**\r\n  - Exact source  \r\n\r\n```md\r\n## Not a boundary\r\n```\r\n',
};
after(async () => {
  for (const id of ids) {
    const row = await getResume(id).catch(() => null);
    if (row) {
      await deleteResume(id, row.version);
    }
  }
  const globalDb = globalThis as unknown as { postgresClient: { end: () => Promise<void> } };
  await globalDb.postgresClient.end();
});
test('create, list, reload, rename, edit and delete preserve whole Markdown exactly', async () => {
  const created = await createResume(input);
  ids.push(created.id);
  assert.equal(created.version, 1);
  assert.equal(created.contentMarkdown, input.contentMarkdown);
  assert.equal(Object.hasOwn(created, 'sections'), false);
  assert.ok((await listResumes()).some((entry) => entry.id === created.id));
  assert.equal((await getResume(created.id)).contentMarkdown, input.contentMarkdown);
  const changedSource = `${input.contentMarkdown}\n## Arbitrary new heading\n**Free editing**\n`;
  const saved = await saveResume(created.id, 1, {
    ...input,
    name: 'Renamed',
    contentMarkdown: changedSource,
  });
  assert.equal(saved.name, 'Renamed');
  assert.equal(saved.version, 2);
  assert.equal((await getResume(created.id)).contentMarkdown, changedSource);
  await assert.rejects(deleteResume(created.id, 1), { conflict: true });
  await deleteResume(created.id, 2);
  await assert.rejects(getResume(created.id), /no longer exists/);
});
test('only one concurrent writer can save a version', async () => {
  const created = await createResume(input);
  ids.push(created.id);
  const results = await Promise.allSettled([
    saveResume(created.id, 1, { ...input, contentMarkdown: '# First tab\n' }),
    saveResume(created.id, 1, { ...input, contentMarkdown: '# Second tab\n' }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  const saved = await getResume(created.id);
  assert.equal(saved.version, 2);
  assert.ok(['# First tab\n', '# Second tab\n'].includes(saved.contentMarkdown));
});
test('document limits reject invalid source before writes; empty documents are valid', async () => {
  await assert.rejects(createResume({ ...input, contentMarkdown: 'x'.repeat(500_001) }), /500,000/);
  await assert.rejects(
    createResume({ ...input, contentMarkdown: 'text\u0000text' }),
    /null characters/
  );
  const empty = await createResume({ ...input, contentMarkdown: '' });
  ids.push(empty.id);
  assert.equal((await getResume(empty.id)).contentMarkdown, '');
});
