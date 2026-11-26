import React from 'react';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Document, Page, renderToBuffer, Text } from '@react-pdf/renderer';
import { extractText, extractTextItems, getDocumentProxy } from 'unpdf';
import type { Resume } from '../app/resumes/model';
import { renderResumePdf } from '../app/resumes/pdf';
import { extractPdfDraft, MAX_PDF_BYTES, MAX_PDF_PAGES } from '../app/resumes/pdf-import';
import { parseResumeMarkdown } from '../app/resumes/resume-markdown';

const h = React.createElement;
const resume = (...source: string[]): Pick<Resume, 'name' | 'contentMarkdown'> => ({
  name: 'Generated integration fixture',
  contentMarkdown: source.join('\n\n'),
});

// All fixtures are generated in memory; no personal documents, network, or saved uploads.
async function fixture(
  pages: string[],
  encryption: Pick<React.ComponentProps<typeof Document>, 'ownerPassword' | 'userPassword'> = {}
) {
  return renderToBuffer(
    h(
      Document,
      encryption,
      ...pages.map((value, index) =>
        h(Page, { key: index, size: 'LETTER' }, value ? h(Text, null, value) : null)
      )
    )
  );
}

async function parsed(buffer: Uint8Array) {
  return getDocumentProxy(new Uint8Array(buffer), { verbosity: 0 });
}

async function textOf(buffer: Uint8Array) {
  const pdf = await parsed(buffer);
  try {
    return (await extractText(pdf, { mergePages: true })).text;
  } finally {
    await pdf.loadingTask.destroy();
  }
}

test('PDF text round-trips through the reviewed Markdown draft literally, without URL/entity reinterpretation', async () => {
  for (const original of [
    'https://example.com/path',
    'Use &amp; and &#38; literally.',
    'john@example.com www.example.com',
    'mailto:john@example.com',
  ]) {
    const draft = await extractPdfDraft(new Uint8Array(await fixture([original])));
    const { buffer } = await renderResumePdf(resume(draft.markdown));
    const result = await textOf(buffer);
    assert.equal(result, original);
    const pdf = await parsed(buffer);
    try {
      assert.equal((await (await pdf.getPage(1)).getAnnotations()).length, 0);
    } finally {
      await pdf.loadingTask.destroy();
    }
  }
});

test('prototype-name references remain literal unless explicitly defined', async () => {
  const literal = await renderResumePdf(
    resume('# [constructor]', '[constructor] [__proto__] [toString]')
  );
  assert.match(await textOf(literal.buffer), /\[constructor\] \[proto\] \[toString\]/);
  const literalPdf = await parsed(literal.buffer);
  try {
    assert.equal((await (await literalPdf.getPage(1)).getAnnotations()).length, 0);
  } finally {
    await literalPdf.loadingTask.destroy();
  }
  const defined = await renderResumePdf(
    resume(
      '# [constructor]',
      '[constructor] [__proto__]',
      '[constructor]: https://example.com/constructor\n[__proto__]: https://example.com/proto\n'
    )
  );
  const pdf = await parsed(defined.buffer);
  try {
    const annotations = await (await pdf.getPage(1)).getAnnotations();
    assert.ok(
      annotations.some((annotation) => annotation.url === 'https://example.com/constructor')
    );
    assert.ok(annotations.some((annotation) => annotation.url === 'https://example.com/proto'));
  } finally {
    await pdf.loadingTask.destroy();
  }
});

test('reference links resolve forward throughout whole-source Markdown', async () => {
  const { buffer } = await renderResumePdf(
    resume(
      '# [Work][portfolio]',
      '[Visit][portfolio]',
      '[portfolio]: https://example.com/portfolio\n'
    )
  );
  const pdf = await parsed(buffer);
  try {
    const annotations = await (await pdf.getPage(1)).getAnnotations();
    assert.ok(annotations.some((annotation) => annotation.url === 'https://example.com/portfolio'));
  } finally {
    await pdf.loadingTask.destroy();
  }
});

