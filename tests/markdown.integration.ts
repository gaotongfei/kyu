import assert from 'node:assert/strict';
import { createRequire, Module } from 'node:module';
import { test } from 'node:test';
import { fileName } from '../app/resumes/markdown';
import { validMarkdown, validateInput } from '../app/resumes/model';

test('whole-document validation preserves headings, fences, whitespace and original line endings', () => {
  const source =
    '# José\r\ncontact\r\n\r\n## **Work** ##\r\n  Body  \r\n\r\n```md\r\n## Code\r\n```\r\nSchool\r\n---\r\n';
  assert.equal(
    validateInput({ name: 'Resume', themeKey: 'classic', contentMarkdown: source }).contentMarkdown,
    source
  );
  assert.equal(
    validateInput({ name: 'Resume', themeKey: 'classic', contentMarkdown: '' }).contentMarkdown,
    ''
  );
  const manyHeadings = '## Heading\ncontent\n'.repeat(150);
  assert.equal(
    validateInput({ name: 'Resume', themeKey: 'classic', contentMarkdown: manyHeadings })
      .contentMarkdown,
    manyHeadings
  );
});
test('document-size validation does not require parsing Markdown', () => {
  assert.doesNotThrow(() => validMarkdown('x'.repeat(500_000)));
  assert.throws(() => validMarkdown('x'.repeat(500_001)), /500,000/);
  assert.throws(() => validMarkdown(undefined), /Markdown must be text/);
  assert.throws(() => validMarkdown([]), /Markdown must be text/);
  assert.throws(() => validMarkdown('text\u0000text'), /null characters/);
  assert.throws(() => validMarkdown('\ud800'), /valid Unicode/);
  assert.throws(() => validMarkdown('\udc00'), /valid Unicode/);
  assert.doesNotThrow(() => validMarkdown('Résumé — 🧑‍💻'));
  const inputWithExtras = {
    name: 'Resume',
    themeKey: 'classic' as const,
    contentMarkdown: '# Source\n',
    sections: [],
    html: '<p>not source</p>',
  };
  assert.deepEqual(validateInput(inputWithExtras), {
    name: 'Resume',
    themeKey: 'classic',
    contentMarkdown: '# Source\n',
  });
});
test('Unicode filenames do not split surrogate pairs at the length boundary', () => {
  assert.doesNotThrow(() => encodeURIComponent(fileName(`${'A'.repeat(79)}𠮷`, 'pdf')));
  assert.equal(fileName(`${'A'.repeat(79)}𠮷`, 'pdf'), `${'A'.repeat(79)}𠮷.pdf`);
});

test('Markdown export returns the exact stored source and remains non-cacheable on errors', async () => {
  const require = createRequire(import.meta.url);
  const storagePath = require.resolve('../app/resumes/storage');
  const originalStorage = require.cache[storagePath];
  const storage = new Module(storagePath);
  const source = '# José\r\n\r\n## Work ##\r\n  Exact  \r\n\r\n';
  storage.exports = {
    getResume: async (id: string) => {
      if (id === 'failure') {
        throw new Error('Simulated internal storage failure');
      }
      return { id, name: 'Resume', contentMarkdown: source, version: 3 };
    },
  };
  storage.loaded = true;
  require.cache[storagePath] = storage;
  try {
    const { GET } = await import('../app/resumes/[id]/markdown/route');
    const exported = await GET(new Request('http://localhost/resumes/exact/markdown?version=3'), {
      params: Promise.resolve({ id: 'exact' }),
    });
    assert.equal(exported.status, 200);
    assert.equal(await exported.text(), source);
    assert.equal(exported.headers.get('cache-control'), 'private, no-store');
    const stale = await GET(new Request('http://localhost/resumes/exact/markdown?version=2'), {
      params: Promise.resolve({ id: 'exact' }),
    });
    assert.equal(stale.status, 409);
    const failed = await GET(new Request('http://localhost/resumes/failure/markdown?version=3'), {
      params: Promise.resolve({ id: 'failure' }),
    });
    assert.equal(failed.status, 500);
    assert.deepEqual(await failed.json(), { error: 'Markdown could not be exported.' });
    assert.equal(failed.headers.get('cache-control'), 'private, no-store');
    assert.equal(failed.headers.get('x-content-type-options'), 'nosniff');
  } finally {
    if (originalStorage) {
      require.cache[storagePath] = originalStorage;
    } else {
      delete require.cache[storagePath];
    }
  }
});
