import assert from 'node:assert/strict';
import { test } from 'node:test';
import { POST } from '../app/resumes/import/route';

async function upload(name: string, contents: Uint8Array | string) {
  const form = new FormData();
  form.append(
    'file',
    new File([typeof contents === 'string' ? contents : new Uint8Array(contents)], name)
  );
  return POST(new Request('http://localhost/resumes/import', { method: 'POST', body: form }));
}
test('Next automatic development logging cannot serialize private server-action arguments', async () => {
  const { default: config } = await import('../next.config.mjs');
  assert.equal(config.logging, false);
});

test('Markdown import returns a draft, not a persisted document', async () => {
  const source =
    '# Name\r\n\r\n## Work ##\r\n**Engineer**  \r\n\r\n```md\r\n## Still source\r\n```\r\n';
  const response = await upload('Imported.md', source);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const draft = await response.json();
  assert.equal(draft.name, 'Imported');
  assert.equal(draft.kind, 'md');
  assert.equal(draft.contentMarkdown, source);
  assert.equal(Object.hasOwn(draft, 'sections'), false);
  assert.equal(draft.version, undefined);
});
test('an empty Markdown file is a valid empty draft; an empty PDF is invalid', async () => {
  const markdown = await upload('empty.md', '');
  assert.equal(markdown.status, 200);
  assert.equal((await markdown.json()).contentMarkdown, '');
  const pdf = await upload('empty.pdf', '');
  assert.equal(pdf.status, 400);
  assert.match((await pdf.json()).error, /Invalid PDF/);
});

test('UTF-8 BOM and more than 100 headings remain part of one unchanged source', async () => {
  const source = `\ufeff# Résumé\r\n\r\n${'## Heading\r\n  Body  \r\n\r\n'.repeat(150)}`;
  const response = await upload('source.md', source);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).contentMarkdown, source);
});

test('whole-source character limit is checked before returning a review draft', async () => {
  const response = await upload('large.md', 'x'.repeat(500_001));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /500,000/);
});

test('invalid UTF-8, unsupported extensions and invalid PDFs get useful errors', async () => {
  const encoding = await upload('resume.md', new Uint8Array([255, 254, 0]));
  assert.equal(encoding.status, 400);
  assert.match((await encoding.json()).error, /UTF-8/);
  const extension = await upload('resume.docx', 'not supported');
  assert.equal(extension.status, 400);
  const pdf = await upload('resume.pdf', 'not a PDF');
  assert.equal(pdf.status, 400);
  assert.match((await pdf.json()).error, /PDF/i);
});
test('oversized uploads are rejected without retaining a draft', async () => {
  const response = await upload('huge.pdf', new Uint8Array(10 * 1024 * 1024 + 1));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /10 MiB/);
});