test('PDF link annotations share entity/escape decoding and reject control-obfuscated destinations', async () => {
  const document = resume(
    String.raw`[Query](https://example.com/a\(b\)?a=1&amp;b=2)`,
    '[Decode once](https://example.com/?literal=&amp;amp;)',
    '[Control](https://example.com/&#x0a;path)',
    '[Encoded](jav&#x61;script:alert%281%29)'
  );
  const { buffer, warnings } = await renderResumePdf(document);
  assert.deepEqual(warnings, parseResumeMarkdown(document.contentMarkdown).warnings);
  assert.equal(warnings.length, 1);
  const text = await textOf(buffer);
  assert.ok(text.includes('[Control](https://example.com/&#x0a;path)'));
  assert.ok(text.includes('[Encoded](jav&#x61;script:alert%281%29)'));
  const pdf = await parsed(buffer);
  try {
    const annotations = await (await pdf.getPage(1)).getAnnotations();
    assert.deepEqual(
      annotations.map((annotation) => annotation.url),
      ['https://example.com/a(b)?a=1&b=2', 'https://example.com/?literal=&amp;']
    );
  } finally {
    await pdf.loadingTask.destroy();
  }
});

test('PDF adapter preserves shared AST warnings, first reference definitions, and literal task source', async () => {
  const document = resume(
    [
      '# [constructor]',
      '',
      '1. First supported item',
      '2. [x] **task source** [not a link](https://example.invalid/task)',
      '3. Third supported item',
      '',
      '[Portfolio][constructor] and [relative](//example.invalid/path)',
      '',
      '[constructor]: https://example.com/first',
      '[constructor]: https://example.com/second',
    ].join('\n'),
    '[constructor]: https://example.com/later\n\nFinal body'
  );
  const { buffer, warnings } = await renderResumePdf(document);
  assert.deepEqual(warnings, parseResumeMarkdown(document.contentMarkdown).warnings);
  assert.deepEqual(warnings, [
    'Task lists: unsupported in Classic; its source is displayed as text.',
    'An unsafe or unsupported link destination was disabled; its Markdown source is displayed as text.',
  ]);
  const text = await textOf(buffer);
  for (const phrase of [
    '1. First supported item',
    '2. [x] **task source** [not a link](https://example.invalid/task)',
    '3. Third supported item',
    '[relative](//example.invalid/path)',
    'Final body',
  ]) {
    assert.ok(text.includes(phrase), `Shared AST source missing from PDF: ${phrase}\n${text}`);
  }
  const pdf = await parsed(buffer);
  try {
    const annotations = await (await pdf.getPage(1)).getAnnotations();
    assert.deepEqual(
      [...new Set(annotations.map((annotation) => annotation.url))],
      ['https://example.com/first']
    );
  } finally {
    await pdf.loadingTask.destroy();
  }
});

test('Classic renders selectable common Markdown, accented text, and four embedded licensed font faces', async () => {
  const { buffer, warnings } = await renderResumePdf(
    resume(
      [
        '# José Noël — résumé',
        '',
        'Plain text, **bold face**, *italic face*, and ***bold italic face***. A &amp; B.',
        '',
        'A soft',
        'line break stays in its paragraph.',
        '',
        '## Heading two',
        '### Heading three',
        '#### Heading four',
        '##### Heading five',
        '###### Heading six',
        '',
        '- First bullet',
        '- Second bullet',
        '  - Nested bullet',
        '',
        '3. Third ordered item',
        '4. Fourth ordered item',
        '',
        '> A useful quotation.',
        '',
        'First hard line  ',
        'Second hard line with `const code = 1`.',
        '',
        '```ts',
        'function example() {',
        '  return "literal <tag> & value";',
        '}',
        '```',
        '',
        '---',
        '',
        '[Portfolio](https://example.com/work) and [Email](mailto:fixture@example.com).',
        '',
        '[Reference][ref]',
        '',
        '[ref]: https://example.com/reference',
      ].join('\n'),
      '## **Experience** and *Education*',
      'Unique final paragraph.'
    )
  );
  assert.deepEqual(warnings, []);
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
  const pdf = await parsed(buffer);
  try {
    const { text } = await extractText(pdf, { mergePages: true });
    for (const phrase of [
      'José Noël — résumé',
      'Plain text, bold face, italic face, and bold italic face. A & B.',
      'Heading two',
      'Heading three',
      'Heading four',
      'Heading five',
      'Heading six',
      '• First bullet',
      '• Second bullet',
      '• Nested bullet',
      '3. Third ordered item',
      '4. Fourth ordered item',
      'A useful quotation.',
      'A soft line break stays in its paragraph.',
      'First hard line\nSecond hard line',
      'const code = 1',
      'function example()',
      'literal <tag> & value',
      'Experience and Education',
      'Unique final paragraph.',
    ]) {
      assert.ok(text.includes(phrase), `Missing extracted text: ${phrase}\n${text}`);
    }
    assert.equal(
      text.match(/José Noël/g)?.length,
      1,
      'whole-source traversal must not duplicate earlier content'
    );
    const links = (await (await pdf.getPage(1)).getAnnotations()).map(
      (annotation) => annotation.url
    );
    for (const url of [
      'https://example.com/work',
      'mailto:fixture@example.com',
      'https://example.com/reference',
    ]) {
      assert.ok(links.includes(url), `Missing PDF link annotation: ${url}`);
    }
    assert.deepEqual((await pdf.getPage(1)).view, [0, 0, 612, 792]);
  } finally {
    await pdf.loadingTask.destroy();
  }
  const encoded = buffer.toString('latin1');
  for (const font of ['Lato-Regular', 'Lato-Bold', 'Lato-Italic', 'Lato-BoldItalic']) {
    assert.ok(encoded.includes(font), `Missing font face ${font}`);
  }
  assert.equal(
    encoded.match(/\/FontFile2\b/g)?.length,
    4,
    'embed every used face, not system-font references'
  );
  assert.equal(
    encoded.match(/\/ToUnicode\b/g)?.length,
    4,
    'each font must support selectable Unicode text'
  );
});

