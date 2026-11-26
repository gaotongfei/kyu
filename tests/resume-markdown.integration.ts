import assert from 'node:assert/strict';
import { test } from 'node:test';
import { marked } from 'marked';
import {
  parseResumeMarkdown,
  type BlockNode,
  type InlineNode,
} from '../app/resumes/resume-markdown';

const text = (value: string): InlineNode => ({ type: 'text', text: value });
const paragraph = (value: string): BlockNode => ({
  type: 'paragraph',
  children: [text(value)],
});

function inlineText(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
        case 'code':
          return node.text;
        case 'break':
          return '\n';
        default:
          return inlineText(node.children);
      }
    })
    .join('');
}

function blockInlines(nodes: BlockNode[]): InlineNode[] {
  return nodes.flatMap((node): InlineNode[] => {
    switch (node.type) {
      case 'heading':
      case 'paragraph':
        return node.children;
      case 'quote':
        return blockInlines(node.children);
      case 'list':
        return node.items.flatMap(blockInlines);
      default:
        return [];
    }
  });
}

function links(nodes: InlineNode[]): Extract<InlineNode, { type: 'link' }>[] {
  return nodes.flatMap((node) => {
    switch (node.type) {
      case 'link':
        return [node, ...links(node.children)];
      case 'strong':
      case 'em':
        return links(node.children);
      default:
        return [];
    }
  });
}

const unsupportedWarning = (label: string) =>
  `${label}: unsupported in Classic; its source is displayed as text.`;
const unsafeWarning =
  'An unsafe or unsupported link destination was disabled; its Markdown source is displayed as text.';

test('shared whole-document AST represents supported Markdown, nesting, code, and explicit versus soft breaks', () => {
  const source = [
    '# Heading',
    '',
    'A soft',
    'line with **bold and *emphasis***, `&amp;`, and [a **link**](https://example.com/work).',
    '',
    'Hard line  ',
    'next line.',
    '',
    '> A quotation.',
    '',
    '---',
    '',
    '```ts',
    'const literal = "<tag> &amp;";',
    '```',
    '',
    '3. Third',
    '4. Fourth',
    '   - Nested',
    '',
    '## **Experience** and *Education*',
  ].join('\n');
  assert.deepEqual(parseResumeMarkdown(source), {
    blocks: [
      { type: 'heading', depth: 1, children: [text('Heading')] },
      {
        type: 'paragraph',
        children: [
          text('A soft line with '),
          {
            type: 'strong',
            children: [text('bold and '), { type: 'em', children: [text('emphasis')] }],
          },
          text(', '),
          { type: 'code', text: '&amp;' },
          text(', and '),
          {
            type: 'link',
            href: 'https://example.com/work',
            children: [text('a '), { type: 'strong', children: [text('link')] }],
          },
          text('.'),
        ],
      },
      {
        type: 'paragraph',
        children: [text('Hard line'), { type: 'break' }, text('next line.')],
      },
      { type: 'quote', children: [paragraph('A quotation.')] },
      { type: 'rule' },
      { type: 'code', text: 'const literal = "<tag> &amp;";' },
      {
        type: 'list',
        ordered: true,
        start: 3,
        items: [
          [paragraph('Third')],
          [
            paragraph('Fourth'),
            { type: 'list', ordered: false, start: 1, items: [[paragraph('Nested')]] },
          ],
        ],
      },
      {
        type: 'heading',
        depth: 2,
        children: [
          { type: 'strong', children: [text('Experience')] },
          text(' and '),
          { type: 'em', children: [text('Education')] },
        ],
      },
    ],
    warnings: [],
  });
});

test('all heading depths, setext headings, CRLF soft lines, and backslash hard breaks are shared', () => {
  const headings = Array.from({ length: 6 }, (_, index) => `${'#'.repeat(index + 1)} Heading`);
  const result = parseResumeMarkdown(
    [...headings, '', 'Setext', '------', '', 'Soft\r\nline\\\r\nhard'].join('\r\n')
  );
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.blocks, [
    ...headings.map((_, index) => ({
      type: 'heading',
      depth: index + 1,
      children: [text('Heading')],
    })),
    { type: 'heading', depth: 2, children: [text('Setext')] },
    {
      type: 'paragraph',
      children: [text('Soft line'), { type: 'break' }, text('hard')],
    },
  ]);
});

