import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, test } from 'node:test';
import {
  createResume,
  deleteResume,
  getResume,
  listResumes,
  saveResume,
} from '../app/resumes/storage';
import {
  connectApiKey,
  readSettings,
  removeConnection,
  selectConnection,
} from '../assistance/settings';
import { getDb } from '../db';
import { aiSettings } from '../db/schema';

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

test('encrypted AI settings serialize concurrent connections and preserve existing resume data', async () => {
  const originalKey = process.env.KYU_AI_ENCRYPTION_KEY;
  const originalFetch = globalThis.fetch;
  const installationKey = randomBytes(32).toString('base64');
  process.env.KYU_AI_ENCRYPTION_KEY = installationKey;
  let requests = 0;
  globalThis.fetch = async (resource) => {
    requests += 1;
    const url = String(resource);
    if (url === 'https://api.openai.com/v1/models') {
      return new Response(JSON.stringify({ data: [{ id: 'gpt-5.4-mini' }] }));
    }
    if (url === 'https://openrouter.ai/api/v1/models/user') {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: 'fixture/model',
              name: 'Fixture model',
              supported_parameters: ['structured_outputs', 'response_format'],
            },
          ],
        })
      );
    }
    throw new Error('Only fixture model catalogs are allowed in this database test.');
  };
  try {
    const created = await createResume({ ...input, name: 'AI preservation fixture' });
    ids.push(created.id);
    assert.equal((await readSettings()).activeProvider, null);
    await Promise.all([
      connectApiKey('openai', 'fixture-openai-secret'),
      connectApiKey('openrouter', 'fixture-openrouter-secret'),
    ]);
    const settings = await readSettings();
    assert.equal(settings.connections.openai.connected, true);
    assert.equal(settings.connections.openrouter.connected, true);
    assert.equal(
      settings.activeProvider,
      null,
      'Connecting must not silently select a billing source.'
    );
    const [stored] = await getDb().select().from(aiSettings);
    const raw = JSON.stringify(stored);
    assert.ok(stored.credentials.openai);
    assert.ok(stored.credentials.openrouter);
    assert.equal(raw.includes('fixture-openai-secret'), false);
    assert.equal(raw.includes('fixture-openrouter-secret'), false);
    assert.equal(JSON.stringify(settings).includes('fixture-openai-secret'), false);
    assert.equal(JSON.stringify(settings).includes('fixture-openrouter-secret'), false);
    await selectConnection('openai', 'gpt-5.4-mini');
    const removed = await removeConnection('openai');
    assert.equal(
      removed.activeProvider,
      null,
      'Disconnecting must not fall back to another provider.'
    );
    assert.equal(removed.connections.openrouter.connected, true);
    process.env.KYU_AI_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    await assert.rejects(readSettings(), /encryption key|unlocked|unreadable/i);
    process.env.KYU_AI_ENCRYPTION_KEY = installationKey;
    assert.equal((await readSettings()).connections.openrouter.connected, true);
    assert.deepEqual(await getResume(created.id), created);
    assert.equal(
      requests,
      2,
      'Reads, selection and removal must not perform discovery or inference.'
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) {
      delete process.env.KYU_AI_ENCRYPTION_KEY;
    } else {
      process.env.KYU_AI_ENCRYPTION_KEY = originalKey;
    }
  }
});
