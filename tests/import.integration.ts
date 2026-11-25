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
test('Markdown import returns a draft, not a persisted document', async () => {
  const response = await upload('Imported.md', '# Name\n\n## Work\n**Engineer**\n');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const draft = await response.json();
  assert.equal(draft.name, 'Imported');
  assert.equal(draft.kind, 'md');
  assert.equal(draft.sections.length, 2);
  assert.equal(draft.sections[1].contentMarkdown, '**Engineer**\n');
  assert.equal(draft.version, undefined);
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