test('entities decode once as text while escapes, code, and unknown entity names remain literal', () => {
  const result = parseResumeMarkdown(
    [
      String.raw`A &amp; B &lt;tag&gt; &#169; &#x1F600; &nbsp; &copy; &reg; &hellip; &ndash; &mdash; &quot; &apos; &unknown; &constructor; &#0; &#xD800; &#x110000; \&amp; \*literal\*`,
      '`&amp; <code>`',
    ].join(' ')
  );
  assert.deepEqual(result.warnings, []);
  const nodes = blockInlines(result.blocks);
  assert.equal(
    inlineText(nodes),
    'A & B <tag> © 😀 \u00a0 © ® … – — " \' &unknown; &constructor; � � � &amp; *literal* &amp; <code>'
  );
  assert.ok(nodes.every((node) => node.type === 'text' || node.type === 'code'));
});

test('reference links resolve throughout the source, including forward references, headings, prototype keys and first definitions', () => {
  const result = parseResumeMarkdown(
    [
      '# [constructor] and [Portfolio][work]',
      '',
      '[constructor] [__proto__] [toString] [hasOwnProperty] [Portfolio][WORK]',
      '',
      '[constructor]: https://example.com/constructor',
      '[__proto__]: https://example.com/proto',
      '[toString]: https://example.com/toString',
      '[hasOwnProperty]: https://example.com/hasOwnProperty',
      '[work]: https://example.com/first',
      '[work]: https://example.com/second-in-run',
      '',
      '## More work',
      '',
      '[Portfolio][work]',
      '',
      '[work]: https://example.com/third-in-document',
      '',
      '[Portfolio][work]',
    ].join('\n')
  );
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(
    links(blockInlines(result.blocks)).map((node) => node.href),
    [
      'https://example.com/constructor',
      'https://example.com/first',
      'https://example.com/constructor',
      'https://example.com/proto',
      'https://example.com/toString',
      'https://example.com/hasOwnProperty',
      'https://example.com/first',
      'https://example.com/first',
      'https://example.com/first',
    ]
  );
  const undefinedReferences = parseResumeMarkdown(
    '# [constructor]\n\n[constructor] [__proto__] [toString] [hasOwnProperty]'
  );
  assert.deepEqual(links(blockInlines(undefinedReferences.blocks)), []);
  assert.deepEqual(undefinedReferences.warnings, []);
});