test('long content naturally paginates without text loss, clipping, or shrinking; long identifiers wrap', async () => {
  const paragraphs = Array.from(
    { length: 100 },
    (_, index) =>
      `Entry ${String(index).padStart(3, '0')}: Built reliable software with thoughtful colleagues and measurable results.`
  );
  const unbroken = 'W'.repeat(1200);
  const { buffer, warnings } = await renderResumePdf(
    resume('# Employment history', ...paragraphs, unbroken, 'END OF GENERATED RESUME')
  );
  assert.deepEqual(warnings, []);
  const pdf = await parsed(buffer);
  try {
    assert.ok(pdf.numPages >= 4, `Expected natural multipage layout, got ${pdf.numPages}`);
    const { text } = await extractText(pdf, { mergePages: true });
    for (let i = 0; i < paragraphs.length; i++) {
      assert.ok(text.includes(`Entry ${String(i).padStart(3, '0')}:`), `Lost entry ${i}`);
    }
    assert.ok(text.includes('END OF GENERATED RESUME'));
    assert.equal(text.match(/W/g)?.length, unbroken.length, 'long words must not be truncated');
    const { items } = await extractTextItems(pdf);
    for (let index = 0; index < items.length; index++) {
      assert.deepEqual((await pdf.getPage(index + 1)).view, [0, 0, 612, 792]);
      for (const item of items[index].filter((item) => item.str.trim())) {
        assert.ok(
          item.x >= 47 && item.x + item.width <= 565,
          `Text outside horizontal margins: ${JSON.stringify(item)}`
        );
        assert.ok(
          item.y >= 40 && item.y <= 751,
          `Text outside vertical margins: ${JSON.stringify(item)}`
        );
        if (/Entry|^W/.test(item.str)) {
          assert.equal(item.fontSize, 10.5, 'body text must not silently shrink');
        }
      }
    }
  } finally {
    await pdf.loadingTask.destroy();
  }
});

