import { validMarkdown } from '../model';
import { extractPdfDraft } from '../pdf-import';

export const runtime = 'nodejs';
const limit = 10 * 1024 * 1024;
const headers = { 'Cache-Control': 'private, no-store' };

export async function POST(request: Request) {
  try {
    if (!request.headers.get('content-type')?.startsWith('multipart/form-data')) {
      throw new Error('Choose a .md or .pdf file.');
    }
    // Bound the entire multipart body, including when Content-Length is absent.
    const reader = request.body?.getReader();
    if (!reader) {
      throw new Error('No file was uploaded.');
    }
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      length += value.length;
      if (length > limit + 64 * 1024) {
        await reader.cancel();
        throw new Error('Files must be 10 MiB or smaller.');
      }
      chunks.push(value);
    }
    const multipart = new Request('http://localhost', {
      method: 'POST',
      headers: { 'content-type': request.headers.get('content-type')! },
      body: Buffer.concat(chunks),
    });
    const form = await multipart.formData();
    const file = form.get('file');
    if (!(file instanceof File) || !file.name) {
      throw new Error('Choose a .md or .pdf file.');
    }
    if (file.size > limit) {
      throw new Error('Files must be 10 MiB or smaller.');
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const baseName = file.name.replace(/\.(md|pdf)$/i, '');
    let name = '';
    for (const character of baseName) {
      if (name.length + character.length > 120) {
        break;
      }
      name += character;
    }
    name ||= 'Imported resume';
    if (/\.pdf$/i.test(file.name)) {
      const draft = await extractPdfDraft(bytes);
      validMarkdown(draft.markdown);
      return Response.json(
        {
          name,
          contentMarkdown: draft.markdown,
          warnings: draft.warnings,
          kind: 'pdf',
        },
        { headers }
      );
    }
    if (!/\.md$/i.test(file.name)) {
      throw new Error('Only .md and selectable-text .pdf files are supported.');
    }
    let source: string;
    try {
      source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw new Error('Markdown must be a UTF-8 text file.');
    }
    validMarkdown(source);
    return Response.json({ name, contentMarkdown: source, warnings: [], kind: 'md' }, { headers });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Could not import this file.' },
      { status: 400, headers }
    );
  }
}