test('unsupported Markdown stays literal with shared Classic warnings, without traversing its contents', () => {
  const table = '| Column | Value |\n| --- | --- |\n| **bold** | &amp; |';
  const html = '<script src="https://example.invalid/script.js">&amp; **literal**</script>';
  const image = '![remote **image**](https://example.invalid/pixel.png)';
  const strike = '~~**literal** [link](https://example.invalid/strike) &amp;~~';
  const task = '- [x] **literal** [link](https://example.invalid/task) &amp;';
  const source = [table, html, image, strike, task].join('\n\n');
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    throw new Error('Unexpected external request');
  };
  try {
    const result = parseResumeMarkdown(source);
    assert.deepEqual(
      result.blocks.map((block) => {
        assert.equal(block.type, 'paragraph');
        return { ...block, children: [text(inlineText(block.children).trimEnd())] };
      }),
      [
        { type: 'paragraph', literal: true, children: [text(table)] },
        { type: 'paragraph', literal: true, children: [text(html)] },
        paragraph(image),
        paragraph(strike),
        { type: 'paragraph', literal: true, children: [text(task)] },
      ]
    );
    assert.deepEqual(links(blockInlines(result.blocks)), []);
    assert.deepEqual(
      [...result.warnings].sort(),
      ['Images', 'Tables', 'Raw HTML', 'Strikethrough', 'Task lists'].map(unsupportedWarning).sort()
    );
    assert.deepEqual(requests, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('literal task items split supported list runs without extra markers or lost ordered numbering', () => {
  const result = parseResumeMarkdown('1. First\n2. [x] task **source**\n3. Third\n4. Fourth');
  assert.deepEqual(result.blocks, [
    { type: 'list', ordered: true, start: 1, items: [[paragraph('First')]] },
    { type: 'paragraph', literal: true, children: [text('2. [x] task **source**\n')] },
    {
      type: 'list',
      ordered: true,
      start: 3,
      items: [[paragraph('Third')], [paragraph('Fourth')]],
    },
  ]);
  assert.deepEqual(result.warnings, [unsupportedWarning('Task lists')]);
});

test('only validated HTTP(S) and mailto destinations become links; unsafe source stays untouched', () => {
  const unsafe = [
    // oxlint-disable-next-line no-script-url -- Intentionally unsafe fixture must remain text.
    '[script](javascript:alert%281%29)',
    '[encoded](jav&#x61;script:alert%281%29)',
    '[data](data:text/html,hello)',
    '[file](file:///etc/passwd)',
    '[relative](/not-a-fetch-target)',
    '[protocol-relative](//example.com/path)',
    '[control](https://example.com/&#x0a;path)',
    '[space](https://example.com/&#32;path)',
    '[delete](https://example.com/&#127;path)',
    '[invalid](https://)',
    '[encoded-scheme](https%3A%2F%2Fexample.com)',
  ];
  const safe = [
    '[web](HTTPS://Example.com/path?a=1&amp;b=2)',
    '[http](http://example.com)',
    '[email](mailto:fixture@example.com)',
    '<https://example.com/auto>',
    'www.example.com',
    String.raw`[escaped](https://example.com/a\(b\)?a=1&amp;b=2)`,
    '[decode-once](https://example.com/?literal=&amp;amp;)',
  ];
  const result = parseResumeMarkdown([...unsafe, ...safe].join('\n\n'));
  assert.deepEqual(result.blocks.slice(0, unsafe.length), unsafe.map(paragraph));
  assert.deepEqual(
    links(blockInlines(result.blocks)).map((node) => node.href),
    [
      'https://example.com/path?a=1&b=2',
      'http://example.com/',
      'mailto:fixture@example.com',
      'https://example.com/auto',
      'http://www.example.com/',
      'https://example.com/a(b)?a=1&b=2',
      'https://example.com/?literal=&amp;',
    ]
  );
  assert.deepEqual(result.warnings, [unsafeWarning]);
});

test('fresh lexers ignore global marked options and extensions and isolate references and warnings', () => {
  marked.use({
    breaks: true,
    extensions: [
      {
        name: 'untrusted-extension',
        level: 'inline',
        start: (source) => source.indexOf('INJECT'),
        tokenizer: (source) =>
          source.startsWith('INJECT') ? { type: 'untrusted-extension', raw: 'INJECT' } : undefined,
      },
    ],
  });
  try {
    const source = 'INJECT soft\nline\n\n[constructor]\n\n![image](https://example.invalid)';
    const first = parseResumeMarkdown(source);
    assert.deepEqual(first.blocks[0], paragraph('INJECT soft line'));
    assert.deepEqual(first.warnings, [unsupportedWarning('Images')]);
    parseResumeMarkdown('[constructor]: https://example.com/other-document');
    const next = parseResumeMarkdown('[constructor]');
    assert.deepEqual(next.blocks, [paragraph('[constructor]')]);
    assert.deepEqual(next.warnings, []);
    assert.deepEqual(parseResumeMarkdown(source), first);
  } finally {
    marked.setOptions({ breaks: false, extensions: null });
  }
});

test('empty and whitespace-only whole documents produce no spurious nodes', () => {
  for (const source of ['', '  ', '\r\n\t\r\n']) {
    assert.deepEqual(parseResumeMarkdown(source), { blocks: [], warnings: [] });
  }
});