test('unsupported Markdown remains readable, unsafe links are inactive, and Markdown never fetches resources', async () => {
  const source = [
    '| Column | Value |',
    '| --- | --- |',
    '| readable table | preserved cell |',
    '',
    '![remote image](https://example.invalid/pixel.png)',
    '',
    '<script src="https://example.invalid/script.js">raw HTML preserved</script>',
    '',
    '~~strikethrough preserved~~',
    '',
    '- [x] task source preserved',
    '',
    '[unsafe](javascript:alert%281%29)',
    '[file](file:///etc/passwd)',
    '[data](data:text/html,hello)',
    '[encoded](jav&#x61;script:alert%281%29)',
    '[relative](/not-a-fetch-target)',
    '',
    '[safe](https://example.com/safe)',
    '[mail](mailto:fixture@example.com)',
  ].join('\n');
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    throw new Error('Unexpected external request');
  };
  try {
    const { buffer, warnings } = await renderResumePdf(
      resume('## ![heading image](https://example.invalid/title.png)', source)
    );
    for (const label of [
      'Tables',
      'Images',
      'Raw HTML',
      'Strikethrough',
      'Task lists',
      'link destination',
    ]) {
      assert.ok(
        warnings.some((warning) => warning.includes(label)),
        `Missing warning for ${label}`
      );
    }
    const text = await textOf(buffer);
    for (const phrase of [
      'readable table',
      'preserved cell',
      '![remote image]',
      'raw HTML preserved',
      '~~strikethrough preserved~~',
      '[x] task source preserved',
      '[unsafe]',
      // oxlint-disable-next-line no-script-url -- Assert an intentionally unsafe fixture stays visible as text.
      'javascript:',
      'file:///',
      'data:text/html',
      '![heading image]',
    ]) {
      assert.ok(text.includes(phrase), `Unsupported source disappeared: ${phrase}\n${text}`);
    }
    const pdf = await parsed(buffer);
    try {
      const urls: string[] = [];
      for (let page = 1; page <= pdf.numPages; page++) {
        urls.push(
          ...(await (await pdf.getPage(page)).getAnnotations())
            .map((item) => item.url)
            .filter(Boolean)
        );
      }
      assert.deepEqual(
        [...new Set(urls)].sort(),
        ['https://example.com/safe', 'mailto:fixture@example.com'].sort()
      );
    } finally {
      await pdf.loadingTask.destroy();
    }
    const draft = await extractPdfDraft(buffer);
    assert.ok(draft.markdown.includes('raw HTML preserved'));
    assert.deepEqual(requests, [], 'rendering and extraction must remain local');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('renderer warnings and content are isolated across simultaneous requests', async () => {
  const [first, second] = await Promise.all([
    renderResumePdf(resume('![unsupported](https://example.invalid/image.png)')),
    renderResumePdf(resume('Independent document text.')),
  ]);
  assert.equal(first.warnings.length, 1);
  assert.deepEqual(second.warnings, []);
  assert.equal(await textOf(second.buffer), 'Independent document text.');
  assert.ok(!(await textOf(first.buffer)).includes('Independent document text'));
});

test('whole-source inline heading Markdown is rendered and empty documents are valid PDFs', async () => {
  const { buffer } = await renderResumePdf(
    resume('Intro body', '## **Skills** with `code`', 'Body text')
  );
  assert.equal(await textOf(buffer), 'Intro body\nSkills with code\nBody text');
  const empty = await renderResumePdf(resume());
  const pdf = await parsed(empty.buffer);
  try {
    assert.equal(pdf.numPages, 1);
    assert.equal(await textOf(empty.buffer), '');
  } finally {
    await pdf.loadingTask.destroy();
  }
});

test('extractor produces a reviewable escaped text draft without inferring Markdown or detaching input', async () => {
  const { buffer } = await renderResumePdf(
    resume('# Élodie García\n\nA careful paragraph with [a link](https://example.com).')
  );
  const bytes = new Uint8Array(buffer);
  const original = new Uint8Array(bytes);
  const draft = await extractPdfDraft(bytes);
  assert.equal(draft.pages, 1);
  assert.ok(draft.markdown.includes('Élodie García'));
  assert.ok(draft.markdown.includes('A careful paragraph with a link\\.'));
  assert.ok(draft.warnings.some((warning) => /reading order.*Review/.test(warning)));
  assert.deepEqual(bytes, original, 'PDF.js must not detach or mutate caller-owned bytes');

  const literal = await fixture([
    '# Not an inferred heading\n- Not an inferred list\n[link](https://example.invalid)\n<img src="https://example.invalid/image">',
  ]);
  const escaped = await extractPdfDraft(literal);
  assert.ok(escaped.markdown.includes('\\# Not an inferred heading'));
  assert.ok(escaped.markdown.includes('\\- Not an inferred list'));
  assert.ok(escaped.markdown.includes('\\[link\\]\\(https\\://example\\.invalid\\)'));
  assert.ok(escaped.markdown.includes('\\<img'));
});

test('PDF-imported lines become hard breaks without reinterpreting literal text', async () => {
  const lines = [
    'Alex Morgan',
    'Full-Stack Software Engineer',
    'Github: https://example.invalid/profile',
    'EXPERIENCE',
    '# Not an inferred heading',
    '- Not an inferred list',
    '*Literal* &amp; [label](https://example.invalid)',
    'A literal backslash at the end \\',
  ];
  const draft = await extractPdfDraft(await fixture([lines.join('\n')]));
  assert.ok(draft.markdown.includes('Alex Morgan  \nFull\\-Stack'));
  const parsed = parseResumeMarkdown(draft.markdown);
  assert.equal(parsed.blocks.length, 1);
  const paragraph = parsed.blocks[0];
  assert.equal(paragraph.type, 'paragraph');
  if (paragraph.type !== 'paragraph') {
    assert.fail('Imported PDF text must remain a literal paragraph.');
  }
  assert.equal(paragraph.children.filter((node) => node.type === 'break').length, lines.length - 1);
  assert.equal(
    paragraph.children
      .map((node) => {
        if (node.type === 'break') return '\n';
        if (node.type === 'text') return node.text;
        return assert.fail('Imported PDF text must not gain formatting or links.');
      })
      .join(''),
    lines.join('\n')
  );
  assert.equal(draft.markdown.endsWith('  '), false);
});

test('PDF-imported line breaks leave page separators as paragraphs', async () => {
  const draft = await extractPdfDraft(
    await fixture(['First line\nSecond line', 'Next page\nFinal line'])
  );
  assert.equal(draft.markdown, 'First line  \nSecond line\n\nNext page  \nFinal line');
  const parsed = parseResumeMarkdown(draft.markdown);
  assert.equal(parsed.blocks.length, 2);
  for (const block of parsed.blocks) {
    assert.equal(block.type, 'paragraph');
    if (block.type === 'paragraph') {
      assert.equal(block.children.filter((node) => node.type === 'break').length, 1);
    }
  }
});

test('extractor warns honestly when only some pages contain text', async () => {
  const buffer = await fixture(['First generated page', '', 'Last generated page']);
  const draft = await extractPdfDraft(buffer);
  assert.equal(draft.pages, 3);
  assert.equal(draft.markdown, 'First generated page\n\nLast generated page');
  assert.ok(
    draft.warnings.some((warning) => /Partial extraction.*page 2.*not recovered/.test(warning))
  );
});

test('extractor rejects missing signatures, invalid PDFs, and files exceeding 10 MiB clearly', async () => {
  for (const bytes of [
    new Uint8Array(),
    Buffer.from('not a PDF'),
    Buffer.from('<html>not a PDF</html>'),
  ]) {
    await assert.rejects(extractPdfDraft(bytes), /Invalid PDF.*signature/);
  }
  await assert.rejects(
    extractPdfDraft(Buffer.from('%PDF-1.7\ninvalid fixture')),
    /Invalid or unreadable PDF/
  );
  assert.equal(MAX_PDF_BYTES, 10 * 1024 * 1024);
  const oversized = new Uint8Array(MAX_PDF_BYTES + 1);
  oversized.set(Buffer.from('%PDF-1.7'));
  await assert.rejects(extractPdfDraft(oversized), /10 MiB or smaller/);
});

test('extractor rejects password-protected and empty-user-password encrypted PDFs', async () => {
  for (const userPassword of ['generated-user-password', '']) {
    const buffer = await fixture(['Generated encryption fixture'], {
      ownerPassword: 'generated-owner-password',
      userPassword,
    });
    assert.ok(
      buffer.includes(Buffer.from('/Encrypt')),
      'the generated fixture must really be encrypted'
    );
    await assert.rejects(extractPdfDraft(buffer), /Encrypted PDFs.*unencrypted PDF/);
  }
});

test('extractor rejects entirely textless PDFs with an explicit no-OCR message', async () => {
  await assert.rejects(
    extractPdfDraft(await fixture(['', ''])),
    /no extractable text.*OCR.*not supported/
  );
});

test('extractor enforces 20-page maximum, including empty pages, and accepts exactly 20', async () => {
  assert.equal(MAX_PDF_PAGES, 20);
  const tooMany = await fixture(['Generated text', ...Array.from({ length: 20 }, () => '')]);
  await assert.rejects(extractPdfDraft(tooMany), /at most 20 pages/);
  const boundary = await fixture(Array.from({ length: 20 }, (_, i) => `Generated page ${i + 1}`));
  const draft = await extractPdfDraft(boundary);
  assert.equal(draft.pages, 20);
  assert.ok(draft.markdown.includes('Generated page 20'));
  assert.equal(draft.warnings.length, 1, 'all pages at the boundary extracted successfully');
});
