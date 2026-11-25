import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
  sections: [
    { id: randomUUID(), titleMarkdown: '**Experience**', contentMarkdown: '- Exact source\n\n' },
    { id: randomUUID(), titleMarkdown: '', contentMarkdown: '# José\n' },
  ],
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
test('create, list, reload, rename, order, delete preserve source', async () => {
  const created = await createResume(input);
  ids.push(created.id);
  assert.equal(created.version, 1);
  assert.ok((await listResumes()).some((entry) => entry.id === created.id));
  assert.deepEqual((await getResume(created.id)).sections, input.sections);
  const saved = await saveResume(created.id, 1, {
    ...input,
    name: 'Renamed',
    sections: [...input.sections].reverse(),
  });
  assert.equal(saved.name, 'Renamed');
  assert.equal(saved.version, 2);
  assert.deepEqual((await getResume(created.id)).sections, [...input.sections].reverse());
  await assert.rejects(deleteResume(created.id, 1), { conflict: true });
  await deleteResume(created.id, 2);
  await assert.rejects(getResume(created.id), /no longer exists/);
});
test('only one concurrent writer can save a version', async () => {
  const created = await createResume(input);
  ids.push(created.id);
  const results = await Promise.allSettled([
    saveResume(created.id, 1, { ...input, name: 'First tab' }),
    saveResume(created.id, 1, { ...input, name: 'Second tab' }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.equal((await getResume(created.id)).version, 2);
});
test('invalid section inputs do not write', async () => {
  await assert.rejects(
    createResume({ ...input, sections: [input.sections[0], input.sections[0]] }),
    /unique/
  );
  await assert.rejects(
    createResume({ ...input, sections: [{ ...input.sections[0], titleMarkdown: 'bad\ntitle' }] }),
    /single-line/
  );
});
