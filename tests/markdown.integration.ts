import assert from 'node:assert/strict';
import { createRequire, Module } from 'node:module';
import { test } from 'node:test';
import { exportMarkdown, fileName, importMarkdown } from '../app/resumes/markdown';

test('headings split sections, keeping intro and exact body whitespace', () => {
  const source = '# José\r\ncontact\r\n\r\n## **Work**\r\n  Body  \r\n\r\n## School\r\nText\r\n';
  const sections = importMarkdown(source);
  assert.equal(sections.length, 3);
  assert.equal(sections[0].titleMarkdown, '');
  assert.equal(sections[0].contentMarkdown, '# José\r\ncontact\r\n\r\n');
  assert.equal(sections[1].titleMarkdown, '**Work**');
  assert.equal(sections[1].contentMarkdown, '  Body  \r\n\r\n');
  assert.equal(sections[2].contentMarkdown, 'Text\r\n');
  assert.match(exportMarkdown(sections), /  Body  \r\n\r\n/);
});
test('fenced code, nested headings and indented code do not split sections', () => {
  const source =
    '```md\n## Not a section\n```\n\n~~~~\n## Also code\n~~~~\n\n> ## Quoted\n\n    ## Indented\n';
  assert.equal(importMarkdown(source).length, 1);
  assert.equal(exportMarkdown(importMarkdown(source)), source);
});
test('setext headings are level two; unsupported source survives', () => {
  const source =
    'Experience\n----------\n![photo](https://invalid.example/a)\n\n<table>raw</table>\n';
  const sections = importMarkdown(source);
  assert.equal(sections[0].titleMarkdown, 'Experience');
  assert.equal(
    sections[0].contentMarkdown,
    '![photo](https://invalid.example/a)\n\n<table>raw</table>\n'
  );
});
test('Unicode filenames do not split surrogate pairs at the length boundary', () => {
  assert.doesNotThrow(() => encodeURIComponent(fileName(`${'A'.repeat(79)}𠮷`, 'pdf')));
  assert.equal(fileName(`${'A'.repeat(79)}𠮷`, 'pdf'), `${'A'.repeat(79)}𠮷.pdf`);
});
test('plain and empty Markdown remain one editable block', () => {
  assert.equal(exportMarkdown(importMarkdown('plain\n\ntext')), 'plain\n\ntext');
  assert.equal(importMarkdown('').length, 1);
  assert.equal(importMarkdown('##\n##\n').length, 2);
  const references = '[link]: https://example.com\n\nIntro\n\n## Work\n[Visit][link]\n';
  assert.equal(importMarkdown(references)[1].contentMarkdown, '[Visit][link]\n');
  assert.throws(() => importMarkdown('x'.repeat(500001)), /500,000/);
});

test('Markdown export failures use a generic message and remain non-cacheable', async () => {
  // Stub storage before importing the handler: this test must never connect to a database.
  const require = createRequire(import.meta.url);
  const storagePath = require.resolve('../app/resumes/storage');
  const originalStorage = require.cache[storagePath];
  const storage = new Module(storagePath);
  storage.exports = {
    getResume: async () => {
      // Synthetic failure: verify the handler never exposes internal storage error details.
      throw new Error('Simulated storage failure');
    },
  };
  storage.loaded = true;
  require.cache[storagePath] = storage;
  try {
    const { GET } = await import('../app/resumes/[id]/markdown/route');
    const response = await GET(new Request('http://localhost/resumes/test/markdown?version=1'), {
      params: Promise.resolve({ id: 'test' }),
    });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Markdown could not be exported.' });
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  } finally {
    if (originalStorage) {
      require.cache[storagePath] = originalStorage;
    } else {
      delete require.cache[storagePath];
    }
  }
});
